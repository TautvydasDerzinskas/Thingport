import fs from "node:fs";
import { nextSyncAt, syncNowAvailableAt } from "./services/collectionSyncSchedule";
import type {
  CollectionSync,
  Author,
  Collection,
  Category,
  ImportJob,
  ImportJobItem,
  Notification,
  Plate,
  PreviewImage,
  Print,
  PrintFile,
  User,
} from "@prisma/client";
import type { AssetHome } from "./services/modelAssets";
import { plateThumbPath } from "./services/printService";
import { previewImagePath } from "./services/previewImageService";
import { preparedFilename } from "./services/preparedPrint";
import {
  canRenderModelImage,
  modelImagePath,
  modelPreviewGlbExists,
  modelPreviewGlbPath,
} from "./services/modelPreviewCache";
import { buildImportSourceUrl } from "./services/importService";
import { openSourceGaps, type SourceGap } from "./services/sourceGaps";
import { parseQueuedLinkOptions } from "./services/importJobRunner";
import type { QueueJobRow } from "./services/importQueueService";

export type UserOut = {
  id: string;
  email: string;
  display_name: string;
  role: "ADMIN" | "MEMBER";
  pending_email: string | null;
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
  // Whether any account has claimed this author. Only GET /author/:id computes it; false elsewhere.
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
  /** The thumb is our own render, not a picture from an import or upload. */
  thumb_generated: boolean;
  /** Null until generated, and always for non-3MF plates; the viewer then parses the file itself. */
  preview_glb_url: string | null;
  /** The server's grey render for model cards to tint; unversioned until it exists (asking for it queues it), null for
   *  files the server can't draw. */
  render_url: string | null;
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
  /** Our own render, not a picture from an import or upload. */
  generated: boolean;
};

export type PrintOut = {
  id: string;
  name: string;
  title: string | null;
  notes: string | null;
  creator: string | null;
  author: AuthorOut | null;
  tags: string[];
  category_id: string | null;
  // Only populated by the detail fetch; list endpoints skip the join.
  category_name: string | null;
  category_source: "manual" | "rule" | "ai" | "legacy" | null;
  category_kind: "category" | "folder" | null;
  /** Improved descriptions on the detail page only, while the feature is on: a rewrite to review, and the
   *  description from before one was applied, to compare or revert to. */
  ai_description_suggestion: { notes: string; created_at: string } | null;
  /** The description is an AI rewrite (accepted, or applied in auto mode) not since edited or reverted. Sent
   *  whether or not the feature is on, so the model page can always say so. */
  description_by_ai: boolean;
  /** A suggested description awaits review; sent on every model, so a card's menu can wait for it too. */
  ai_description_pending: boolean;
  ai_description_original: string | null;
  ai_suggestion: {
    category_id: string;
    category_path: string;
    confidence: number;
    reason: string;
    model: string;
    created_at: string;
  } | null;
  created_at: string;
  storage_path: string | null;
  plates: PlateOut[];
  preview_images: PreviewImageOut[];
  thumb_url: string | null;
  thumb_generated: boolean;
  render_url: string | null;
  supporting_file_count: number;
  /** All plates plus supporting and prepared files; gallery images aren't counted. */
  total_size: number;
  prepared_print: PreparedPrintOut | null;
  slicer_url: string | null;
  slicer_filename: string | null;
  view_count: number;
  print_count: number;
  is_favorite: boolean;
  // source_url is the reconstructed original model page.
  source_provider: string | null;
  source_url: string | null;
  /** What "Fetch missing details" could still fill. Null where the preview images weren't
   *  loaded (list endpoints), since an images gap can't be told without them. */
  source_gaps: SourceGap[] | null;
};

export type CategoryOut = {
  id: string;
  name: string;
  tags: string[];
  parent_id: string | null;
  kind: string;
  position: number;
  meta_title: string | null;
  meta_description: string | null;
  // Semicolon-separated, e.g. "800;71;1001"; empty when none.
  makerworld_cat_ids: string;
  thingiverse_cat_ids: string;
  printables_cat_ids: string;
  myminifactory_cat_ids: string;
  snapmaker_cat_ids: string;
  makeronline_cat_ids: string;
  crealitycloud_cat_ids: string;
  nexprint_cat_ids: string;
  thangs_cat_ids: string;
  cults3d_cat_ids: string;
};

