import { Prisma, type Collection, type CollectionVisibility } from "@prisma/client";
import { prisma } from "../db";
import { visibilityOut, type CollectionOut, type CollectionVisibilityOut, type SharePersonOut } from "../dto";
import { HttpError } from "../utils/fileUtils";
import { createNotification } from "./notificationService";
import { getSocialSettings } from "./settingsService";
import { userCards } from "./socialService";

// Who a collection is shared with: its owner picks people, and while it's SHARED (and social features are on) they
// see it as they would a public one (socialService's readablePrintWhere and readableCollection). The list is kept
// while it's private or public too, so making it shared again shares it with the same people. Only its owner reads or
// changes the list.

/** People a collection may be shared with at most. */
export const MAX_SHARES = 100;
/** How many of them a card shows. */
const SUMMARY_PEOPLE = 3;

export type SharingOut = {
  visibility: CollectionVisibilityOut;
  /** Everyone on the list, the first added first, kept while it's private or public too. */
  people: SharePersonOut[];
  max_people: number;
};

export type SharingPatch = {
  visibility?: CollectionVisibilityOut;
  /** Added to the list; those already on it stay as they are. */
  add_user_ids?: string[];
  /** Taken off it. The ones not named stay, so an editor that loaded only some can't take the others off. */
  remove_user_ids?: string[];
};

export const visibilityIn = (visibility: CollectionVisibilityOut): CollectionVisibility =>
  visibility === "public" ? "PUBLIC" : visibility === "shared" ? "SHARED" : "PRIVATE";

type Db = Prisma.TransactionClient | typeof prisma;

