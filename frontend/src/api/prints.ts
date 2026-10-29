import { appendTokenToUrl, authHeaders, readToken } from "../utils/auth";
import { apiBase, assertOk, readErrorMessage, LastPlateError, UnauthorizedError } from "./client";

export type PreparedPrint = {
  printer?: string | null;
  material?: string | null;
  nozzle_mm?: number | null;
  layer_height_mm?: number | null;
  estimated_seconds?: number | null;
  format?: string | null; // "gcode" | "bgcode" | "gcode_3mf"
  removable: boolean;
};

export type Plate = {
  id: string;
  print_id: string;
  position: number; // dense, 0-based, ordered
  filename: string;
  mime: string;
  size: number;
  url: string; // /print/{printId}/plate/{plateId}/file/{filename}
  thumb_url?: string | null; // /plate/{plateId}/thumb.jpg?v=... if a thumb exists
  thumb_generated?: boolean; // the thumb is our own render, not a picture from an import or upload
  preview_glb_url?: string | null; // /plate/{plateId}/preview.glb?v=... once background pre-render finishes
  render_url?: string | null; // /plate/{plateId}/render.png[?v=...]: grey shading for cards to tint; null if undrawable
};

export type PrintFile = {
  id: string;
  filename: string;
  mime: string;
  size: number;
  url: string; // /print/{printId}/files/{fileId}
};

export type PreviewImage = {
  id: string;
  position: number; // dense, 0-based, ordered; 0 is the default/main image
  url: string; // /preview-image/{id}/file.jpg?v=...
  generated?: boolean; // our own render, not a picture from an import or upload
};

export type Author = {
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
  // Always false on an Author embedded in a Print; only the author endpoints compute it.
  is_linked: boolean;
};

export type Print = {
  id: string;
  /** Set on a model a tool brought: it can be opened, downloaded and printed, not edited or deleted. */
  tool_id?: string | null;
  name: string;
  title?: string | null;
  notes?: string | null;
  creator?: string | null;
  author?: Author | null;
  tags: string[];
  category_id?: string | null;
  category_name?: string | null;
  category_source?: "manual" | "rule" | "ai" | "legacy" | null;
  category_kind?: "category" | "folder" | null;
  /** Improved descriptions, on the detail page while the feature is on: a rewrite to review, and the description
   *  from before one was applied. */
  ai_description_suggestion?: { notes: string; created_at: string } | null;
  ai_description_original?: string | null;
  /** The description is an AI rewrite, not since edited or reverted; sent whether or not the feature is on. */
  description_by_ai?: boolean;
  /** A suggested description awaits review; on every model, unlike the suggestion itself. */
  ai_description_pending?: boolean;
  ai_suggestion?: {
    category_id: string;
    category_path: string;
    confidence: number;
    reason: string;
    model: string;
    created_at: string;
  } | null;
  created_at: string;
  storage_path?: string | null;
  plates: Plate[]; // ordered by position, length >= 1
  preview_images: PreviewImage[]; // ordered by position; [0] is the default/main gallery image
  thumb_url?: string | null; // denormalized = plates[0].thumb_url
  thumb_generated?: boolean; // denormalized = plates[0].thumb_generated
  render_url?: string | null; // the first plate's render_url that isn't null
  supporting_file_count: number;
  /** The scripts it can be generated again from, out of the files kept beside it; empty for an ordinary model. */
  generator_scripts?: { id: string; filename: string }[];
  /** The source had a script for it but its creator chose not to share it: there is none to open, and that is
   *  why, which a model that simply never had one wouldn't explain. */
  generator_script_withheld?: boolean;
  // Optional: an older backend (published separately) doesn't send it.
  total_size?: number;
  prepared_print?: PreparedPrint | null;
  slicer_url?: string | null;
  slicer_filename?: string | null;
  view_count: number;
  print_count: number;
  is_favorite: boolean;
  source_provider?: string | null;
  source_url?: string | null;
  /** Null from list endpoints, which can't tell an images gap. */
  source_gaps?: SourceGap[] | null;
};

export type ListPrintsResult = {
  items: Print[];
  hasMore: boolean;
  nextOffset?: number;
  /** Only sent when `limit` is. */
  total?: number;
};

export type UploadPrintsResult = {
  prints: Print[];
};

/** What "Fetch missing details" can fill from a model's source. */
export type SourceGap = "title" | "description" | "tags" | "creator" | "author" | "category" | "images";

export type FillGapsResult = {
  source_url: string;
  filled: SourceGap[];
  /** Still empty because the source has nothing for them either. */
  remaining: SourceGap[];
};

