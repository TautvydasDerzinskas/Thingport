import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { createLogger } from "../logger";
import { parseModelUrl, type ProviderId } from "../providers/index.generated";
import { PROVIDERS } from "../providers/registry";
import { HttpError } from "../utils/fileUtils";
import { normalizeTags } from "../utils/tagNormalization";
import { normalizeImportUrl } from "../utils/urlUtils";
import { suggestMappedCategory } from "./aiCategorizationService";
import { forgetAiDescription } from "./aiDescriptionService";
import { createLog } from "./auditLog";
import { upsertAuthorFromImport } from "./authorService";
import { localizeDescriptionImages, pruneDescriptionImages } from "./descriptionImageService";
import type { ImportedPageMetadata } from "./importResolvers";
import {
  attachImportedPreviewImages,
  buildImportSourceUrl,
  PREVIEW_IMAGE_MAX_COUNT,
  resolveCategoryIdByCategory,
} from "./importService";
import { reorderPreviewImages } from "./previewImageService";
import { assertNotToolModel } from "./printEditService";
import { availableModelName, relocatePrint } from "./printService";
import { assertUrlProviderEnabled } from "./providerSettingsService";
import { emptyGaps } from "./sourceGaps";

// Linking a model with no source, such as an upload, to its page on a provider. It takes the page's details and
// pictures, as an import would bring them, and none of its files. Its category only changes if the owner accepts the
// suggestion it gets.

const log = createLogger("model-link");

type LinkedSource = { provider: ProviderId; externalId: string; url: string };

/** The provider's model a link is of, by the id an import would keep it under. */
async function sourceOfLink(raw: string): Promise<LinkedSource> {
  const url = await normalizeImportUrl(raw);
  const model = parseModelUrl(url);
  if (!model) throw new HttpError(400, "That isn't a link to a model on a supported site");
  await assertUrlProviderEnabled(url);
  const externalId = (await PROVIDERS[model.provider].keptId?.(model.externalId)) ?? model.externalId;
  return { provider: model.provider, externalId, url };
}

function printWithSource(userId: string, source: LinkedSource) {
  return prisma.print.findFirst({
    where: { userId, sourceProvider: source.provider, sourceExternalId: source.externalId },
    select: { id: true, name: true, title: true },
  });
}

async function readSource(userId: string, { provider, externalId }: LinkedSource): Promise<ImportedPageMetadata> {
  const { details } = PROVIDERS[provider];
  let meta: ImportedPageMetadata | null;
  try {
    meta = await details.read(userId, externalId);
  } catch (err) {
    throw details.mapError ? await details.mapError(userId, err) : err;
  }
  if (!meta) throw new HttpError(404, details.missingMessage);
  return meta;
}

export type SourcePreview = {
  provider: ProviderId;
  source_url: string | null;
  /** The user's model that already has this source, which another can't take; nothing is read from the provider then. */
  linked_print: { id: string; name: string } | null;
  title: string | null;
  author_name: string | null;
  author_avatar_url: string | null;
  cover_url: string | null;
  image_count: number;
  tag_count: number;
  has_description: boolean;
};

/** What linking to this model would bring, for the dialog to show. Changes nothing. */
export async function previewSourceLink(userId: string, raw: string): Promise<SourcePreview> {
  const source = await sourceOfLink(raw);
  const empty = {
    provider: source.provider,
    source_url: buildImportSourceUrl(source.provider, source.externalId),
    linked_print: null,
    title: null,
    author_name: null,
    author_avatar_url: null,
    cover_url: null,
    image_count: 0,
    tag_count: 0,
    has_description: false,
  };
  const linked = await printWithSource(userId, source);
  if (linked) return { ...empty, linked_print: { id: linked.id, name: linked.title || linked.name } };
  const meta = await readSource(userId, source);
  const pictures = new Set(
    [meta.previewImageUrl, ...meta.galleryImages.map((image) => image.url)].filter((url) => url !== null),
  );
  return {
    ...empty,
    title: meta.title,
    author_name: meta.author?.name || meta.author?.handle || meta.creator,
    author_avatar_url: meta.author?.avatarUrl ?? null,
    cover_url: [...pictures][0] ?? null,
    image_count: Math.min(pictures.size, PREVIEW_IMAGE_MAX_COUNT),
    tag_count: normalizeTags(meta.tags).length,
    has_description: Boolean(meta.description?.trim()),
  };
}

