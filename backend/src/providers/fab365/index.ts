// Fab365's bundle: this folder, providers/fab365/ at the repository's root (its manifest and links, which all three
// packages share), the app's frontend/src/providers/fab365/ and Grab's extension/src/providers/fab365/. Wired in by
// providers/registry.ts here, frontend/src/providers/collectionTiles.ts in the app, and the tables in
// extension/src/providers/ in Grab.
//
// Outside them, and why:
// - The app's text for it, under its id in frontend/src/i18n/locales/*.json, where all of the app's text is kept.
// - Its category names, in frontend/src/components/categoryMapping/providerCategories.json with every provider's.

import { z } from "zod";
import { HttpError } from "../../utils/fileUtils";
import { detailsOf } from "../details";
import { MANIFESTS } from "../index.generated";
import type { ProviderDetails, ProviderList, ProviderLists, ProviderTrending, SourcedImport } from "../types";
import {
  FAB365_LIKES_NAME,
  Fab365AuthError,
  Fab365RateLimitError,
  Fab365UnownedError,
  fetchFab365Likes,
  fetchFab365Popular,
  isFab365FileHost,
  isFab365LikesUrl,
  resolveFab365Download,
  resolveFab365Model,
  type Fab365Auth,
  type Fab365Listing,
  type Fab365Member,
  type Fab365ModelResolution,
} from "./api";
import { FAB365_CONNECT, getFab365Connection, getUserFab365Auth, withFab365Auth } from "./session";

const SESSION_CODE = MANIFESTS.fab365.errorCodes.session;
const RATE_LIMITED = "Fab365 rate-limited Thingport. Wait a while, then try again.";

/** Fab365's errors as the HttpErrors an import reports. A rejected sign-in was remembered where it was turned down
 *  (withFab365Auth, and renewing), and only while it was still the one stored, so it isn't marked again here. */
async function fab365Failure(_userId: string, err: unknown): Promise<unknown> {
  if (err instanceof Fab365AuthError) {
    // 400, not 401: the frontend treats any 401 as an expired Thingport session.
    return new HttpError(400, err.message, SESSION_CODE);
  }
  // 403: the model is fine, the user just doesn't own it -- they buy it or redeem a ticket on Fab365 first.
  if (err instanceof Fab365UnownedError) return new HttpError(403, err.message);
  if (err instanceof Fab365RateLimitError) return new HttpError(429, err.message);
  return err;
}

type Connected = { userId: string; auth: Fab365Auth; account: Fab365Member };

/** The user's sign-in, renewed when it's out, or the HttpError that says to connect Fab365. */
async function requireFab365(userId: string): Promise<Connected> {
  let connected: Awaited<ReturnType<typeof getUserFab365Auth>>;
  try {
    connected = await getUserFab365Auth(userId);
  } catch (err) {
    throw await fab365Failure(userId, err);
  }
  if (!connected) throw new HttpError(400, FAB365_CONNECT, SESSION_CODE);
  return { userId, ...connected };
}

/** A model's details are anyone's to read, but its ownership flags take the user's sign-in; read with it, renewing it
 *  when Fab365 turns it down mid-read. */
function resolve(externalId: string, connected: Connected): Promise<Fab365ModelResolution | null> {
  return withFab365Auth(connected.userId, connected.auth, (auth) => resolveFab365Model(externalId, auth.token));
}

/** A model's files, which Fab365 hands a signed-in member who owns it -- a free one included, with no order to place;
 *  a paid or ticket one they haven't got is refused. One zip of all its files, which the import unpacks. */
export const fab365Import: SourcedImport<Connected, Fab365ModelResolution> = {
  requireAuth: requireFab365,
  resolveModel: resolve,
  mapError: fab365Failure,
  missingMessage: "This Fab365 model could not be found, or isn't on sale any more.",
  noFilesMessage: "This Fab365 model has no files Thingport can import.",
  nameHint: (externalId) => `fab365-${externalId}`,
  async downloadModel(target, resolved, connected, _requested, kit) {
    if (!resolved.free && !resolved.owned) throw new Fab365UnownedError(resolved.ticket);
    const url = await withFab365Auth(target.userId, connected.auth, (auth) =>
      resolveFab365Download(resolved.itemId, auth, resolved.ticket),
    );
    const name = `fab365-${resolved.itemId}.zip`;
    return (await kit.downloadSignedFile({ url, name }, isFab365FileHost, RATE_LIMITED)) ?? [];
  },
};

export const fab365Trending: ProviderTrending = { fetch: (_userId, limit) => fetchFab365Popular(limit) };

/** The user's favourites, Fab365's only list and their own to see. */
async function likesOf(userId: string, url: string): Promise<{ title: string; listing: Fab365Listing }> {
  if (!isFab365LikesUrl(url)) throw new HttpError(400, "Not a link to your Fab365 favourites");
  const connected = await requireFab365(userId);
  try {
    const listing = await withFab365Auth(userId, connected.auth, (auth) => fetchFab365Likes(auth));
    return { title: FAB365_LIKES_NAME, listing };
  } catch (err) {
    throw await fab365Failure(userId, err);
  }
}

export const fab365Lists: ProviderLists = {
  async read(userId, url) {
    const { title, listing } = await likesOf(userId, url);
    if (!listing.entries.length) throw new HttpError(400, "You haven't favourited anything on Fab365 yet");
    const list: ProviderList = {
      title,
      total: listing.total,
      truncated: listing.truncated,
      entries: listing.entries.map((entry) => ({ externalId: entry.itemId, title: entry.title, cover: entry.cover })),
    };
    return list;
  },
  modelIds: z
    .array(z.string().regex(/^\d{1,12}$/))
    .min(1)
    .max(1000),
  async start(userId, url) {
    const { title } = await likesOf(userId, url);
    return {
      batch: {
        // Each model's import reads the sign-in itself, which has to still be there when the job runs.
        async ready() {
          if (!(await getUserFab365Auth(userId).catch(() => null))) throw new HttpError(503, FAB365_CONNECT);
        },
        title: async () => title,
      },
    };
  },
};

/** Its models' details, read without a sign-in, which only their files and ownership flags need. */
export const fab365Details: ProviderDetails = {
  read: async (_userId, itemId) => detailsOf(await resolveFab365Model(itemId)),
  missingMessage: fab365Import.missingMessage,
  mapError: fab365Failure,
};

export { getFab365Connection };
