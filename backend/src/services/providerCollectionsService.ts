// The sync dialog's Browse tab: which providers a user can browse, their collections there, and
// turning sync on for a Thingport collection from the app rather than from Thingport Grab. What each provider does
// is in its browse and sync modules (providers/<id>/browse.ts, sync.ts).

import { prisma } from "../db";
import { HttpError } from "../utils/fileUtils";
import { LIKES_ID_PREFIX, type CollectionSyncOut, type SyncProfileScope } from "../dto";
import { isSystemCollectionId } from "./collectionService";
import { fetchListing, syncCollection } from "./collectionSyncRunner";
import type { SyncIntervalHours } from "./collectionSyncSchedule";
import {
  enableSync,
  hasProfiles,
  parseSyncSource,
  type SyncProvider,
  updateSyncSettings,
} from "./collectionSyncService";
import type { ProviderCollectionCard } from "./providerCollectionCard";
import { assertProviderEnabled } from "./providerSettingsService";
import { manifestOf, PROVIDER_IDS, type ProviderId } from "../providers/index.generated";
import { NO_PROFILES_TEXT, providerName, providerNames } from "../providers/names";
import { PROVIDERS } from "../providers/registry";
import type { ProviderAccount, ProviderBrowse } from "../providers/types";

export const BROWSABLE_PROVIDERS = PROVIDER_IDS;
export type BrowsableProvider = ProviderId;

export type ProviderAccountOut = ProviderAccount;
export type ProviderAccountsOut = Record<BrowsableProvider, ProviderAccountOut>;

export type ProviderCollectionOut = {
  id: string;
  name: string;
  url: string;
  model_count: number;
  thumbnails: string[];
  private: boolean;
  owner: string | null;
  /** The Thingport collection already synced with it, which can't take a second one. */
  synced: { collection_id: string; collection_name: string } | null;
  /** The user's liked models, rather than a collection. */
  likes: boolean;
};

function browseOf(provider: BrowsableProvider): ProviderBrowse {
  const browse = PROVIDERS[provider].browse;
  if (!browse) throw new HttpError(400, `${providerName(provider)} has no collections to browse`);
  return browse;
}

/** Runs one of a provider's Browse calls, with the errors the user can act on as HTTP errors; anything else is left
 *  to the error handler. */
async function providerCall<T>(provider: BrowsableProvider, call: (browse: ProviderBrowse) => Promise<T>): Promise<T> {
  const browse = browseOf(provider);
  try {
    return await call(browse);
  } catch (err) {
    throw browse.httpError?.(err) ?? err;
  }
}

export async function getProviderAccounts(userId: string): Promise<ProviderAccountsOut> {
  const accounts = await Promise.all(PROVIDER_IDS.map(async (id) => [id, await browseOf(id).account(userId)] as const));
  return Object.fromEntries(accounts) as ProviderAccountsOut;
}

/** `input` is a username, handle or profile link; null forgets it. */
export async function setProviderAccount(
  userId: string,
  provider: BrowsableProvider,
  input: string | null,
): Promise<ProviderAccountsOut> {
  const browse = browseOf(provider);
  if (!browse.setAccount) {
    throw new HttpError(
      400,
      `${providerName(provider)} is linked through its ${browse.linkedThrough ?? "sign-in"} in Configuration > Providers`,
    );
  }
  const value = input?.trim() || null;
  await providerCall(provider, (b) => b.setAccount!(userId, value));
  return getProviderAccounts(userId);
}

