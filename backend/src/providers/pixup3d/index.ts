// PIXUP's bundle: this folder, providers/pixup3d/ at the repository's root (its manifest and links, which all three
// packages share), the app's frontend/src/providers/pixup3d/ and Grab's extension/src/providers/pixup3d/. Wired in by
// providers/registry.ts here, frontend/src/providers/collectionTiles.ts in the app, and the tables in
// extension/src/providers/ in Grab.
//
// Outside them, and why:
// - The app's text for it, under its id in frontend/src/i18n/locales/*.json, where all of the app's text is kept.
// - Its category names, in frontend/src/components/categoryMapping/providerCategories.json with every provider's.
// - How its wishlists are named after whose they are, by its member addresses (`/en/p/<username>/saved_posts`), in
//   syncLikesUsername (providers/names.ts), which reads every provider's.

import fs from "node:fs/promises";
import { z } from "zod";
import type { NewPlateInput } from "../../services/printCreation";
import { HttpError } from "../../utils/fileUtils";
import { joinFolders } from "../../utils/fileFolder";
import { detailsOf } from "../details";
import { MANIFESTS } from "../index.generated";
import type {
  ListEntry,
  ProviderDetails,
  ProviderList,
  ProviderLists,
  ProviderTrending,
  SourcedImport,
} from "../types";
import {
  checkPixup3dAuth,
  fetchPixup3dCollection,
  fetchPixup3dOwnedPosts,
  fetchPixup3dTrending,
  fetchPixup3dVariantState,
  fetchPixup3dWishlist,
  isPixup3dFileHost,
  parsePixup3dCollectionUrl,
  parsePixup3dWishlistUrl,
  Pixup3dAuthError,
  Pixup3dCartError,
  type Pixup3dListing,
  type Pixup3dModelResolution,
  Pixup3dPreparingError,
  pixup3dPriceText,
  Pixup3dRateLimitError,
  type Pixup3dSession,
  type Pixup3dVariant,
  pixup3dWishlistName,
  placePixup3dFreeOrder,
  resolvePixup3dDownload,
  resolvePixup3dModel,
  withoutUploadNumbers,
} from "./api";
import {
  getUserPixup3dSession,
  keepRenewedPixup3dSession,
  PIXUP3D_CONNECT,
  pixup3dRejection,
  withPixup3dSession,
} from "./session";

const SESSION_CODE = MANIFESTS.pixup3d.errorCodes.session;
const RATE_LIMITED = "PIXUP rate-limited Thingport. Wait a while, then try again.";
/** The name PIXUP gives a file group its designer left unnamed. */
const UNNAMED_GROUP = /^default name$/i;

/** PIXUP's errors as the HttpErrors an import reports. A rejected sign-in was remembered where it was turned down
 *  (`pixup3dRejection`), so the app can say so. */
async function pixup3dFailure(_userId: string, err: unknown): Promise<unknown> {
  if (err instanceof Pixup3dAuthError) {
    // 400, not 401: the frontend treats any 401 as an expired Thingport session.
    return new HttpError(400, err.message, SESSION_CODE);
  }
  if (err instanceof Pixup3dRateLimitError) return new HttpError(429, err.message);
  // 409: nothing is wrong with the model; the same import works once the zip is made, or the cart is cleared.
  if (err instanceof Pixup3dPreparingError || err instanceof Pixup3dCartError) return new HttpError(409, err.message);
  return err;
}

/** The variants worth downloading: any with model files, not the ones of sliced files for a printer alone. */
export function pixup3dImportableVariants(variants: Pixup3dVariant[]): Pixup3dVariant[] {
  return variants.filter((variant) => !variant.slicedOnly && variant.fileGroups.length > 0);
}

function paidRefusal(resolved: Pixup3dModelResolution): HttpError {
  return new HttpError(
    403,
    `This is a paid PIXUP model (${pixup3dPriceText(resolved.price)}) you haven't bought: Thingport imports the ones ` +
      "you own. Buy it on pixup3d.com first.",
  );
}

/** A model's details are anyone's to read; its files go to a signed-in member who owns it, one zip per file group of
 *  each of its variants with model files. A free variant not in their library yet is ordered first, for $0, as the
 *  site's own Download button does; a paid one they haven't bought is refused. */
