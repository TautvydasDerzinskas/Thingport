import fs from "node:fs/promises";
import path from "node:path";
import type { Peer, Prisma } from "@prisma/client";
import { z } from "zod";
import { STORAGE } from "../config";
import { prisma } from "../db";
import { originOf } from "./addresses";
import { FederationFetchError } from "./fetch";
import { AP_PREFIX, getRuntime } from "./runtime";
import { isFederationLive } from "./settings";

/** What partners share, read into this instance's own tables (RemotePerson, RemoteModel, RemoteCollection) for Explore:
 *  on connecting, every 15 minutes after, and when someone opens Explore and it's a couple of minutes old. Explore
 *  stays fast, and shows what a partner shared while it's away. Everything a partner says is checked here: its ids and
 *  pictures must be on its own origin, its text is cut to size. Gone with the partner. */

const SYNC_EVERY_MS = 15 * 60 * 1000;
const RETRY_AFTER_MS = 2 * 60 * 1000;
const MAX_PEOPLE = 500;
const MAX_MODEL_PAGES = 40;
export const MEDIA_DIR = path.join(STORAGE, "federation-media");

const running = new Map<string, Promise<void>>();
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

/** Everything of a partner's kept here: on disconnecting or blocking it. */
export async function forgetPeerContent(peerId: string): Promise<void> {
  await prisma.remotePerson.deleteMany({ where: { peerId } });
  await fs.rm(path.join(MEDIA_DIR, peerId), { recursive: true, force: true }).catch(() => {});
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

const pageSchema = z.object({
  orderedItems: z.array(z.unknown()).optional().catch(undefined),
  next: z.string().optional().catch(undefined),
});

type Person = z.infer<typeof personSchema>;
type Model = z.infer<typeof modelSchema>;
type Collection = z.infer<typeof collectionSchema>;

async function sync(peerId: string): Promise<void> {
  const peer = await prisma.peer.findUnique({ where: { id: peerId } });
  if (!peer || peer.status !== "ACTIVE" || !(await isFederationLive())) return;
  try {
    const runtime = await getRuntime();
    const own = (url: string | undefined): url is string => Boolean(url) && originOf(url!) === peer.origin;
    const read = async (url: string) => (await runtime.signedLoader(url)).document;

    const directory = pageSchema.parse(await read(`${peer.origin}${AP_PREFIX}/directory`));
    const people: { person: Person; models: Model[]; collections: Collection[] }[] = [];
    for (const raw of (directory.orderedItems ?? []).slice(0, MAX_PEOPLE)) {
      const parsed = personSchema.safeParse(raw);
      if (!parsed.success || !own(parsed.data.id)) continue;
      const person = parsed.data;
      people.push({
        person,
        models: own(person["thingport:models"]) ? await readModels(read, person["thingport:models"], own) : [],
        collections: own(person["thingport:collections"])
          ? await readCollections(read, person["thingport:collections"], own)
          : [],
      });
    }
    await store(peer, people, own);
    await prisma.peer.update({ where: { id: peer.id }, data: { syncedAt: new Date(), syncError: null } });
  } catch (err) {
    const message = (err as Error).message || "Couldn't read what it shares";
    console.warn(`[federation] Couldn't read what ${peer.origin} shares:`, message);
    await prisma.peer.update({ where: { id: peer.id }, data: { syncError: message.slice(0, 500) } }).catch(() => {});
  }
}

async function readModels(
  read: (url: string) => Promise<unknown>,
  first: string,
  own: (url: string | undefined) => url is string,
): Promise<Model[]> {
  const models: Model[] = [];
  let url: string | undefined = first;
  for (let page = 0; url && own(url) && page < MAX_MODEL_PAGES; page++) {
    let body: z.infer<typeof pageSchema>;
    try {
      body = pageSchema.parse(await read(url));
    } catch (err) {
      // Shares no models of their own, only collections.
      if (err instanceof FederationFetchError && err.status === 404) break;
      throw err;
    }
    for (const raw of body.orderedItems ?? []) {
      const parsed = modelSchema.safeParse(raw);
      if (parsed.success && own(parsed.data.id)) models.push(parsed.data);
    }
    url = body.next;
  }
  return models;
}

async function readCollections(
  read: (url: string) => Promise<unknown>,
  url: string,
  own: (url: string | undefined) => url is string,
): Promise<Collection[]> {
  const body = pageSchema.parse(await read(url));
  return (body.orderedItems ?? []).flatMap((raw) => {
    const parsed = collectionSchema.safeParse(raw);
    return parsed.success && own(parsed.data.id) ? [parsed.data] : [];
  });
}

const webLink = (href: string) => /^https?:\/\//i.test(href) && href.length <= 500;
const markdownOf = (value: { content?: string } | undefined, max: number) =>
  value?.content?.trim() ? value.content.trim().slice(0, max) : null;

/** The index for one partner, made to match what it just said: kept rows keep their ids, so links to them stay. */
async function store(
  peer: Peer,
  people: { person: Person; models: Model[]; collections: Collection[] }[],
  own: (url: string | undefined) => url is string,
): Promise<void> {
  const seenPeople: string[] = [];
  const seenModels: string[] = [];
  const seenCollections: string[] = [];
  for (const { person, models, collections } of people) {
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
      syncedAt: new Date(),
    };
    const saved = await prisma.remotePerson.upsert({
      where: { apId: person.id },
      create: { apId: person.id, ...personData },
      update: personData,
      select: { id: true, peerId: true },
    });
    // An id claimed by another partner is never taken over.
    if (saved.peerId !== peer.id) continue;
    seenPeople.push(person.id);
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
        })) as Prisma.InputJsonValue,
        sharedAt: model.published,
        updatedAt: model.updated,
        syncedAt: new Date(),
      };
      const row = await prisma.remoteModel.upsert({
        where: { apId: model.id },
        create: { apId: model.id, ...modelData },
        update: modelData,
        select: { peerId: true },
      });
      if (row.peerId === peer.id) seenModels.push(model.id);
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
        syncedAt: new Date(),
      };
      const row = await prisma.remoteCollection.upsert({
        where: { apId: collection.id },
        create: { apId: collection.id, ...collectionData },
        update: collectionData,
        select: { peerId: true },
      });
      if (row.peerId === peer.id) seenCollections.push(collection.id);
    }
  }
  // Whatever it no longer shares goes.
  await prisma.$transaction([
    prisma.remoteCollection.deleteMany({ where: { peerId: peer.id, apId: { notIn: seenCollections } } }),
    prisma.remoteModel.deleteMany({ where: { peerId: peer.id, apId: { notIn: seenModels } } }),
    prisma.remotePerson.deleteMany({ where: { peerId: peer.id, apId: { notIn: seenPeople } } }),
  ]);
}
