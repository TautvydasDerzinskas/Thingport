import { Prisma, type Collection, type CollectionVisibility } from "@prisma/client";
import type { Peer, RemotePerson } from "@prisma/client";
import { prisma } from "../db";
import { visibilityOut, type CollectionOut, type CollectionVisibilityOut, type SharePersonOut } from "../dto";
import { mediaAddress } from "../federation/media";
import { isFederationLive } from "../federation/settings";
import { kickSharing, queueSharing } from "../federation/sharedCollections";
import { HttpError } from "../utils/fileUtils";
import { getSocialSettings, holdSocialSettings } from "./settingsService";
import { userCards } from "./socialService";

// Who a collection is shared with: its owner picks people, and while it's SHARED (and social features are on) they
// see it as they would a public one (socialService's readablePrintWhere and readableCollection). The list is kept
// while it's private or public too, so making it shared again shares it with the same people. Only its owner reads or
// changes the list. People on connected instances can be on it too: their instances are told what they may see
// (federation/sharedCollections.ts), in the transaction of the change.

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
  /** People on connected instances, by their id here (RemotePerson), added and taken off the same way. */
  add_remote_person_ids?: string[];
  remove_remote_person_ids?: string[];
};

export const visibilityIn = (visibility: CollectionVisibilityOut): CollectionVisibility =>
  visibility === "public" ? "PUBLIC" : visibility === "shared" ? "SHARED" : "PRIVATE";

type Db = Prisma.TransactionClient | typeof prisma;

/** Someone on a connected instance, as a list shows them: with their handle and instance. */
export function remoteShareOut(person: RemotePerson & { peer: Peer }): SharePersonOut {
  const host = new URL(person.peer.origin).host;
  return {
    id: person.id,
    display_name: person.displayName,
    avatar_url: mediaAddress(person.avatarUrl),
    remote: {
      handle: person.username ? `${person.username}@${host}` : null,
      instance: { name: person.peer.name ?? host, origin: person.peer.origin },
      profile_id: person.listed && person.peer.status === "ACTIVE" ? person.id : null,
    },
  };
}

