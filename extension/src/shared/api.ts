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
  /** The print profiles the library's model has a file of. Missing from instances older than 1.6.0. */
  imported_profile_ids?: string[];
};

export type FillGapsResult = { filled: SourceGap[]; remaining: SourceGap[] };

export type InspectResult = { title?: string | null; is_zip?: boolean; filename?: string | null };

/** A zip's files by path, its folders left out by the instance. */
export type ZipEntriesResult = { entries: { path: string; size: number }[] };

export type BatchEntry = {
  design_id: string;
  title?: string | null;
  already_imported?: boolean;
  /** Why the user can't import it, as the provider's reason; its words are the provider's `listBlocks`. */
  blocked?: string;
};
export type BatchEntriesResult = { title?: string | null; entries: BatchEntry[]; truncated?: boolean };

export type ImportJob = {
  status: "RUNNING" | "PAUSED" | "DONE" | "ERROR" | string;
  processed: number;
  imported: number;
  already_in_library?: number;
  failed_count?: number;
  total: number;
  result_print_id?: string | null;
  error_message?: string | null;
};

/** A Thingport collection kept in step with this provider collection. */
export type SyncLink = {
  /** This link among the collection's sources, which can be several. Instances from before that send none. */
  id?: string;
  provider: string;
  collection_id: string;
  collection_name: string;
};

/** GET /collection-sync: `supported` is false on pages a sync can't follow, e.g. Thingiverse Likes. */
export type SyncLookup = { supported: boolean; sync: SyncLink | null };

/** POST /import/queue: the link waits in the user's queue on the instance, on hold unless `started` says otherwise. */
export type QueueImportResult = {
  job_id: string;
  item_id: string;
  duplicate: boolean;
  waiting: number;
  /** Missing from instances without a queue of one's own. True: it's in line, as the user's setting there says. */
  started?: boolean;
  /** Its place in line, 1 being next up. Missing likewise, and null while on hold. */
  position?: number | null;
};

export type LoginResult = {
  token: string;
  expires_in: number;
  user?: { role?: "ADMIN" | "MEMBER"; email?: string };
};