async function withSyncs(
  userId: string,
  provider: SyncProvider,
  cards: ProviderCollectionCard[],
): Promise<ProviderCollectionOut[]> {
  const syncs = await prisma.collectionSync.findMany({
    where: { userId, provider, externalId: { in: cards.map((card) => card.id) } },
    include: { collection: { select: { id: true, name: true } } },
  });
  const byId = new Map(syncs.map((sync) => [sync.externalId, sync.collection]));
  return cards.map((card) => {
    const synced = byId.get(card.id);
    return {
      id: card.id,
      name: card.name,
      url: card.url,
      model_count: card.modelCount,
      thumbnails: card.thumbnails,
      private: card.private,
      owner: card.owner,
      synced: synced ? { collection_id: synced.id, collection_name: synced.name } : null,
      likes: card.id.startsWith(LIKES_ID_PREFIX),
    };
  });
}

export async function listProviderCollections(
  userId: string,
  provider: BrowsableProvider,
): Promise<ProviderCollectionOut[]> {
  await assertProviderEnabled(provider);
  const cards = await providerCall(provider, (browse) => browse.cards(userId));
  return withSyncs(userId, provider, cards);
}

const NOT_A_LIST = `That isn't a ${providerNames((c) => c.collections || c.likes, "or")} collection link`;

/** A pasted collection link, as the same card a listing shows. */
export async function lookupProviderCollection(userId: string, url: string): Promise<ProviderCollectionOut> {
  const source = parseSyncSource(url);
  if (!source) throw new HttpError(400, NOT_A_LIST);
  await assertProviderEnabled(source.provider);
  const card = await providerCall(source.provider, (browse) => browse.card(userId, source));
  if (!card) throw new HttpError(404, "That collection can't be found. It may be private or deleted.");
  return (await withSyncs(userId, source.provider, [card]))[0];
}

/** `waiting`: a private Printables collection or likes whose models Thingport Grab hasn't read yet;
 *  they come in on the user's next visit to Printables. */
export type EnableFromAppResult = { sync: CollectionSyncOut; importing: boolean; waiting: boolean };

/** Links an existing Thingport collection to a provider's. Where the provider says so (MakerWorld rate-limits bulk
 *  imports hard), only models added from now on come in; elsewhere the collection's current models are imported too,
 *  by the sync's first check. Library models are filed into the collection either way. */
export async function enableSyncFromApp(
  userId: string,
  collectionId: string,
  input: { url: string; intervalHours?: SyncIntervalHours; profileScope?: SyncProfileScope },
): Promise<EnableFromAppResult> {
  if (isSystemCollectionId(collectionId)) throw new HttpError(400, "This collection can't be synced");
  const source = parseSyncSource(input.url);
  if (!source) throw new HttpError(400, NOT_A_LIST);
  await assertProviderEnabled(source.provider);
  if (input.profileScope && !hasProfiles(source.provider)) {
    throw new HttpError(400, NO_PROFILES_TEXT);
  }
  const provider = PROVIDERS[source.provider].sync;
  const newOnly = manifestOf(source.provider).capabilities.syncsNewOnly;

  let knownIds: string[] = [];
  if (newOnly) {
    const listing = await providerCall(source.provider, () =>
      fetchListing({ userId, provider: source.provider, externalId: source.externalId, sourceUrl: source.url }),
    );
    if (!listing) throw new HttpError(404, "That collection can't be found. It may be private or deleted.");
    knownIds = listing;
  }

  const waiting = (await provider?.waitingForGrab?.(userId, source.externalId)) ?? false;
  const link = await enableSync(userId, { url: input.url, collectionId, knownIds });
  let sync = link;
  if (input.intervalHours || input.profileScope) {
    sync = {
      ...link,
      ...(await updateSyncSettings(userId, collectionId, {
        intervalHours: input.intervalHours,
        profileScope: input.profileScope,
      })),
    };
  }

  const importing = !newOnly;
  if (importing) {
    const created = await prisma.collectionSync.findUniqueOrThrow({ where: { collectionId } });
    // Never checked yet, so a check that finds the user busy importing is retried on the
    // scheduler's next tick rather than a day later.
    void syncCollection(created.id).catch((err) => console.error(`[sync] first check of ${created.id} failed:`, err));
  }
  return { sync, importing, waiting };
}