/** `url` versioned by the file's mtime; null when it isn't there. One stat, as a storage move can take the file
 *  away between an existence check and a second look. */
function versionedUrl(file: string, url: string): string | null {
  try {
    return `${url}?v=${fs.statSync(file).mtimeMs}`;
  } catch {
    return null;
  }
}

/** `home`, here and below, is the model's Print.assetsPath. */
export function plateThumbUrl(plateId: string, home: AssetHome): string | null {
  return versionedUrl(plateThumbPath(plateId, home), `/plate/${plateId}/thumb.jpg`);
}

function previewGlbUrl(plate: Plate): string | null {
  if (!modelPreviewGlbExists(plate.id)) {
    // Hand out the URL even with no cache yet: requesting it is what triggers generation.
    return plate.filename.toLowerCase().endsWith(".3mf") ? `/plate/${plate.id}/preview.glb` : null;
  }
  const mtime = fs.statSync(modelPreviewGlbPath(plate.id)).mtimeMs;
  return `/plate/${plate.id}/preview.glb?v=${mtime}`;
}

/** The plate's grey render for the browser to tint; unversioned until it exists, as asking for it queues it. */
export function renderUrl(plate: { id: string; filename: string }, home: AssetHome): string | null {
  if (!canRenderModelImage(plate.filename)) return null;
  const url = `/plate/${plate.id}/render.png`;
  return versionedUrl(modelImagePath(plate.id, home, "render"), url) ?? url;
}

export function toPlateOut(printId: string, plate: Plate, home: AssetHome): PlateOut {
  return {
    id: plate.id,
    print_id: printId,
    position: plate.position,
    filename: plate.filename,
    mime: plate.mime,
    size: plate.size,
    url: `/print/${printId}/plate/${plate.id}/file/${encodeURIComponent(plate.filename)}`,
    thumb_url: plateThumbUrl(plate.id, home),
    thumb_generated: plate.thumbGenerated,
    preview_glb_url: previewGlbUrl(plate),
    render_url: renderUrl(plate, home),
  };
}

/** A model's picture for a mosaic: its first image, else its first plate's render; null with neither on disk.
 *  `url` carries the file's mtime, so it changes whenever the picture does. */
export function printCover(
  previewImageId: string | null,
  plateId: string | null,
  home: AssetHome,
): { url: string; file: string } | null {
  const image = previewImageId && previewImageUrl(previewImageId, home);
  if (image) return { url: image, file: previewImagePath(previewImageId, home) };
  const plate = plateId && plateThumbUrl(plateId, home);
  if (plate) return { url: plate, file: plateThumbPath(plateId, home) };
  return null;
}

function previewImageUrl(id: string, home: AssetHome): string | null {
  return versionedUrl(previewImagePath(id, home), `/preview-image/${id}/file.jpg`);
}

