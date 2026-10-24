import { prisma } from "../db";
import type { Print, Prisma } from "@prisma/client";
import { HttpError } from "../utils/fileUtils";
import { IMPORT_MAKERWORLD_CALL_DELAY_MS } from "../config";
import {
  attachImportedPreviewImages,
  buildImportSourceUrl,
  CULTS3D_SESSION_CODE,
  fetchMakerworldDesignForImport,
  resolveCategoryIdByCategory,
} from "./importService";
import { parseMakerworldModelUrl } from "./makerworldCloudApi";
import {
  emptyImportedPageMetadata,
  makerworldMetaFromDesign,
  resolveMakerworldCookie,
  type ImportedPageMetadata,
} from "./importResolvers";
import { resolveThingiverseThing, ThingiverseAuthError, ThingiverseRateLimitError } from "../providers/thingiverse/api";
import { parsePrintablesModelUrl, resolvePrintablesModel } from "../providers/printables/api";
import { getMyminifactoryApiKey, getThingiverseAccessToken } from "./settingsService";
import {
  MyminifactoryAuthError,
  MyminifactoryRateLimitError,
  resolveMyminifactoryObject,
} from "../providers/myminifactory/api";
import { resolveSnapmakerModel } from "../providers/snapmaker/api";
import { resolveMakeronlineModel } from "../providers/makeronline/api";
import { resolveCrealitycloudModel } from "../providers/crealitycloud/api";
import { resolveNexprintModel } from "../providers/nexprint/api";
import { resolveThangsModel, ThangsBlockedError } from "../providers/thangs/api";
import { Cults3dAuthError, Cults3dRateLimitError, resolveCults3dModel } from "../providers/cults3d/api";
import { CULTS3D_CONNECT, getUserCults3dCredentials, markCults3dApiRejected } from "../providers/cults3d/session";
import { getUserMakerworldCookie } from "./makerworldCookieService";
import { upsertAuthorFromImport } from "./authorService";
import { emptyGaps, openSourceGaps, type SourceGap } from "./sourceGaps";
import { localizeDescriptionImages } from "./descriptionImageService";
import { normalizeTags } from "../utils/tagNormalization";

export type FillGapsResult = {
  source_url: string;
  filled: SourceGap[];
  /** Still empty because the source has nothing for them either. */
  remaining: SourceGap[];
};

/** Reads the source's metadata. Nothing is downloaded but the images that fill an empty slot.
 *  Thingiverse's and MyMiniFactory's own errors are passed through, so callers can tell a rejected token apart. */
export async function fetchSourceMeta(userId: string, print: Print, sourceUrl: string): Promise<ImportedPageMetadata> {
  const provider = print.sourceProvider!;
  const externalId = print.sourceExternalId!;

  if (provider === "makerworld") {
    const parsed = parseMakerworldModelUrl(sourceUrl);
    if (!parsed) throw new HttpError(400, "Not a MakerWorld model link");
    const cookie = await getUserMakerworldCookie(userId);
    const design = await fetchMakerworldDesignForImport(
      parsed.designId,
      resolveMakerworldCookie({ makerworld_cookie: cookie }),
      IMPORT_MAKERWORLD_CALL_DELAY_MS,
    );
    if (!design) throw new HttpError(400, "Couldn't read this model from MakerWorld");
    return makerworldMetaFromDesign(design);
  }

  if (provider === "thingiverse") {
    const accessToken = await getThingiverseAccessToken();
    if (!accessToken) {
      throw new HttpError(
        503,
        "Thingiverse import isn't configured for this instance yet -- ask an admin to add an App Token in Administration > Providers.",
      );
    }
    const resolved = await resolveThingiverseThing(externalId, accessToken);
    if (!resolved) {
      throw new HttpError(
        404,
        "This Thingiverse Thing could not be found, or isn't accessible with the configured App Token.",
      );
    }
    return {
      ...emptyImportedPageMetadata(),
      ...resolved.meta,
      galleryImages: resolved.galleryImages.map((image) => ({ url: image.url, filename: image.name })),
    };
  }

  if (provider === "printables") {
    if (!parsePrintablesModelUrl(sourceUrl)) throw new HttpError(400, "Not a Printables model link");
    const resolved = await resolvePrintablesModel(externalId);
    if (!resolved) throw new HttpError(404, "This Printables model could not be found, or isn't public.");
    return {
      ...emptyImportedPageMetadata(),
      ...resolved.meta,
      galleryImages: resolved.galleryImages.map((image) => ({ url: image.url, filename: image.name })),
    };
  }

  if (provider === "myminifactory") {
    const apiKey = await getMyminifactoryApiKey();
    if (!apiKey) {
      throw new HttpError(
        503,
        "MyMiniFactory import isn't configured for this instance yet -- ask an admin to add an API key in Administration > Providers.",
      );
    }
    const resolved = await resolveMyminifactoryObject(externalId, apiKey);
    if (!resolved) throw new HttpError(404, "This MyMiniFactory object could not be found, or isn't public.");
    return { ...emptyImportedPageMetadata(), ...resolved.meta, galleryImages: resolved.galleryImages };
  }

  if (provider === "snapmaker") {
    const resolved = await resolveSnapmakerModel(externalId);
    if (!resolved) throw new HttpError(404, "This Snapmaker model could not be found, or isn't public.");
    return { ...emptyImportedPageMetadata(), ...resolved.meta, galleryImages: resolved.galleryImages };
  }

  if (provider === "makeronline") {
    const resolved = await resolveMakeronlineModel(externalId);
    if (!resolved) throw new HttpError(404, "This MakerOnline model could not be found, or isn't public.");
    return { ...emptyImportedPageMetadata(), ...resolved.meta, galleryImages: resolved.galleryImages };
  }

  if (provider === "crealitycloud") {
    const resolved = await resolveCrealitycloudModel(externalId);
    if (!resolved) throw new HttpError(404, "This Creality Cloud model could not be found, or isn't public.");
    return { ...emptyImportedPageMetadata(), ...resolved.meta, galleryImages: resolved.galleryImages };
  }

  if (provider === "nexprint") {
    const resolved = await resolveNexprintModel(externalId);
    if (!resolved) throw new HttpError(404, "This NexPrint model could not be found, or isn't public.");
    return { ...emptyImportedPageMetadata(), ...resolved.meta, galleryImages: resolved.galleryImages };
  }

  if (provider === "thangs") {
    const resolved = await resolveThangsModel(externalId);
    if (!resolved) throw new HttpError(404, "This Thangs model could not be found, or isn't public.");
    return { ...emptyImportedPageMetadata(), ...resolved.meta, galleryImages: resolved.galleryImages };
  }

  if (provider === "cults3d") {
    const credentials = await getUserCults3dCredentials(userId);
    if (!credentials) throw new HttpError(400, CULTS3D_CONNECT, CULTS3D_SESSION_CODE);
    let resolved;
    try {
      resolved = await resolveCults3dModel(externalId, credentials);
    } catch (err) {
      if (err instanceof Cults3dAuthError) await markCults3dApiRejected(userId);
      throw err;
    }
    if (!resolved) throw new HttpError(404, "This Cults3D model could not be found, or isn't public.");
    return { ...emptyImportedPageMetadata(), ...resolved.meta, galleryImages: resolved.galleryImages };
  }

  throw new HttpError(400, "This model has no source to fill its details from");
}

