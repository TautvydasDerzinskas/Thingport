import type { Peer, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { originOf } from "./addresses";
import { FederationFetchError } from "./fetch";
import { forgetMedia, pruneMedia } from "./media";
import { AP_PREFIX, getRuntime } from "./runtime";
import { isFederationLive } from "./settings";

/** What partners share, read into this instance's own tables (RemotePerson, RemoteModel, RemoteCollection) for Explore:
 *  on connecting, every 15 minutes after, and when someone opens Explore and it's a couple of minutes old. Explore
 *  stays fast, and shows what a partner shared while it's away. Everything a partner says is checked here: its ids and
 *  pictures must be on its own origin, its text is cut to size. Gone with the partner. */

const SYNC_EVERY_MS = 15 * 60 * 1000;
const RETRY_AFTER_MS = 2 * 60 * 1000;
const MAX_PEOPLE = 500;
const MAX_DIRECTORY_PAGES = 20;
// 2,000 of a person's models, the latest shared first: one with more shows those, and keeps any read before.
const MAX_MODEL_PAGES = 40;
// As many as Thingport publishes; another partner's are cut there too.
const MAX_COLLECTIONS = 200;
// Writing what was read, in one transaction: however many rows a big partner has.
const STORE_TIMEOUT_MS = 5 * 60 * 1000;

const running = new Map<string, Promise<void>>();
// The part of a sync that writes: what forgetting a partner waits for, so it isn't written back after.
const storing = new Map<string, Promise<unknown>>();
const lastTried = new Map<string, number>();

/** Reads a partner's directory again now, unless that's already under way. */
export function syncPeer(peerId: string): Promise<void> {
  const current = running.get(peerId);
  if (current) return current;
  lastTried.set(peerId, Date.now());
  const run = sync(peerId).finally(() => running.delete(peerId));
  running.set(peerId, run);
  return run;
}

/** Partners whose index is older than `maxAgeMs` (never read, or read before), read again; one that failed waits a
 *  couple of minutes before it's tried again. */
export async function syncStale(maxAgeMs = SYNC_EVERY_MS): Promise<void> {
  if (!(await isFederationLive())) return;
  const peers = await prisma.peer.findMany({ where: { status: "ACTIVE" }, select: { id: true, syncedAt: true } });
  for (const peer of peers) {
    const age = peer.syncedAt ? Date.now() - peer.syncedAt.getTime() : Infinity;
    if (age < maxAgeMs || Date.now() - (lastTried.get(peer.id) ?? 0) < RETRY_AFTER_MS) continue;
    void syncPeer(peer.id).catch(() => {});
  }
}

/** Everything of a partner's kept here: on disconnecting or blocking it. A sync writing meanwhile finishes first; one
 *  writing later finds the partner gone or no longer ACTIVE, and writes nothing (`store`). */
export async function forgetPeerContent(peerId: string): Promise<void> {
  await storing.get(peerId)?.catch(() => {});
  await forgetMedia(peerId);
  // Rooms hosted here go on without its people, their other partners told; the copies of its rooms go. Direct messages
  // with its people stay, as they said.
  const rooms = await prisma.chatRemoteMember.findMany({
    where: { person: { peerId } },
    select: { chatId: true },
    distinct: ["chatId"],
  });
  const copies = await prisma.chat.findMany({ where: { hostPeerId: peerId }, select: { id: true } });
  await prisma.chat.deleteMany({ where: { hostPeerId: peerId } });
  for (const copy of copies) {
    await prisma.notification.deleteMany({ where: { type: "chat", group: { path: ["chatId"], equals: copy.id } } });
  }
  await prisma.remotePerson.deleteMany({ where: { peerId } });
  if (rooms.length) {
    void import("./chats")
      .then(async ({ roomChanged }) => {
        for (const room of rooms) await roomChanged(room.chatId);
      })
      .catch(() => {});
  }
}

// ---------------------------------------------------------------------------------------------------------------------

const text = (max: number) =>
  z
    .string()
    .transform((value) => value.trim().slice(0, max))
    .optional()
    .catch(undefined);
const source = z.object({ content: z.string() }).partial().optional().catch(undefined);
const imageRef = z.union([z.string(), z.object({ url: z.string() }).passthrough()]);
const images = z
  .union([imageRef, z.array(imageRef)])
  .optional()
  .catch(undefined)
  .transform((value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]))
  .transform((list) => list.map((item) => (typeof item === "string" ? item : item.url)));
const date = z
  .string()
  .optional()
  .catch(undefined)
  .transform((value) => {
    const at = value ? new Date(value) : null;
    return at && !Number.isNaN(at.getTime()) ? at : null;
  });
const count = z.number().int().min(0).max(1_000_000).optional().catch(undefined);

const personSchema = z.object({
  id: z.string(),
  type: z.literal("Person"),
  preferredUsername: text(30),
  name: text(120),
  source,
  attachment: z
    .array(z.object({ href: z.string() }).passthrough())
    .optional()
    .catch(undefined),
  icon: images,
  image: images,
  published: date,
  "thingport:coverPreset": text(40),
  "thingport:coverPositionY": count,
  "thingport:sharedAt": date,
  "thingport:modelCount": count,
  "thingport:collectionCount": count,
  "thingport:models": z.string().optional().catch(undefined),
  "thingport:collections": z.string().optional().catch(undefined),
});