/** The source's pictures, ahead of the owner's own so its cover becomes the model's. Our renders give way to them. */
async function bringPictures(
  print: { id: string; plates: { id: string }[]; previewImages: { id: string; generated: boolean }[] },
  meta: ImportedPageMetadata,
): Promise<void> {
  const own = new Set(print.previewImages.filter((image) => !image.generated).map((image) => image.id));
  const stored = await attachImportedPreviewImages(
    print.id,
    print.plates[0]?.id,
    meta.previewImageUrl,
    meta.galleryImages,
  );
  if (!stored || !own.size) return;
  const images = await prisma.previewImage.findMany({
    where: { printId: print.id },
    orderBy: { position: "asc" },
    select: { id: true },
  });
  const ids = images.map((image) => image.id);
  await reorderPreviewImages(print.id, [...ids.filter((id) => !own.has(id)), ...ids.filter((id) => own.has(id))]);
}

/** Links the model to the provider's model at `rawUrl`. Its files aren't touched. Nothing changes if the source can't
 *  be read. A title stays if the model has one set; a description, creator and author give way to the source's where
 *  it has them; tags are added to. */
export async function linkPrintToSource(userId: string, printId: string, rawUrl: string): Promise<void> {
  const print = await prisma.print.findFirst({
    where: { id: printId, userId },
    include: { plates: { orderBy: { position: "asc" } }, previewImages: { select: { id: true, generated: true } } },
  });
  if (!print) throw new HttpError(404, "Print not found");
  assertNotToolModel(print);
  const alreadyLinked = () => new HttpError(409, "This model is already linked to a provider");
  if (print.sourceProvider) throw alreadyLinked();
  const source = await sourceOfLink(rawUrl);
  const other = await printWithSource(userId, source);
  if (other) throw new HttpError(409, `"${other.title || other.name}" is already linked to this model`);

  const meta = await readSource(userId, source);
  const author = await upsertAuthorFromImport(meta.author);
  const description = meta.description?.trim() ? meta.description : null;
  const creator = meta.creator?.trim() || null;
  const title = !print.title?.trim() && meta.title?.trim() ? meta.title : null;
  // Only an available name: a model named alike elsewhere in its category is no reason to refuse the link.
  const name = title ? await availableModelName(userId, title, print.categoryId, print.id) : null;

  let claimed: Prisma.BatchPayload;
  try {
    claimed = await prisma.print.updateMany({
      where: { id: print.id, sourceProvider: null },
      data: {
        sourceProvider: source.provider,
        sourceExternalId: source.externalId,
        generatorScriptWithheld: meta.parametricSource?.withheld === true,
        tags: normalizeTags([...print.tags, ...meta.tags]),
        ...(description && { notes: description }),
        ...(creator && { creator }),
        ...(author && { authorId: author.id }),
        ...(title && name && { title, name, nameNormalized: name.trim().toLowerCase() }),
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new HttpError(409, "Another model just took this source or name; please try again");
    }
    throw err;
  }
  if (!claimed.count) throw alreadyLinked();

  // The link stands from here on, so nothing below fails it: "Fetch missing details" can bring back what didn't come.
  const didNot = (step: string) => (error: unknown) => log.warn(`couldn't ${step}`, { print: print.id, error });
  const updated = await prisma.print.findUniqueOrThrow({ where: { id: print.id } });
  await relocatePrint(updated, print.plates).catch(didNot("move its files where its new details put them"));
  if (description && description !== print.notes) {
    await forgetAiDescription(print.id).catch(didNot("forget its AI description"));
    await pruneDescriptionImages(print.id).catch(didNot("remove its old description's images"));
    await localizeDescriptionImages(print.id).catch(didNot("store its description's images"));
  }
  await bringPictures(print, meta).catch(didNot("bring its pictures"));
  const mapped = await resolveCategoryIdByCategory(userId, meta.categorySite, meta.siteCategoryIds).catch(() => null);
  if (mapped) await suggestMappedCategory(print, mapped, source.provider).catch(didNot("suggest its category"));

  const after = await prisma.print.findUniqueOrThrow({ where: { id: print.id }, include: { previewImages: true } });
  await prisma.print
    .update({ where: { id: print.id }, data: { unfillableGaps: emptyGaps(after, after.previewImages) } })
    .catch(didNot("record what its source has nothing for"));
  void createLog({
    userId,
    action: "model_linked",
    targetId: print.id,
    details: { name: after.name, source_url: buildImportSourceUrl(source.provider, source.externalId) },
  });
}
