import { Prisma, type Collection, type Print } from "@prisma/client";
import { prisma } from "../db";
import { toCollectionOut, type CollectionOut, type PrintOut, type UserCardOut } from "../dto";
import { printOutById, printOutsByIds } from "./printLoader";
import { getSocialSettings } from "./settingsService";

// Social features: while an admin has them on, a collection its owner made public is shown to the instance's other
// users on Explore, and every model in one can be opened, downloaded and copied by them -- what the owner can do with
// it, short of changing it. Changing a model, a collection or anything else stays its owner's alone: every write keeps
// its `{ userId }`, and only what reads goes through readablePrintWhere.

const IN_PUBLIC_COLLECTION: Prisma.PrintWhereInput = { collectionItems: { some: { collection: { isPublic: true } } } };

/** Whether Explore is offered: social features are on, and there's someone else on the instance to explore. */
export async function socialStatus(): Promise<{ enabled: boolean; explore: boolean }> {
  const { enabled } = await getSocialSettings();
  if (!enabled) return { enabled, explore: false };
  return { enabled, explore: (await prisma.user.count({ take: 2 })) > 1 };
}

/** The models `userId` may open, download and copy: their own, and while social features are on, every model in a
 *  public collection. Only for reading: whatever changes a model stays `{ userId }`. */
export async function readablePrintWhere(userId: string): Promise<Prisma.PrintWhereInput> {
  if (!(await getSocialSettings()).enabled) return { userId };
  return { OR: [{ userId }, IN_PUBLIC_COLLECTION] };
}

/** A collection `userId` may open: their own, or while social features are on, a public one. */
export async function readableCollection(userId: string, collectionId: string): Promise<Collection | null> {
  const collection = await prisma.collection.findUnique({ where: { id: collectionId } });
  if (!collection) return null;
  if (collection.userId === userId) return collection;
  return collection.isPublic && (await getSocialSettings()).enabled ? collection : null;
}

/** How each user is shown to the others: their name, and the picture of the provider profile they linked as themselves. */
export async function userCards(userIds: string[]): Promise<Map<string, UserCardOut>> {
  const unique = [...new Set(userIds)];
  if (!unique.length) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: {
      id: true,
      displayName: true,
      authorLinks: {
        where: { author: { avatarUrl: { not: null } } },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { author: { select: { avatarUrl: true } } },
      },
    },
  });
  return new Map(
    users.map((user) => [
      user.id,
      { id: user.id, display_name: user.displayName, avatar_url: user.authorLinks[0]?.author.avatarUrl ?? null },
    ]),
  );
}

type CopySource = {
  id: string;
  originalId: string | null;
  sourceProvider: string | null;
  sourceExternalId: string | null;
};

/** The model a copy, or a copy of a copy, was first copied from; a model that's no copy is its own. */
const originalOf = (print: Pick<CopySource, "id" | "originalId">) => print.originalId ?? print.id;

/** For each model, `userId`'s own copy of it, where they have one: a model of theirs with the same original -- the
 *  original itself, or a copy of it however many copies along -- or the same model imported from the same source. */
export async function libraryCopyIds(userId: string, sources: CopySource[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!sources.length) return out;
  const originals = [...new Set(sources.map(originalOf))];
  const pairs = sources.flatMap((source) =>
    source.sourceProvider && source.sourceExternalId
      ? [{ sourceProvider: source.sourceProvider, sourceExternalId: source.sourceExternalId }]
      : [],
  );
  const mine = await prisma.print.findMany({
    where: { userId, OR: [{ id: { in: originals } }, { originalId: { in: originals } }, ...pairs] },
    select: { id: true, originalId: true, sourceProvider: true, sourceExternalId: true },
  });
  for (const source of sources) {
    const copy =
      mine.find((print) => originalOf(print) === originalOf(source)) ??
      mine.find(
        (print) =>
          source.sourceProvider !== null &&
          source.sourceExternalId !== null &&
          print.sourceProvider === source.sourceProvider &&
          print.sourceExternalId === source.sourceExternalId,
      );
    if (copy) out.set(source.id, copy.id);
  }
  return out;
}

/** `userId`'s own copy of the model, as libraryCopyIds finds it. */
export async function libraryCopyOf(userId: string, source: CopySource): Promise<Print | null> {
  const id = (await libraryCopyIds(userId, [source])).get(source.id);
  return id ? prisma.print.findUnique({ where: { id } }) : null;
}

/** Another user's model as anyone else sees it: whose it is, without what's the owner's alone -- their sorting, AI
 *  reviews waiting for them, their counts, and where on the server its files are. */
function sharedPrintOut(out: PrintOut, owner: UserCardOut, libraryCopyId: string | null): PrintOut {
  return {
    ...out,
    category_id: null,
    category_name: null,
    category_source: null,
    category_kind: null,
    ai_suggestion: null,
    ai_description_suggestion: null,
    ai_description_pending: false,
    ai_description_original: null,
    storage_path: null,
    view_count: 0,
    print_count: 0,
    is_favorite: false,
    source_gaps: null,
    owner,
    library_copy_id: libraryCopyId,
  };
}

