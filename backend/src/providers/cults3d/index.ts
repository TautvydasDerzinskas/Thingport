// Cults3D's bundle: this folder, providers/cults3d/ at the repository's root (its manifest and links, which all three
// packages share), the app's frontend/src/providers/cults3d/ and Grab's extension/src/providers/cults3d/. Wired in by
// providers/registry.ts and providers/routes.ts here, frontend/src/providers/collectionTiles.ts in the app, and the
// tables in extension/src/providers/ in Grab.
//
// Outside them, and why:
// - prisma/schema.prisma: Category's cults3dCatIds, a column apiece until Phase 7 of docs/rfc/provider-modules.md moves
//   them into a table of their own; dto.ts, routes/categories.ts, services/categoryService.ts and
//   seedData/defaultCategories.ts name its category ids for the same reason.
// - The app's text for it, under its id in frontend/src/i18n/locales/*.json, where all of the app's text is kept.

import fs from "node:fs/promises";
import { HttpError } from "../../utils/fileUtils";
import type { NewPlateInput } from "../../services/printCreation";
import { CLOUDFLARE_BLOCKED_CODE } from "../../services/flaresolverr";
import type { SourcedImport, ProviderTrending, ProviderList, ProviderLists, ProviderDetails } from "../types";
import { MANIFESTS } from "../index.generated";
import {
  Cults3dAuthError,
  Cults3dBlockedError,
  type Cults3dCredentials,
  type Cults3dModelResolution,
  Cults3dNoFreeDownloadError,
  Cults3dRateLimitError,
  Cults3dSessionError,
  fetchCults3dOrders,
  isCults3dFileHost,
  placeCults3dFreeOrder,
  resolveCults3dDownload,
  resolveCults3dModel,
  fetchCults3dPopular,
  cults3dLikesName,
  fetchCults3dLikes,
  fetchCults3dPrintlist,
  parseCults3dLikesUrl,
  parseCults3dPrintlistUrl,
} from "./api";
import {
  CULTS3D_CONNECT,
  CULTS3D_NO_CLEARANCE,
  CULTS3D_SIGN_IN,
  getUserCults3dBrowser,
  getUserCults3dCredentials,
  markCults3dApiRejected,
  markCults3dSessionRejected,
} from "./session";
import { z } from "zod";
import { hasUsableSecretSql } from "../connections";
import { detailsOf } from "../details";

const SESSION_CODE = MANIFESTS.cults3d.errorCodes.session;

function cults3dPaid(resolved: Cults3dModelResolution): HttpError {
  return new HttpError(
    403,
    `This is a paid Cults3D model (${resolved.priceText}), so it downloads only once bought. Buy it on Cults3D with ` +
      "the account connected to Thingport, then import it again.",
  );
}

/** Metadata from the API; the files from the user's Cults3D library, where every model they ordered, bought or free,
 *  stays. A free model not in it yet is ordered first, as its Download button does; a paid one is refused. The order
 *  and download pages need the browser's sign-in and clearance, which Thingport Grab sends. */
export const cults3dImport: SourcedImport<Cults3dCredentials, Cults3dModelResolution> = {
  async requireAuth(userId) {
    const credentials = await getUserCults3dCredentials(userId);
    if (!credentials) throw new HttpError(400, CULTS3D_CONNECT, SESSION_CODE);
    return credentials;
  },
  resolveModel: (slug, credentials) => resolveCults3dModel(slug, credentials),
  /** A rejected key or sign-in is remembered, so the app can say so. */
  async mapError(userId, err) {
    if (err instanceof Cults3dAuthError) {
      await markCults3dApiRejected(userId);
      // 400, not 401: see tryMakerworldCloudApi.
      return new HttpError(400, err.message, SESSION_CODE);
    }
    if (err instanceof Cults3dSessionError) {
      await markCults3dSessionRejected(userId);
      return new HttpError(400, err.message, SESSION_CODE);
    }
    // Its own code, so a sync waits for the next visit with Grab rather than failing the model.
    if (err instanceof Cults3dBlockedError) return new HttpError(403, err.message, CLOUDFLARE_BLOCKED_CODE);
    if (err instanceof Cults3dRateLimitError) return new HttpError(429, err.message);
    if (err instanceof Cults3dNoFreeDownloadError) return new HttpError(403, err.message);
    return err;
  },
  missingMessage: "This Cults3D model could not be found, or isn't public.",
  noFilesMessage: "This Cults3D model has no files Thingport can import.",
  async downloadModel({ userId }, resolved, credentials, _requested, kit) {
    const downloaded: NewPlateInput[] = [];
    try {
      let downloadUrl = (await fetchCults3dOrders(credentials)).get(resolved.slug) ?? null;
      if (!downloadUrl && resolved.priceCents > 0) throw cults3dPaid(resolved);
      const browser = await getUserCults3dBrowser(userId);
      if (!browser) throw new HttpError(400, CULTS3D_SIGN_IN, SESSION_CODE);
      // Without it every site page is a Cloudflare challenge.
      if (!browser.clearance) throw new HttpError(400, CULTS3D_NO_CLEARANCE, SESSION_CODE);
      if (!downloadUrl) {
        await placeCults3dFreeOrder(resolved.slug, browser);
        downloadUrl = (await fetchCults3dOrders(credentials)).get(resolved.slug) ?? null;
        if (!downloadUrl) throw new HttpError(502, "Cults3D took the free order, but it isn't in your downloads yet.");
      }
      const file = await resolveCults3dDownload(downloadUrl, browser);
      downloaded.push(
        ...((await kit.downloadSignedFile(
          file,
          isCults3dFileHost,
          "Cults3D blocked the file download (rate limit). This usually clears after a while -- wait, then retry.",
        )) ?? []),
      );
    } catch (err) {
      await Promise.all(downloaded.map((input) => fs.rm(input.tempFilePath!, { force: true }).catch(() => undefined)));
      throw err;
    }
    return downloaded;
  },
};

