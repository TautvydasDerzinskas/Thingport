import fs from "node:fs";
import type { Author, Collection, Category, ImportJob, Notification, Plate, PreviewImage, Print, PrintFile, User } from "@prisma/client";
import { plateThumbExists, plateThumbPath } from "./services/printService";
import { previewImageExists, previewImagePath } from "./services/previewImageService";
import { preparedFilename } from "./services/preparedPrint";
import { modelPreviewGlbExists, modelPreviewGlbPath } from "./services/modelPreviewCache";
import { buildImportSourceUrl } from "./services/importService";

export type UserOut = {
  id: string;
  email: string;
  display_name: string;
  role: "ADMIN" | "MEMBER";
  // Set while an email change is awaiting confirmation (see routes/auth.ts's PATCH /profile).
  pending_email: string | null;
  // Populated by linking an imported Author to this account (see authorService.ts's
  // linkAuthorToUser) -- shown on this user's own "My models" author page.
  bio: string | null;
  background_url: string | null;
};

export function toUserOut(user: User): UserOut {
  return {
    id: user.id,
    email: user.email,
    display_name: user.displayName,
    role: user.role,
    pending_email: user.pendingEmail,
    bio: user.bio,
    background_url: user.backgroundUrl,
  };
}

export type AuthorOut = {
  id: string;
  provider: string;
  external_id: string;
  name: string | null;
  handle: string | null;
  bio: string | null;
  bio_translated: string | null;
  links: string[];
  avatar_url: string | null;
  background_url: string | null;
  // Whether ANY Thingport account has claimed this author as themselves (see authorService.ts's
  // isAuthorLinked) -- doesn't say *who*, just whether the Author page's "It's me!" button should
  // stay hidden. Defaults to false wherever a caller doesn't look it up (e.g. every Author
  // embedded in a Print DTO) -- only the standalone GET /author/:id route computes it for real.
  is_linked: boolean;
};

export function toAuthorOut(author: Author, isLinked = false): AuthorOut {
  return {
    id: author.id,
    provider: author.provider,
    external_id: author.externalId,
    name: author.name,
    handle: author.handle,
    bio: author.bio,
    bio_translated: author.bioTranslated,
    links: author.links,
    avatar_url: author.avatarUrl,
    background_url: author.backgroundUrl,
    is_linked: isLinked,
  };
}

export type PreparedPrintOut = {
  printer?: string | null;
  material?: string | null;
  nozzle_mm?: number | null;
  layer_height_mm?: number | null;
  estimated_seconds?: number | null;
  format?: string | null;
  removable: boolean;
};

export type PlateOut = {
  id: string;
  print_id: string;
  position: number;
  filename: string;
  mime: string;
  size: number;
  url: string;
  thumb_url: string | null;
  /** Cached pre-rendered GLB for the interactive 3D preview (see services/modelPreviewCache.ts)
   *  -- null until background generation finishes (or for non-3MF plates, which never get one).
   *  The viewer falls back to its live client-side parser whenever this is null. */
  preview_glb_url: string | null;
};

export type PrintFileOut = {
  id: string;
  filename: string;
  mime: string;
  size: number;
  url: string;
};

export type PreviewImageOut = {
  id: string;
  position: number;
  url: string;
};

export type PrintOut = {
  id: string;
  name: string;
  title: string | null;
  notes: string | null;
  creator: string | null;
  author: AuthorOut | null;
  collection: string | null;
  tags: string[];
  category_id: string | null;
  // Only populated by the single-print detail fetch (printOutById) -- see toPrintOut's `category`
  // param. Null both when there's no category and when the caller didn't load one (list endpoints
  // skip the extra join since nothing there renders it).
  category_name: string | null;
  created_at: string;
  storage_path: string | null;
  plates: PlateOut[];
  preview_images: PreviewImageOut[];
  thumb_url: string | null;
  supporting_file_count: number;
  prepared_print: PreparedPrintOut | null;
  slicer_url: string | null;
  slicer_filename: string | null;
  view_count: number;
  print_count: number;
  is_favorite: boolean;
  // Null for uploads, zip/folder-scan imports, and anything not resolvable to a known provider
  // -- see importService.ts's identifySourceModel/buildImportSourceUrl. source_url is the
  // reconstructed original model page, for an "Open in {Provider}" link.
  source_provider: string | null;
  source_url: string | null;
};

export type CategoryOut = {
  id: string;
  name: string;
  tags: string[];
  parent_id: string | null;
  position: number;
  meta_title: string | null;
  meta_description: string | null;
  // Semicolon-separated, e.g. "800;71;1001" -- same format the category manager dialog reads
  // and writes (see routes/categories.ts's parseCatIdsInput), so the frontend can bind the field
  // straight to a text input with no extra parsing. Empty string when none are set.
  makerworld_cat_ids: string;
  thingiverse_cat_ids: string;
  printables_cat_ids: string;
};

