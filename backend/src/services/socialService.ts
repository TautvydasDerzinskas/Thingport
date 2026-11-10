import { Prisma, type Collection, type Print } from "@prisma/client";
import { prisma } from "../db";
import { toCollectionOut, type CollectionOut, type PrintOut, type UserCardOut } from "../dto";
import { printOutById, printOutsByIds } from "./printLoader";
import { getPublicUrl, getSocialSettings } from "./settingsService";
import { isFederationLive } from "../federation/settings";
import { profileOut, type PublicProfileOut } from "./publicProfileService";
import { avatarUrlOf } from "./avatarService";
import {
  listPrints,
  ownDesignsWhere,
  SELF_AUTHOR_ID,
  type PrintFilters,
  type PrintListPage,
  type PrintSortMode,
} from "./printQuery";

// Social features: while an admin has them on, a collection its owner made public is shown to the instance's other
// users on Explore, and every model in one can be opened, downloaded and copied by them -- what the owner can do with
// it, short of changing it. A collection its owner shared with some people is the same to those people, and stays off
// Explore. So can a user's own models, as their My models lists them, once they made those public. So can a model sent
// in a chat, by whoever can read that chat, while chats are on too.
// Changing a model, a collection or anything else stays its owner's alone: every write keeps its `{ userId }`, and only
// what reads goes through readablePrintWhere.

const PUBLIC = { visibility: "PUBLIC" } satisfies Prisma.CollectionWhereInput;
const IN_PUBLIC_COLLECTION: Prisma.PrintWhereInput = { collectionItems: { some: { collection: PUBLIC } } };

/** A collection its owner shared with `userId`: SHARED, and they're among its people. */
export const sharedWithWhere = (userId: string): Prisma.CollectionWhereInput => ({
  visibility: "SHARED",
  shares: { some: { userId } },
});

/** Sent in a message, still there, of a chat `userId` can read: one they're in, or a public room. */
const sentInChatsOf = (userId: string): Prisma.PrintWhereInput => ({
  chatAttachments: {
    some: {
      message: {
        deletedAt: null,
        chat: { OR: [{ members: { some: { userId } } }, { kind: "ROOM", isPublic: true }] },
      },
    },
  },
});

/** The models of every user who made their own public: as their My models lists them, and only theirs -- another
 *  user's import of the same design stays that user's. One query; few users share. */
async function publicDesigners(): Promise<{ userId: string; since: number; where: Prisma.PrintWhereInput }[]> {
  const users = await prisma.user.findMany({
    where: { modelsPublic: true },
    select: { id: true, modelsPublicAt: true, authorLinks: { select: { authorId: true } } },
  });
  return users.map((user) => ({
    userId: user.id,
    since: user.modelsPublicAt?.getTime() ?? 0,
    where: { AND: [{ userId: user.id }, ownDesignsWhere(user.authorLinks.map((link) => link.authorId))] },
  }));
}

async function publicDesigns(): Promise<Prisma.PrintWhereInput[]> {
  return (await publicDesigners()).map((designer) => designer.where);
}

/** What anyone's models the others can see: one in a public collection, or one of a user's own they made public. */
async function sharedPrintWhere(): Promise<Prisma.PrintWhereInput> {
  return { OR: [IN_PUBLIC_COLLECTION, ...(await publicDesigns())] };
}

/** Everyone who shares, with when they last did -- filed something in a public collection, made one public or
 *  renamed it, or added one of their own models once those are public -- the latest first. What partner instances
 *  are told this instance's people share (federation/publish.ts). */
export async function sharers(): Promise<{ userId: string; at: Date }[]> {
  const [fromCollections, designers] = await Promise.all([
    prisma.$queryRaw<{ userId: string; at: Date }[]>`
      SELECT c."userId", MAX(GREATEST(c."updatedAt", COALESCE(i."createdAt", c."updatedAt"))) AS at
      FROM "Collection" c
      LEFT JOIN "CollectionItem" i ON i."collectionId" = c.id
      WHERE c."visibility" = 'PUBLIC'
      GROUP BY c."userId"`,
    publicDesigners(),
  ]);
  const last = new Map<string, number>();
  const seen = (userId: string, at: number) => last.set(userId, Math.max(last.get(userId) ?? 0, at));
  for (const row of fromCollections) seen(row.userId, row.at.getTime());
  const designs = designers.length
    ? await prisma.print.groupBy({
        by: ["userId"],
        where: { OR: designers.map((d) => d.where) },
        _max: { createdAt: true },
      })
    : [];
  const since = new Map(designers.map((designer) => [designer.userId, designer.since]));
  for (const row of designs) seen(row.userId, Math.max(row._max.createdAt?.getTime() ?? 0, since.get(row.userId) ?? 0));
  return [...last.entries()]
    .toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([userId, at]) => ({ userId, at: new Date(at) }));
}

