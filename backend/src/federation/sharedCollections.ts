import crypto from "node:crypto";
import type { Peer, Prisma, RemotePerson } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { createNotification } from "../services/notificationService";
import { getSocialSettings } from "../services/settingsService";
import { originOf } from "./addresses";
import { here, localUserId, personOn, RetryLater, type Here } from "./chats";
import { enqueueActivity, kickDelivery } from "./delivery";
import { FederationFetchError } from "./fetch";
import { sharedCollectionObject } from "./publish";
import { readModels, remoteModelData } from "./remoteIndex";
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

const collectionUrl = (at: Pick<Here, "origin">, id: string) => `${at.origin}${AP_PREFIX}/collections/${id}`;

// ---------------------------------------------------------------------------------------------------------------------
// Sending

/** Queues, in `db`'s transaction, what each partner with people on `collectionId`'s list now needs to hear: `Update`
 *  while it's shared with someone there, `Delete` once it isn't. `alsoPeerIds`: partners whose people were just taken
 *  off it, who may have none left on it. Call `kickDelivery` once the transaction is committed. */
export async function queueSharing(db: Db, collectionId: string, alsoPeerIds: string[] = []): Promise<void> {
  const peers = await peersOf(db, [collectionId], alsoPeerIds);
  if (!peers.length) return;
  const at = await here();
  const url = collectionUrl(at, collectionId);
  for (const peer of peers) {
    const object = await sharedCollectionObject(at, collectionId, peer.id, db);
    await send(
      db,
      at,
      peer,
      url,
      object
        ? { type: "Update", to: object.to, object: { id: url, type: "Collection", name: object.name } }
        : { type: "Delete", to: [peer.actorUrl], object: url },
    );
  }
}

/** Queues `Delete` of each of `collectionIds` for every partner with people on its list: they're about to go. In the
 *  transaction that deletes them. */
