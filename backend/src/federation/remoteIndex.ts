import { LICENSE_ACTIONS, type ProviderLicense } from "../services/licenseCatalog";
import { Prisma, type Peer } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { isProviderId, modelUrl, parseModelUrl } from "../providers/index.generated";
import type { CategoryRef } from "../services/categoryService";
import { compactFacts, hexColor, type ProviderProfileFacts } from "../services/printProfileFacts";
import { SOURCE_GAPS, type SourceGap } from "../services/sourceGaps";
import { sanitizeFilename } from "../utils/fileUtils";
import { normalizeFolder } from "../utils/fileFolder";
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
// 2,000 of a person's models, the latest shared first: one with more shows those, and keeps any read before. Pages
// are as long as fit, so there's a cap on them too.
const MAX_MODELS = 2000;
const MAX_MODEL_PAGES = 200;
// As many as Thingport publishes; another partner's are cut there too.
const MAX_COLLECTIONS = 200;
const MAX_COLLECTION_PAGES = 40;
// Of each collection's models, by their ids.
const MAX_COLLECTION_MODELS = 2000;
const MAX_ID_PAGES = 10;
// Writing what was read, in one transaction: however many rows a big partner has.
const STORE_TIMEOUT_MS = 5 * 60 * 1000;
/** For a transaction that takes a partner's lock (`holdRemoteModels`): long enough to wait out a store holding it, and
 *  then do its own writes. */
export const HOLD_TIMEOUT_MS = 2 * STORE_TIMEOUT_MS;

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
  // What was noted gone of it, too: nothing of a blocked partner's is kept. After any write of its kept collections
  // under way (which, finding it blocked, keeps nothing more).
  await prisma.$transaction(
    async (tx) => {
      await holdRemoteModels(tx, peerId);
      await tx.remoteGone.deleteMany({ where: { peerId } });
    },
    { timeout: HOLD_TIMEOUT_MS, maxWait: 10_000 },
  );
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

// What a copy needs of a model (remoteCopy.ts), each checked the same way: broken, it's left out, not the model.
const flag = z.boolean().optional().catch(undefined);
/** Strings, trimmed, cut to `max`, empty ones dropped; `most` of them at most. */
const strings = (most: number, max: number) =>
  z
    .array(z.unknown())
    .optional()
    .catch(undefined)
    .transform((list) =>
      (list ?? [])
        .flatMap((item) => (typeof item === "string" && item.trim() ? [item.trim().slice(0, max)] : []))
        .slice(0, most),
    );
/** Items of `schema` only, `most` of them at most: one that isn't is left out, not the rest. */
const listOf = <T extends z.ZodTypeAny>(schema: T, most: number) =>
  z
    .array(z.unknown())
    .optional()
    .catch(undefined)
    .transform((list) =>
      (list ?? []).slice(0, most).flatMap((item): z.output<T>[] => {
        const parsed = schema.safeParse(item);
        return parsed.success ? [parsed.data] : [];
      }),
    );
/** A model on one of the providers this instance knows, by an id it would read off that model's own page address: a
 *  copy asks the site for what it lacks by it, so it's never more than a link someone could paste. */
const providerModel = z
  .object({ provider: z.string(), externalId: z.string().trim().min(1).max(200) })
  .optional()
  .catch(undefined)
  .transform((ref) => {
    const url = ref ? modelUrl(ref.provider, ref.externalId) : null;
    const read = url ? parseModelUrl(url) : null;
    return read && read.provider === ref!.provider && read.externalId === ref!.externalId
      ? { provider: read.provider as string, externalId: read.externalId }
      : null;
  });
/** An author on one of the providers this instance knows: only ever looked up here, never fetched by. */
const providerAuthor = z
  .object({ provider: z.string(), externalId: z.string().trim().min(1).max(200) })
  .optional()
  .catch(undefined)
  .transform((ref) =>
    ref && isProviderId(ref.provider) ? { provider: ref.provider, externalId: ref.externalId } : null,
  );
const factText = (max: number) =>
  z
    .string()
    .nullish()
    .catch(undefined)
    .transform((value) => value?.trim().slice(0, max) || null);