const modelSchema = z.object({
  id: z.string(),
  name: text(300),
  attributedTo: z.string(),
  source,
  image: images,
  attachment: z
    .array(
      z
        .object({
          name: text(255),
          mediaType: text(120),
          url: z.string().optional().catch(undefined),
          "thingport:size": z.number().int().min(0).optional().catch(undefined),
        })
        .passthrough(),
    )
    .optional()
    .catch(undefined),
  published: date,
  updated: date,
});

const collectionSchema = z.object({
  id: z.string(),
  name: text(200),
  attributedTo: z.string(),
  source,
  updated: date,
  "thingport:models": z.array(z.string()).optional().catch(undefined),
});

// A listing without its items is broken, not empty: read as empty, it would take everything of the partner's away.
const pageSchema = z.object({
  orderedItems: z.array(z.unknown()),
  next: z.string().optional().catch(undefined),
});

type Person = z.infer<typeof personSchema>;
type Model = z.infer<typeof modelSchema>;
type Collection = z.infer<typeof collectionSchema>;

type Shared = { person: Person; models: Model[]; allModels: boolean; collections: Collection[] };

async function sync(peerId: string): Promise<void> {
  const peer = await prisma.peer.findUnique({ where: { id: peerId } });
  if (!peer || peer.status !== "ACTIVE" || !(await isFederationLive())) return;
  try {
    const runtime = await getRuntime();
    const own = (url: string | undefined): url is string => Boolean(url) && originOf(url!) === peer.origin;
    const read = async (url: string) => (await runtime.signedLoader(url)).document;

    // The directory comes a page at a time, as a page has to fit what a fetch takes.
    const listed: Person[] = [];
    let url: string | undefined = `${peer.origin}${AP_PREFIX}/directory`;
    for (let page = 0; url && own(url) && page < MAX_DIRECTORY_PAGES && listed.length < MAX_PEOPLE; page++) {
      const body = pageSchema.parse(await read(url));
      for (const raw of body.orderedItems) {
        const parsed = personSchema.safeParse(raw);
        if (parsed.success && own(parsed.data.id)) listed.push(parsed.data);
      }
      url = body.next;
    }
    const people: Shared[] = [];
    for (const person of listed.slice(0, MAX_PEOPLE)) {
      const models = own(person["thingport:models"])
        ? await readModels(read, person["thingport:models"], own)
        : { models: [], all: true };
      people.push({
        person,
        models: models.models,
        allModels: models.all,
        collections: own(person["thingport:collections"])
          ? await readCollections(read, person["thingport:collections"], own)
          : [],
      });
    }
    const written = store(peer, people, own);
    storing.set(peer.id, written);
    try {
      await written;
    } finally {
      if (storing.get(peer.id) === written) storing.delete(peer.id);
    }
  } catch (err) {
    const message = (err as Error).message || "Couldn't read what it shares";
    console.warn(`[federation] Couldn't read what ${peer.origin} shares:`, message);
    await prisma.peer.update({ where: { id: peer.id }, data: { syncError: message.slice(0, 500) } }).catch(() => {});
  }
  // A read that failed still tidies the pictures, by what's kept from the last one that didn't.
  await pruneMedia(peer.id).catch(() => {});
}

/** A person's shared models, page by page. `all` is false unless every page was read: one past the last read, a page
 *  that's gone, or a next page somewhere else leaves the rest unknown, not gone. */
export async function readModels(
  read: (url: string) => Promise<unknown>,
  first: string,
  own: (url: string | undefined) => url is string,
): Promise<{ models: Model[]; all: boolean }> {
  const models: Model[] = [];
  let url: string | undefined = first;
  for (let page = 0; url; page++) {
    if (!own(url) || page === MAX_MODEL_PAGES) return { models, all: false };
    let body: z.infer<typeof pageSchema>;
    try {
      body = pageSchema.parse(await read(url));
    } catch (err) {
      // On the first page: shares no models of their own, only collections. Later: the rest isn't known.
      if (err instanceof FederationFetchError && err.status === 404) return { models, all: page === 0 };
      throw err;
    }
    for (const raw of body.orderedItems) {
      const parsed = modelSchema.safeParse(raw);
      if (parsed.success && own(parsed.data.id)) models.push(parsed.data);
    }
    url = body.next;
  }
  return { models, all: true };
}

async function readCollections(
  read: (url: string) => Promise<unknown>,
  url: string,
  own: (url: string | undefined) => url is string,
): Promise<Collection[]> {
  const body = pageSchema.parse(await read(url));
  return body.orderedItems.slice(0, MAX_COLLECTIONS).flatMap((raw) => {
    const parsed = collectionSchema.safeParse(raw);
    return parsed.success && own(parsed.data.id) ? [parsed.data] : [];
  });
}