/** Marks the models among `outs` that aren't `viewerId`'s as shared ones (sharedPrintOut). Their own are untouched. */
export async function withOwners(viewerId: string, outs: PrintOut[]): Promise<PrintOut[]> {
  if (!outs.length) return outs;
  const rows = await prisma.print.findMany({
    where: { id: { in: outs.map((out) => out.id) }, userId: { not: viewerId } },
    select: { id: true, userId: true, originalId: true, sourceProvider: true, sourceExternalId: true },
  });
  if (!rows.length) return outs;
  const [owners, copies] = await Promise.all([
    userCards(rows.map((row) => row.userId)),
    libraryCopyIds(viewerId, rows),
  ]);
  const rowOf = new Map(rows.map((row) => [row.id, row]));
  return outs.map((out) => {
    const row = rowOf.get(out.id);
    const owner = row && owners.get(row.userId);
    return owner ? sharedPrintOut(out, owner, copies.get(out.id) ?? null) : out;
  });
}

/** One model `viewerId` may read, theirs or shared. 404s like printOutById otherwise. */
export async function readablePrintOutById(viewerId: string, printId: string): Promise<PrintOut> {
  const out = await printOutById(viewerId, printId, await readablePrintWhere(viewerId));
  return (await withOwners(viewerId, [out]))[0];
}

/** Those of `printIds` `viewerId` may read, in the order given. */
export async function readablePrintOuts(viewerId: string, printIds: string[]): Promise<PrintOut[]> {
  const byId = await printOutsByIds(viewerId, printIds, await readablePrintWhere(viewerId));
  const outs = printIds.flatMap((id) => byId.get(id) ?? []);
  return withOwners(viewerId, outs);
}

const COVER_ITEM_LIMIT = 4;

/** Collections as `viewerId` sees them, with their covers; another user's says whose it is. */
export async function collectionOutsFor(viewerId: string, collections: Collection[]): Promise<CollectionOut[]> {
  if (!collections.length) return [];
  const ids = collections.map((collection) => collection.id);
  const [counts, items, owners] = await Promise.all([
    prisma.collectionItem.groupBy({ by: ["collectionId"], where: { collectionId: { in: ids } }, _count: true }),
    // The first few of each, as a cover shows them, in one query and without reading every model of a big collection.
    prisma.$queryRaw<{ collectionId: string; printId: string }[]>`
      SELECT "collectionId", "printId" FROM (
        SELECT "collectionId", "printId", position,
          ROW_NUMBER() OVER (PARTITION BY "collectionId" ORDER BY position, id) AS place
        FROM "CollectionItem"
        WHERE "collectionId" IN (${Prisma.join(ids)})
      ) ranked
      WHERE place <= ${COVER_ITEM_LIMIT}
      ORDER BY "collectionId", place`,
    userCards(collections.filter((c) => c.userId !== viewerId).map((c) => c.userId)),
  ]);
  const covers = new Map(
    (await readablePrintOuts(viewerId, [...new Set(items.map((item) => item.printId))])).map((out) => [out.id, out]),
  );
  const countOf = new Map(counts.map((row) => [row.collectionId, row._count]));
  return collections.map((collection) => {
    const cover = items
      .filter((item) => item.collectionId === collection.id)
      .flatMap((item) => covers.get(item.printId) ?? []);
    const out = toCollectionOut(collection, countOf.get(collection.id) ?? 0, cover, false);
    return { ...out, owner: owners.get(collection.userId) ?? null };
  });
}

export type ExplorePersonOut = UserCardOut & { collection_count: number; model_count: number };

/** The users, in the order given, with what each shares: three queries however many there are. */
async function people(userIds: string[]): Promise<ExplorePersonOut[]> {
  if (!userIds.length) return [];
  const [cards, collections, models] = await Promise.all([
    userCards(userIds),
    prisma.collection.groupBy({ by: ["userId"], where: { userId: { in: userIds }, isPublic: true }, _count: true }),
    prisma.print.groupBy({ by: ["userId"], where: { userId: { in: userIds }, ...IN_PUBLIC_COLLECTION }, _count: true }),
  ]);
  const countOf = (rows: { userId: string; _count: number }[]) => new Map(rows.map((row) => [row.userId, row._count]));
  const [collectionCounts, modelCounts] = [countOf(collections), countOf(models)];
  return userIds.flatMap((userId) => {
    const card = cards.get(userId);
    if (!card) return [];
    return [
      { ...card, collection_count: collectionCounts.get(userId) ?? 0, model_count: modelCounts.get(userId) ?? 0 },
    ];
  });
}