const factAmount = z
  .number()
  .nullish()
  .catch(undefined)
  .transform((value) => (value != null && Number.isFinite(value) && value > 0 && value < 1e9 ? value : null));
const filament = z.object({
  type: factText(60),
  color: z
    .string()
    .nullish()
    .catch(undefined)
    .transform((value) => hexColor(value)),
  grams: factAmount,
});
const profileFacts = z
  .object({
    title: factText(300),
    description: factText(5000),
    origin: z.enum(["designer", "community"]).nullish().catch(undefined),
    creator: factText(200),
    seconds: factAmount,
    grams: factAmount,
    filaments: listOf(filament, 64),
    plates: listOf(
      z.object({
        index: z.number().int().min(1).max(10_000),
        name: factText(200),
        seconds: factAmount,
        grams: factAmount,
        filaments: listOf(filament, 64),
      }),
      200,
    ),
    printer: factText(200),
    nozzleMm: factAmount,
    layerMm: factAmount,
    infill: factText(20),
    walls: z.number().int().min(0).max(1000).nullish().catch(undefined),
    supports: z.boolean().nullish().catch(undefined),
  })
  .transform((facts) => compactFacts(facts as ProviderProfileFacts));

const modelSchema = z.object({
  id: z.string(),
  name: text(300),
  attributedTo: z.string(),
  source,
  image: z
    .union([z.unknown().array(), z.unknown()])
    .optional()
    .catch(undefined)
    .transform((value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]))
    .pipe(
      listOf(
        z.union([
          z.string().transform((url) => ({ url, generated: false, plate: false })),
          z
            .object({ url: z.string(), "thingport:generated": flag, "thingport:plate": flag })
            .passthrough()
            .transform((image) => ({
              url: image.url,
              generated: image["thingport:generated"] === true,
              plate: image["thingport:plate"] === true,
            })),
        ]),
        100,
      ),
    ),
  attachment: z
    .array(
      z
        .object({
          name: text(255),
          mediaType: text(120),
          url: z.string().optional().catch(undefined),
          "thingport:size": z.number().int().min(0).optional().catch(undefined),
          "thingport:kind": z.enum(["plate", "file"]).optional().catch(undefined),
          "thingport:role": z.enum(["SUPPORTING", "PREPARED"]).optional().catch(undefined),
          // A site's own id for one: letters, digits and the like, nothing that reads as part of an address.
          "thingport:profileId": z
            .string()
            .regex(/^[A-Za-z0-9_.-]{1,100}$/)
            .optional()
            .catch(undefined),
          "thingport:profile": z
            .object({ version: z.number().int().min(0).max(1_000_000), facts: profileFacts })
            .optional()
            .catch(undefined),
          "thingport:thumb": z.string().optional().catch(undefined),
          "thingport:thumbGenerated": flag,
          // Its folder and real name, "Supported/Arm.stl"; `name` is what a partner without folders goes by.
          "thingport:path": z.string().max(1000).optional().catch(undefined),
        })
        .passthrough(),
    )
    .optional()
    .catch(undefined),
  published: date,
  updated: date,
  "thingport:tags": strings(50, 100),
  "thingport:creator": text(120),
  "thingport:importedFrom": providerModel,
  "thingport:author": providerAuthor,
  "thingport:category": z
    .object({
      path: z.array(z.string().trim().min(1).max(200)).min(1).max(100),
      siteIds: listOf(z.object({ provider: z.string().max(40), siteId: z.string().min(1).max(200) }), 200),
    })
    .optional()
    .catch(undefined),
  "thingport:generatorScriptWithheld": flag,
  // A licence, or `{ none: true }` for a model whose site was read and stated none.
  "thingport:license": z
    .union([
      z.object({
        id: z.string().max(100).optional().catch(undefined),
        raw: z.string().max(500),
        label: z.string().max(500).optional().catch(undefined),
        url: z
          .string()
          .max(500)
          .regex(/^https?:\/\//)
          .optional()
          .catch(undefined),
        terms: z.string().max(20_000).optional().catch(undefined),
        allows: z.array(z.enum(LICENSE_ACTIONS)).max(LICENSE_ACTIONS.length).optional().catch(undefined),
        requires: z
          .object({ credit: z.boolean().optional(), sameLicense: z.boolean().optional() })
          .optional()
          .catch(undefined),
        source: z.enum(["provider", "user"]).catch("provider"),
        provider: z.string().max(40).optional().catch(undefined),
      }),
      z.object({ none: z.literal(true) }),
    ])
    .optional()
    .catch(undefined),
  "thingport:unfillableGaps": strings(SOURCE_GAPS.length, 40),
  // Ids as Thingport makes them, all a description's images are found by (DESCRIPTION_IMAGE): any other stays a link.
  "thingport:descriptionImages": listOf(z.object({ id: z.string().regex(/^[a-z0-9]{1,64}$/), url: z.string() }), 50),
});

