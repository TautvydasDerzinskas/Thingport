import { HttpError } from "../../utils/fileUtils";
import { mapWithConcurrency } from "../../utils/concurrency";
import type { NewPlateInput } from "../../services/printCreation";
import type {
  ProviderLists,
  ResolvedModel,
  SourcedImport,
  ProviderTrending,
  ProviderDetails,
  InstanceHealth,
} from "../types";
import { getThingiverseAccessToken } from "../../services/settingsService";
import { likesCollectionName } from "../names";
import {
  fetchThingiverseCollectionThings,
  fetchThingiverseCollectionTitle,
  fetchThingiverseUserLikes,
  parseThingiverseCollectionUrl,
  parseThingiverseLikesUrl,
  resolveThingiverseThing,
  ThingiverseAuthError,
  ThingiverseRateLimitError,
  type ThingiversePlateFile,
  type ThingiverseThingResolution,
  fetchThingiversePopular,
  checkThingiverseAccessToken,
} from "./api";
import manifest from "../_generated/thingiverse/manifest";
import { detailsOf } from "../details";

const DOWNLOAD_CONCURRENCY = 2;

type Thing = ResolvedModel & { plateFiles: ThingiversePlateFile[] };

async function requireToken(): Promise<string> {
  const accessToken = await getThingiverseAccessToken();
  if (!accessToken) {
    throw new HttpError(
      503,
      "Thingiverse import isn't configured for this instance yet -- ask an admin to add an App Token in Administration > Providers.",
    );
  }
  return accessToken;
}

/** Every model file bundled with the Thing becomes its own plate on one print. Read and downloaded with the
 *  instance's App Token, which an admin sets. */
export const thingiverseImport: SourcedImport<string, Thing> = {
  requireAuth: () => requireToken(),
  async resolveModel(thingId, accessToken) {
    const resolved: ThingiverseThingResolution | null = await resolveThingiverseThing(thingId, accessToken);
    return (
      resolved && {
        meta: resolved.meta,
        plateFiles: resolved.plateFiles,
        galleryImages: resolved.galleryImages.map((img) => ({ url: img.url, filename: img.name })),
      }
    );
  },
  async mapError(_userId, err) {
    if (err instanceof ThingiverseRateLimitError) return new HttpError(429, err.message);
    // 400, not 401: see tryMakerworldCloudApi.
    if (err instanceof ThingiverseAuthError) return new HttpError(400, err.message);
    return err;
  },
  missingMessage: "This Thingiverse Thing could not be found, or isn't accessible with the configured App Token.",
  noFilesMessage: "None of this Thing's files could be downloaded.",
  nameHint: (thingId) => `thing-${thingId}`,
  async downloadModel(_target, thing, _token, _requested, kit) {
    const modelFiles = thing.plateFiles.filter((file) => kit.isModelFile(file.name));
    const results = await mapWithConcurrency(modelFiles, DOWNLOAD_CONCURRENCY, (file) =>
      kit.downloadFile(file.url, file.name),
    );
    const downloaded = results
      .filter((result): result is { input: NewPlateInput } => result !== null && "input" in result)
      .map((result) => result.input);
    if (!downloaded.length && results.some((result) => result !== null && "rateLimited" in result)) {
      throw new HttpError(
        429,
        "Thingiverse blocked a file download with a rate-limit challenge (Cloudflare). This usually clears after a while -- wait, then retry the same import.",
      );
    }
    return downloaded;
  },
};

/** Read with the instance's App Token. */
export const thingiverseTrending: ProviderTrending = {
  async fetch(_userId, limit) {
    const token = await getThingiverseAccessToken();
    return token ? fetchThingiversePopular(limit, token) : "thingiverseToken";
  },
};

/** Anyone's Likes, or a collection, read with the instance's App Token. */
export const thingiverseLists: ProviderLists = {
  async read(_userId, url) {
    const likes = parseThingiverseLikesUrl(url);
    const collection = likes ? null : parseThingiverseCollectionUrl(url);
    if (!likes && !collection) throw new HttpError(400, "Not a Thingiverse Likes or Collection URL");
    const accessToken = await requireToken();
    const [title, listing] = likes
      ? [`${likes.username}'s Thingiverse Likes`, await fetchThingiverseUserLikes(likes.username, accessToken)]
      : await Promise.all([
          fetchThingiverseCollectionTitle(collection!.collectionId, accessToken),
          fetchThingiverseCollectionThings(collection!.collectionId, accessToken),
        ]);
    if (!listing.entries.length) {
      throw new HttpError(
        400,
        likes
          ? "Could not load this user's likes -- check the username and try again"
          : "Could not load this collection's models",
      );
    }
    return {
      title,
      total: listing.entries.length,
      truncated: listing.truncated,
      entries: listing.entries.map((e) => ({ externalId: e.thingId, title: e.title, cover: e.cover })),
    };
  },
  async start(_userId, url) {
    const likes = parseThingiverseLikesUrl(url);
    if (likes) {
      return {
        batch: {
          ready: async () => void (await requireToken()),
          title: async () => likesCollectionName(likes.username, manifest.id),
          label: () => `@${likes.username}'s Likes`,
        },
      };
    }
    const collection = parseThingiverseCollectionUrl(url);
    if (!collection) throw new HttpError(400, "Not a Thingiverse Likes or Collection URL");
    const { collectionId } = collection;
    return {
      batch: {
        ready: async () => void (await requireToken()),
        title: async () =>
          (await fetchThingiverseCollectionTitle(collectionId, await requireToken())) ??
          `Thingiverse Collection ${collectionId}`,
      },
    };
  },
  rateLimitText:
    "blocked by Thingiverse's rate-limit protection (too many requests at once) — wait a while, then retry",
  authText: "failed because the configured App Token was rejected",
};

/** Read with the instance's App Token, as its imports are. */
export const thingiverseDetails: ProviderDetails = {
  read: async (_userId, thingId) => detailsOf(await thingiverseImport.resolveModel(thingId, await requireToken())),
  missingMessage: thingiverseImport.missingMessage,
  mapError: thingiverseImport.mapError,
  unavailable: { check: async () => ((await getThingiverseAccessToken()) ? null : "thingiverse_no_token") },
  problemOf(err) {
    if (err instanceof ThingiverseAuthError) return { problem: "thingiverse_token_rejected" };
    // Cloudflare's 429 is sticky, so every further request would fail the same way.
    if (err instanceof ThingiverseRateLimitError) return { problem: "thingiverse_rate_limited" };
    return null;
  },
};

/** The instance's App Token, tested against the API. */
export async function thingiverseInstanceHealth(): Promise<InstanceHealth> {
  const token = await getThingiverseAccessToken();
  return token ? checkThingiverseAccessToken(token) : "not_configured";
}