/** "relevance" ranks by how well a model matches `q`, as the search palette does. */
export type PrintSortMode = "newest" | "popular" | "downloads" | "relevance";

/** A site the library's models came from; `provider` is "thingport" for the ones uploaded here. */
export type PrintSource = { provider: string; model_count: number };

export class PrintApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
    this.name = "PrintApiError";
  }
}

/** Filters combine with AND. */
export type DownloadZipFilter = {
  print_ids?: string[];
  tag?: string;
  category_id?: string;
  collection_id?: string;
};

export type DownloadZipSummary = {
  count: number;
  size_bytes: number;
};

/** The most ids one bulk request (delete, favourite, an AI run) accepts. */
export const BULK_LIMIT = 500;

function bulkChunks(ids: string[]): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += BULK_LIMIT) chunks.push(ids.slice(i, i + BULK_LIMIT));
  return chunks;
}

export type QualityIssueCode =
  | "unreadable"
  | "empty"
  | "missingParts"
  | "openEdges"
  | "nonManifoldEdges"
  | "flippedFaces"
  | "insideOut"
  | "fragments"
  | "tooSmall"
  | "tooLarge";
/** Critical: the print fails or comes out incomplete. Major: likely defects. Minor: slicers usually cope. */
export type QualitySeverity = "critical" | "major" | "minor";
export type QualityIssue = { code: QualityIssueCode; severity: QualitySeverity; count?: number };
export type FileQualityStatus = "unchecked" | "checking" | "good" | "issues" | "skipped";
export type FileQuality = {
  plate_id: string;
  filename: string;
  status: FileQualityStatus;
  issues: QualityIssue[];
  triangles: number | null;
  shells: number | null;
  size: [number, number, number] | null;
};
export type PrintQuality = {
  enabled: boolean;
  /** The most pressing file's state; "none" when the model has no file the check reads. */
  status: FileQualityStatus | "none";
  files: FileQuality[];
};

