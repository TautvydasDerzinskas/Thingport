// Synced collections: a Thingport collection linked to one on a provider, so models added there
// later are imported by the scheduled sync (collectionSyncRunner.ts). Thingport Grab creates the
// link; the app can change its profile scope or drop it.

import type { Collection, CollectionSync } from "@prisma/client";
import { prisma } from "../db";
import { HttpError } from "../utils/fileUtils";
import { isProviderId, MANIFESTS, modelUrl, parseListUrl, type ProviderId } from "../providers/_generated";
import { PROFILE_PROVIDERS } from "../providers/registry";
import { addPrintsToCollection, findOrCreateCollectionByName, isSystemCollectionId } from "./collectionService";
import { parseSnapmakerListUrl, snapmakerListName } from "../providers/snapmaker/api";
import { getUserSnapmakerId } from "../providers/snapmaker/session";
import { MAKERONLINE_LIKES_KEY, MAKERONLINE_LIKES_NAME } from "./makeronlineApi";
import { getUserMakeronlineToken } from "./makeronlineSessionService";
import { CREALITYCLOUD_LIKES_NAME, parseCrealitycloudLikesUrl } from "../providers/crealitycloud/api";
import { getUserCrealitycloudId } from "../providers/crealitycloud/session";
import { THANGS_LIKES_KEY, THANGS_LIKES_NAME } from "./thangsApi";
import { getThangsConnection } from "./thangsSessionService";
import { parseCults3dModelUrl } from "./cults3dApi";
import { getCults3dConnection } from "./cults3dSessionService";
import { createLog } from "./auditLog";
import { pushedLikes } from "./providerListingsService";
import { createNotification } from "./notificationService";
import type { SyncIntervalHours } from "./collectionSyncSchedule";
import { syncLikesUsername, toCollectionSyncOut, type CollectionSyncOut, type SyncProfileScope } from "../dto";

export type SyncProvider = ProviderId;

/** `likesOf` is set for a user's likes (on Thingiverse or Cults3D, or the user's own on Printables), which a
 *  sync follows like a collection. */
export type SyncSource = { provider: SyncProvider; externalId: string; url: string; likesOf?: string };

/** Providers whose models come with print profiles a sync can pick between. */
export function hasProfiles(provider: string): boolean {
  return PROFILE_PROVIDERS.has(provider);
}

export function providerName(provider: string): string {
  return isProviderId(provider) ? MANIFESTS[provider].name : provider;
}

/** The collection a user's likes are filed into, by import and sync alike. */
export function likesCollectionName(username: string, provider: string = "thingiverse"): string {
  return `${providerName(provider)} likes (@${username})`;
}

/** What a sync follows, for notifications: "its MakerWorld collection", "@alice's Thingiverse likes". */
export function sourceDescription(sync: { provider: string; externalId: string; sourceUrl: string }): string {
  const likesOf = syncLikesUsername(sync);
  return likesOf
    ? `@${likesOf}'s ${providerName(sync.provider)} likes`
    : `its ${providerName(sync.provider)} collection`;
}

/** A provider collection a sync can follow by its id, or a Thingiverse user's Likes by username. */
export function parseSyncSource(url: string): SyncSource | null {
  const list = parseListUrl(url);
  if (!list) return null;
  const { provider, externalId, likesOf } = list;
  return { provider, externalId, url: list.url, ...(likesOf !== undefined && { likesOf }) };
}

/** Which model page a provider's id stands for, as the import queue takes it. */
export function modelUrlFor(provider: string, externalId: string): string {
  return modelUrl(provider, externalId) ?? `https://www.thingiverse.com/thing:${externalId}`;
}