export function toPreviewImageOut(image: PreviewImage, home: AssetHome): PreviewImageOut | null {
  const url = previewImageUrl(image.id, home);
  if (!url) return null;
  return { id: image.id, position: image.position, url, generated: image.generated };
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
 * `plates` and `previewImages` must be sorted by position ascending.
 */
export function toPrintOut(
  print: Print,
  plates: Plate[],
  files: PrintFile[],
  preparedFile: PrintFile | null,
  author?: Author | null,
  previewImages?: PreviewImage[],
  category?: Category | null,
  aiSuggestion?: PrintOut["ai_suggestion"],
  aiDescription?: Pick<PrintOut, "ai_description_suggestion" | "ai_description_original">,
): PrintOut {
  const sortedPlates = plates.toSorted((a, b) => a.position - b.position);
  const plateOuts = sortedPlates.map((p) => toPlateOut(print.id, p, print.assetsPath));
  const supportingCount = files.filter((f) => f.role === "SUPPORTING").length;
  const totalSize = plates.reduce((sum, p) => sum + p.size, 0) + files.reduce((sum, f) => sum + f.size, 0);
  const previewImageOuts = (previewImages ?? [])
    .toSorted((a, b) => a.position - b.position)
    .map((image) => toPreviewImageOut(image, print.assetsPath))
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
    tags: print.tags,
    category_id: print.categoryId,
    category_name: category?.name ?? null,
    category_source: print.categorySource ? (print.categorySource.toLowerCase() as PrintOut["category_source"]) : null,
    category_kind: category ? (category.kind as PrintOut["category_kind"]) : null,
    ai_suggestion: aiSuggestion ?? null,
    ai_description_suggestion: aiDescription?.ai_description_suggestion ?? null,
    // The original is kept exactly while the description is the AI's.
    description_by_ai: print.aiDescriptionOriginal !== null,
    ai_description_pending: print.aiDescriptionSuggestion !== null,
    ai_description_original: aiDescription?.ai_description_original ?? null,
    created_at: print.createdAt.toISOString(),
    storage_path: storageParentDir(sortedPlates),
    plates: plateOuts,
    preview_images: previewImageOuts,
    thumb_url: plateOuts[0]?.thumb_url ?? null,
    thumb_generated: plateOuts[0]?.thumb_generated ?? false,
    // The first file the server can draw: a STEP first plate mustn't leave the card without one.
    render_url: plateOuts.find((plate) => plate.render_url)?.render_url ?? null,
    supporting_file_count: supportingCount,
    total_size: totalSize,
    prepared_print: prepared,
    slicer_url: slicerUrl,
    slicer_filename: slicerFilename,
    view_count: print.viewCount,
    print_count: print.printCount,
    is_favorite: print.favoritedAt !== null,
    source_provider: print.sourceProvider,
    source_url: buildImportSourceUrl(print.sourceProvider, print.sourceExternalId),
    source_gaps: previewImages ? openSourceGaps(print, previewImages) : null,
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
  /** Set only for the built-in pseudo-collections, which get a translated name and no edit/delete. */
  system_key: SystemCollectionKey | null;
  /** Always false for a system pseudo-collection, which can't be bookmarked. */
  bookmarked: boolean;
  /** Set while the collection is synced with one on a provider. */
  sync: CollectionSyncOut | null;
};

export type SyncProfileScope = "url" | "designer" | "all";

export type CollectionSyncOut = {
  provider: string;
  source_url: string;
  profile_scope: SyncProfileScope;
  last_checked_at: string | null;
  last_error: string | null;
  /** Set when the sync follows a user's likes (on Thingiverse, or the user's own on Printables)
   *  rather than a collection: their username. */
  likes_of: string | null;
  /** How often the provider's collection is checked: 1, 6 or 24. */
  interval_hours: number;
  /** Roughly when it's next checked; null with scheduled sync off. */
  next_sync_at: string | null;
  /** When "Sync now" can be used again; null when it can be now. */
  sync_now_at: string | null;
};

// A Likes sync's externalId; collection ids are numeric, so the two never collide.
export const LIKES_ID_PREFIX = "likes:";

/** The user whose likes a sync follows (on Thingiverse, Printables or Cults3D), as written in its page
 *  address, or null for a collection sync. */
export function syncLikesUsername(sync: { externalId: string; sourceUrl: string }): string | null {
  if (!sync.externalId.startsWith(LIKES_ID_PREFIX)) return null;
  const parts = new URL(sync.sourceUrl).pathname.split("/").filter(Boolean);
  // Printables writes its profile paths as "/@handle"; Cults3D's are "/en/users/<nick>/likes".
  const fromUrl = (/^[a-z]{2}$/.test(parts[0] ?? "") && parts.length === 4 ? parts[2] : parts[0])?.replace(/^@/, "");
  return fromUrl ? decodeURIComponent(fromUrl) : sync.externalId.slice(LIKES_ID_PREFIX.length);
}

export function toCollectionSyncOut(sync: CollectionSync): CollectionSyncOut {
  const syncNowAt = syncNowAvailableAt(sync.lastCheckedAt);
  return {
    provider: sync.provider,
    source_url: sync.sourceUrl,
    profile_scope: sync.profileScope as SyncProfileScope,
    last_checked_at: sync.lastCheckedAt?.toISOString() ?? null,
    last_error: sync.lastError,
    likes_of: syncLikesUsername(sync),
    interval_hours: sync.intervalHours,
    next_sync_at: nextSyncAt(sync)?.toISOString() ?? null,
    sync_now_at: syncNowAt && syncNowAt.getTime() > Date.now() ? syncNowAt.toISOString() : null,
  };
}

/** `coverPrints`: up to 4, in item position order. */
export function toCollectionOut(
  collection: Collection,
  itemCount: number,
  coverPrints: PrintOut[],
  bookmarked: boolean,
  sync: CollectionSync | null = null,
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
    sync: sync ? toCollectionSyncOut(sync) : null,
  };
}

