import crypto from "node:crypto";
import type { Peer, Prisma, RemotePerson } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { getPublicUrl, getSocialSettings, holdSocialSettings } from "../services/settingsService";
import { originOf } from "./addresses";
import { here, localUserId, personOn, RetryLater, type Here } from "./chats";
import { enqueueActivity, kickDelivery } from "./delivery";
import { FederationFetchError } from "./fetch";
import { sharedAudience } from "./publish";
import { askedAt, holdRemoteModels, HOLD_TIMEOUT_MS, pruneIn, readModels, remoteModelData } from "./remoteIndex";
import { AP_PREFIX, getRuntime } from "./runtime";

/** Collections shared with partners' people (docs/FEDERATION_DEVELOPMENT.md, "Shared collections"). What partners
 *  read of this instance is one index for all their people, so a collection meant for a few of them can't go in it:
 *  it's sent instead. Its owner's instance tells each partner with people on its list where they stand: `Update` of
 *  the collection, addressed to them, or `Delete` once none of them may see it. The partner then reads it, signed, from
 *  its address here (`publish.ts`, `sharedCollectionObject`), which answers only while it's shared with someone there,
 *  and keeps it for those people only (`RemoteCollection.limited`, its `viewers`). It reads it again with everything
 *  else it reads of this instance, so what's filed in it later, or its new name, gets there too. This instance can't
 *  check who on the partner opens it: that partner shows it to the people named, as it does a direct message. */

const AS = "https://www.w3.org/ns/activitystreams";

type Db = Prisma.TransactionClient | typeof prisma;

const SOCIAL_OFF = "Social features are off here for now";

const collectionUrl = (at: Pick<Here, "origin">, id: string) => `${at.origin}${AP_PREFIX}/collections/${id}`;

// ---------------------------------------------------------------------------------------------------------------------
// Sending

/** Queues, in `db`'s transaction, what each partner with people on `collectionId`'s list now needs to hear: `Update`
 *  while it's shared with someone there, `Delete` once it isn't. `alsoPeerIds`: partners whose people were just taken
 *  off it, who may have none left on it. Call `kickDelivery` once the transaction is committed. */
export async function queueSharing(db: Db, collectionId: string, alsoPeerIds: string[] = []): Promise<void> {
  const peers = await peersOf(db, [collectionId], alsoPeerIds);
  if (!peers.length) return;
  const at = await here(db);
  const url = collectionUrl(at, collectionId);
  for (const peer of peers) {
    // Who it's for and its name only: the partner reads the rest from its address, its owner's avatar too.
    const audience = await sharedAudience(collectionId, peer.id, db);
    const name = audience?.collection.name.slice(0, NAME_MAX);
    await send(
      db,
      at,
      peer,
      url,
      audience
        ? { type: "Update", to: audience.to, object: { id: url, type: "Collection", name } }
        : { type: "Delete", to: [peer.actorUrl], object: url },
    );
  }
}

/** Queues `Delete` of each of `collectionIds` for every partner with people on its list: they're about to go. In the
 *  transaction that deletes them. */
export async function queueCollectionsGone(db: Db, collectionIds: string[]): Promise<void> {
  if (!collectionIds.length) return;
  // Held until they're gone, as a change to who sees one holds it (collectionSharing.ts): one under way is in what's
  // read below, and one after waits, then finds it gone.
  await db.$queryRaw`SELECT id FROM "Collection" WHERE id = ANY(${collectionIds}::text[]) FOR UPDATE`;
  const shares = await db.collectionShare.findMany({
    where: { collectionId: { in: collectionIds }, remotePersonId: { not: null } },
    select: { collectionId: true, remotePerson: { select: { peerId: true } } },
  });
  if (!shares.length) return;
  const at = await here(db);
  // One Delete of each to each partner, however many of its people were on the list.
  const told = new Map<string, { collectionId: string; peerId: string }>();
  for (const { collectionId, remotePerson } of shares) {
    if (remotePerson) told.set(`${collectionId} ${remotePerson.peerId}`, { collectionId, peerId: remotePerson.peerId });
  }
  const peers = await db.peer.findMany({
    where: { id: { in: [...new Set([...told.values()].map((item) => item.peerId))] } },
  });
  for (const { collectionId, peerId } of told.values()) {
    const peer = peers.find((item) => item.id === peerId);
    if (!peer) continue;
    const url = collectionUrl(at, collectionId);
    await send(db, at, peer, url, { type: "Delete", to: [peer.actorUrl], object: url });
  }
}