/** Only empty fields are written, so anything the user typed always wins. */
async function fillEmptyMetadata(
  userId: string,
  print: Print,
  gaps: Set<SourceGap>,
  meta: ImportedPageMetadata,
): Promise<void> {
  const updates: Prisma.PrintUpdateInput = {};
  if (gaps.has("title") && meta.title) updates.title = meta.title;
  if (gaps.has("description") && meta.description) updates.notes = meta.description;
  if (gaps.has("tags")) {
    const tags = normalizeTags(meta.tags);
    if (tags.length) updates.tags = tags;
  }
  if (gaps.has("creator") && meta.creator) updates.creator = meta.creator;
  if (gaps.has("author") && meta.author) {
    const linked = await upsertAuthorFromImport(meta.author);
    if (linked) updates.author = { connect: { id: linked.id } };
  }
  if (gaps.has("category")) {
    const categoryId = await resolveCategoryIdByCategory(userId, meta.categorySite, meta.siteCategoryIds);
    if (categoryId) {
      updates.category = { connect: { id: categoryId } };
      updates.categorySource = "RULE";
    }
  }
  if (Object.keys(updates).length) await prisma.print.update({ where: { id: print.id }, data: updates });
}

/** Fills an imported model's empty details and images from its source. What the source has
 *  nothing for is remembered, so the action isn't offered again until a new gap appears. */
export async function fillSourceGaps(userId: string, printId: string): Promise<FillGapsResult> {
  const print = await prisma.print.findFirst({
    where: { id: printId, userId },
    include: { plates: { orderBy: { position: "asc" } }, previewImages: true },
  });
  if (!print) throw new HttpError(404, "Model not found");
  const sourceUrl = buildImportSourceUrl(print.sourceProvider, print.sourceExternalId);
  if (!sourceUrl) throw new HttpError(400, "This model has no recorded source to fill its details from");

  if (!openSourceGaps(print, print.previewImages).length) {
    return { source_url: sourceUrl, filled: [], remaining: print.unfillableGaps as SourceGap[] };
  }
  // Retries the ones the source lacked last time too: it costs nothing more than the one fetch.
  const gaps = emptyGaps(print, print.previewImages);

  let meta: ImportedPageMetadata;
  try {
    meta = await fetchSourceMeta(userId, print, sourceUrl);
  } catch (err) {
    if (err instanceof ThingiverseRateLimitError) throw new HttpError(429, err.message);
    if (err instanceof ThingiverseAuthError) throw new HttpError(400, err.message);
    if (err instanceof MyminifactoryRateLimitError) throw new HttpError(429, err.message);
    if (err instanceof MyminifactoryAuthError) throw new HttpError(400, err.message);
    if (err instanceof ThangsBlockedError) throw new HttpError(429, err.message);
    if (err instanceof Cults3dRateLimitError) throw new HttpError(429, err.message);
    if (err instanceof Cults3dAuthError) throw new HttpError(400, err.message, CULTS3D_SESSION_CODE);
    throw err;
  }
  const wanted = new Set(gaps);
  await fillEmptyMetadata(userId, print, wanted, meta);
  if (wanted.has("images")) {
    await attachImportedPreviewImages(
      print.id,
      print.plates[0]?.id,
      meta.previewImageUrl,
      meta.galleryImages.map((image) => ({ url: image.url, filename: image.filename })),
    );
  }
  if (wanted.has("description") && meta.description) await localizeDescriptionImages(print.id);

  const after = await prisma.print.findUniqueOrThrow({ where: { id: print.id }, include: { previewImages: true } });
  const remaining = emptyGaps(after, after.previewImages);
  await prisma.print.update({ where: { id: print.id }, data: { unfillableGaps: remaining } });
  return { source_url: sourceUrl, filled: gaps.filter((gap) => !remaining.includes(gap)), remaining };
}