/** RemoteModel.details: what a copy needs to be the same model, as its partner said it. */
export type RemoteModelDetails = {
  tags: string[];
  creator: string | null;
  importedFrom: { provider: string; externalId: string } | null;
  author: { provider: string; externalId: string } | null;
  category: CategoryRef | null;
  generatorScriptWithheld: boolean;
  /** Its licence, as its owner's library had it; null when its site was read and stated none. Absent from a partner
   *  too old to say, or one whose library hasn't read it yet. */
  license?: (ProviderLicense & { source: "provider" | "user"; provider: string | null }) | null;
  unfillableGaps: SourceGap[];
  /** Its description's images by their ids there (`/description-image/<id>`), and where each is fetched. */
  descriptionImages: { id: string; url: string }[];
  /** Of its pictures, the partner's own renders and its plates' thumbnails standing in: a copy has its own of both. */
  renders: string[];
  platePictures: string[];
};

/** A file's part of RemoteModel.files past its name, size, type and address: what a copy needs of it. */
export type RemoteFileDetails = {
  kind?: "plate" | "file";
  role?: "SUPPORTING" | "PREPARED";
  profileId?: string;
  profile?: { version: number; facts: ProviderProfileFacts };
  thumb?: string;
  /** `thumb` is the partner's render, which a copy takes only where its instance won't make its own. */
  thumbGenerated?: boolean;
  /** The folder it's in at the partner (Plate.folder), checked as any source's is; none from one too old to say. */
  folder?: string;
};

const collectionSchema = z.object({
  id: z.string(),
  name: text(200),
  attributedTo: z.string(),
  source,
  updated: date,
  // Its models by their ids: the first ones here, the rest at `next`; from an instance from before pages, all of them
  // in a list. Missing or broken, they aren't known, and the ones kept from before stay.
  "thingport:models": z
    .union([
      z.object({
        first: z.object({
          orderedItems: z
            .array(z.unknown())
            .transform((ids) => ids.filter((id): id is string => typeof id === "string")),
          next: z.string().optional().catch(undefined),
        }),
      }),
      z
        .array(z.unknown())
        .transform((ids) => ({ first: { orderedItems: ids.filter((id): id is string => typeof id === "string") } })),
    ])
    .optional()
    .catch(undefined),
});

// A listing without its items is broken, not empty: read as empty, it would take everything of the partner's away.
const pageSchema = z.object({
  orderedItems: z.array(z.unknown()),
  next: z.string().optional().catch(undefined),
});

type Person = z.infer<typeof personSchema>;
type Model = z.infer<typeof modelSchema>;
type Collection = z.infer<typeof collectionSchema>;
/** A collection as read, with its models' ids; `allIds` is false when a page of them couldn't be read, so the ones
 *  kept from before stay. */
/** `fetchedAt`: when the page it came on was asked for. */
type ReadCollection = Collection & { modelIds: string[]; allIds: boolean; fetchedAt: Date };
/** A model as read, with when the page it came on was asked for. */
type ReadModel = Model & { fetchedAt: Date };

type Shared = {
  person: Person;
  models: ReadModel[];
  allModels: boolean;
  collections: ReadCollection[];
  allCollections: boolean;
};