export const printsApi = {
  fileUrl: (rel: string) => {
    if (!rel) return rel;
    return appendTokenToUrl(`${apiBase()}${rel}`);
  },

  /** An absolute file URL for a slicer to download, with the session in the path rather than `?token=`: OrcaSlicer
   *  and its forks name the file after everything past the last slash, query string included. */
  slicerFileUrl: (rel: string) => {
    const token = readToken();
    const path = token ? `${apiBase()}/t/${encodeURIComponent(token)}${rel}` : `${apiBase()}${rel}`;
    return new URL(path, window.location.origin).toString();
  },

  list: async (
    params: {
      q?: string;
      tags?: string[];
      category_id?: string | string[];
      collection_id?: string;
      author_id?: string;
      /** Only the models that came with a script they can be generated from again. */
      generative?: boolean;
      /** Sites to leave out, by provider id ("thingport" for the ones uploaded here). Named as what to hide, so a
       *  site the library gains later is listed from the start. */
      hide_providers?: string[];
      order_by?: PrintSortMode;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<ListPrintsResult> => {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.tags && params.tags.length) qs.set("tags", params.tags.join(","));
    if (params.generative) qs.set("generative", "1");
    if (params.hide_providers?.length) qs.set("hide_providers", params.hide_providers.join(","));
    if (params.category_id && params.category_id.length) {
      qs.set("category_id", Array.isArray(params.category_id) ? params.category_id.join(",") : params.category_id);
    }
    if (params.collection_id) qs.set("collection_id", params.collection_id);
    if (params.author_id) qs.set("author_id", params.author_id);
    if (params.order_by) qs.set("orderBy", params.order_by);
    if (typeof params.limit === "number") qs.set("limit", String(params.limit));
    if (typeof params.offset === "number") qs.set("offset", String(params.offset));
    const res = await fetch(`${apiBase()}/prints?${qs.toString()}`, {
      headers: authHeaders(),
    });
    assertOk(res, "Failed to list prints");
    const items = await res.json();
    const hasMore = (res.headers.get("X-Has-More") || "").toLowerCase() === "true";
    const nextOffsetRaw = res.headers.get("X-Next-Offset");
    const nextOffset = nextOffsetRaw ? Number(nextOffsetRaw) : undefined;
    const totalRaw = res.headers.get("X-Total-Count");
    const total = totalRaw ? Number(totalRaw) : undefined;
    return { items, hasMore, nextOffset, total };
  },

  /** The sites the library's models came from, most models first, for the listing's source filter. */
  sources: async (): Promise<PrintSource[]> => {
    const res = await fetch(`${apiBase()}/prints/sources`, { headers: authHeaders() });
    assertOk(res, "Failed to list sources");
    return res.json();
  },

  get: async (id: string): Promise<Print> => {
    const res = await fetch(`${apiBase()}/print/${id}`, { headers: authHeaders() });
    if (res.status === 401) throw new UnauthorizedError();
    assertOk(res, "Failed to load model");
    return res.json();
  },

  getQuality: async (id: string): Promise<PrintQuality> => {
    const res = await fetch(`${apiBase()}/print/${id}/quality`, { headers: authHeaders() });
    if (res.status === 401) throw new UnauthorizedError();
    assertOk(res, "Failed to load the quality check");
    return res.json();
  },

  /** Starts checking the files not checked yet; returns at once with them "checking". */
  startQuality: async (id: string): Promise<PrintQuality> => {
    const res = await fetch(`${apiBase()}/print/${id}/quality`, { method: "POST", headers: authHeaders() });
    if (res.status === 401) throw new UnauthorizedError();
    assertOk(res, "Failed to start the quality check");
    return res.json();
  },

  listTags: async (
    params: {
      q?: string;
      tags?: string[];
      category_id?: string;
    } = {},
  ): Promise<string[]> => {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.tags && params.tags.length) qs.set("tags", params.tags.join(","));
    if (params.category_id) qs.set("category_id", params.category_id);
    const res = await fetch(`${apiBase()}/tags?${qs.toString()}`, {
      headers: authHeaders(),
    });
    assertOk(res, "Failed to list tags");
    return res.json();
  },

  upload: async (
    files: File[],
    opts: {
      title?: string;
      notes?: string;
      tags?: string[];
      category_id?: string;
      mode?: "separate" | "multiplate";
      /** False for each request of a batch; the batch sends one summary (uploadSummary) instead. */
      notify?: boolean;
    } = {},
  ): Promise<UploadPrintsResult> => {
    const fd = new FormData();
    for (const file of files) {
      fd.append("files", file);
    }
    if (opts.title) fd.set("title", opts.title);
    if (opts.notes) fd.set("notes", opts.notes);
    if (opts.tags && opts.tags.length) fd.set("tags", opts.tags.join(","));
    if (opts.category_id) fd.set("category_id", opts.category_id);
    if (opts.mode && files.length > 1) fd.set("mode", opts.mode);
    if (opts.notify === false) fd.set("notify", "false");
    const res = await fetch(`${apiBase()}/upload`, {
      method: "POST",
      body: fd,
      headers: authHeaders(),
    });
    if (res.status === 401) {
      throw new UnauthorizedError();
    }
    if (!res.ok) {
      const message = await readErrorMessage(res, "Upload failed");
      throw new Error(message);
    }
    return res.json();
  },

  addPlates: async (printId: string, files: File[]): Promise<{ print: Print }> => {
    const fd = new FormData();
    for (const file of files) {
      fd.append("files", file);
    }
    const res = await fetch(`${apiBase()}/print/${printId}/plates`, {
      method: "POST",
      body: fd,
      headers: authHeaders(),
    });
    if (res.status === 401) {
      throw new UnauthorizedError();
    }
    if (!res.ok) {
      const message = await readErrorMessage(res, "Failed to add plate");
      throw new Error(message);
    }
    return res.json();
  },

  deletePlate: async (printId: string, plateId: string): Promise<{ print: Print }> => {
    const res = await fetch(`${apiBase()}/print/${printId}/plates/${plateId}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    if (res.status === 401) {
      throw new UnauthorizedError();
    }
    if (res.status === 409) {
      throw new LastPlateError(await readErrorMessage(res, "Cannot remove the only remaining plate."));
    }
    if (!res.ok) {
      throw new Error(await readErrorMessage(res, "Failed to remove plate"));
    }
    return res.json();
  },

  reorderPlates: async (printId: string, plateIds: string[]): Promise<{ print: Print }> => {
    const res = await fetch(`${apiBase()}/print/${printId}/plates/reorder`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ plate_ids: plateIds }),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) {
      throw new Error(await readErrorMessage(res, "Failed to reorder plates"));
    }
    return res.json();
  },

  renamePlate: async (printId: string, plateId: string, filename: string): Promise<{ print: Print }> => {
    const res = await fetch(`${apiBase()}/print/${printId}/plate/${plateId}/rename`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ filename }),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) {
      throw new Error(await readErrorMessage(res, "Rename failed"));
    }
    return res.json();
  },

  setTags: async (id: string, tags: string[]) => {
    const res = await fetch(`${apiBase()}/print/${id}/tags`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ tags }),
    });
    assertOk(res, "Tag update failed");
    return res.json();
  },

  /** One notification for a batch uploaded one request at a time. Best-effort. */
  uploadSummary: async (printIds: string[], failed: string[]): Promise<void> => {
    const res = await fetch(`${apiBase()}/upload/summary`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ print_ids: printIds, failed }),
    });
    assertOk(res, "Failed to record the upload");
  },

  uploadGeneratedThumbnail: async (plateId: string, image: Blob): Promise<Print> => {
    const body = new FormData();
    body.set("file", image, "thumbnail.png");
    const res = await fetch(`${apiBase()}/plate/${plateId}/thumbnail-generated`, {
      method: "POST",
      headers: authHeaders(),
      body,
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) {
      throw new Error(await readErrorMessage(res, "Failed to save generated thumbnail"));
    }
    return res.json();
  },

  listFiles: async (id: string): Promise<PrintFile[]> => {
    const res = await fetch(`${apiBase()}/print/${id}/files`, { headers: authHeaders() });
    assertOk(res, "Failed to load supporting files");
    return res.json();
  },

  /** One supporting file as text, for the generator script the customizer runs. */
  supportingText: async (printId: string, fileId: string): Promise<string> => {
    const res = await fetch(`${apiBase()}/print/${printId}/files/${fileId}`, { headers: authHeaders() });
    assertOk(res, "Failed to read the script");
    return res.text();
  },

  uploadFile: async (id: string, file: File): Promise<Print> => {
    const body = new FormData();
    body.set("file", file, file.name);
    const res = await fetch(`${apiBase()}/print/${id}/files`, {
      method: "POST",
      headers: authHeaders(),
      body,
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) {
      throw new Error(await readErrorMessage(res, "Failed to add file"));
    }
    return res.json();
  },

  deleteFile: async (printId: string, fileId: string): Promise<Print> => {
    const res = await fetch(`${apiBase()}/print/${printId}/files/${fileId}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    assertOk(res, "Failed to remove supporting file");
    return res.json();
  },

  deletePreparedPrint: async (printId: string): Promise<Print> => {
    const res = await fetch(`${apiBase()}/print/${printId}/prepared-print`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    assertOk(res, "Failed to clear prepared print");
    return res.json();
  },

  updateMeta: async (
    id: string,
    payload: {
      name?: string | null;
      title?: string | null;
      notes?: string | null;
      creator?: string | null;
    },
  ) => {
    const res = await fetch(`${apiBase()}/print/${id}/meta`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) {
      throw new Error(await readErrorMessage(res, "Metadata update failed"));
    }
    return res.json();
  },

  /** Queues the model for AI categorization; the outcome arrives as a notification. */
  recategorize: async (id: string, force = false): Promise<void> => {
    const res = await fetch(`${apiBase()}/print/${id}/recategorize`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ force, background: true }),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) {
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
      throw new PrintApiError(
        typeof record.error === "string" ? record.error : `AI recategorization failed (${res.status})`,
        res.status,
        typeof record.code === "string" ? record.code : null,
      );
    }
  },

  fillGaps: async (id: string): Promise<FillGapsResult> => {
    const res = await fetch(`${apiBase()}/print/${id}/fill-gaps`, { method: "POST", headers: authHeaders() });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) {
      throw new Error(await readErrorMessage(res, "Filling in missing details failed"));
    }
    return res.json();
  },

  delete: async (id: string) => {
    const res = await fetch(`${apiBase()}/print/${id}`, { method: "DELETE", headers: authHeaders() });
    assertOk(res, "Delete print failed");
    return res.json();
  },

  /** Each model on its own: the ones that fail are counted, the rest are still deleted. */
  bulkDelete: async (ids: string[]): Promise<{ deleted: string[]; failed: number }> => {
    const result = { deleted: [] as string[], failed: 0 };
    for (const chunk of bulkChunks(ids)) {
      const res = await fetch(`${apiBase()}/prints/delete`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ print_ids: chunk }),
      });
      if (res.status === 401) throw new UnauthorizedError();
      if (!res.ok) throw new Error(await readErrorMessage(res, "Delete failed"));
      const part = (await res.json()) as { deleted: string[]; failed: number };
      result.deleted.push(...part.deleted);
      result.failed += part.failed;
    }
    return result;
  },

  bulkFavorite: async (ids: string[], favorite: boolean): Promise<Print[]> => {
    const prints: Print[] = [];
    for (const chunk of bulkChunks(ids)) {
      const res = await fetch(`${apiBase()}/prints/favorite`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ print_ids: chunk, favorite }),
      });
      if (res.status === 401) throw new UnauthorizedError();
      if (!res.ok)
        throw new Error(await readErrorMessage(res, favorite ? "Failed to favorite" : "Failed to unfavorite"));
      prints.push(...((await res.json()) as { prints: Print[] }).prints);
    }
    return prints;
  },

  /** Adds `add` to and takes `remove` off every model; answers the models and how many changed. A batch failing
   *  after an earlier one went through answers what did, with `partial` set, so the grid isn't left stale. */
  bulkEditTags: async (
    ids: string[],
    tags: { add: string[]; remove: string[] },
  ): Promise<{ prints: Print[]; changed: number; partial: boolean }> => {
    const result = { prints: [] as Print[], changed: 0, partial: false };
    for (const chunk of bulkChunks(ids)) {
      try {
        const res = await fetch(`${apiBase()}/prints/tags`, {
          method: "POST",
          headers: authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ print_ids: chunk, ...tags }),
        });
        if (res.status === 401) throw new UnauthorizedError();
        if (!res.ok) throw new Error(await readErrorMessage(res, "Tag update failed"));
        const part = (await res.json()) as { prints: Print[]; changed: number };
        result.prints.push(...part.prints);
        result.changed += part.changed;
      } catch (err) {
        if (!result.prints.length || err instanceof UnauthorizedError) throw err;
        console.error(err);
        return { ...result, partial: true };
      }
    }
    return result;
  },

  updateCategory: async (id: string, category_id: string | null) => {
    const res = await fetch(`${apiBase()}/print/${id}/category`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ category_id }),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) {
      throw new Error(await readErrorMessage(res, "Category update failed"));
    }
    return res.json();
  },

  resetAuthor: async (id: string): Promise<{ print: Print }> => {
    const res = await fetch(`${apiBase()}/print/${id}/author-reset`, { method: "POST", headers: authHeaders() });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to reset author"));
    return res.json();
  },

  addPreviewImages: async (id: string, files: File[]): Promise<{ print: Print }> => {
    const fd = new FormData();
    for (const file of files) fd.append("files", file);
    const res = await fetch(`${apiBase()}/print/${id}/preview-images`, {
      method: "POST",
      body: fd,
      headers: authHeaders(),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to add preview image"));
    return res.json();
  },

  deletePreviewImage: async (printId: string, imageId: string): Promise<{ print: Print }> => {
    const res = await fetch(`${apiBase()}/print/${printId}/preview-images/${imageId}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to remove preview image"));
    return res.json();
  },

  reorderPreviewImages: async (id: string, imageIds: string[]): Promise<{ print: Print }> => {
    const res = await fetch(`${apiBase()}/print/${id}/preview-images/reorder`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ image_ids: imageIds }),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to reorder preview images"));
    return res.json();
  },

  downloadZip: async (opts: DownloadZipFilter & { filename?: string }) => {
    const res = await fetch(`${apiBase()}/download/zip`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(opts),
    });
    assertOk(res, "Download failed");
    return res;
  },

  /** An upper-bound size estimate, computed without building the zip. */
  downloadZipSummary: async (filter: DownloadZipFilter): Promise<DownloadZipSummary> => {
    const res = await fetch(`${apiBase()}/download/zip/summary`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(filter),
    });
    assertOk(res, "Failed to estimate download size");
    return res.json();
  },

  /** Bumps the print count and records the activity; returns the updated print. */
  recordDownload: async (id: string, kind: "download" | "slicer" = "download"): Promise<Print> => {
    const res = await fetch(`${apiBase()}/print/${id}/download`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ kind }),
    });
    assertOk(res, "Failed to record download");
    return res.json();
  },

  /** Starts preparing a normalized copy for "Open normalized in <slicer>" if needed; poll until "ready". */
  normalizePlate: async (printId: string, plateId: string): Promise<{ status: "ready" | "preparing" | "failed" }> => {
    const res = await fetch(`${apiBase()}/print/${printId}/plate/${plateId}/normalize`, {
      method: "POST",
      headers: authHeaders(),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to prepare normalized file"));
    return res.json();
  },

  favorite: async (id: string): Promise<Print> => {
    const res = await fetch(`${apiBase()}/print/${id}/favorite`, { method: "POST", headers: authHeaders() });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to favorite"));
    return res.json();
  },

  unfavorite: async (id: string): Promise<Print> => {
    const res = await fetch(`${apiBase()}/print/${id}/favorite`, { method: "DELETE", headers: authHeaders() });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to unfavorite"));
    return res.json();
  },
};