/** Queues `Delete` of each of `userId`'s collections shared with partners' people, in the transaction that deletes
 *  their account. Without a Public URL nothing can be sent, and nothing stops the account going: each partner finds
 *  them gone the next time it reads them. */
export async function queueAccountGone(db: Db, userId: string): Promise<void> {
  // Held until the account's gone: its row, so no collection is made meanwhile (one being made is waited for), then its
  // collections, so a change to who sees one waits, then finds it gone, and one under way is read below. In the order
  // deleting the account takes them.
  await db.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
  await db.$queryRaw`SELECT id FROM "Collection" WHERE "userId" = ${userId} FOR UPDATE`;
  const collections = await db.collection.findMany({
    where: { userId, shares: { some: { remotePersonId: { not: null } } } },
    select: { id: true },
  });
  if (!collections.length || !(await getPublicUrl(db))) return;
  await queueCollectionsGone(
    db,
    collections.map((collection) => collection.id),
  );
}

/** Sends what's queued, now that the change it follows is kept. */
export function kickSharing(): void {
  kickDelivery();
}

/** The partners with people on any of `collectionIds`' lists, and `alsoPeerIds`: those still connected, or paused
 *  (their deliveries wait until they're back). */
async function peersOf(db: Db, collectionIds: string[], alsoPeerIds: string[]): Promise<Peer[]> {
  const shares = await db.collectionShare.findMany({
    where: { collectionId: { in: collectionIds }, remotePersonId: { not: null } },
    select: { remotePerson: { select: { peerId: true } } },
  });
  const ids = [...new Set([...shares.flatMap((share) => share.remotePerson?.peerId ?? []), ...alsoPeerIds])];
  if (!ids.length) return [];
  return db.peer.findMany({ where: { id: { in: ids }, status: { in: ["ACTIVE", "PAUSED"] } } });
}