export type ExploreOut = {
  /** The other users with a public collection, those who shared most recently first; the most recent few dozen. */
  people: ExplorePersonOut[];
  /** The models most recently put in another user's public collection. */
  recent_models: PrintOut[];
  /** Other users' public collections, the most recently changed or added to first. */
  recent_collections: CollectionOut[];
  /** Other users' shared models the instance's users copied most, with how many did. */
  most_collected: { model: PrintOut; copies: number }[];
};

const PEOPLE = 48;
const RECENT_MODELS = 12;
const RECENT_COLLECTIONS = 8;
const MOST_COLLECTED = 12;

/** Everything Explore's page shows `viewerId`. Their own collections and models are left out: they're not news to them. */
export async function exploreOverview(viewerId: string): Promise<ExploreOut> {
  const othersPublic = { isPublic: true, userId: { not: viewerId } } satisfies Prisma.CollectionWhereInput;
  // A collection changes when it's made public or renamed (updatedAt), or something is put in it: whichever was last.
  // Ranked in the database, as it takes the latest of each collection's items.
  const [recentCollectionIds, sharers, recentItems, collected] = await Promise.all([
    prisma.$queryRaw<{ id: string }[]>`
      SELECT c.id FROM "Collection" c
      LEFT JOIN "CollectionItem" i ON i."collectionId" = c.id
      WHERE c."isPublic" AND c."userId" <> ${viewerId}
      GROUP BY c.id
      ORDER BY GREATEST(c."updatedAt", COALESCE(MAX(i."createdAt"), c."updatedAt")) DESC, c.id
      LIMIT ${RECENT_COLLECTIONS}`,
    // Those who share, by when they last did.
    prisma.$queryRaw<{ userId: string }[]>`
      SELECT c."userId" FROM "Collection" c
      LEFT JOIN "CollectionItem" i ON i."collectionId" = c.id
      WHERE c."isPublic" AND c."userId" <> ${viewerId}
      GROUP BY c."userId"
      ORDER BY MAX(GREATEST(c."updatedAt", COALESCE(i."createdAt", c."updatedAt"))) DESC, c."userId"
      LIMIT ${PEOPLE}`,
    // Each model once, by when it was last filed: one filed in many collections doesn't fill the row.
    prisma.collectionItem.groupBy({
      by: ["printId"],
      where: { collection: othersPublic },
      _max: { createdAt: true },
      orderBy: { _max: { createdAt: "desc" } },
      take: RECENT_MODELS,
    }),
    prisma.print.findMany({
      where: { userId: { not: viewerId }, ...IN_PUBLIC_COLLECTION, copies: { some: {} } },
      orderBy: [{ copies: { _count: "desc" } }, { createdAt: "desc" }],
      take: MOST_COLLECTED,
      select: { id: true, _count: { select: { copies: true } } },
    }),
  ]);

  const collectionIds = recentCollectionIds.map((row) => row.id);
  // Still public: one made private since it was ranked isn't shown.
  const recentCollections = await prisma.collection.findMany({ where: { id: { in: collectionIds }, ...othersPublic } });
  const byChange = collectionIds.flatMap((id) => recentCollections.find((collection) => collection.id === id) ?? []);

  const [peopleOut, recentModels, recentCollectionOuts, collectedModels] = await Promise.all([
    people(sharers.map((row) => row.userId)),
    readablePrintOuts(
      viewerId,
      recentItems.map((item) => item.printId),
    ),
    collectionOutsFor(viewerId, byChange),
    readablePrintOuts(
      viewerId,
      collected.map((print) => print.id),
    ),
  ]);
  const copiesOf = new Map(collected.map((print) => [print.id, print._count.copies]));
  return {
    // Someone who stopped sharing since they were listed.
    people: peopleOut.filter((person) => person.collection_count > 0),
    recent_models: recentModels,
    recent_collections: recentCollectionOuts,
    most_collected: collectedModels.map((model) => ({ model, copies: copiesOf.get(model.id) ?? 0 })),
  };
}

export type ExploreUserOut = {
  user: ExplorePersonOut & { bio: string | null; joined_at: string };
  collections: CollectionOut[];
};

/** One user's page: who they are and their public collections. Null for no such user, and for one who shares nothing:
 *  they never chose to be seen. The viewer's own always, so they can see what the others see of them. */
export async function exploreUser(viewerId: string, userId: string): Promise<ExploreUserOut | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, bio: true, createdAt: true },
  });
  if (!user) return null;
  const [[person], collections] = await Promise.all([
    people([user.id]),
    prisma.collection.findMany({ where: { userId, isPublic: true }, orderBy: { createdAt: "desc" } }),
  ]);
  if (!person || (!collections.length && userId !== viewerId)) return null;
  return {
    user: { ...person, bio: user.bio, joined_at: user.createdAt.toISOString() },
    collections: await collectionOutsFor(viewerId, collections),
  };
}