/** `name` is an untranslated fallback; the frontend translates via `system_key`. */
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
    sync: null,
  };
}

function formatCatIds(ids: (number | string)[]): string {
  return ids.join(";");
}

export function toCategoryOut(category: Category): CategoryOut {
  return {
    id: category.id,
    name: category.name,
    tags: category.tags,
    parent_id: category.parentId,
    kind: category.kind,
    position: category.position,
    meta_title: category.metaTitle,
    meta_description: category.metaDescription,
    makerworld_cat_ids: formatCatIds(category.makerworldCatIds),
    thingiverse_cat_ids: formatCatIds(category.thingiverseCatIds),
    printables_cat_ids: formatCatIds(category.printablesCatIds),
    myminifactory_cat_ids: formatCatIds(category.myminifactoryCatIds),
    snapmaker_cat_ids: formatCatIds(category.snapmakerCatIds),
    makeronline_cat_ids: formatCatIds(category.makeronlineCatIds),
    crealitycloud_cat_ids: formatCatIds(category.crealitycloudCatIds),
    nexprint_cat_ids: formatCatIds(category.nexprintCatIds),
    thangs_cat_ids: formatCatIds(category.thangsCatIds),
    cults3d_cat_ids: formatCatIds(category.cults3dCatIds),
  };
}

export type ImportJobOut = {
  id: string;
  type: "COLLECTION" | "ZIP" | "PROFILES" | "LINKS";
  status: "RUNNING" | "DONE" | "ERROR" | "PAUSED";
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
  result_print_id: string | null;
};

/** The queue's per-link state, so the progress bar can show what's importing and what failed. */
export type ImportJobItemOut = {
  id: string;
  url: string;
  status: "PENDING" | "RUNNING" | "DONE" | "FAILED";
  attempts: number;
  error_message: string | null;
  /** Page title, collection and profile scope of a link sent from the extension's queue. */
  title: string | null;
  collection_id: string | null;
  scope: "url" | "designer" | "all" | null;
};

export function toImportJobItemOut(item: ImportJobItem): ImportJobItemOut {
  const options = parseQueuedLinkOptions(item.payload);
  return {
    id: item.id,
    url: item.url,
    status: item.status,
    attempts: item.attempts,
    error_message: item.errorMessage,
    title: options.title ?? null,
    collection_id: options.collection_id ?? null,
    scope: options.scope ?? null,
  };
}

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

/** A row of the admin import queue: any user's job, with its links counted by status. */
export type AdminImportJobOut = ImportJobOut & {
  owner: { id: string; display_name: string; email: string };
  pending_count: number;
  running_count: number;
  done_count: number;
  failed_items_count: number;
  /** False on a RUNNING job means its runner is gone (a restart): pause it, then start it again. */
  runner_live: boolean;
  created_at: string;
  updated_at: string;
};

export function toAdminImportJobOut(row: QueueJobRow): AdminImportJobOut {
  return {
    ...toImportJobOut(row),
    owner: { id: row.user.id, display_name: row.user.displayName, email: row.user.email },
    pending_count: row.counts.pending,
    running_count: row.counts.running,
    done_count: row.counts.done,
    failed_items_count: row.counts.failed,
    runner_live: row.runnerLive,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

export type NotificationOut = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  external_url: string | null;
  internal_path: string | null;
  read: boolean;
  read_at: string | null;
  created_at: string;
};

export function toNotificationOut(notification: Notification): NotificationOut {
  return {
    id: notification.id,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    external_url: notification.externalUrl,
    internal_path: notification.internalPath,
    read: notification.readAt !== null,
    read_at: notification.readAt?.toISOString() ?? null,
    created_at: notification.createdAt.toISOString(),
  };
}