/** The people on each collection's list, the first added first. */
async function peopleOf(collectionIds: string[], db: Db = prisma): Promise<Map<string, SharePersonOut[]>> {
  const out = new Map<string, SharePersonOut[]>();
  if (!collectionIds.length) return out;
  const rows = await db.collectionShare.findMany({
    where: { collectionId: { in: collectionIds } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { collectionId: true, userId: true, remotePerson: { include: { peer: true } } },
  });
  const cards = await userCards(
    rows.flatMap((row) => (row.userId ? [row.userId] : [])),
    db,
  );
  for (const row of rows) {
    const card = row.userId ? cards.get(row.userId) : undefined;
    const person = card ? { ...card, remote: null } : row.remotePerson ? remoteShareOut(row.remotePerson) : null;
    if (person) out.set(row.collectionId, [...(out.get(row.collectionId) ?? []), person]);
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

// Each statement sees what's committed, so the list counted after the lock is the whole of it, whatever the
// database's default isolation.
const COUNTED_AFTER_LOCK = { isolationLevel: "ReadCommitted" } as const;

/** Changes who sees `ownerId`'s collection: its visibility, and who's on its list. The people who can see it now and
 *  couldn't before are told. Refused while social features are off, as nobody else sees anything then. */
export async function updateSharing(ownerId: string, collectionId: string, patch: SharingPatch): Promise<SharingOut> {
  if (!(await getSocialSettings()).enabled) throw new HttpError(409, "Social features are off", "social_off");
  const remove = new Set(patch.remove_user_ids ?? []);
  const add = [...new Set(patch.add_user_ids ?? [])].filter((id) => id !== ownerId);
  const removeRemote = new Set(patch.remove_remote_person_ids ?? []);
  const addRemote = [...new Set(patch.add_remote_person_ids ?? [])];
  // Someone elsewhere is added only while connected instances are on: their instance has to be told now. Taking
  // someone off, or any other change, is told once they're on again.
  if (addRemote.length && !(await isFederationLive())) {
    throw new HttpError(409, "Connected instances are off", "federation_off");
  }
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

    // People elsewhere: only someone on a partner connected now is added; one paused can't be told yet.
    const elsewhere = addRemote.length
      ? await tx.remotePerson.findMany({ where: { id: { in: addRemote } }, include: { peer: true } })
      : [];
    if (elsewhere.length !== addRemote.length) {
      throw new HttpError(400, "Someone to share with wasn't found", "unknown_person");
    }
    if (elsewhere.some((person) => person.peer.status !== "ACTIVE")) {
      throw new HttpError(409, "Their instance isn't available right now", "partner_unavailable");
    }
    const listedElsewhere = await tx.collectionShare.findMany({
      where: { collectionId, remotePersonId: { not: null } },
      select: { remotePersonId: true, remotePerson: { select: { peerId: true } } },
    });
    const onList = new Set(listedElsewhere.map((row) => row.remotePersonId));
    const removedRemote = listedElsewhere.filter(
      (row) => row.remotePersonId && removeRemote.has(row.remotePersonId) && !addRemote.includes(row.remotePersonId),
    );
    if (removedRemote.length) {
      await tx.collectionShare.deleteMany({
        where: { collectionId, remotePersonId: { in: removedRemote.flatMap((row) => row.remotePersonId ?? []) } },
      });
    }
    const addedRemote = addRemote.filter((id) => !onList.has(id));
    if (addedRemote.length) {
      await tx.collectionShare.createMany({
        data: addedRemote.map((remotePersonId) => ({ collectionId, remotePersonId })),
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
    // Partners with people on the list, or just taken off it, hear where those people stand now.
    if (visibility !== before.visibility || addedRemote.length || removedRemote.length) {
      await queueSharing(
        tx,
        collectionId,
        removedRemote.flatMap((row) => row.remotePerson?.peerId ?? []),
      );
    }
    const people = (await peopleOf([collectionId], tx)).get(collectionId) ?? [];
    // Turned off since the check above: refused, as it would have been then, rather than kept with nobody told.
    if (!(await tellGained(tx, before, after, added))) {
      throw new HttpError(409, "Social features are off", "social_off");
    }
    return { before, after, people, added, removed };
  }, COUNTED_AFTER_LOCK);
  kickSharing();
  return {
    visibility: visibilityOut(result.after.visibility),
    people: result.people,
    max_people: MAX_SHARES,
  };
}

/** Whom a change to a collection lets see it who couldn't: everyone on its list when it's made shared from private,
 *  and those just added while it's shared. Someone added to a public one made shared could see it already, but was
 *  picked by name all the same, so they're told too. */
async function gainedBy(
  tx: Prisma.TransactionClient,
  before: Collection,
  after: Collection,
  added: string[],
): Promise<string[]> {
  if (after.visibility !== "SHARED") return [];
  if (before.visibility !== "PRIVATE") return added;
  const rows = await tx.collectionShare.findMany({
    where: { collectionId: after.id, userId: { not: null } },
    select: { userId: true },
  });
  return rows.flatMap((row) => (row.userId ? [row.userId] : []));
}

/** Tells each person who can see `after` now and couldn't before, in `tx`, the change's own transaction, holding the
 *  social setting until it's kept: so they're told exactly when it's kept, and turning social features off waits for
 *  it. Nobody while they're off, when they can't open it, and false then. */
export async function tellGained(
  tx: Prisma.TransactionClient,
  before: Collection,
  after: Collection,
  added: string[] = [],
): Promise<boolean> {
  if (!(await holdSocialSettings(tx)).enabled) return false;
  const gained = (await gainedBy(tx, before, after, added)).filter((id) => id !== after.userId);
  if (!gained.length) return true;
  // Held from going until it's kept: one whose account is deleted meanwhile is left out, not the change failed.
  const userIds = (
    await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "User" WHERE id = ANY(${gained}::text[]) FOR KEY SHARE`
  ).map((user) => user.id);
  if (!userIds.length) return true;
  const owner = await tx.user.findUnique({ where: { id: after.userId }, select: { displayName: true } });
  const title = `${owner?.displayName ?? "Someone"} shared “${after.name}” with you`;
  await tx.notification.createMany({
    data: userIds.map((userId) => ({
      userId,
      type: "share" as const,
      title,
      internalPath: `/explore/collections/${after.id}`,
    })),
  });
  return true;
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
    prisma.$queryRaw<{ collectionId: string; userId: string | null; remotePersonId: string | null }[]>`
      SELECT "collectionId", "userId", "remotePersonId" FROM (
        SELECT "collectionId", "userId", "remotePersonId",
          ROW_NUMBER() OVER (PARTITION BY "collectionId" ORDER BY "createdAt", id) AS place
        FROM "CollectionShare"
        WHERE "collectionId" IN (${Prisma.join(ownedIds)})
      ) ranked
      WHERE place <= ${SUMMARY_PEOPLE}
      ORDER BY "collectionId", place`,
  ]);
  const [cards, elsewhere] = await Promise.all([
    userCards(firsts.flatMap((row) => row.userId ?? [])),
    prisma.remotePerson.findMany({
      where: { id: { in: firsts.flatMap((row) => row.remotePersonId ?? []) } },
      include: { peer: true },
    }),
  ]);
  const countOf = new Map(counts.map((row) => [row.collectionId, row._count]));
  return outs.map((out) => {
    if (!ownedIds.includes(out.id)) return out;
    const people = firsts
      .filter((row) => row.collectionId === out.id)
      .flatMap((row): SharePersonOut[] => {
        const card = row.userId ? cards.get(row.userId) : undefined;
        if (card) return [{ ...card, remote: null }];
        const person = elsewhere.find((item) => item.id === row.remotePersonId);
        return person ? [remoteShareOut(person)] : [];
      });
    return { ...out, shared_with: { count: countOf.get(out.id) ?? 0, people } };
  });
}
