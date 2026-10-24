// What Thingport Grab read from Printables with the user's own login: private collections and
// likes, which Printables shows to their owner only. The instance can't read them itself, so
// syncing them works from these lists, as fresh as the user's last visit to Printables.

import type { Prisma } from "@prisma/client";
import { prisma } from "../../db";
import { HttpError } from "../../utils/fileUtils";
import { LIKES_ID_PREFIX } from "../_generated";
import manifest from "../_generated/printables/manifest";
import type { ProviderCollectionCard } from "../../services/providerCollectionCard";

const PROVIDER = manifest.id;
export const COLLECTIONS_KEY = "collections";
export const LIKES_KEY = "likes";

/** Why a private Printables sync can't be checked yet. Shown as the sync's last error. */
export const WAITING_FOR_GRAB =
  "Waiting for Thingport Grab: open Printables in a browser where you're signed in and Grab is installed";

type CollectionsData = { cards: ProviderCollectionCard[] };
type LikesData = { card: ProviderCollectionCard; ids: string[] | null };
type ModelsData = { ids: string[] };

async function read<T>(userId: string, key: string): Promise<T | null> {
  const row = await prisma.providerListing.findUnique({
    where: { userId_provider_key: { userId, provider: PROVIDER, key } },
  });
  return row ? (row.data as unknown as T) : null;
}

export async function writePrintablesListing(userId: string, key: string, data: object): Promise<void> {
  const json = data as Prisma.InputJsonValue;
  await prisma.providerListing.upsert({
    where: { userId_provider_key: { userId, provider: PROVIDER, key } },
    create: { userId, provider: PROVIDER, key, data: json },
    update: { data: json },
  });
}

async function pushedCollections(userId: string): Promise<ProviderCollectionCard[] | null> {
  return (await read<CollectionsData>(userId, COLLECTIONS_KEY))?.cards ?? null;
}

/** Why a Printables sync is paused once the user forgot their Printables account. */
export const PRINTABLES_FORGOTTEN =
  "Couldn't read this Printables collection: it may be private, and your Printables account is forgotten in Thingport. Give your username in Browse to read it again";

export async function printablesPushIsOff(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { printablesPushOff: true } });
  return Boolean(user?.printablesPushOff);
}

/** Refuses Grab's Printables pushes for a user who forgot their Printables account in the app. */
export async function assertPrintablesPushOn(userId: string): Promise<void> {
  if (await printablesPushIsOff(userId)) {
    throw new HttpError(409, "Printables is turned off for Thingport Grab: give your username in Browse to turn it on");
  }
}

export async function deletePrintablesListings(userId: string): Promise<void> {
  await prisma.providerListing.deleteMany({ where: { userId, provider: PROVIDER } });
}

/** Drops the model lists of collections that aren't among the user's private ones any more. */
export async function deleteStalePrintablesListings(userId: string, privateIds: string[]): Promise<void> {
  await prisma.providerListing.deleteMany({
    where: { userId, provider: PROVIDER, key: { notIn: [COLLECTIONS_KEY, LIKES_KEY, ...privateIds] } },
  });
}

/** The user's collections, private ones included, and their likes, as of their last visit. */
export async function pushedPrintablesCards(
  userId: string,
): Promise<{ collections: ProviderCollectionCard[] | null; likes: ProviderCollectionCard | null }> {
  const [collections, likes] = await Promise.all([
    read<CollectionsData>(userId, COLLECTIONS_KEY),
    read<LikesData>(userId, LIKES_KEY),
  ]);
  return { collections: collections?.cards ?? null, likes: likes?.card ?? null };
}

export async function pushedLikes(userId: string): Promise<LikesData | null> {
  return read<LikesData>(userId, LIKES_KEY);
}

/** For the sync runner: the pushed model ids; "waiting" for a Printables source only Grab can read
 *  that it hasn't yet; null for one the instance reads itself. A collection's pushed ids count only
 *  while the user's last push still lists it as private: Grab stops reading one made public, so
 *  its ids would go stale, and Printables answers for it anyone, the instance included. */
export async function pushedPrintablesModels(userId: string, externalId: string): Promise<string[] | "waiting" | null> {
  if (externalId.startsWith(LIKES_ID_PREFIX)) return (await pushedLikes(userId))?.ids ?? "waiting";
  const isPrivate = (await pushedCollections(userId))?.some((card) => card.id === externalId && card.private);
  if (!isPrivate) return null;
  return (await read<ModelsData>(userId, externalId))?.ids ?? "waiting";
}

// Grab pages each collection a second apart, so a visit reads only this many; the rest wait for
// the next one.
const COLLECTIONS_PER_VISIT = 3;

/** The lists Grab should read in full on its next visit: those of synced likes and synced private
 *  collections, the latter stalest first. Reading every list on every visit would run into
 *  Printables' throttling. */
export async function wantedPrintablesListings(userId: string): Promise<string[]> {
  const [syncs, collections] = await Promise.all([
    prisma.collectionSync.findMany({ where: { userId, provider: PROVIDER }, select: { externalId: true } }),
    pushedCollections(userId),
  ]);
  const privateIds = new Set((collections ?? []).filter((card) => card.private).map((card) => card.id));
  const likes = syncs.some(({ externalId }) => externalId.startsWith(LIKES_ID_PREFIX));
  const ids = syncs.flatMap(({ externalId }) => (privateIds.has(externalId) ? [externalId] : []));
  // Stalest first, never read before least recently read: Grab reads only a few per visit.
  const lastRead = await prisma.providerListing.findMany({
    where: { userId, provider: PROVIDER, key: { in: ids } },
    select: { key: true, updatedAt: true },
  });
  const readAt = new Map(lastRead.map((row) => [row.key, row.updatedAt.getTime()]));
  ids.sort((a, b) => (readAt.get(a) ?? 0) - (readAt.get(b) ?? 0));
  return [...(likes ? [LIKES_KEY] : []), ...ids.slice(0, COLLECTIONS_PER_VISIT)];
}