/** The people on each collection's list, the first added first. */
async function peopleOf(collectionIds: string[], db: Db = prisma): Promise<Map<string, SharePersonOut[]>> {
  const out = new Map<string, SharePersonOut[]>();
  if (!collectionIds.length) return out;
  const rows = await db.collectionShare.findMany({
    where: { collectionId: { in: collectionIds }, userId: { not: null } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { collectionId: true, userId: true },
  });
  const cards = await userCards(rows.flatMap((row) => (row.userId ? [row.userId] : [])));
  for (const row of rows) {
    const card = row.userId ? cards.get(row.userId) : undefined;
    if (!card) continue;
    out.set(row.collectionId, [...(out.get(row.collectionId) ?? []), { ...card, remote: null }]);
  }
  return out;
}

async function ownCollection(ownerId: string, collectionId: string, db: Db = prisma): Promise<Collection> {
  const collection = await db.collection.findFirst({ where: { id: collectionId, userId: ownerId } });
  if (!collection) throw new HttpError(404, "Collection not found");
  return collection;
}

/** Who `ownerId`'s collection is shared with. 404 for anyone else's. */
export async function sharingOf(ownerId: string, collectionId: string): Promise<SharingOut> {
  const collection = await ownCollection(ownerId, collectionId);
  return {
    visibility: visibilityOut(collection.visibility),
    people: (await peopleOf([collection.id])).get(collection.id) ?? [],
    max_people: MAX_SHARES,
  };
}

/** Changes who sees `ownerId`'s collection: its visibility, and who's on its list. The people who can see it now and
 *  couldn't before are told. Refused while social features are off, as nobody else sees anything then. */
export async function updateSharing(ownerId: string, collectionId: string, patch: SharingPatch): Promise<SharingOut> {
  if (!(await getSocialSettings()).enabled) throw new HttpError(409, "Social features are off", "social_off");
  const remove = new Set(patch.remove_user_ids ?? []);
  const add = [...new Set(patch.add_user_ids ?? [])].filter((id) => id !== ownerId);
  const result = await prisma.$transaction(async (tx) => {
    // One change at a time per collection, so two can't add past the limit between them.
    await tx.$queryRaw`SELECT id FROM "Collection" WHERE id = ${collectionId} FOR UPDATE`;
    const before = await ownCollection(ownerId, collectionId, tx);
    if (before.toolId) {
      throw new HttpError(403, `"${before.name}" belongs to a tool and can't be changed`, "TOOL_OWNED");
    }
    const known = add.length ? await tx.user.findMany({ where: { id: { in: add } }, select: { id: true } }) : [];
    if (known.length !== add.length) throw new HttpError(400, "Someone to share with wasn't found", "unknown_person");
    const listed = new Set(
      (
        await tx.collectionShare.findMany({ where: { collectionId, userId: { not: null } }, select: { userId: true } })
      ).flatMap((row) => (row.userId ? [row.userId] : [])),
    );
    const removed = [...remove].filter((id) => listed.has(id) && !add.includes(id));
    if (removed.length) await tx.collectionShare.deleteMany({ where: { collectionId, userId: { in: removed } } });
    const added = add.filter((id) => !listed.has(id));
    if (added.length) {
      await tx.collectionShare.createMany({
        data: added.map((userId) => ({ collectionId, userId })),
        skipDuplicates: true,
      });
    }
    if ((await tx.collectionShare.count({ where: { collectionId } })) > MAX_SHARES) {
      throw new HttpError(422, `A collection can be shared with ${MAX_SHARES} people at most`, "too_many_people");
    }
    const visibility = patch.visibility ? visibilityIn(patch.visibility) : before.visibility;
    const after =
      visibility === before.visibility
        ? before
        : await tx.collection.update({ where: { id: collectionId }, data: { visibility } });
    const people = (await peopleOf([collectionId], tx)).get(collectionId) ?? [];
    return { before, after, people, added, removed };
  });
  await tellGained(result.before, result.after, result.added);
  return {
    visibility: visibilityOut(result.after.visibility),
    people: result.people,
    max_people: MAX_SHARES,
  };
}

/** Whom a change to a collection lets see it who couldn't: everyone on its list when it's made shared from private,
 *  and those just added while it's shared. Someone added to a public one made shared could see it already, but was
 *  picked by name all the same, so they're told too. */
async function gainedBy(before: Collection, after: Collection, added: string[]): Promise<string[]> {
  if (after.visibility !== "SHARED") return [];
  if (before.visibility !== "PRIVATE") return added;
  const rows = await prisma.collectionShare.findMany({
    where: { collectionId: after.id, userId: { not: null } },
    select: { userId: true },
  });
  return rows.flatMap((row) => (row.userId ? [row.userId] : []));
}

/** Tells each person who can see `after` now and couldn't before. Never fails the change that led to it. */
export async function tellGained(before: Collection, after: Collection, added: string[] = []): Promise<void> {
  try {
    const userIds = (await gainedBy(before, after, added)).filter((id) => id !== after.userId);
    if (!userIds.length) return;
    const owner = await prisma.user.findUnique({ where: { id: after.userId }, select: { displayName: true } });
    const title = `${owner?.displayName ?? "Someone"} shared “${after.name}” with you`;
    await Promise.all(
      userIds.map((userId) =>
        createNotification(userId, { type: "share", title, internalPath: `/explore/collections/${after.id}` }).catch(
          () => {},
        ),
      ),
    );
  } catch {
    // Telling them is a courtesy; the change itself is made.
  }
}

/** The visibility a collection's form asks for: `visibility` if it's sent, else `is_public` as older clients send it,
 *  which knows only public or not: false turns a public collection private and leaves a shared one shared. */
export function visibilityAsked(
  body: { visibility?: CollectionVisibilityOut; is_public?: boolean },
  current: CollectionVisibility,
): CollectionVisibility {
  if (body.visibility) return visibilityIn(body.visibility);
  if (body.is_public === true) return "PUBLIC";
  if (body.is_public === false && current === "PUBLIC") return "PRIVATE";
  return current;
}

/** The owner's own shared collections among `outs` get how many people they're shared with and the first few. */
export async function withSharedWith(ownerId: string, outs: CollectionOut[]): Promise<CollectionOut[]> {
  const ids = outs.filter((out) => out.visibility === "shared" && !out.owner && !out.system_key).map((out) => out.id);
  if (!ids.length) return outs;
  const owned = await prisma.collection.findMany({ where: { id: { in: ids }, userId: ownerId }, select: { id: true } });
  const ownedIds = owned.map((row) => row.id);
  if (!ownedIds.length) return outs;
  const [counts, firsts] = await Promise.all([
    prisma.collectionShare.groupBy({ by: ["collectionId"], where: { collectionId: { in: ownedIds } }, _count: true }),
    // The first few of each, without reading every name of a long list.
    prisma.$queryRaw<{ collectionId: string; userId: string }[]>`
      SELECT "collectionId", "userId" FROM (
        SELECT "collectionId", "userId",
          ROW_NUMBER() OVER (PARTITION BY "collectionId" ORDER BY "createdAt", id) AS place
        FROM "CollectionShare"
        WHERE "collectionId" IN (${Prisma.join(ownedIds)}) AND "userId" IS NOT NULL
      ) ranked
      WHERE place <= ${SUMMARY_PEOPLE}
      ORDER BY "collectionId", place`,
  ]);
  const cards = await userCards(firsts.map((row) => row.userId));
  const countOf = new Map(counts.map((row) => [row.collectionId, row._count]));
  return outs.map((out) => {
    if (!ownedIds.includes(out.id)) return out;
    const people = firsts
      .filter((row) => row.collectionId === out.id)
      .flatMap((row) => {
        const card = cards.get(row.userId);
        return card ? [{ ...card, remote: null }] : [];
      });
    return { ...out, shared_with: { count: countOf.get(out.id) ?? 0, people } };
  });
}