async function send(db: Db, at: Here, peer: Peer, url: string, activity: Record<string, unknown>): Promise<void> {
  if (!peer.inboxUrl) return;
  await enqueueActivity(
    {
      origin: peer.origin,
      inboxUrl: peer.inboxUrl,
      peerId: peer.id,
      // One collection's in order: a Delete never overtakes the Update before it.
      orderKey: url,
      activity: {
        "@context": AS,
        id: `${at.origin}${AP_PREFIX}/activities/${crypto.randomUUID()}`,
        actor: at.actorUrl.href,
        ...activity,
      },
    },
    "$transaction" in db ? undefined : db,
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Receiving: only from an ACTIVE partner, about a collection on its own origin, kept only for this instance's people it
// names.

const iconOf = z
  .union([z.string(), z.object({ url: z.string() }).passthrough()])
  .nullish()
  .catch(null)
  .transform((value) => (typeof value === "string" ? value : (value?.url ?? null)));
const personDoc = z.object({
  id: z.string(),
  name: z.string().nullish().catch(null),
  preferredUsername: z.string().nullish().catch(null),
  icon: iconOf,
});
const collectionDoc = z.object({
  id: z.string(),
  name: z.string().optional().catch(undefined),
  attributedTo: personDoc,
  source: z.object({ content: z.string() }).partial().optional().catch(undefined),
  updated: z
    .string()
    .optional()
    .catch(undefined)
    .transform((value) => (value && !Number.isNaN(Date.parse(value)) ? new Date(value) : null)),
  to: z
    .union([z.string(), z.array(z.unknown())])
    .optional()
    .catch(undefined)
    .transform((value) =>
      (value === undefined ? [] : Array.isArray(value) ? value : [value]).filter(
        (item): item is string => typeof item === "string",
      ),
    ),
  "thingport:items": z.string().optional().catch(undefined),
});

// What a partner may say: as its index of public collections keeps them (remoteIndex.ts).
const NAME_MAX = 200;
const DESCRIPTION_MAX = 5000;
const VIEWERS_MAX = 100;
// However long a big collection's models take to write, as the index's own read allows (remoteIndex.ts).
// Collections a partner lists as shared with people here, and the pages of that list, read at most.
const SHARED_LIST_MAX = 10_000;
const SHARED_LIST_PAGES = 40;

async function activePeer(actorId: URL): Promise<Peer | null> {
  return prisma.peer.findFirst({ where: { actorUrl: actorId.href, status: "ACTIVE" } });
}

/** A partner's `Update` of a collection shared with people here: read from its owner's instance and kept for them. */
export async function sharedCollectionFrom(actorId: URL, objectId: string): Promise<void> {
  const peer = await activePeer(actorId);
  if (!peer || originOf(objectId) !== peer.origin) return;
  // Kept at the partner and tried again until they're back on: nothing's lost meanwhile.
  if (!(await getSocialSettings()).enabled) throw new RetryLater(SOCIAL_OFF);
  await readShared(peer, objectId);
}

/** A partner's `Delete` of one: gone for everyone here it was shared with. False when it isn't one kept here. */
export async function sharedCollectionGoneFrom(actorId: URL, objectId: string): Promise<boolean> {
  const peer = await activePeer(actorId);
  // Only its own: a partner can't let go of another's, nor note one gone.
  if (!peer || originOf(objectId) !== peer.origin) return false;
  let gone = false;
  await oneAtATime(objectId, async () => {
    gone = await forget(peer.id, objectId, askedAt());
  });
  return gone;
}

// What's being read or let go of each collection, by its address: one at a time, from fetching it to writing it, so an
// older read can't write over a newer one (or bring back someone taken off its list) by finishing last.
const busy = new Map<string, Promise<void>>();
function oneAtATime(apId: string, work: () => Promise<void>): Promise<void> {
  const done = (busy.get(apId) ?? Promise.resolve()).catch(() => {}).then(work);
  busy.set(apId, done);
  void done
    .finally(() => {
      if (busy.get(apId) === done) busy.delete(apId);
    })
    .catch(() => {});
  return done;
}

/** Every collection shared with people here by `peer`'s people, read again: what's changed in them, and those no
 *  longer shared with anyone here. After each read of what it shares. */
export async function refreshShared(peerId: string): Promise<void> {
  const peer = await prisma.peer.findUnique({ where: { id: peerId } });
  if (!peer || peer.status !== "ACTIVE") return;
  // Nothing's taken while social features are off, as an Update isn't (`sharedCollectionFrom`): read once they're on.
  if (!(await getSocialSettings()).enabled) return;
  const rows = await prisma.remoteCollection.findMany({
    where: { peerId, limited: true },
    select: { apId: true },
  });
  // And whatever it says is shared with people here, so one whose Update never got here (social features were off
  // longer than the partner kept trying, say) is found all the same. A list that can't be read is the partner's
  // error to show its admin; what it did list is read with the rest.
  const listed = await sharedListOf(peer);
  if (listed.error) {
    const message = `Couldn't list what its people shared with people here: ${listed.error.message}`;
    console.warn(`[federation] ${peer.origin}: ${message}`);
    await failedOn(peer, message);
  }
  // One that can't be read stays as it was; the first such is shown too, and the rest are read all the same.
  let failed: string | null = null;
  for (const apId of new Set([...rows.map((row) => row.apId), ...listed.urls])) {
    try {
      await readShared(peer, apId);
    } catch (err) {
      // Social features turned off meanwhile: the rest wait too.
      if (err instanceof RetryLater) return;
      failed ??= `Couldn't read a collection its people shared with people here: ${(err as Error).message}`;
      console.warn(`[federation] Couldn't read a collection shared from ${peer.origin}:`, (err as Error).message);
    }
  }
  if (failed) await failedOn(peer, failed);
}

/** Shows `message` to the admin on the partner's row, unless the read of its index just now failed: that says more,
 *  and stays. A read of it that works clears both. */
async function failedOn(peer: Peer, message: string): Promise<void> {
  await prisma.peer
    .updateMany({ where: { id: peer.id, syncError: null }, data: { syncError: message.slice(0, 500) } })
    .catch(() => {});
}

const sharedList = z.object({ orderedItems: z.array(z.unknown()), next: z.string().optional().catch(undefined) });

/** The addresses of `peer`'s collections shared with people here, page by page as it lists them; none from one too
 *  old to. What was listed before a page that failed, and why it did. */
async function sharedListOf(peer: Peer): Promise<{ urls: string[]; error: Error | null }> {
  const runtime = await getRuntime();
  const urls: string[] = [];
  let url: string | undefined = `${peer.origin}${AP_PREFIX}/shared`;
  try {
    for (let page = 0; url && originOf(url) === peer.origin && page < SHARED_LIST_PAGES; page++) {
      let body: unknown;
      try {
        body = (await runtime.signedLoader(url)).document;
      } catch (err) {
        if (page === 0 && err instanceof FederationFetchError && err.status === 404) break;
        throw err;
      }
      const list = sharedList.parse(body);
      for (const item of list.orderedItems) {
        if (typeof item === "string" && originOf(item) === peer.origin) urls.push(item);
      }
      if (urls.length >= SHARED_LIST_MAX) break;
      url = list.next;
    }
  } catch (err) {
    return { urls: urls.slice(0, SHARED_LIST_MAX), error: err as Error };
  }
  return { urls: urls.slice(0, SHARED_LIST_MAX), error: null };
}

/** A read of a collection that something asked for later wrote first: nothing of it is kept. */
class Superseded extends Error {}

/** Reads one collection `peer` says is shared with people here and keeps it as it says, with its models; or lets it
 *  go once it's no longer shared with anyone here (or isn't there). One read of a collection at a time. */
function readShared(peer: Peer, apId: string): Promise<void> {
  return oneAtATime(apId, () => readSharedNow(peer, apId));
}

async function readSharedNow(peer: Peer, apId: string): Promise<void> {
  // Turned off while it waited its turn: not asked for until they're on again.
  if (!(await getSocialSettings()).enabled) throw new RetryLater(SOCIAL_OFF);
  const runtime = await getRuntime();
  const own = (url: string | undefined): url is string => Boolean(url) && originOf(url!) === peer.origin;
  const read = async (url: string) => (await runtime.signedLoader(url)).document;
  // As of when it's asked for: a read of the partner's index asked for before this doesn't write over it
  // (remoteIndex.ts), nor does a read of another collection asked for before it.
  const readAt = askedAt();
  let doc: z.infer<typeof collectionDoc>;
  try {
    doc = collectionDoc.parse(await read(apId));
  } catch (err) {
    // Not shared with anyone here any more, or gone: its owner's instance answers for it no longer.
    if (err instanceof FederationFetchError && (err.status === 404 || err.status === 410)) {
      await forget(peer.id, apId, readAt);
      return;
    }
    throw err;
  }
  if (doc.id !== apId || !own(doc.attributedTo.id)) return;
  const named = [...new Set(doc.to.flatMap((url) => localUserId(runtime, url) ?? []))].slice(0, VIEWERS_MAX);
  const users = named.length ? await prisma.user.findMany({ where: { id: { in: named } }, select: { id: true } }) : [];
  if (!users.length) {
    await forget(peer.id, apId, readAt);
    return;
  }
  const items = doc["thingport:items"];
  // Nowhere of its own to read its models from: they're not known, not gone, so those it had stay.
  const models = own(items) ? await readModels(read, items, own) : { models: [], all: false };
  const theirs = models.models.filter((model) => model.attributedTo === doc.attributedTo.id);

  await prisma
    .$transaction(
      async (tx) => {
        // Held until it's kept and whoever's new is told: turning them off waits for it, and once they're off nothing
        // of it is kept, so nobody's its viewer without being told. Read again once they're on, by the Update tried
        // again or the refresh after the next read of the index.
        if (!(await holdSocialSettings(tx)).enabled) throw new RetryLater(SOCIAL_OFF);
        await holdRemoteModels(tx, peer.id);
        const kept = await tx.remoteCollection.findUnique({
          where: { apId },
          select: { id: true, peerId: true, modelApIds: true, fetchedAt: true, viewers: { select: { userId: true } } },
        });
        if (kept && kept.peerId !== peer.id) return;
        // Asked for since by its partner's index, public there by then: that's newer, and stays.
        if (kept?.fetchedAt && kept.fetchedAt > readAt) return;
        // Its owner too only if all of this is kept (the check below).
        const owner = await personOn(
          peer,
          {
            id: doc.attributedTo.id,
            name: doc.attributedTo.name ?? null,
            preferredUsername: doc.attributedTo.preferredUsername ?? null,
            icon: doc.attributedTo.icon,
          },
          tx,
        );
        if (!owner) return;
        for (const model of theirs) {
          // As of when its page was asked for: what orders it beside a read of the index, or of another collection.
          const data = {
            peerId: peer.id,
            personId: owner.id,
            ...remoteModelData(model, own),
            syncedAt: model.fetchedAt,
          };
          // One shared openly there stays as its index has it, details too: these may be newer than what's open there
          // (made private and changed since), and its index's next read says which (remoteIndex.ts). One a read of
          // another collection holding it asked for later has already written stays as that read has it.
          const write = () =>
            tx.remoteModel.updateMany({
              where: { apId: model.id, limited: true, syncedAt: { lte: model.fetchedAt } },
              data,
            });
          if (!(await write()).count) {
            const { count } = await tx.remoteModel.createMany({
              data: { apId: model.id, ...data, limited: true },
              skipDuplicates: true,
            });
            // Made meanwhile, by a read of another collection holding it: written over, unless it's public or newer.
            if (!count) await write();
          }
        }
        const data = {
          peerId: peer.id,
          personId: owner.id,
          name: (doc.name?.trim() || "Untitled").slice(0, NAME_MAX),
          description: doc.source?.content?.trim().slice(0, DESCRIPTION_MAX) || null,
          updatedAt: doc.updated,
          syncedAt: readAt,
          fetchedAt: readAt,
          limited: true,
          // Its models read only in part: those it had stay, beside those read now.
          modelApIds: models.all
            ? theirs.map((model) => model.id)
            : [...new Set([...theirs.map((model) => model.id), ...(kept?.modelApIds ?? [])])],
        };
        // Checked again as it's written: a read of the index that was asked later may have finished meanwhile. The
        // collection after its models, as the index writes them, so neither waits on a row the other holds.
        const write = () =>
          tx.remoteCollection.updateMany({
            where: { apId, OR: [{ fetchedAt: null }, { fetchedAt: { lte: readAt } }] },
            data,
          });
        let { count } = await write();
        if (!count && !kept) {
          await tx.remoteCollection.createMany({ data: { apId, ...data }, skipDuplicates: true });
          ({ count } = await write());
        }
        if (!count) throw new Superseded();
        const saved = await tx.remoteCollection.findUniqueOrThrow({ where: { apId }, select: { id: true } });
        // Held from going until it's kept: one whose account is deleted meanwhile is left out, not the read failed.
        const viewers = (
          await tx.$queryRaw<{ id: string }[]>`
            SELECT id FROM "User" WHERE id = ANY(${users.map((user) => user.id)}::text[]) FOR KEY SHARE`
        ).map((user) => user.id);
        // Nobody here left to see it, their accounts deleted meanwhile: let go of as one no longer shared with them.
        if (!viewers.length) {
          await tx.remoteCollection.deleteMany({ where: { apId, peerId: peer.id, limited: true } });
          await noteGone(tx, peer.id, apId, readAt);
          await pruneIn(tx, peer.id, [...new Set([...data.modelApIds, ...(kept?.modelApIds ?? [])])]);
          await holdPartner(tx, peer.id);
          return;
        }
        const had = new Set(kept?.viewers.map((viewer) => viewer.userId) ?? []);
        await tx.remoteCollectionViewer.deleteMany({ where: { collectionId: saved.id, userId: { notIn: viewers } } });
        await tx.remoteCollectionViewer.createMany({
          data: viewers.map((userId) => ({ collectionId: saved.id, userId })),
          skipDuplicates: true,
        });
        await tell(
          tx,
          viewers.filter((userId) => !had.has(userId)),
          owner,
          data.name,
          saved.id,
        );
        // Those it no longer holds, with nothing else holding them, in the same go: nothing comes between.
        const holds = new Set(data.modelApIds);
        await pruneIn(
          tx,
          peer.id,
          (kept?.modelApIds ?? []).filter((id) => !holds.has(id)),
        );
        await holdPartner(tx, peer.id);
      },
      { timeout: HOLD_TIMEOUT_MS, maxWait: 10_000 },
    )
    .catch((err: unknown) => {
      if (!(err instanceof Superseded)) throw err;
    });
}

/** Throws unless `peerId` is still an ACTIVE partner, and keeps it one until `tx` is done: a block waits for it, then
 *  forgets what it wrote, a person too. One blocked or disconnected already keeps nothing of it. Last in a transaction,
 *  so it's never held while waiting on a row a read of the index has (which takes the partner's row last too). */
async function holdPartner(tx: Prisma.TransactionClient, peerId: string): Promise<void> {
  const still = await tx.$queryRaw<unknown[]>`
    SELECT 1 FROM "Peer" WHERE id = ${peerId} AND status = 'ACTIVE' FOR SHARE`;
  if (!still.length) throw new Error("No longer connected");
}

/** Notifies `userIds` of it, in the transaction that keeps them as its viewers. */
async function tell(
  tx: Prisma.TransactionClient,
  userIds: string[],
  owner: RemotePerson,
  name: string,
  collectionId: string,
): Promise<void> {
  if (!userIds.length) return;
  const title = `${owner.displayName} shared “${name}” with you`;
  await tx.notification.createMany({
    data: userIds.map((userId) => ({
      userId,
      type: "share" as const,
      title,
      internalPath: `/explore/elsewhere/collections/${collectionId}`,
    })),
  });
}

/** Lets go of `apId`, no longer shared with anyone here, as its owner's instance said `at` (when what told it was asked
 *  for), with the models only it held, in one go. False when it wasn't one kept here. Nothing's kept of a partner
 *  blocked meanwhile: its notes go with the rest (`forgetPeerContent`). */
async function forget(peerId: string, apId: string, at: Date): Promise<boolean> {
  return prisma.$transaction(
    async (tx) => {
      await holdRemoteModels(tx, peerId);
      const kept = await tx.remoteCollection.findFirst({
        where: { apId, peerId, limited: true },
        select: { id: true, modelApIds: true },
      });
      if (kept) await tx.remoteCollection.delete({ where: { id: kept.id } });
      await noteGone(tx, peerId, apId, at);
      if (kept) await pruneIn(tx, peerId, kept.modelApIds);
      await holdPartner(tx, peerId);
      return Boolean(kept);
    },
    { timeout: HOLD_TIMEOUT_MS, maxWait: 10_000 },
  );
}

/** Notes `apId` gone as of `at`, so a read of the index asked for before then can't bring it back as public
 *  (remoteIndex.ts). */
async function noteGone(tx: Prisma.TransactionClient, peerId: string, apId: string, at: Date): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO "RemoteGone" ("apId", "peerId", "at") VALUES (${apId}, ${peerId}, ${at})
    ON CONFLICT ("apId") DO UPDATE SET "at" = GREATEST("RemoteGone"."at", EXCLUDED."at")`;
}

/** Whether `userId` may open a partner's model: one shared openly there, or in a collection shared with them. */
export async function canSeeRemoteModel(
  model: { apId: string; peerId: string; limited: boolean },
  userId: string,
): Promise<boolean> {
  if (!model.limited) return true;
  return (
    (await prisma.remoteCollection.count({
      where: {
        peerId: model.peerId,
        limited: true,
        modelApIds: { has: model.apId },
        viewers: { some: { userId } },
      },
    })) > 0
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Finding someone to share with

// A handle nobody answered to on that partner, asked again only after this: someone typing doesn't ask it each key.
const MISS_MS = 60 * 1000;
const MISSES_MAX = 1000;
const misses = new Map<string, number>();
// Handles a person may have asked of partners a minute, whatever they type: each is a signed request to that partner.
const ASKS_PER_MINUTE = 10;
const asked = new Map<string, number[]>();

/** Whether `userId` may ask a partner for someone now, counted if so. */
function mayAsk(userId: string): boolean {
  const now = Date.now();
  const recent = (asked.get(userId) ?? []).filter((at) => now - at < 60_000);
  if (recent.length >= ASKS_PER_MINUTE) {
    asked.set(userId, recent);
    return false;
  }
  recent.push(now);
  asked.set(userId, recent);
  if (asked.size > MISSES_MAX) asked.delete(asked.keys().next().value!);
  return true;
}

/** Whether `host` (`name`, `name:port`, `[fd00::1]:8000`) is where `origin` is, however it's written: IPv6 shortened
 *  or not, a default port or none. */
function isHostOf(origin: string, host: string): boolean {
  try {
    const at = new URL(origin);
    return new URL(`${at.protocol}//${host}`).host === at.host;
  } catch {
    return false;
  }
}