async function sync(peerId: string): Promise<void> {
  const peer = await prisma.peer.findUnique({ where: { id: peerId } });
  if (!peer || peer.status !== "ACTIVE" || !(await isFederationLive())) return;
  try {
    const runtime = await getRuntime();
    const own = (url: string | undefined): url is string => Boolean(url) && originOf(url!) === peer.origin;
    const read = async (url: string) => (await runtime.signedLoader(url)).document;

    // Before anything of this read is asked for: what was withdrawn before then can't come back by it (storeIn).
    const askedFrom = askedAt();
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
      const collections = own(person["thingport:collections"])
        ? await readCollections(read, person["thingport:collections"], own)
        : { collections: [], all: true };
      people.push({
        person,
        models: models.models,
        allModels: models.all,
        collections: collections.collections,
        allCollections: collections.all,
      });
    }
    const written = store(peer, people, own, askedFrom);
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
  // Then what its people shared with people here: renamed, added to, or no longer shared. Whether or not what it shares
  // openly could be read: these are asked for on their own, and one whose Update never got here is found only so.
  const { refreshShared } = await import("./sharedCollections");
  await refreshShared(peer.id).catch((err: unknown) => {
    console.warn(`[federation] Couldn't read again what ${peer.origin}'s people shared here:`, (err as Error).message);
  });
  // A read that failed still tidies the pictures, by what's kept from the last one that didn't.
  await pruneMedia(peer.id).catch(() => {});
}

/** A person's shared models, page by page. `all` is false unless every page was read: one past the last read, a page
 *  that's gone, or a next page somewhere else leaves the rest unknown, not gone. */
export async function readModels(
  read: (url: string) => Promise<unknown>,
  first: string,
  own: (url: string | undefined) => url is string,
): Promise<{ models: ReadModel[]; all: boolean }> {
  const models: ReadModel[] = [];
  let url: string | undefined = first;
  for (let page = 0; url; page++) {
    if (!own(url) || page === MAX_MODEL_PAGES || models.length >= MAX_MODELS) return { models, all: false };
    let body: z.infer<typeof pageSchema>;
    const fetchedAt = askedAt();
    try {
      body = pageSchema.parse(await read(url));
    } catch (err) {
      // On the first page: shares no models of their own, only collections. Later: the rest isn't known.
      if (err instanceof FederationFetchError && err.status === 404) return { models, all: page === 0 };
      throw err;
    }
    for (const raw of body.orderedItems) {
      const parsed = modelSchema.safeParse(raw);
      if (!parsed.success || !own(parsed.data.id)) continue;
      // One past the cap: the rest aren't read, so those kept from before stay.
      if (models.length >= MAX_MODELS) return { models, all: false };
      models.push({ ...parsed.data, fetchedAt });
    }
    url = body.next;
  }
  return { models, all: true };
}

let lastAsked = 0;
/** When a read of a collection is asked for, by the index or as shared (sharedCollections.ts): a millisecond past the
 *  last one's if need be, so no two share a time, and both kinds keep to one clock to be told apart by. */
export function askedAt(): Date {
  lastAsked = Math.max(Date.now(), lastAsked + 1);
  return new Date(lastAsked);
}

/** A person's public collections, page by page, each with its models' ids. `all` is false unless every page was read,
 *  as with their models: those not read stay as they were. */
export async function readCollections(
  read: (url: string) => Promise<unknown>,
  first: string,
  own: (url: string | undefined) => url is string,
): Promise<{ collections: ReadCollection[]; all: boolean }> {
  const collections: ReadCollection[] = [];
  let url: string | undefined = first;
  for (let page = 0; url; page++) {
    if (!own(url) || page === MAX_COLLECTION_PAGES || collections.length >= MAX_COLLECTIONS) {
      return { collections, all: false };
    }
    let body: z.infer<typeof pageSchema>;
    const fetchedAt = askedAt();
    try {
      body = pageSchema.parse(await read(url));
    } catch (err) {
      if (err instanceof FederationFetchError && err.status === 404 && page > 0) return { collections, all: false };
      throw err;
    }
    for (const raw of body.orderedItems) {
      const parsed = collectionSchema.safeParse(raw);
      if (!parsed.success || !own(parsed.data.id)) continue;
      // One past the cap: not read, so the rest kept from before stay.
      if (collections.length >= MAX_COLLECTIONS) return { collections, all: false };
      const ids = await readModelIds(read, parsed.data["thingport:models"]?.first, own);
      collections.push({ ...parsed.data, ...ids, fetchedAt });
    }
    url = body.next;
  }
  return { collections, all: true };
}