/** What one user shares of their own models, as everyone else here sees it: those in their public collections, and
 *  their own designs once they made those public. */
export async function sharedModelsWhere(userId: string): Promise<Prisma.PrintWhereInput> {
  return { userId, AND: [await sharedPrintWhere()] };
}

/** How many models each of `userIds` shares, as `sharedModelsWhere` decides: counted together, not one by one. */
export async function sharedModelCounts(userIds: string[]): Promise<Map<string, number>> {
  if (!userIds.length) return new Map();
  const rows = await prisma.print.groupBy({
    by: ["userId"],
    where: { userId: { in: userIds }, AND: [await sharedPrintWhere()] },
    _count: true,
  });
  return new Map(rows.map((row) => [row.userId, row._count]));
}

/** When each model was shared: filed in a public collection, or for a public designer's own design, added or made
 *  public, whichever was later. Someone else's design they filed keeps when it was filed. */
export async function sharedAtOf(
  prints: { id: string; userId: string; createdAt: Date }[],
): Promise<Map<string, Date>> {
  if (!prints.length) return new Map();
  const ids = prints.map((print) => print.id);
  const [filed, designers] = await Promise.all([
    prisma.collectionItem.groupBy({
      by: ["printId"],
      where: { printId: { in: ids }, collection: PUBLIC },
      _max: { createdAt: true },
    }),
    publicDesigners(),
  ]);
  const ownDesigns = designers.length
    ? await prisma.print.findMany({
        where: { id: { in: ids }, OR: designers.map((designer) => designer.where) },
        select: { id: true },
      })
    : [];
  const designs = new Set(ownDesigns.map((print) => print.id));
  const since = new Map(designers.map((designer) => [designer.userId, designer.since]));
  const at = new Map(filed.map((row) => [row.printId, row._max.createdAt?.getTime() ?? 0]));
  return new Map(
    prints.map((print) => {
      const own = designs.has(print.id) ? Math.max(print.createdAt.getTime(), since.get(print.userId) ?? 0) : 0;
      return [print.id, new Date(Math.max(at.get(print.id) ?? 0, own) || print.createdAt.getTime())];
    }),
  );
}

/** Whether Explore and Chats are offered: social features are on (and chats with them), and there's someone else on the
 *  instance to explore or talk to. */
export type SocialStatusOut = {
  enabled: boolean;
  explore: boolean;
  chats: boolean;
  /** Connected instances are on: usernames show as handles, and people can ask to reach someone elsewhere. */
  federation: boolean;
  /** What follows the @ in this instance's handles, while federation is on. */
  instance_host: string | null;
};

export async function socialStatus(): Promise<SocialStatusOut> {
  const { enabled, chats } = await getSocialSettings();
  if (!enabled) return { enabled, explore: false, chats: false, federation: false, instance_host: null };
  const others = (await prisma.user.count({ take: 2 })) > 1;
  const federation = await isFederationLive();
  const publicUrl = federation ? await getPublicUrl() : "";
  return {
    enabled,
    // One person alone still gets Explore while connected: it's where they ask to reach someone elsewhere.
    explore: others || federation,
    // Alone here, chats are still for partners' people while connected.
    chats: chats && (others || federation),
    federation,
    instance_host: publicUrl ? new URL(publicUrl).host : null,
  };
}

/** The models `userId` may open, download and copy: their own, and while social features are on, every model in a
 *  public collection, one shared with them or a public profile, and with chats on, every model sent in a chat they can
 *  read. Only for reading: whatever changes a model stays `{ userId }`. */
export async function readablePrintWhere(userId: string): Promise<Prisma.PrintWhereInput> {
  const { enabled, chats } = await getSocialSettings();
  if (!enabled) return { userId };
  return {
    OR: [
      { userId },
      IN_PUBLIC_COLLECTION,
      { collectionItems: { some: { collection: sharedWithWhere(userId) } } },
      ...(await publicDesigns()),
      ...(chats ? [sentInChatsOf(userId)] : []),
    ],
  };
}

/** A collection `userId` may open: their own, or while social features are on, a public one or one shared with
 *  them. */