/** Someone on a connected instance by their exact handle, `name@host`: from what this instance has of that partner,
 *  or else asked of it, for `userId` (a few times a minute). Only ever an ACTIVE partner's host: a handle naming
 *  anywhere else asks nobody. */
export async function personByHandle(handle: string, userId: string): Promise<(RemotePerson & { peer: Peer }) | null> {
  const match = /^@?([a-z0-9_.-]{1,40})@((?:[a-z0-9.-]+|\[[0-9a-f:.]+\])(?::\d{1,5})?)$/i.exec(handle.trim());
  if (!match) return null;
  const username = match[1].toLowerCase();
  const peers = await prisma.peer.findMany({ where: { status: "ACTIVE" } });
  const peer = peers.find((item) => isHostOf(item.origin, match[2]));
  if (!peer) return null;
  const known = await prisma.remotePerson.findFirst({
    where: { peerId: peer.id, username },
    include: { peer: true },
  });
  if (known) return known;
  const key = `${peer.id} ${username}`;
  if (Date.now() - (misses.get(key) ?? 0) < MISS_MS || !mayAsk(userId)) return null;
  try {
    const runtime = await getRuntime();
    const doc = personDoc.parse(
      (await runtime.signedLoader(`${peer.origin}${AP_PREFIX}/people/${encodeURIComponent(username)}`)).document,
    );
    const person = await prisma.$transaction(async (tx) => {
      const kept = await personOn(
        peer,
        { id: doc.id, name: doc.name ?? null, preferredUsername: doc.preferredUsername ?? username, icon: doc.icon },
        tx,
      );
      await holdPartner(tx, peer.id);
      return kept;
    });
    if (!person) return null;
    misses.delete(key);
    return { ...person, peer };
  } catch {
    for (const [name, at] of misses) if (Date.now() - at >= MISS_MS) misses.delete(name);
    misses.set(key, Date.now());
    // The oldest go first past the cap: Maps keep the order things were put in.
    while (misses.size > MISSES_MAX) misses.delete(misses.keys().next().value!);
    return null;
  }
}