/** Cults3D's API answers only the user's own key, so each user reads their own list. */
export const cults3dTrending: ProviderTrending = {
  async fetch(userId, limit) {
    const credentials = await getUserCults3dCredentials(userId);
    return credentials ? fetchCults3dPopular(limit, credentials) : "cults3dKey";
  },
  perUser: true,
};

/** A user's likes, or one of the user's own printlists, from a Cults3D link, read with their API key. Their orders say
 *  which paid models they own, which the listing keeps. */
async function listOf(userId: string, url: string): Promise<ProviderList & { title: string }> {
  const likes = parseCults3dLikesUrl(url);
  const printlist = likes ? null : parseCults3dPrintlistUrl(url);
  if (!likes && !printlist) throw new HttpError(400, "Not a link to Cults3D likes or one of your printlists");
  const credentials = await getUserCults3dCredentials(userId);
  if (!credentials) throw new HttpError(400, CULTS3D_CONNECT, SESSION_CODE);
  try {
    const owned = new Set((await fetchCults3dOrders(credentials)).keys());
    let title: string;
    let listing: NonNullable<Awaited<ReturnType<typeof fetchCults3dLikes>>>;
    if (likes) {
      const found = await fetchCults3dLikes(credentials, likes.nick, owned);
      if (!found) throw new HttpError(404, `There's no Cults3D user called "${likes.nick}".`);
      title = cults3dLikesName(likes.nick);
      listing = found;
    } else {
      if (printlist!.nick.toLowerCase() !== credentials.nick.toLowerCase()) {
        throw new HttpError(
          403,
          "Only your own Cults3D printlists can be imported: Cults3D's API shows no one else's.",
        );
      }
      const found = await fetchCults3dPrintlist(credentials, printlist!.key, owned);
      if (!found) throw new HttpError(404, "That printlist can't be found. It may have been deleted.");
      title = found.info.name;
      listing = found;
    }
    return {
      title,
      total: listing.total,
      truncated: listing.truncated,
      entries: listing.entries.map((e) => ({ externalId: e.slug, title: e.title, cover: e.cover })),
    };
  } catch (err) {
    if (err instanceof Cults3dAuthError) {
      await markCults3dApiRejected(userId);
      // 400, not 401: the frontend treats any 401 as an expired Thingport session.
      throw new HttpError(400, err.message, SESSION_CODE);
    }
    if (err instanceof Cults3dRateLimitError) throw new HttpError(429, err.message);
    throw err;
  }
}

export const cults3dLists: ProviderLists = {
  async read(userId, url) {
    const list = await listOf(userId, url);
    if (!list.entries.length) throw new HttpError(400, `"${list.title}" has no models Thingport can import`);
    return list;
  },
  modelIds: z
    .array(
      z
        .string()
        .regex(/^[a-z0-9][a-z0-9_-]*$/i)
        .max(200),
    )
    .min(1)
    .max(1000),
  async start(userId, url) {
    const { title } = await listOf(userId, url);
    return {
      batch: {
        // Each model's import reads the credentials itself.
        async ready() {
          if (!(await getUserCults3dCredentials(userId))) throw new HttpError(503, CULTS3D_CONNECT);
        },
        title: async () => title,
      },
    };
  },
};

/** Read only with the user's own API key: one turned down stops only their models. */
export const cults3dDetails: ProviderDetails = {
  async read(userId, slug) {
    const credentials = await cults3dImport.requireAuth(userId);
    try {
      return detailsOf(await resolveCults3dModel(slug, credentials));
    } catch (err) {
      // Remembered, so the rest of this user's models don't ask with it again.
      if (err instanceof Cults3dAuthError) await markCults3dApiRejected(userId);
      throw err;
    }
  },
  missingMessage: cults3dImport.missingMessage,
  mapError: cults3dImport.mapError,
  unavailable: {
    perUser: true,
    check: async (userId) => ((await getUserCults3dCredentials(userId)) ? null : "cults3d_no_key"),
  },
  readableBy: hasUsableSecretSql(MANIFESTS.cults3d.id, "u"),
  problemOf(err) {
    if (err instanceof Cults3dAuthError) return { problem: "cults3d_key_rejected", perUser: true };
    if (err instanceof Cults3dRateLimitError) return { problem: "cults3d_rate_limited" };
    return null;
  },
};