export async function readableCollection(userId: string, collectionId: string): Promise<Collection | null> {
  const collection = await prisma.collection.findUnique({ where: { id: collectionId } });
  if (!collection) return null;
  if (collection.userId === userId) return collection;
  if (collection.visibility === "PRIVATE" || !(await getSocialSettings()).enabled) return null;
  if (collection.visibility === "PUBLIC") return collection;
  const share = await prisma.collectionShare.findUnique({
    where: { collectionId_userId: { collectionId, userId } },
    select: { id: true },
  });
  return share ? collection : null;
}

/** How each user is shown to the others: their name and their avatar -- never their email. Read with `db`, a
 *  transaction's client inside one. */
export async function userCards(
  userIds: string[],
  db: Pick<Prisma.TransactionClient, "user"> = prisma,
): Promise<Map<string, UserCardOut>> {
  const unique = [...new Set(userIds)];
  if (!unique.length) return new Map();
  const users = await db.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, displayName: true, email: true, avatarUrl: true, avatarStyle: true },
  });
  return new Map(
    users.map((user) => [user.id, { id: user.id, display_name: user.displayName, avatar_url: avatarUrlOf(user) }]),
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
  const shared = await sharedPrintWhere();
  const [cards, collections, models] = await Promise.all([
    userCards(userIds),
    prisma.collection.groupBy({ by: ["userId"], where: { userId: { in: userIds }, ...PUBLIC }, _count: true }),
    prisma.print.groupBy({ by: ["userId"], where: { userId: { in: userIds }, AND: [shared] }, _count: true }),
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
  /** The other users who share a collection or their models, those who shared most recently first; the most recent
   *  few dozen. */
  people: ExplorePersonOut[];
  /** The models most recently put in another user's public collection, or added to a public profile. */
  recent_models: PrintOut[];
  /** Other users' public collections, the most recently changed or added to first. */
  recent_collections: CollectionOut[];
  /** Other users' shared models the instance's users copied most, with how many did. */
  most_collected: { model: PrintOut; copies: number }[];
  /** Collections their owners shared with the viewer, the latest shared or changed first: the first page of them, the
   *  rest from GET /explore/shared. */
  shared_with_you: CollectionOut[];
  shared_with_you_total: number;
  /** When each person, model and collection above was last shared, by id: what puts partners' beside them in order. */
  shared_at: { people: Record<string, string>; models: Record<string, string>; collections: Record<string, string> };
};

/** Nothing of this instance's own: Explore narrowed to one partner. */
export const EMPTY_EXPLORE: ExploreOut = {
  people: [],
  recent_models: [],
  recent_collections: [],
  most_collected: [],
  shared_with_you: [],
  shared_with_you_total: 0,
  shared_at: { people: {}, models: {}, collections: {} },
};

const PEOPLE = 48;
const RECENT_MODELS = 12;
const RECENT_COLLECTIONS = 8;
const MOST_COLLECTED = 12;
export const SHARED_WITH_YOU_PAGE = 12;

/** A page of the collections shared with `viewerId`, the latest first: by when it was shared with them, made shared,
 *  renamed, or something was filed in it. With each one's time, as Explore orders things by. */
export async function sharedWithYou(
  viewerId: string,
  limit: number,
  offset: number,
): Promise<{ collections: CollectionOut[]; total: number; at: Record<string, string> }> {
  const where = { ...sharedWithWhere(viewerId), userId: { not: viewerId } } satisfies Prisma.CollectionWhereInput;
  const [ranked, total] = await Promise.all([
    prisma.$queryRaw<{ id: string; at: Date }[]>`
      SELECT c.id, GREATEST(s."createdAt", c."updatedAt", COALESCE(MAX(i."createdAt"), c."updatedAt")) AS at
      FROM "Collection" c
      JOIN "CollectionShare" s ON s."collectionId" = c.id AND s."userId" = ${viewerId}
      LEFT JOIN "CollectionItem" i ON i."collectionId" = c.id
      WHERE c."visibility" = 'SHARED' AND c."userId" <> ${viewerId}
      GROUP BY c.id, s."createdAt"
      ORDER BY at DESC, c.id
      LIMIT ${limit} OFFSET ${offset}`,
    prisma.collection.count({ where }),
  ]);
  // Still shared with them: one unshared since it was ranked isn't shown.
  const rows = await prisma.collection.findMany({ where: { id: { in: ranked.map((row) => row.id) }, ...where } });
  const inOrder = ranked.flatMap((row) => rows.find((collection) => collection.id === row.id) ?? []);
  return {
    collections: await collectionOutsFor(viewerId, inOrder),
    total,
    at: Object.fromEntries(ranked.map((row) => [row.id, row.at.toISOString()])),
  };
}

/** Everything Explore's page shows `viewerId`. Their own collections and models are left out: they're not news to them. */
export async function exploreOverview(viewerId: string): Promise<ExploreOut> {
  const othersPublic = { ...PUBLIC, userId: { not: viewerId } } satisfies Prisma.CollectionWhereInput;
  const designers = (await publicDesigners()).filter((designer) => designer.userId !== viewerId);
  const designs = designers.map((designer) => designer.where);
  const othersDesigns: Prisma.PrintWhereInput = { OR: designs };
  // Making their models public is sharing them: they count as new from then, however old they are.
  const sinceOf = new Map(designers.map((designer) => [designer.userId, designer.since]));
  // A collection changes when it's made public or renamed (updatedAt), or something is put in it: whichever was last.
  // Ranked in the database, as it takes the latest of each collection's items.
  const [recentCollectionIds, collectionSharers, designSharers, recentItems, recentDesigns, collected] =
    await Promise.all([
      prisma.$queryRaw<{ id: string; at: Date }[]>`
        SELECT c.id, GREATEST(c."updatedAt", COALESCE(MAX(i."createdAt"), c."updatedAt")) AS at FROM "Collection" c
        LEFT JOIN "CollectionItem" i ON i."collectionId" = c.id
        WHERE c."visibility" = 'PUBLIC' AND c."userId" <> ${viewerId}
        GROUP BY c.id
        ORDER BY GREATEST(c."updatedAt", COALESCE(MAX(i."createdAt"), c."updatedAt")) DESC, c.id
        LIMIT ${RECENT_COLLECTIONS}`,
      // Those who share, by when they last did: filed something in a public collection, or added one of their own.
      prisma.$queryRaw<{ userId: string; at: Date }[]>`
        SELECT c."userId", MAX(GREATEST(c."updatedAt", COALESCE(i."createdAt", c."updatedAt"))) AS at
        FROM "Collection" c
        LEFT JOIN "CollectionItem" i ON i."collectionId" = c.id
        WHERE c."visibility" = 'PUBLIC' AND c."userId" <> ${viewerId}
        GROUP BY c."userId"
        ORDER BY at DESC, c."userId"
        LIMIT ${PEOPLE}`,
      designs.length
        ? prisma.print.groupBy({ by: ["userId"], where: othersDesigns, _max: { createdAt: true } })
        : Promise.resolve([]),
      // Each model once, by when it was last filed: one filed in many collections doesn't fill the row.
      prisma.collectionItem.groupBy({
        by: ["printId"],
        where: { collection: othersPublic },
        _max: { createdAt: true },
        orderBy: { _max: { createdAt: "desc" } },
        take: RECENT_MODELS,
      }),
      // Each designer's newest few: which of them are newest overall depends on when each went public.
      Promise.all(
        designers.map((designer) =>
          prisma.print.findMany({
            where: designer.where,
            orderBy: { createdAt: "desc" },
            take: RECENT_MODELS,
            select: { id: true, userId: true, createdAt: true },
          }),
        ),
      ).then((lists) => lists.flat()),
      prisma.print.findMany({
        where: { userId: { not: viewerId }, AND: [{ OR: [IN_PUBLIC_COLLECTION, ...designs] }], copies: { some: {} } },
        orderBy: [{ copies: { _count: "desc" } }, { createdAt: "desc" }],
        take: MOST_COLLECTED,
        select: { id: true, _count: { select: { copies: true } } },
      }),
    ]);

  const collectionIds = recentCollectionIds.map((row) => row.id);
  // Still public: one made private since it was ranked isn't shown.
  const recentCollections = await prisma.collection.findMany({ where: { id: { in: collectionIds }, ...othersPublic } });
  const byChange = collectionIds.flatMap((id) => recentCollections.find((collection) => collection.id === id) ?? []);

  const sharedLast = new Map<string, number>();
  const shared = (id: string, at: number) => sharedLast.set(id, Math.max(sharedLast.get(id) ?? 0, at));
  for (const row of collectionSharers) shared(row.userId, row.at.getTime());
  for (const row of designSharers) {
    shared(row.userId, Math.max(row._max.createdAt?.getTime() ?? 0, sinceOf.get(row.userId) ?? 0));
  }
  const sharerIds = [...sharedLast.entries()]
    .toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, PEOPLE)
    .map(([userId]) => userId);

  const latest = new Map<string, number>();
  for (const item of recentItems) latest.set(item.printId, item._max.createdAt?.getTime() ?? 0);
  for (const print of recentDesigns) {
    const at = Math.max(print.createdAt.getTime(), sinceOf.get(print.userId) ?? 0);
    latest.set(print.id, Math.max(latest.get(print.id) ?? 0, at));
  }
  const recentIds = [...latest.entries()]
    .toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, RECENT_MODELS)
    .map(([id]) => id);

  const [peopleOut, recentModels, recentCollectionOuts, collectedModels, sharedWithViewer] = await Promise.all([
    people(sharerIds),
    readablePrintOuts(viewerId, recentIds),
    collectionOutsFor(viewerId, byChange),
    readablePrintOuts(
      viewerId,
      collected.map((print) => print.id),
    ),
    sharedWithYou(viewerId, SHARED_WITH_YOU_PAGE, 0),
  ]);
  const copiesOf = new Map(collected.map((print) => [print.id, print._count.copies]));
  return {
    // Someone who stopped sharing since they were listed.
    people: peopleOut.filter((person) => person.collection_count > 0 || person.model_count > 0),
    recent_models: recentModels,
    recent_collections: recentCollectionOuts,
    most_collected: collectedModels.map((model) => ({ model, copies: copiesOf.get(model.id) ?? 0 })),
    shared_with_you: sharedWithViewer.collections,
    shared_with_you_total: sharedWithViewer.total,
    shared_at: {
      people: Object.fromEntries(sharerIds.map((id) => [id, new Date(sharedLast.get(id) ?? 0).toISOString()])),
      models: Object.fromEntries(recentIds.map((id) => [id, new Date(latest.get(id) ?? 0).toISOString()])),
      collections: {
        ...Object.fromEntries(recentCollectionIds.map((row) => [row.id, row.at.toISOString()])),
        ...sharedWithViewer.at,
      },
    },
  };
}

