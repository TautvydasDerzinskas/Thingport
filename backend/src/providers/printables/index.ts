import { HttpError } from "../../utils/fileUtils";
import type { NewPlateInput } from "../../services/printCreation";
import type { ProviderLists, ResolvedModel, SourcedImport, ProviderTrending } from "../types";
import {
  fetchPrintablesCollectionEntries,
  fetchPrintablesCollectionTitle,
  parsePrintablesCollectionUrl,
  resolvePrintablesDownloadLinks,
  resolvePrintablesModel,
  type PrintablesPlateFile,
  fetchPrintablesTrending,
} from "./api";

type Model = ResolvedModel & { plateFiles: PrintablesPlateFile[] };

/** Read from Printables' public API, so no sign-in; each model file a plate of its own, from the download links the
 *  API hands out. */
export const printablesImport: SourcedImport<null, Model> = {
  requireAuth: async () => null,
  async resolveModel(modelId) {
    const resolved = await resolvePrintablesModel(modelId);
    return (
      resolved && {
        meta: resolved.meta,
        plateFiles: resolved.plateFiles,
        galleryImages: resolved.galleryImages.map((img) => ({ url: img.url, filename: img.name })),
      }
    );
  },
  mapError: async (_userId, err) => err,
  missingMessage: "This Printables model could not be found, or isn't public.",
  noFilesMessage: "None of this model's files could be downloaded.",
  async downloadModel({ externalId }, model, _auth, _requested, kit) {
    const modelFiles = model.plateFiles.filter((file) => kit.isModelFile(file.name));
    if (!modelFiles.length) {
      throw new HttpError(
        400,
        "This Printables model has no downloadable model files (only sliced/print-ready files, if any).",
      );
    }
    const links = await resolvePrintablesDownloadLinks(
      externalId,
      modelFiles.map((file) => file.id),
    );
    const results = await Promise.all(
      modelFiles.flatMap((file) => {
        const link = links.get(file.id);
        return link ? [kit.downloadFile(link, file.name)] : [];
      }),
    );
    const downloaded = results
      .filter((result): result is { input: NewPlateInput } => result !== null && "input" in result)
      .map((result) => result.input);
    if (!downloaded.length && results.some((result) => result !== null && "rateLimited" in result)) {
      throw new HttpError(
        429,
        "Printables blocked a file download (rate limit or Cloudflare challenge). This usually clears after a while -- wait, then retry the same import.",
      );
    }
    return downloaded;
  },
};

export const printablesTrending: ProviderTrending = { fetch: (_userId, limit) => fetchPrintablesTrending(limit) };

function collectionIdOf(url: string): string {
  const parsed = parsePrintablesCollectionUrl(url);
  if (!parsed) throw new HttpError(400, "Not a Printables Collection URL");
  return parsed.collectionId;
}

/** Public collections, read from Printables' API. Private ones and likes only Thingport Grab can read, as their owner
 *  (services/providerListingsService.ts), for a sync to follow. */
export const printablesLists: ProviderLists = {
  async read(_userId, url) {
    const listing = await fetchPrintablesCollectionEntries(collectionIdOf(url));
    if (!listing.entries.length) throw new HttpError(400, "Could not load this collection's models");
    return {
      title: listing.title,
      total: listing.total,
      truncated: listing.truncated,
      entries: listing.entries.map((e) => ({ externalId: e.modelId, title: e.title, cover: e.cover })),
    };
  },
  async start(_userId, url, body) {
    const collectionId = collectionIdOf(url);
    return {
      batch: {
        title: async () =>
          body.collection_title?.trim() ||
          (await fetchPrintablesCollectionTitle(collectionId)) ||
          `Printables Collection ${collectionId}`,
      },
    };
  },
  rateLimitText: "rate-limited by Printables — wait a while, then retry",
  unavailableText: "unavailable (private, deleted, or removed)",
};