function plateThumbUrl(plateId: string): string | null {
  if (!plateThumbExists(plateId)) return null;
  const mtime = fs.statSync(plateThumbPath(plateId)).mtimeMs;
  return `/plate/${plateId}/thumb.jpg?v=${mtime}`;
}

function previewGlbUrl(plateId: string): string | null {
  if (!modelPreviewGlbExists(plateId)) return null;
  const mtime = fs.statSync(modelPreviewGlbPath(plateId)).mtimeMs;
  return `/plate/${plateId}/preview.glb?v=${mtime}`;
}

export function toPlateOut(printId: string, plate: Plate): PlateOut {
  return {
    id: plate.id,
    print_id: printId,
    position: plate.position,
    filename: plate.filename,
    mime: plate.mime,
    size: plate.size,
    url: `/print/${printId}/plate/${plate.id}/file/${encodeURIComponent(plate.filename)}`,
    thumb_url: plateThumbUrl(plate.id),
    preview_glb_url: previewGlbUrl(plate.id),
  };
}

function previewImageUrl(id: string): string | null {
  if (!previewImageExists(id)) return null;
  const mtime = fs.statSync(previewImagePath(id)).mtimeMs;
  return `/preview-image/${id}/file.jpg?v=${mtime}`;
}

export function toPreviewImageOut(image: PreviewImage): PreviewImageOut | null {
  const url = previewImageUrl(image.id);
  if (!url) return null;
  return { id: image.id, position: image.position, url };
}

export function toPrintFileOut(printFile: PrintFile): PrintFileOut {
  return {
    id: printFile.id,
    filename: printFile.filename,
    mime: printFile.mime,
    size: printFile.size,
    url: `/print/${printFile.printId}/files/${printFile.id}`,
  };
}

function storageParentDir(plates: Plate[]): string | null {
  if (!plates.length) return null;
  const parts = plates[0].storagePath.split("/");
  parts.pop();
  return parts.join("/") || null;
}

/**
 * Builds the full Print DTO. `plates` must already be sorted by position ascending.
 * `files` is every PrintFile (supporting + prepared) belonging to this print.
 * `preparedFile` is the print's explicit prepared PrintFile row, if any (preparedFileId).
 * `previewImages` must already be sorted by position ascending; position 0 is the default/main
 * gallery image shown on the model detail page.
 */
export function toPrintOut(
  print: Print,
  plates: Plate[],
  files: PrintFile[],
  preparedFile: PrintFile | null,
  author?: Author | null,
  previewImages: PreviewImage[] = [],
  category?: Category | null,
): PrintOut {
  const sortedPlates = plates.toSorted((a, b) => a.position - b.position);
  const plateOuts = sortedPlates.map((p) => toPlateOut(print.id, p));
  const supportingCount = files.filter((f) => f.role === "SUPPORTING").length;
  const previewImageOuts = previewImages
    .toSorted((a, b) => a.position - b.position)
    .map(toPreviewImageOut)
    .filter((img): img is PreviewImageOut => img !== null);

  let prepared: PreparedPrintOut | null = null;
  let slicerUrl: string | null = null;
  let slicerFilename: string | null = null;

  if (preparedFile) {
    const meta = (preparedFile.metadata as Record<string, unknown> | null) || {};
    prepared = {
      printer: (meta.printer as string | null) ?? null,
      material: (meta.material as string | null) ?? null,
      nozzle_mm: (meta.nozzle_mm as number | null) ?? null,
      layer_height_mm: (meta.layer_height_mm as number | null) ?? null,
      estimated_seconds: (meta.estimated_seconds as number | null) ?? null,
      format: (meta.format as string | null) ?? null,
      removable: true,
    };
    slicerUrl = `/print/${print.id}/prepared-print`;
    slicerFilename = preparedFile.filename;
  } else if (print.preparedMetadata) {
    const meta = print.preparedMetadata as Record<string, unknown>;
    prepared = {
      printer: (meta.printer as string | null) ?? null,
      material: (meta.material as string | null) ?? null,
      nozzle_mm: (meta.nozzle_mm as number | null) ?? null,
      layer_height_mm: (meta.layer_height_mm as number | null) ?? null,
      estimated_seconds: (meta.estimated_seconds as number | null) ?? null,
      format: (meta.format as string | null) ?? null,
      removable: false,
    };
    slicerUrl = plateOuts[0]?.url ?? null;
    slicerFilename = preparedFilename(print.name, { format: meta.format as string });
  } else {
    slicerUrl = plateOuts[0]?.url ?? null;
    slicerFilename = sortedPlates[0]?.filename ?? null;
  }

  return {
    id: print.id,
    name: print.name,
    title: print.title,
    notes: print.notes,
    creator: print.creator,
    author: author ? toAuthorOut(author) : null,
    collection: print.collection,
    tags: print.tags,
    category_id: print.categoryId,
    category_name: category?.name ?? null,
    created_at: print.createdAt.toISOString(),
    storage_path: storageParentDir(sortedPlates),
    plates: plateOuts,
    preview_images: previewImageOuts,
    thumb_url: plateOuts[0]?.thumb_url ?? null,
    supporting_file_count: supportingCount,
    prepared_print: prepared,
    slicer_url: slicerUrl,
    slicer_filename: slicerFilename,
    view_count: print.viewCount,
    print_count: print.printCount,
    is_favorite: print.favoritedAt !== null,
    source_provider: print.sourceProvider,
    source_url: buildImportSourceUrl(print.sourceProvider, print.sourceExternalId),
  };
}