/** The model id in a link modelUrlFor made. */
export function modelIdFromUrl(provider: string, url: string): string | null {
  const patterns: Record<string, RegExp> = {
    makerworld: /\/models\/(\d+)/,
    printables: /\/model\/(\d+)/,
    myminifactory: /\/object\/(?:[^/]*-)?(\d+)/,
    snapmaker: /\/model\/(\d+)/,
    makeronline: /\/model\/(?:[^/#]+\/)?(\d+)/,
    crealitycloud: /\/model-detail\/([\w-]+)/,
    nexprint: /\/models\/(G\d+)/i,
    thangs: /\/m\/(\d+)/,
  };
  // Cults3D's links name a model by its slug, in any of its languages.
  if (provider === "cults3d") return parseCults3dModelUrl(url)?.slug ?? null;
  const pattern = patterns[provider] ?? /thing:(\d+)/;
  return url.match(pattern)?.[1] ?? null;
}

/** What Thingport Grab reads on a provider's collection page. */
export type SyncLinkOut = CollectionSyncOut & { collection_id: string; collection_name: string };

function toSyncLinkOut(sync: CollectionSync & { collection: Collection }): SyncLinkOut {
  return { ...toCollectionSyncOut(sync), collection_id: sync.collection.id, collection_name: sync.collection.name };
}

async function findSyncForSource(userId: string, source: SyncSource) {
  return prisma.collectionSync.findUnique({
    where: { userId_provider_externalId: { userId, provider: source.provider, externalId: source.externalId } },
    include: { collection: true },
  });
}

/** The sync following this provider page, if there is one. Null `supported` means the page isn't a
 *  collection a sync can follow. */
export async function lookupSync(
  userId: string,
  url: string,
): Promise<{ supported: boolean; sync: SyncLinkOut | null }> {
  const source = parseSyncSource(url);
  if (!source) return { supported: false, sync: null };
  const sync = await findSyncForSource(userId, source);
  return { supported: true, sync: sync ? toSyncLinkOut(sync) : null };
}

/** The collection a batch import from this page files into: the synced one, whatever it's been
 *  renamed to, so a re-import never splits a synced collection in two. */
export async function syncedCollectionFor(userId: string, url: string): Promise<Collection | null> {
  const source = parseSyncSource(url);
  if (!source) return null;
  return (await findSyncForSource(userId, source))?.collection ?? null;
}

/** Already-imported models among `externalIds`, by provider id. */
export async function findLibraryPrints(
  userId: string,
  provider: string,
  externalIds: string[],
): Promise<Map<string, string>> {
  if (!externalIds.length) return new Map();
  const prints = await prisma.print.findMany({
    where: { userId, sourceProvider: provider, sourceExternalId: { in: externalIds } },
    select: { id: true, sourceExternalId: true },
  });
  return new Map(prints.flatMap((p) => (p.sourceExternalId ? [[p.sourceExternalId, p.id] as const] : [])));
}

export type EnableSyncInput = {
  url: string;
  /** The provider collection's name, for the Thingport collection when there isn't one yet. */
  title?: string | null;
  /** Every model id Grab saw in the provider's collection. Only models added after these are
   *  imported by the sync, so models left unticked in the panel stay out. */
  knownIds: string[];
  /** File into this collection instead of finding or creating one by `title`. */
  collectionId?: string | null;
};

/** Turns sync on for a provider collection, or returns the existing link. The models already in the
 *  library are filed into the collection now, so it starts out mirroring the provider's. */
export async function enableSync(userId: string, input: EnableSyncInput): Promise<SyncLinkOut> {
  const source = parseSyncSource(input.url);
  if (!source)
    throw new HttpError(
      400,
      "Only MakerWorld, Printables, Thingiverse, MyMiniFactory, MakerOnline, Creality Cloud, NexPrint and Thangs collections, your own Cults3D printlists, Thingiverse or Cults3D likes, your own Printables, MakerOnline, Creality Cloud and Thangs likes, and your own Snapmaker Space likes and bookmarks, can be synced",
    );
  if (source.provider === "printables" && source.likesOf) await assertOwnPrintablesLikes(userId, source.likesOf);
  if (source.provider === "snapmaker") await assertOwnSnapmakerList(userId, source.url);
  if (source.provider === "makeronline" && source.externalId === MAKERONLINE_LIKES_KEY) {
    await assertMakeronlineConnected(userId);
  }
  if (source.provider === "thangs") await assertThangsConnected(userId);
  if (source.provider === "cults3d") await assertCults3dSource(userId, source);
  const crealitycloudLikes = source.provider === "crealitycloud" ? parseCrealitycloudLikesUrl(source.url) : null;
  if (crealitycloudLikes) await assertOwnCrealitycloudLikes(userId, crealitycloudLikes.userId);
  const knownIds = [...new Set(input.knownIds.map((id) => id.trim()).filter(Boolean))];

  const existing = await findSyncForSource(userId, source);
  if (existing) {
    if (input.collectionId && input.collectionId !== existing.collectionId) {
      throw new HttpError(409, `This collection is already synced with "${existing.collection.name}"`);
    }
    const merged = [...new Set([...existing.knownIds, ...knownIds])];
    const updated = await prisma.collectionSync.update({
      where: { id: existing.id },
      data: { knownIds: merged },
      include: { collection: true },
    });
    await fileLibraryModels(userId, updated, knownIds);
    return toSyncLinkOut(updated);
  }

  let created: CollectionSync & { collection: Collection };
  if (input.collectionId) {
    // Picked by the caller, so a clash is theirs to resolve.
    if (isSystemCollectionId(input.collectionId)) throw new HttpError(400, "This collection can't be synced");
    const found = await prisma.collection.findFirst({ where: { id: input.collectionId, userId } });
    if (!found) throw new HttpError(404, "Collection not found");
    const result = await createSync(userId, found, source, knownIds);
    if ("takenBy" in result) {
      throw new HttpError(
        409,
        `"${found.name}" is already synced with another ${providerName(result.takenBy)} collection`,
      );
    }
    if ("link" in result) return result.link;
    created = result.created;
  } else {
    const snapmakerList = source.provider === "snapmaker" ? parseSnapmakerListUrl(source.url)?.list : null;
    const title = source.likesOf
      ? likesCollectionName(source.likesOf, source.provider)
      : snapmakerList
        ? snapmakerListName(snapmakerList)
        : source.provider === "makeronline" && source.externalId === MAKERONLINE_LIKES_KEY
          ? MAKERONLINE_LIKES_NAME
          : crealitycloudLikes
            ? CREALITYCLOUD_LIKES_NAME
            : source.provider === "thangs" && source.externalId === THANGS_LIKES_KEY
              ? THANGS_LIKES_NAME
              : input.title?.trim() || `${providerName(source.provider)} Collection ${source.externalId}`;
    let found: (CollectionSync & { collection: Collection }) | null = null;
    for (const name of collectionNamesFor(title, source.provider)) {
      const collection = await findOrCreateCollectionByName(userId, name);
      const result = await createSync(userId, collection, source, knownIds);
      if ("takenBy" in result) continue;
      if ("link" in result) return result.link;
      found = result.created;
      break;
    }
    if (!found)
      throw new HttpError(409, `Every collection named like "${title}" is already synced with something else`);
    created = found;
  }
  await fileLibraryModels(userId, created, knownIds);
  void createLog({
    userId,
    action: "collection_sync_enabled",
    targetId: created.collectionId,
    details: { name: created.collection.name, provider: source.provider, url: source.url },
  });
  // The sync exists by now, so a failed notification mustn't fail the request: a retry finds the
  // sync and wouldn't send it either.
  await notifySyncEnabled(created).catch((err) => console.error("[sync] enable notification failed", err));
  return toSyncLinkOut(created);
}

const INTERVAL_PHRASES: Record<number, string> = { 1: "every hour", 6: "every 6 hours", 24: "once a day" };
const PROFILE_SCOPE_PHRASES: Record<string, string> = {
  url: "its default print profile",
  designer: "all of the designer's print profiles",
  all: "all of its print profiles, community ones included",
};

/** Confirms in the app what was switched on from Thingport Grab, with the defaults it got. */
async function notifySyncEnabled(sync: CollectionSync & { collection: Collection }): Promise<void> {
  const name = sync.collection.name;
  const interval = INTERVAL_PHRASES[sync.intervalHours] ?? `every ${sync.intervalHours} hours`;
  const profiles =
    hasProfiles(sync.provider) && PROFILE_SCOPE_PHRASES[sync.profileScope]
      ? `, each with ${PROFILE_SCOPE_PHRASES[sync.profileScope]}`
      : "";
  await createNotification(sync.userId, {
    type: "sync",
    title: `"${name}" is now synced`,
    body:
      `New models in ${sourceDescription(sync)} are imported here ${interval}${profiles}. ` +
      "Change this in the collection's sync configuration.",
    externalUrl: sync.sourceUrl,
    internalPath: `/models/collections/${sync.collectionId}`,
  });
}

/** Printables shows likes to their owner only, and Grab reads them as that user: a sync of someone
 *  else's would be fed the user's own likes under the other's name. The likes Grab pushed prove whose
 *  they are; the account saved on the user can be typed into the app, so it proves nothing. */
async function assertOwnPrintablesLikes(userId: string, handle: string): Promise<void> {
  const likes = await pushedLikes(userId);
  if (likes?.card.owner?.toLowerCase() !== handle.toLowerCase()) {
    throw new HttpError(
      400,
      "Printables shows likes to their owner only, so only your own can be synced, once Thingport Grab has seen them",
    );
  }
}

/** Snapmaker shows likes and bookmarks to their owner only, and a sync reads them with the user's own sign-in: one
 *  of someone else's would be fed the user's own under the other's name. */
async function assertOwnSnapmakerList(userId: string, url: string): Promise<void> {
  const own = await getUserSnapmakerId(userId);
  if (!own || own !== parseSnapmakerListUrl(url)?.userId) {
    throw new HttpError(
      400,
      "Snapmaker Space shows likes and bookmarks to their owner only, so only your own can be synced, once Snapmaker is connected",
    );
  }
}

/** MakerOnline's likes page names no user, so a sync reads whoever's token Thingport has: there has to be one. */
async function assertMakeronlineConnected(userId: string): Promise<void> {
  if (!(await getUserMakeronlineToken(userId))) {
    throw new HttpError(
      400,
      "MakerOnline shows likes to their owner only: connect MakerOnline first, or visit it with Thingport Grab",
    );
  }
}

/** Every Thangs download is the user's, and its likes page names no user: a sync needs their sign-in either way. */
async function assertThangsConnected(userId: string): Promise<void> {
  if ((await getThangsConnection(userId)) !== "connected") {
    throw new HttpError(
      400,
      "Thangs gives its files to a signed-in user only: connect Thangs first, or visit it with Thingport Grab",
    );
  }
}

/** Cults3D's listings are read with the user's API key, which shows no one's printlists but their own. */
async function assertCults3dSource(userId: string, source: SyncSource): Promise<void> {
  const connection = await getCults3dConnection(userId);
  if (connection.api !== "connected") {
    throw new HttpError(400, "Cults3D is read with your own API key: enter it in Configuration > Providers first");
  }
  if (!source.likesOf && !source.externalId.startsWith(`${connection.nick?.toLowerCase()}/`)) {
    throw new HttpError(400, "Only your own Cults3D printlists can be synced: Cults3D's API shows no one else's");
  }
}

/** Creality Cloud shows likes to their owner only, and a sync reads them with the user's own sign-in, as for
 *  Snapmaker. */
async function assertOwnCrealitycloudLikes(userId: string, likesOf: string): Promise<void> {
  if ((await getUserCrealitycloudId(userId)) !== likesOf) {
    throw new HttpError(
      400,
      "Creality Cloud shows likes to their owner only, so only your own can be synced, once Creality Cloud is connected",
    );
  }
}

// How many "Things (MakerWorld 2)"-style names to try before giving up.
const MAX_NAME_SUFFIX = 20;

/** The names a new sync's collection may take: the provider's own name first, so a plain collection
 *  of that name is adopted; then, if that one already follows another source, the name with the
 *  provider after it ("Things (MakerWorld)", "Things (MakerWorld 2)", ...). */
function* collectionNamesFor(title: string, provider: string): Generator<string> {
  yield title;
  const label = providerName(provider);
  yield `${title} (${label})`;
  for (let n = 2; n <= MAX_NAME_SUFFIX; n++) yield `${title} (${label} ${n})`;
}

// A synced collection follows what the designer publishes, so new models bring all of their profiles.
const NEW_SYNC_PROFILE_SCOPE: SyncProfileScope = "designer";

/** Links `collection` to `source`. `takenBy` names the provider when the collection already follows
 *  another source; `link` is the existing one when another request just made this same link. */
async function createSync(
  userId: string,
  collection: Collection,
  source: SyncSource,
  knownIds: string[],
): Promise<{ takenBy: string } | { link: SyncLinkOut } | { created: CollectionSync & { collection: Collection } }> {
  const existing = await prisma.collectionSync.findUnique({ where: { collectionId: collection.id } });
  if (existing) return { takenBy: existing.provider };
  try {
    const created = await prisma.collectionSync.create({
      data: {
        userId,
        collectionId: collection.id,
        provider: source.provider,
        externalId: source.externalId,
        sourceUrl: source.url,
        knownIds,
        ...(hasProfiles(source.provider) ? { profileScope: NEW_SYNC_PROFILE_SCOPE } : {}),
      },
      include: { collection: true },
    });
    return { created };
  } catch (err) {
    // Another request won the unique index: for this same source, that's the link asked for; if it
    // took this collection for another source, it's taken like any other.
    const raced = await findSyncForSource(userId, source);
    if (raced) return { link: toSyncLinkOut(raced) };
    const racedForCollection = await prisma.collectionSync.findUnique({ where: { collectionId: collection.id } });
    if (racedForCollection) return { takenBy: racedForCollection.provider };
    throw err;
  }
}

/** In the provider collection's own order, as an import would file them. */
async function fileLibraryModels(userId: string, sync: CollectionSync, externalIds: string[]): Promise<void> {
  const prints = await findLibraryPrints(userId, sync.provider, externalIds);
  const ordered = externalIds.flatMap((id) => {
    const printId = prints.get(id);
    return printId ? [printId] : [];
  });
  await addPrintsToCollection(sync.collectionId, ordered);
}

async function ownedSync(userId: string, collectionId: string) {
  const sync = await prisma.collectionSync.findFirst({
    where: { collectionId, userId },
    include: { collection: true },
  });
  if (!sync) throw new HttpError(404, "This collection isn't synced");
  return sync;
}

/** The sync of one of the user's collections, for "Sync now". */
export async function syncForCollection(userId: string, collectionId: string): Promise<CollectionSync> {
  return ownedSync(userId, collectionId);
}

/** The collection and its models stay; new models just stop coming in. */
export async function disableSync(userId: string, collectionId: string): Promise<void> {
  const sync = await ownedSync(userId, collectionId);
  await prisma.collectionSync.delete({ where: { id: sync.id } });
  void createLog({
    userId,
    action: "collection_sync_disabled",
    targetId: collectionId,
    details: { name: sync.collection.name, provider: sync.provider, url: sync.sourceUrl },
  });
}

/** Applies to checks and models found from now on; models already waiting in the import queue
 *  keep the profile scope they were queued with. Only MakerWorld, Snapmaker, MakerOnline, Creality Cloud and NexPrint
 *  models have print profiles. */
export async function updateSyncSettings(
  userId: string,
  collectionId: string,
  settings: { profileScope?: SyncProfileScope; intervalHours?: SyncIntervalHours },
): Promise<CollectionSyncOut> {
  const sync = await ownedSync(userId, collectionId);
  if (settings.profileScope && !hasProfiles(sync.provider)) {
    throw new HttpError(
      400,
      "Only MakerWorld, Snapmaker Space, MakerOnline, Creality Cloud and NexPrint models have print profiles to pick",
    );
  }
  const updated = await prisma.collectionSync.update({
    where: { id: sync.id },
    data: { profileScope: settings.profileScope, intervalHours: settings.intervalHours },
  });
  return toCollectionSyncOut(updated);
}