/** A collection's models by their ids, from the page that came with it and those after it. */
async function readModelIds(
  read: (url: string) => Promise<unknown>,
  first: { orderedItems: string[]; next?: string } | undefined,
  own: (url: string | undefined) => url is string,
): Promise<{ modelIds: string[]; allIds: boolean }> {
  if (!first) return { modelIds: [], allIds: false };
  const ids = first.orderedItems.filter((id) => own(id));
  let url = first.next;
  for (let page = 0; url && ids.length < MAX_COLLECTION_MODELS; page++) {
    if (!own(url) || page === MAX_ID_PAGES) return { modelIds: ids, allIds: false };
    let body: z.infer<typeof pageSchema>;
    try {
      body = pageSchema.parse(await read(url));
    } catch (err) {
      if (err instanceof FederationFetchError && err.status === 404) return { modelIds: ids, allIds: false };
      throw err;
    }
    ids.push(...body.orderedItems.filter((id): id is string => typeof id === "string" && own(id)));
    url = body.next;
  }
  // The first MAX_COLLECTION_MODELS are what's kept of a bigger one.
  return { modelIds: ids.slice(0, MAX_COLLECTION_MODELS), allIds: true };
}

/** A file's name and folder from where its partner says it is ("Supported/Arm.stl"), checked as any source's folder
 *  is; its plain name, in no folder, from a partner too old to say or a path that names no file. */
function placeOf(where: string | undefined, name: string): { name: string; folder?: string } {
  const levels = where?.split("/") ?? [];
  const filename = sanitizeFilename(levels.pop());
  const folder = normalizeFolder(levels);
  return where && filename !== "imported-file" && folder ? { name: filename.slice(0, 255), folder } : { name };
}

/** A model as it's kept (RemoteModel), from what its partner said of it. */
export function remoteModelData(model: Model, own: (url: string | undefined) => url is string) {
  const pictures = model.image.filter((image) => own(image.url)).slice(0, 20);
  const thumbOf = (file: NonNullable<Model["attachment"]>[number]) =>
    file["thingport:kind"] === "plate" && own(file["thingport:thumb"]) ? file["thingport:thumb"] : undefined;
  return {
    title: model.name || "Untitled",
    description: markdownOf(model.source, 20_000),
    images: pictures.map((image) => image.url),
    files: (model.attachment ?? []).slice(0, 100).map((file): RemoteFileDetails & Record<string, unknown> => ({
      ...placeOf(file["thingport:path"], file.name ?? "file"),
      size: file["thingport:size"] ?? null,
      mediaType: file.mediaType ?? null,
      // Where it's fetched from, signed, to download, open or copy it: only ever on the partner's own origin.
      url: own(file.url) ? file.url : null,
      kind: file["thingport:kind"],
      role: file["thingport:kind"] === "file" ? file["thingport:role"] : undefined,
      profileId: file["thingport:kind"] === "plate" ? file["thingport:profileId"] : undefined,
      profile: file["thingport:kind"] === "plate" ? file["thingport:profile"] : undefined,
      thumb: thumbOf(file),
      thumbGenerated: thumbOf(file) && file["thingport:thumbGenerated"] === true ? true : undefined,
    })) as Prisma.InputJsonValue,
    details: (detailsOf(model, pictures, own) as Prisma.InputJsonValue | null) ?? Prisma.DbNull,
    sharedAt: model.published,
    updatedAt: model.updated,
  };
}

/** Whether `model`'s partner is new enough to say what a copy needs: it marks each file plate or file, and says the
 *  rest of what it has of one without files. */
