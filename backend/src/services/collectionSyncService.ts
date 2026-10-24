// Synced collections: a Thingport collection linked to one on a provider, so models added there
// later are imported by the scheduled sync (collectionSyncRunner.ts). Thingport Grab creates the
// link; the app can change its profile scope or drop it.

import type { Collection, CollectionSync } from "@prisma/client";
import { prisma } from "../db";
import { HttpError } from "../utils/fileUtils";
import { isProviderId, modelUrl, parseListUrl, type ProviderId, URLS } from "../providers/_generated";
import { PROFILE_PROVIDERS, PROVIDERS } from "../providers/registry";
import type { SyncSource } from "../providers/types";
import { likesCollectionName, providerName, syncLikesUsername } from "../providers/names";

export { providerName };
import { addPrintsToCollection, findOrCreateCollectionByName, isSystemCollectionId } from "./collectionService";
import { createLog } from "./auditLog";
import { createNotification } from "./notificationService";
import type { SyncIntervalHours } from "./collectionSyncSchedule";
import { toCollectionSyncOut, type CollectionSyncOut, type SyncProfileScope } from "../dto";

export type SyncProvider = ProviderId;

export type { SyncSource };

/** Providers whose models come with print profiles a sync can pick between. */
export function hasProfiles(provider: string): boolean {
  return PROFILE_PROVIDERS.has(provider);
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
  const url = modelUrl(provider, externalId);
  // A sync's provider is one parseSyncSource read off its link.
  if (!url) throw new Error(`A sync of an unknown provider: ${provider}`);
  return url;
}

/** The model id in a link modelUrlFor made. */
export function modelIdFromUrl(provider: string, url: string): string | null {
  return isProviderId(provider) ? (URLS[provider].parseModel(url)?.externalId ?? null) : null;
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
  const provider = PROVIDERS[source.provider].sync;
  await provider?.assertCanSync?.(userId, source);
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
    const title = source.likesOf
      ? likesCollectionName(source.likesOf, source.provider)
      : (provider?.listName?.(source) ??
        (input.title?.trim() || `${providerName(source.provider)} Collection ${source.externalId}`));
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