const webLink = (href: string) => /^https?:\/\//i.test(href) && href.length <= 500;
const markdownOf = (value: { content?: string } | undefined, max: number) =>
  value?.content?.trim() ? value.content.trim().slice(0, max) : null;

/** The index for one partner, made to match what it just said: kept rows keep their ids, so links to them stay. */
async function store(peer: Peer, people: Shared[], own: (url: string | undefined) => url is string): Promise<void> {
  // All of it or none: a write that fails leaves the last complete read as it was.
  await prisma.$transaction((tx) => storeIn(tx, peer, people, own), { timeout: STORE_TIMEOUT_MS, maxWait: 10_000 });
}

async function storeIn(
  tx: Prisma.TransactionClient,
  peer: Peer,
  people: Shared[],
  own: (url: string | undefined) => url is string,
): Promise<void> {
  // Every row written now is marked with it: what's left unmarked is what the partner no longer shares, found without
  // listing what it does (a big partner's ids would pass what one query may take).
  const readAt = new Date();
  // Read only in part: what wasn't read of theirs stays rather than going.
  const partly: string[] = [];
  for (const { person, models, allModels, collections } of people) {
    const personData = {
      peerId: peer.id,
      username: person.preferredUsername?.toLowerCase() ?? null,
      displayName: person.name || person.preferredUsername || new URL(person.id).host,
      bio: markdownOf(person.source, 5000),
      links: (person.attachment ?? [])
        .map((link) => link.href)
        .filter(webLink)
        .slice(0, 5),
      avatarUrl: person.icon.find((url) => own(url)) ?? null,
      coverUrl: person.image.find((url) => own(url)) ?? null,
      coverPreset: person["thingport:coverPreset"] ?? null,
      coverPositionY: Math.min(100, person["thingport:coverPositionY"] ?? 50),
      modelCount: person["thingport:modelCount"] ?? models.length,
      collectionCount: person["thingport:collectionCount"] ?? collections.length,
      sharedAt: person["thingport:sharedAt"],
      joinedAt: person.published,
      syncedAt: readAt,
      listed: true,
    };
    const saved = await tx.remotePerson.upsert({
      where: { apId: person.id },
      create: { apId: person.id, ...personData },
      update: personData,
      select: { id: true, peerId: true },
    });
    // An id claimed by another partner is never taken over.
    if (saved.peerId !== peer.id) continue;
    if (!allModels) partly.push(saved.id);
    for (const model of models) {
      if (model.attributedTo !== person.id) continue;
      const modelData = {
        peerId: peer.id,
        personId: saved.id,
        title: model.name || "Untitled",
        description: markdownOf(model.source, 20_000),
        images: model.image.filter((url) => own(url)).slice(0, 20),
        files: (model.attachment ?? []).slice(0, 100).map((file) => ({
          name: file.name ?? "file",
          size: file["thingport:size"] ?? null,
          mediaType: file.mediaType ?? null,
          // Where it's fetched from, signed, to download, open or copy it: only ever on the partner's own origin.
          url: own(file.url) ? file.url : null,
        })) as Prisma.InputJsonValue,
        sharedAt: model.published,
        updatedAt: model.updated,
        syncedAt: readAt,
      };
      await tx.remoteModel.upsert({
        where: { apId: model.id },
        create: { apId: model.id, ...modelData },
        update: modelData,
        select: { id: true },
      });
    }
    for (const collection of collections) {
      if (collection.attributedTo !== person.id) continue;
      const collectionData = {
        peerId: peer.id,
        personId: saved.id,
        name: collection.name || "Untitled",
        description: markdownOf(collection.source, 5000),
        modelApIds: (collection["thingport:models"] ?? []).filter((id) => own(id)).slice(0, 2000),
        updatedAt: collection.updated,
        syncedAt: readAt,
      };
      await tx.remoteCollection.upsert({
        where: { apId: collection.id },
        create: { apId: collection.id, ...collectionData },
        update: collectionData,
        select: { id: true },
      });
    }
  }
  // Whatever it no longer shares goes.
  const stale = { peerId: peer.id, syncedAt: { lt: readAt } };
  await tx.remoteCollection.deleteMany({ where: stale });
  await tx.remoteModel.deleteMany({ where: { ...stale, personId: { notIn: partly } } });
  // Someone no longer listed whom a chat still names is kept for it, off Explore.
  const inChats = { OR: [{ chats: { some: {} } }, { messages: { some: {} } }] } satisfies Prisma.RemotePersonWhereInput;
  await tx.remotePerson.updateMany({ where: { ...stale, ...inChats }, data: { listed: false } });
  await tx.remotePerson.deleteMany({ where: { ...stale, chats: { none: {} }, messages: { none: {} } } });
  // Still a partner: one blocked or disconnected meanwhile keeps nothing of this. The row stays locked until this is
  // written, so a block waits for it, and what it then forgets is everything.
  const { count: still } = await tx.peer.updateMany({
    where: { id: peer.id, status: "ACTIVE" },
    data: { syncedAt: new Date(), syncError: null },
  });
  if (!still) throw new Error("No longer connected");
}