/** A person's public collections on their page, a page at a time: the first comes with the page. */
export const PERSON_COLLECTIONS_PAGE = 24;
const personCollectionsOrder: Prisma.CollectionOrderByWithRelationInput[] = [{ createdAt: "desc" }, { id: "asc" }];

export type ExploreUserOut = {
  user: ExplorePersonOut & { joined_at: string } & PublicProfileOut;
  /** The first page of them; the rest from GET /explore/user/:id/collections. */
  collections: CollectionOut[];
  collections_total: number;
};

/** One user's page: who they are, their public collections, and whether their own models are public. Null for no such
 *  user, and for one who shares nothing: they never chose to be seen. The viewer's own always, so they can see what the
 *  others see of them. */
export async function exploreUser(viewerId: string, userId: string): Promise<ExploreUserOut | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      bio: true,
      createdAt: true,
      backgroundUrl: true,
      coverPreset: true,
      coverPositionY: true,
      profileLinks: true,
      modelsPublic: true,
    },
  });
  if (!user) return null;
  const [[person], collections] = await Promise.all([
    people([user.id]),
    prisma.collection.findMany({
      where: { userId, ...PUBLIC },
      orderBy: personCollectionsOrder,
      take: PERSON_COLLECTIONS_PAGE,
    }),
  ]);
  if (!person || (!collections.length && !person.model_count && userId !== viewerId)) return null;
  return {
    user: { ...person, joined_at: user.createdAt.toISOString(), ...profileOut(user) },
    collections: await collectionOutsFor(viewerId, collections),
    collections_total: person.collection_count,
  };
}

