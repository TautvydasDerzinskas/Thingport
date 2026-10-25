// What Thingport Grab reads on a visit to Printables with the user's own login, saved where the sync dialog's Browse tab
// and the syncs of private lists read it (listings.ts).

import { prisma } from "../../db";
import { readConnection, writeConnection } from "../connections";
import { HttpError } from "../../utils/fileUtils";
import { LIKES_ID_PREFIX } from "../index.generated";
import manifest from "./manifest.generated";
import { printablesCollectionUrl, printablesLikesUrl } from "./urls.generated";
import { syncCollection } from "../../services/collectionSyncRunner";
import type { ProviderCollectionCard } from "../../services/providerCollectionCard";
import { resolvePrintablesUser } from "./api";
import {
  assertPrintablesPushOn,
  COLLECTIONS_KEY,
  deleteStalePrintablesListings,
  LIKES_KEY,
  pushedLikes,
  writePrintablesListing,
} from "./listings";

export type PrintablesPush = {
  user: { id: string; handle: string };
  /** The user's collections, private ones included. */
  collections?: { id: string; name: string; model_count: number; thumbnails: string[]; private: boolean }[];
  /** Their likes, when Grab read them this time: on every visit while a likes sync wants them (see
   *  wantedPrintablesListings), else once a day for the Browse tab's count. Either way it's every
   *  page of them: Printables has no likes count of its own. */
  likes?: { model_count: number; thumbnails: string[]; ids?: string[] };
  /** Model ids of the private collections asked for. */
  listings?: Record<string, string[]>;
};

/** What Thingport Grab read on a visit to Printables. Synced collections whose models changed are
 *  synced straight away: a visit is when their new models can be seen. */
export async function savePrintablesPush(userId: string, push: PrintablesPush): Promise<void> {
  await assertPrintablesPushOn(userId);
  const { id: printablesUserId, handle } = push.user;
  // The signed-in account wins over a username typed into the app, once Printables confirms it: the
  // handle is what proves a likes sync is the user's own (see assertOwnPrintablesLikes).
  const stored = await readConnection(userId, manifest.id);
  if (stored?.accountId !== printablesUserId || stored.accountName !== handle) {
    const confirmed = await resolvePrintablesUser(printablesUserId);
    if (confirmed?.handle !== handle) throw new HttpError(400, "That isn't a Printables user");
    await writeConnection(userId, manifest.id, { accountId: printablesUserId, accountName: handle });
  }

  if (push.collections) {
    const cards: ProviderCollectionCard[] = push.collections.map((c) => ({
      id: c.id,
      name: c.name,
      url: printablesCollectionUrl(c.id, handle),
      modelCount: c.model_count,
      thumbnails: c.thumbnails,
      private: c.private,
      owner: handle,
    }));
    await writePrintablesListing(userId, COLLECTIONS_KEY, { cards });
    // A collection deleted or made public since needs no model list of its own any more.
    await deleteStalePrintablesListings(
      userId,
      cards.filter((card) => card.private).map((card) => card.id),
    );
  }
  const changed = new Map<string, string[]>(Object.entries(push.listings ?? {}));
  for (const [collectionId, ids] of changed) await writePrintablesListing(userId, collectionId, { ids });
  if (push.likes) {
    const ids = push.likes.ids ?? (await pushedLikes(userId))?.ids ?? null;
    const card: ProviderCollectionCard = {
      id: `${LIKES_ID_PREFIX}${handle.toLowerCase()}`,
      name: "Liked models",
      url: printablesLikesUrl(handle),
      modelCount: push.likes.model_count,
      thumbnails: push.likes.thumbnails,
      private: true,
      owner: handle,
    };
    await writePrintablesListing(userId, LIKES_KEY, { card, ids });
    if (push.likes.ids) changed.set(card.id, push.likes.ids);
  }

  const syncs = await prisma.collectionSync.findMany({
    where: { userId, provider: manifest.id, externalId: { in: [...changed.keys()] } },
  });
  for (const sync of syncs) {
    const known = new Set(sync.knownIds);
    if (changed.get(sync.externalId)!.some((id) => !known.has(id))) {
      void syncCollection(sync.id).catch((err) =>
        console.error(`[sync] ${sync.id} after a visit to ${manifest.name}:`, err),
      );
    }
  }
}