const saysMore = (model: Model) =>
  Boolean(
    model.attachment?.some((file) => file["thingport:kind"]) ||
    model.image.some((image) => image.generated || image.plate) ||
    model["thingport:tags"].length ||
    model["thingport:creator"] ||
    model["thingport:importedFrom"] ||
    model["thingport:author"] ||
    model["thingport:category"] ||
    model["thingport:generatorScriptWithheld"] ||
    model["thingport:license"] ||
    model["thingport:unfillableGaps"].length ||
    model["thingport:descriptionImages"].length,
  );

function licenseOfTerm(term: Model["thingport:license"]): RemoteModelDetails["license"] {
  if (!term || "none" in term) return null;
  return {
    id: term.id ?? null,
    raw: term.raw,
    label: term.label ?? null,
    url: term.url ?? null,
    terms: term.terms ?? null,
    ...(term.allows ? { allows: term.allows } : {}),
    ...(term.requires ? { requires: term.requires } : {}),
    source: term.source,
    provider: term.provider ?? null,
  };
}

/** What a copy of `model` needs, from what its partner said: anything to fetch only on the partner's own origin. Null
 *  from a partner too old to say. */
function detailsOf(
  model: Model,
  pictures: Model["image"],
  own: (url: string | undefined) => url is string,
): RemoteModelDetails | null {
  if (!saysMore(model)) return null;
  const category = model["thingport:category"];
  return {
    tags: model["thingport:tags"],
    creator: model["thingport:creator"] || null,
    importedFrom: model["thingport:importedFrom"],
    author: model["thingport:author"],
    category: category ? { path: category.path, siteIds: category.siteIds } : null,
    generatorScriptWithheld: model["thingport:generatorScriptWithheld"] === true,
    // Only from a partner that says, so an older one's model is read from its source like any older import.
    ...(model["thingport:license"] ? { license: licenseOfTerm(model["thingport:license"]) } : {}),
    unfillableGaps: model["thingport:unfillableGaps"].filter((gap): gap is SourceGap =>
      (SOURCE_GAPS as readonly string[]).includes(gap),
    ),
    descriptionImages: model["thingport:descriptionImages"].filter((image) => own(image.url)),
    renders: pictures.filter((image) => image.generated).map((image) => image.url),
    platePictures: pictures.filter((image) => image.plate).map((image) => image.url),
  };
}

const webLink = (href: string) => /^https?:\/\//i.test(href) && href.length <= 500;
const markdownOf = (value: { content?: string } | undefined, max: number) =>
  value?.content?.trim() ? value.content.trim().slice(0, max) : null;

/** The index for one partner, made to match what it just said: kept rows keep their ids, so links to them stay.
 *  `askedFrom`: when the read of it began. */
async function store(
  peer: Peer,
  people: Shared[],
  own: (url: string | undefined) => url is string,
  askedFrom: Date,
): Promise<void> {
  // All of it or none: a write that fails leaves the last complete read as it was.
  await prisma.$transaction((tx) => storeIn(tx, peer, people, own, askedFrom), {
    timeout: STORE_TIMEOUT_MS,
    maxWait: 10_000,
  });
}

/** Holds `peerId`'s kept collections and models for `tx`, alone: each write of them (a read of a collection as shared
 *  kept, one let go of, the index written, the partner blocked) waits for the one before, so it sees what that wrote,
 *  and what one drops is pruned within it. So a model another collection is being given isn't taken, and nothing let go
 *  of is brought back. Taken first, before any row. */
