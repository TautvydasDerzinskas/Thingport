// Only the fields this extension reads; see the backend's dto.ts for the full shapes.

export type ImportOutcome = "created" | "profile_added" | "already_imported";

export type Print = {
  id: string;
  title?: string | null;
  name?: string | null;
  thumb_url?: string | null;
  preview_images?: { url: string }[];
  import_outcome?: ImportOutcome;
};

export type Collection = { id: string; name: string; system_key?: string | null };

/** What "Fetch missing details" can fill on a library model, from its source. */
export type SourceGap = "title" | "description" | "tags" | "creator" | "author" | "category" | "images";

export type ImportStatus = {
  already_imported: boolean;
  print_id?: string | null;
  state?: "imported" | "profile_missing" | "profile_unknown" | string;
  /** Missing from instances older than 1.4.0. */
  gaps?: SourceGap[];
};

export type FillGapsResult = { filled: SourceGap[]; remaining: SourceGap[] };

export type InspectResult = { title?: string | null; is_zip?: boolean; filename?: string | null };

export type ZipEntriesResult = { entries: string[] };

export type BatchEntry = { design_id: string; title?: string | null; already_imported?: boolean };
export type BatchEntriesResult = { title?: string | null; entries: BatchEntry[]; truncated?: boolean };

export type ImportJob = {
  status: "RUNNING" | "DONE" | "ERROR" | string;
  processed: number;
  imported: number;
  total: number;
  result_print_id?: string | null;
  error_message?: string | null;
};

/** A Thingport collection kept in step with this provider collection. */
export type SyncLink = {
  provider: string;
  collection_id: string;
  collection_name: string;
};

/** GET /collection-sync: `supported` is false on pages a sync can't follow, e.g. Thingiverse Likes. */
export type SyncLookup = { supported: boolean; sync: SyncLink | null };

/** POST /import/queue: the link waits, paused, in the user's queue on the instance. */
export type QueueImportResult = { job_id: string; item_id: string; duplicate: boolean; waiting: number };

export type LoginResult = {
  token: string;
  expires_in: number;
  user?: { role?: "ADMIN" | "MEMBER"; email?: string };
};