export type SystemCollectionKey = "favorites" | "history";

export type CollectionOut = {
  id: string;
  name: string;
  description: string | null;
  tags: string[];
  item_count: number;
  cover_items: PrintOut[];
  created_at: string;
  /** Set only for the two built-in "Favourites"/"Browsing History" pseudo-collections (see
   * collectionService.ts's SYSTEM_COLLECTIONS) -- the frontend uses this to pick a translated
   * display name instead of `name`, and to hide the edit/delete actions those can't support. */
  system_key: SystemCollectionKey | null;
  /** Whether this user has bookmarked this collection (see services/bookmarkService.ts) -- backs
   * the Collections grid card's "..." menu and the collection detail page's title-row toggle.
   * Always false for a system pseudo-collection: there's no real Collection row for a Bookmark to
   * point at, so those can't be bookmarked (the frontend hides the toggle for them entirely). */
  bookmarked: boolean;
};

/** `coverPrints` should already be the up-to-4 cover PrintOuts (see collections.ts), ordered by
 * the collection's item position ascending. */
export function toCollectionOut(
  collection: Collection,
  itemCount: number,
  coverPrints: PrintOut[],
  bookmarked: boolean,
): CollectionOut {
  return {
    id: collection.id,
    name: collection.name,
    description: collection.description,
    tags: collection.tags,
    item_count: itemCount,
    cover_items: coverPrints,
    created_at: collection.createdAt.toISOString(),
    system_key: null,
    bookmarked,
  };
}

/** Builds the CollectionOut for a built-in pseudo-collection -- there's no backing Collection
 * row, so this is assembled directly from the id/key plus the caller's computed item_count and
 * cover prints rather than going through toCollectionOut. `name` is an untranslated fallback
 * only; the frontend always prefers a translated label keyed off `system_key`. */
export function toSystemCollectionOut(
  id: string,
  key: SystemCollectionKey,
  name: string,
  itemCount: number,
  coverPrints: PrintOut[],
): CollectionOut {
  return {
    id,
    name,
    description: null,
    tags: [],
    item_count: itemCount,
    cover_items: coverPrints,
    created_at: new Date(0).toISOString(),
    system_key: key,
    bookmarked: false,
  };
}

function formatCatIds(ids: number[]): string {
  return ids.join(";");
}

export function toCategoryOut(category: Category): CategoryOut {
  return {
    id: category.id,
    name: category.name,
    tags: category.tags,
    parent_id: category.parentId,
    position: category.position,
    meta_title: category.metaTitle,
    meta_description: category.metaDescription,
    makerworld_cat_ids: formatCatIds(category.makerworldCatIds),
    thingiverse_cat_ids: formatCatIds(category.thingiverseCatIds),
    printables_cat_ids: formatCatIds(category.printablesCatIds),
  };
}

export type ImportJobOut = {
  id: string;
  type: "COLLECTION" | "ZIP";
  status: "RUNNING" | "DONE" | "ERROR";
  source_url: string;
  source_label: string | null;
  provider: string | null;
  total: number;
  processed: number;
  imported: number;
  already_in_library: number;
  failed_count: number;
  error_message: string | null;
  result_collection_id: string | null;
  // Set whenever this job finished having created exactly one Print, whatever its type -- see
  // importJobRunner.ts. Lets the frontend redirect straight into that print's details page instead
  // of the models grid.
  result_print_id: string | null;
};

export function toImportJobOut(job: ImportJob): ImportJobOut {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    source_url: job.sourceUrl,
    source_label: job.sourceLabel,
    provider: job.provider,
    total: job.total,
    processed: job.processed,
    imported: job.imported,
    already_in_library: job.alreadyInLibrary,
    failed_count: job.failedCount,
    error_message: job.errorMessage,
    result_collection_id: job.resultCollectionId,
    result_print_id: job.resultPrintId,
  };
}

export type NotificationOut = {
  id: string;
  title: string;
  body: string | null;
  external_url: string | null;
  internal_path: string | null;
  read: boolean;
  created_at: string;
};

export function toNotificationOut(notification: Notification): NotificationOut {
  return {
    id: notification.id,
    title: notification.title,
    body: notification.body,
    external_url: notification.externalUrl,
    internal_path: notification.internalPath,
    read: notification.readAt !== null,
    created_at: notification.createdAt.toISOString(),
  };
}