export async function holdRemoteModels(tx: Prisma.TransactionClient, peerId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('remote-models'), hashtext(${peerId}))`;
}

/** The models kept only for collections shared with people here that no such collection holds any more, in `tx`
 *  (which holds the partner's lock): of `candidates` when given (those a read or a let-go dropped), else all of the
 *  partner's. Each is noted gone as of now, so a read of the index asked for before can't bring it back as public. */
export async function pruneIn(tx: Prisma.TransactionClient, peerId: string, candidates?: string[]): Promise<void> {
  if (candidates && !candidates.length) return;
  const only = candidates ? Prisma.sql`AND m."apId" = ANY(${candidates}::text[])` : Prisma.empty;
  await tx.$executeRaw`
    WITH gone AS (
      DELETE FROM "RemoteModel" m
      WHERE m."peerId" = ${peerId} AND m.limited ${only}
        AND NOT EXISTS (
          SELECT 1 FROM "RemoteCollection" c
          WHERE c."peerId" = m."peerId" AND c.limited AND m."apId" = ANY(c."modelApIds")
        )
      RETURNING m."apId"
    )
    INSERT INTO "RemoteGone" ("apId", "peerId", "at")
    SELECT "apId", ${peerId}, ${askedAt()} FROM gone
    ON CONFLICT ("apId") DO UPDATE SET "at" = GREATEST("RemoteGone"."at", EXCLUDED."at")`;
}

async function storeIn(
  tx: Prisma.TransactionClient,
  peer: Peer,
  people: Shared[],
  own: (url: string | undefined) => url is string,
  askedFrom: Date,
): Promise<void> {
  await holdRemoteModels(tx, peer.id);
  // What's been let go of, and as of when (sharedCollections.ts): fixed while this holds the lock.
  const goneAt = new Map(
    (await tx.remoteGone.findMany({ where: { peerId: peer.id }, select: { apId: true, at: true } })).map((row) => [
      row.apId,
      row.at,
    ]),
  );
  // Every row written now is marked with it: what's left unmarked is what the partner no longer shares, found without
  // listing what it does (a big partner's ids would pass what one query may take).
  const readAt = new Date();
  // Read only in part: what wasn't read of theirs stays rather than going.
  const partly: string[] = [];
  const partlyCollections: string[] = [];
  for (const { person, models, allModels, collections, allCollections } of people) {
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
      select: { id: true },
    });
    if (!allModels) partly.push(saved.id);
    if (!allCollections) partlyCollections.push(saved.id);
    for (const model of models) {
      if (model.attributedTo !== person.id) continue;
      // Shared openly there: on Explore, whatever collection shared with people here also holds it.
      const modelData = {
        peerId: peer.id,
        personId: saved.id,
        ...remoteModelData(model, own),
        syncedAt: readAt,
        limited: false,
      };
      // Let go of since this was asked for, kept only for a collection shared with people here: not made public again,
      // whether or not a read as shared has kept it since.
      const gone = goneAt.get(model.id);
      if (gone && gone >= model.fetchedAt) continue;
      // Unless it was read since this was asked for, for a collection shared with some people here, and isn't known to
      // be open as of then: it stays theirs alone until a later read of this says otherwise (its files are fetched for
      // anyone here meanwhile, as they're shared with someone here).
      const write = () =>
        tx.remoteModel.updateMany({
          where: { apId: model.id, OR: [{ limited: false }, { syncedAt: { lt: model.fetchedAt } }] },
          data: modelData,
        });
      if (!(await write()).count) {
        const made = await tx.remoteModel.createMany({
          data: { apId: model.id, ...modelData },
          skipDuplicates: true,
        });
        // Made meanwhile, by a read of a collection holding it: written over unless that was asked for after this.
        if (!made.count) await write();
      }
    }
    for (const collection of collections) {
      if (collection.attributedTo !== person.id) continue;
      const collectionData = {
        peerId: peer.id,
        personId: saved.id,
        name: collection.name || "Untitled",
        description: markdownOf(collection.source, 5000),
        updatedAt: collection.updated,
        syncedAt: readAt,
        fetchedAt: collection.fetchedAt,
        // Public there now: for everyone here, not only the people it was once shared with.
        limited: false,
      };
      const modelApIds = collection.modelIds;
      // Withdrawn by its owner's instance since this was asked for, once shared with people here: not made public again.
      const gone = goneAt.get(collection.id);
      if (gone && gone >= collection.fetchedAt) continue;
      // Unless it was asked for since, as shared with some people here (sharedCollections.ts): that's newer than this,
      // so it stays theirs alone, as it does when both were asked for in the same millisecond (one public then is
      // written, so it's not pruned as stale). Checked as it's written, so a read of it finishing meanwhile counts too.
      const write = () =>
        tx.remoteCollection.updateMany({
          where: {
            apId: collection.id,
            OR: [
              { fetchedAt: null },
              { fetchedAt: { lt: collection.fetchedAt } },
              { fetchedAt: collection.fetchedAt, limited: false },
            ],
          },
          // Its models read only in part: those it had stay.
          data: collection.allIds ? { ...collectionData, modelApIds } : collectionData,
        });
      if (!(await write()).count) {
        await tx.remoteCollection.createMany({
          data: { apId: collection.id, ...collectionData, modelApIds },
          skipDuplicates: true,
        });
        // Made meanwhile by a read of it as shared, asked for earlier than this: this is kept instead.
        await write();
      }
    }
  }
  // Withdrawn before this read began: no read still to come was asked for before that.
  await tx.remoteGone.deleteMany({ where: { peerId: peer.id, at: { lt: askedFrom } } });
  // One that was shared with some people here and is public there now is for everyone: nobody's its viewer.
  await tx.remoteCollectionViewer.deleteMany({ where: { collection: { peerId: peer.id, limited: false } } });
  // Whatever it no longer shares goes, except what was sent to people here rather than listed: a collection shared
  // with them goes when its owner's instance says so (sharedCollections.ts), and a model no longer shared openly but
  // still in one stays for them.
  const stale = { peerId: peer.id, syncedAt: { lt: readAt } };
  await tx.remoteCollection.deleteMany({ where: { ...stale, limited: false, personId: { notIn: partlyCollections } } });
  // Someone whose models were read only in part keeps the rest as they were: one not read may still be shared openly.
  const readInPart = partly.length ? Prisma.sql`AND m."personId" NOT IN (${Prisma.join(partly)})` : Prisma.empty;
  await tx.$executeRaw`
    UPDATE "RemoteModel" m SET limited = true
    WHERE m."peerId" = ${peer.id} AND m."syncedAt" < ${readAt} AND NOT m.limited ${readInPart}
      AND EXISTS (
        SELECT 1 FROM "RemoteCollection" c
        WHERE c."peerId" = m."peerId" AND c.limited AND m."apId" = ANY(c."modelApIds")
      )`;
  await tx.remoteModel.deleteMany({ where: { ...stale, limited: false, personId: { notIn: partly } } });
  // And any kept only for a collection shared with people here that's now public, or for none: the one look across all
  // of them, once a read of the index.
  await pruneIn(tx, peer.id);
  // Someone no longer listed whom a chat, a collection shared with people here, or a collection here shared with them
  // still names is kept for it, off Explore.
  const named = {
    OR: [
      { chats: { some: {} } },
      { messages: { some: {} } },
      { collections: { some: { limited: true } } },
      { collectionShares: { some: {} } },
    ],
  } satisfies Prisma.RemotePersonWhereInput;
  // Their cover goes with it, so the picture kept of it is pruned: it's not theirs to show any more.
  await tx.remotePerson.updateMany({ where: { ...stale, ...named }, data: { listed: false, coverUrl: null } });
  await tx.remotePerson.deleteMany({
    where: {
      ...stale,
      chats: { none: {} },
      messages: { none: {} },
      collections: { none: { limited: true } },
      collectionShares: { none: {} },
    },
  });
  // Someone this instance's people had direct messages with, back after a disconnect: in those chats again.
  await tx.$executeRaw`
    INSERT INTO "ChatRemoteMember" ("chatId", "personId")
    SELECT c.id, p.id
    FROM "Chat" c
    JOIN "ChatMember" m ON m."chatId" = c.id
    JOIN "RemotePerson" p ON c."directKey" = 'r:' || m."userId" || ':' || p."apId"
    WHERE c.kind = 'DIRECT' AND p."peerId" = ${peer.id}
    ON CONFLICT DO NOTHING`;
  // Still a partner: one blocked or disconnected meanwhile keeps nothing of this. The row stays locked until this is
  // written, so a block waits for it, and what it then forgets is everything.
  const { count: still } = await tx.peer.updateMany({
    where: { id: peer.id, status: "ACTIVE" },
    data: { syncedAt: new Date(), syncError: null },
  });
  if (!still) throw new Error("No longer connected");
}