/** A page of a user's public collections, in their page's order, for `viewerId`; null for no such user, and for one
 *  with none, unless it's the viewer. */
export async function exploreUserCollections(
  viewerId: string,
  userId: string,
  limit: number,
  offset: number,
): Promise<{ collections: CollectionOut[]; total: number } | null> {
  const where = { userId, ...PUBLIC };
  const [rows, total] = await Promise.all([
    prisma.collection.findMany({ where, orderBy: personCollectionsOrder, skip: offset, take: limit }),
    prisma.collection.count({ where }),
  ]);
  if (!total && userId !== viewerId) return null;
  return { collections: await collectionOutsFor(viewerId, rows), total };
}

/** A page of a user's own models, as their My models lists them, for `viewerId`; null unless they made them public. */
export async function exploreUserModels(
  viewerId: string,
  userId: string,
  filters: Pick<PrintFilters, "generative" | "excludeProviders" | "licenseAllows" | "licensed">,
  options: { sort: PrintSortMode; limit: number; offset: number },
): Promise<PrintListPage | null> {
  const owner = await prisma.user.findUnique({ where: { id: userId }, select: { modelsPublic: true } });
  if (!owner?.modelsPublic) return null;
  const page = await listPrints(userId, { ...filters, authorId: SELF_AUTHOR_ID }, options);
  if (userId !== viewerId) page.prints = await withOwners(viewerId, page.prints);
  return page;
}
