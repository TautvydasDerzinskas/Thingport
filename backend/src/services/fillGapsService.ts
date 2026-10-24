import { prisma } from "../db";
import { isProviderId } from "../providers/_generated";
import { PROVIDERS } from "../providers/registry";
import type { Print, Prisma } from "@prisma/client";
import { HttpError } from "../utils/fileUtils";
import { attachImportedPreviewImages, buildImportSourceUrl, resolveCategoryIdByCategory } from "./importService";
import type { ImportedPageMetadata } from "./importResolvers";
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

/** Reads the source's metadata. Nothing is downloaded but the images that fill an empty slot. The provider's own errors
 *  are thrown as they are, so a run over many models can tell a rejected token apart. */
export async function fetchSourceMeta(userId: string, print: Print): Promise<ImportedPageMetadata> {
  const provider = print.sourceProvider;
  if (!isProviderId(provider) || !print.sourceExternalId) {
    throw new HttpError(400, "This model has no source to fill its details from");
  }
  const { details } = PROVIDERS[provider];
  const meta = await details.read(userId, print.sourceExternalId);
  if (!meta) throw new HttpError(404, details.missingMessage);
  return meta;
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
    meta = await fetchSourceMeta(userId, print);
  } catch (err) {
    const mapError = isProviderId(print.sourceProvider) && PROVIDERS[print.sourceProvider].details.mapError;
    throw mapError ? await mapError(userId, err) : err;
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