export async function queueCollectionsGone(db: Db, collectionIds: string[]): Promise<void> {
  if (!collectionIds.length) return;
  const shares = await db.collectionShare.findMany({
    where: { collectionId: { in: collectionIds }, remotePersonId: { not: null } },
    select: { collectionId: true, remotePerson: { select: { peerId: true } } },
  });
  if (!shares.length) return;
  const at = await here();
  const peers = await db.peer.findMany({
    where: { id: { in: [...new Set(shares.flatMap((share) => share.remotePerson?.peerId ?? []))] } },
  });
  for (const share of shares) {
    const peer = peers.find((item) => item.id === share.remotePerson?.peerId);
    if (!peer) continue;
    const url = collectionUrl(at, share.collectionId);
    await send(db, at, peer, url, { type: "Delete", to: [peer.actorUrl], object: url });
  }
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

async function activePeer(actorId: URL): Promise<Peer | null> {
  return prisma.peer.findFirst({ where: { actorUrl: actorId.href, status: "ACTIVE" } });
}

/** A partner's `Update` of a collection shared with people here: read from its owner's instance and kept for them. */
export async function sharedCollectionFrom(actorId: URL, objectId: string): Promise<void> {
  const peer = await activePeer(actorId);
  if (!peer || originOf(objectId) !== peer.origin) return;
  // Kept at the partner and tried again until they're back on: nothing's lost meanwhile.
  if (!(await getSocialSettings()).enabled) throw new RetryLater("Social features are off here for now");
  await readShared(peer, objectId);
}

/** A partner's `Delete` of one: gone for everyone here it was shared with. False when it isn't one kept here. */
export async function sharedCollectionGoneFrom(actorId: URL, objectId: string): Promise<boolean> {
  const peer = await activePeer(actorId);
  if (!peer) return false;
  const { count } = await prisma.remoteCollection.deleteMany({
    where: { apId: objectId, peerId: peer.id, limited: true },
  });
  if (count) await pruneLimitedModels(peer.id);
  return count > 0;
}

/** Every collection shared with people here by `peer`'s people, read again: what's changed in them, and those no
 *  longer shared with anyone here. After each read of what it shares. */
export async function refreshShared(peerId: string): Promise<void> {
  const peer = await prisma.peer.findUnique({ where: { id: peerId } });
  if (!peer || peer.status !== "ACTIVE") return;
  const rows = await prisma.remoteCollection.findMany({
    where: { peerId, limited: true },
    select: { apId: true },
  });
  for (const row of rows) {
    await readShared(peer, row.apId).catch((err: unknown) => {
      console.warn(`[federation] Couldn't read a collection shared from ${peer.origin}:`, (err as Error).message);
    });
  }
}

/** Reads one collection `peer` says is shared with people here and keeps it as it says, with its models; or lets it
 *  go once it's no longer shared with anyone here (or isn't there). */
async function readShared(peer: Peer, apId: string): Promise<void> {
  const runtime = await getRuntime();
  const own = (url: string | undefined): url is string => Boolean(url) && originOf(url!) === peer.origin;
  const read = async (url: string) => (await runtime.signedLoader(url)).document;
  let doc: z.infer<typeof collectionDoc>;
  try {
    doc = collectionDoc.parse(await read(apId));
  } catch (err) {
    // Not shared with anyone here any more, or gone: its owner's instance answers for it no longer.
    if (err instanceof FederationFetchError && (err.status === 404 || err.status === 410)) {
      await forget(peer.id, apId);
      return;
    }
    throw err;
  }
  if (doc.id !== apId || !own(doc.attributedTo.id)) return;
  const named = [...new Set(doc.to.flatMap((url) => localUserId(runtime, url) ?? []))].slice(0, VIEWERS_MAX);
  const users = named.length ? await prisma.user.findMany({ where: { id: { in: named } }, select: { id: true } }) : [];
  if (!users.length) {
    await forget(peer.id, apId);
    return;
  }
  const owner = await personOn(peer, {
    id: doc.attributedTo.id,
    name: doc.attributedTo.name ?? null,
    preferredUsername: doc.attributedTo.preferredUsername ?? null,
    icon: doc.attributedTo.icon,
  });
  if (!owner) return;
  const items = doc["thingport:items"];
  const models = own(items) ? await readModels(read, items, own) : { models: [], all: true };
  const theirs = models.models.filter((model) => model.attributedTo === owner.apId);

  const added = await prisma.$transaction(async (tx) => {
    const kept = await tx.remoteCollection.findUnique({
      where: { apId },
      select: { id: true, peerId: true, modelApIds: true, viewers: { select: { userId: true } } },
    });
    if (kept && kept.peerId !== peer.id) return null;
    const readAt = new Date();
    for (const model of theirs) {
      const data = { peerId: peer.id, personId: owner.id, ...remoteModelData(model, own), syncedAt: readAt };
      // One also shared openly there stays as its index has it: not limited.
      await tx.remoteModel.upsert({
        where: { apId: model.id },
        create: { apId: model.id, ...data, limited: true },
        update: data,
        select: { id: true },
      });
    }
    const data = {
      peerId: peer.id,
      personId: owner.id,
      name: (doc.name?.trim() || "Untitled").slice(0, NAME_MAX),
      description: doc.source?.content?.trim().slice(0, DESCRIPTION_MAX) || null,
      updatedAt: doc.updated,
      syncedAt: readAt,
      limited: true,
      // Its models read only in part: those it had stay.
      modelApIds: models.all ? theirs.map((model) => model.id) : (kept?.modelApIds ?? theirs.map((model) => model.id)),
    };
    const saved = await tx.remoteCollection.upsert({
      where: { apId },
      create: { apId, ...data },
      update: data,
      select: { id: true },
    });
    const viewers = users.map((user) => user.id);
    const had = new Set(kept?.viewers.map((viewer) => viewer.userId) ?? []);
    await tx.remoteCollectionViewer.deleteMany({ where: { collectionId: saved.id, userId: { notIn: viewers } } });
    await tx.remoteCollectionViewer.createMany({
      data: viewers.map((userId) => ({ collectionId: saved.id, userId })),
      skipDuplicates: true,
    });
    // Still a partner: one blocked or disconnected meanwhile keeps nothing of this.
    const still = await tx.peer.count({ where: { id: peer.id, status: "ACTIVE" } });
    if (!still) throw new Error("No longer connected");
    return { id: saved.id, name: data.name, viewers: viewers.filter((userId) => !had.has(userId)) };
  });
  await pruneLimitedModels(peer.id);
  if (added?.viewers.length) await tell(added.viewers, owner, added.name, added.id);
}

async function tell(userIds: string[], owner: RemotePerson, name: string, collectionId: string): Promise<void> {
  const title = `${owner.displayName} shared “${name}” with you`;
  await Promise.all(
    userIds.map((userId) =>
      createNotification(userId, {
        type: "share",
        title,
        internalPath: `/explore/elsewhere/collections/${collectionId}`,
      }).catch(() => {}),
    ),
  );
}

async function forget(peerId: string, apId: string): Promise<void> {
  const { count } = await prisma.remoteCollection.deleteMany({ where: { apId, peerId, limited: true } });
  if (count) await pruneLimitedModels(peerId);
}

/** The models kept only for collections shared with people here that no such collection holds any more. */
export async function pruneLimitedModels(peerId: string, db: Db = prisma): Promise<void> {
  await db.$executeRaw`
    DELETE FROM "RemoteModel" m
    WHERE m."peerId" = ${peerId} AND m.limited
      AND NOT EXISTS (
        SELECT 1 FROM "RemoteCollection" c
        WHERE c."peerId" = m."peerId" AND c.limited AND m."apId" = ANY(c."modelApIds")
      )`;
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
const misses = new Map<string, number>();

/** Someone on a connected instance by their exact handle, `name@host`: from what this instance has of that partner,
 *  or else asked of it. Only ever an ACTIVE partner's host: a handle naming anywhere else asks nobody. */
export async function personByHandle(handle: string): Promise<(RemotePerson & { peer: Peer }) | null> {
  const match = /^@?([a-z0-9_.-]{1,40})@([a-z0-9.-]+(?::\d{1,5})?)$/i.exec(handle.trim());
  if (!match) return null;
  const username = match[1].toLowerCase();
  const host = match[2].toLowerCase();
  const peers = await prisma.peer.findMany({ where: { status: "ACTIVE" } });
  const peer = peers.find((item) => new URL(item.origin).host.toLowerCase() === host);
  if (!peer) return null;
  const known = await prisma.remotePerson.findFirst({
    where: { peerId: peer.id, username },
    include: { peer: true },
  });
  if (known) return known;
  const key = `${peer.id} ${username}`;
  if (Date.now() - (misses.get(key) ?? 0) < MISS_MS) return null;
  try {
    const runtime = await getRuntime();
    const doc = personDoc.parse(
      (await runtime.signedLoader(`${peer.origin}${AP_PREFIX}/people/${encodeURIComponent(username)}`)).document,
    );
    const person = await personOn(peer, {
      id: doc.id,
      name: doc.name ?? null,
      preferredUsername: doc.preferredUsername ?? username,
      icon: doc.icon,
    });
    if (!person) return null;
    misses.delete(key);
    return { ...person, peer };
  } catch {
    for (const [name, at] of misses) if (Date.now() - at >= MISS_MS) misses.delete(name);
    misses.set(key, Date.now());
    return null;
  }
}