export const pixup3dImport: SourcedImport<Pixup3dSession, Pixup3dModelResolution> = {
  async requireAuth(userId) {
    const session = await getUserPixup3dSession(userId);
    if (!session) throw new HttpError(400, PIXUP3D_CONNECT, SESSION_CODE);
    return session;
  },
  resolveModel: (postId) => resolvePixup3dModel(postId),
  mapError: pixup3dFailure,
  missingMessage: "This PIXUP model could not be found, or isn't public.",
  noFilesMessage:
    "This PIXUP model has no files Thingport can import: only sliced files for particular resin printers.",
  async downloadModel({ userId }, resolved, session, _requested, kit) {
    const used = session.session;
    const downloaded: NewPlateInput[] = [];
    try {
      const wanted = pixup3dImportableVariants(resolved.variants);
      if (!wanted.length) return [];
      // Asked first: a turned-down sign-in reads as owning nothing, which would be taken for a model not bought.
      if ((await checkPixup3dAuth(session)) === "rejected") throw new Pixup3dAuthError();
      const owned: Pixup3dVariant[] = [];
      const free: Pixup3dVariant[] = [];
      for (const variant of wanted) {
        if ((await fetchPixup3dVariantState(variant.id, session)).purchased) owned.push(variant);
        else if (variant.price === 0) free.push(variant);
      }
      if (!owned.length && !free.length) throw paidRefusal(resolved);
      if (free.length) {
        await placePixup3dFreeOrder(
          free.map((variant) => variant.id),
          session,
        );
        owned.push(...free);
      }
      for (const variant of owned) {
        for (const group of variant.fileGroups) {
          const url = await resolvePixup3dDownload(resolved.postId, variant.id, group.id, session);
          const name = `pixup3d-${resolved.postId}-${variant.id}-${group.id}.zip`;
          const files = (await kit.downloadSignedFile({ url, name }, isPixup3dFileHost, RATE_LIMITED)) ?? [];
          // Each variant and file group a folder of its own ("STL_Pre-supported"), as the post lists them, where
          // there are several to tell apart. A group the designer never named is called "Default name".
          const folder = joinFolders(
            owned.length > 1 ? variant.name : null,
            variant.fileGroups.length > 1 && !UNNAMED_GROUP.test(group.name) ? group.name : null,
          );
          downloaded.push(
            ...withoutUploadNumbers(files).map((input) => ({ ...input, folder: joinFolders(folder, input.folder) })),
          );
        }
      }
      return downloaded;
    } catch (err) {
      await Promise.all(downloaded.map((input) => fs.rm(input.tempFilePath!, { force: true }).catch(() => undefined)));
      throw await pixup3dRejection(userId, used, err);
    } finally {
      await keepRenewedPixup3dSession(userId, used, session).catch(() => undefined);
    }
  },
};

export const pixup3dTrending: ProviderTrending = { fetch: (_userId, limit) => fetchPixup3dTrending(limit) };

/** The models the user owns, where their sign-in can say; null where it can't, which marks nothing. */
function ownedPosts(userId: string): Promise<Set<string> | null> {
  return withPixup3dSession(userId, async (session) => (session ? fetchPixup3dOwnedPosts(session) : null)).catch(
    () => null,
  );
}

/** A wishlist or a collection, from a PIXUP link; anyone's to read, a private collection its owner's. Its first
 *  `maxItems`. */
export async function pixup3dListOf(
  userId: string,
  url: string,
  maxItems?: number,
): Promise<{ title: string; listing: Pixup3dListing }> {
  const wishlist = parsePixup3dWishlistUrl(url);
  const collection = wishlist ? null : parsePixup3dCollectionUrl(url);
  if (!wishlist && !collection) throw new HttpError(400, "Not a link to a PIXUP collection or someone's wishlist");
  try {
    if (wishlist) {
      const found = await fetchPixup3dWishlist(wishlist.username, maxItems);
      if (!found) throw new HttpError(404, "There's no such PIXUP member.");
      return { title: pixup3dWishlistName(wishlist.username), listing: found };
    }
    // Read with the sign-in where there is one: a private collection shows only to its owner.
    const found = await withPixup3dSession(userId, (session) =>
      fetchPixup3dCollection(collection!.username, collection!.collectionId, maxItems, session),
    );
    if (!found) throw new HttpError(404, "That collection can't be found. It may have been deleted, or be private.");
    return { title: found.info.title, listing: found };
  } catch (err) {
    if (err instanceof Pixup3dRateLimitError) throw new HttpError(429, err.message);
    throw err;
  }
}

export const pixup3dLists: ProviderLists = {
  async read(userId, url) {
    const { title, listing } = await pixup3dListOf(userId, url);
    if (!listing.entries.length) throw new HttpError(400, `"${title}" has no models yet`);
    // Only shown beside the list, so a library that can't be read leaves its paid models unmarked.
    const owned = listing.entries.some((entry) => entry.price > 0) ? await ownedPosts(userId) : null;
    const list: ProviderList = {
      title,
      total: listing.total,
      truncated: listing.truncated,
      entries: listing.entries.map((entry): ListEntry => {
        const blocked = owned && entry.price > 0 && !owned.has(entry.postId);
        return blocked
          ? { externalId: entry.postId, title: entry.title, cover: entry.cover, blocked: "paid" }
          : { externalId: entry.postId, title: entry.title, cover: entry.cover };
      }),
    };
    return list;
  },
  modelIds: z
    .array(z.string().regex(/^\d{1,12}$/))
    .min(1)
    .max(1000),
  async start(userId, url) {
    // Only its title, which the first page has.
    const { title } = await pixup3dListOf(userId, url, 1);
    return {
      batch: {
        // Each model's import reads the sign-in itself, which has to still be there when the job runs.
        async ready() {
          if (!(await getUserPixup3dSession(userId))) throw new HttpError(503, PIXUP3D_CONNECT);
        },
        title: async () => title,
      },
    };
  },
};

/** Its models' details, read without a sign-in, which only their files need. */
export const pixup3dDetails: ProviderDetails = {
  read: async (_userId, postId) => detailsOf(await resolvePixup3dModel(postId)),
  missingMessage: pixup3dImport.missingMessage,
  mapError: pixup3dFailure,
};
