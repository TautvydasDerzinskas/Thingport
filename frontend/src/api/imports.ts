import { authHeaders } from "../utils/auth";
import { apiBase, readErrorMessage, UnauthorizedError } from "./client";
import type { ProviderId } from "../providers/_generated";
import type { Print } from "./prints";

export type ImportInspectInfo = {
  filename: string;
  mime: string;
  is_zip: boolean;
};

export type ZipEntryInfo = {
  path: string;
  size: number;
};

export type ImportCollectionEntry = {
  design_id: string;
  title: string;
  cover: string | null;
  already_imported: boolean;
};

export type ImportCollectionEntriesResult = {
  title: string | null;
  total: number;
  truncated: boolean;
  entries: ImportCollectionEntry[];
};

export type ImportJobType = "COLLECTION" | "ZIP" | "PROFILES" | "LINKS";

export type MakerworldProfileScope = "url" | "designer" | "all";
// PAUSED: a link queue waiting to be started from the admin import queue.
export type ImportJobStatus = "RUNNING" | "DONE" | "ERROR" | "PAUSED";

/** Polled by ImportJobContext until status leaves RUNNING. */
export type ImportJob = {
  id: string;
  type: ImportJobType;
  status: ImportJobStatus;
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
  // Set when the job created exactly one Print, so the UI can open it.
  result_print_id: string | null;
};

/** One queued link of a LINKS job. Polled alongside the job to show the queue's detail. */
export type ImportJobItem = {
  id: string;
  url: string;
  status: "PENDING" | "RUNNING" | "DONE" | "FAILED";
  attempts: number;
  error_message: string | null;
  /** Set on links sent from the extension's "Add to the queue". */
  title: string | null;
  collection_id: string | null;
  scope: MakerworldProfileScope | null;
};

type ImportLinkPayload = {
  url: string;
  title?: string;
  notes?: string;
  tags?: string[];
  category_id?: string;
  filename?: string;
  makerworld_cookie?: string;
  // Solved captcha, checked and consumed by whichever request starts the import.
  captcha_id?: string;
  captcha_answer?: string;
};

/** "profile_added": an existing MakerWorld model gained another profile's file. */
export type ImportOutcome = "created" | "profile_added" | "already_imported";

export const importsApi = {
  fromLink: async (payload: ImportLinkPayload): Promise<Print & { import_outcome?: ImportOutcome }> => {
    const res = await fetch(`${apiBase()}/import`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    if (res.status === 401) {
      throw new UnauthorizedError();
    }
    if (!res.ok) {
      let message = "Import failed";
      try {
        const data = await res.json();
        if (typeof data?.detail === "string") message = data.detail;
      } catch {}
      throw new Error(message);
    }
    return res.json();
  },

  inspectLink: async (payload: ImportLinkPayload): Promise<ImportInspectInfo> => {
    const res = await fetch(`${apiBase()}/import/inspect`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    if (res.status === 401) {
      throw new UnauthorizedError();
    }
    if (!res.ok) {
      const message = await readErrorMessage(res, "Inspect failed");
      throw new Error(message);
    }
    return res.json();
  },

  listZipEntries: async (payload: ImportLinkPayload): Promise<{ filename: string; entries: ZipEntryInfo[] }> => {
    const res = await fetch(`${apiBase()}/import/zip/entries`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    if (res.status === 401) {
      throw new UnauthorizedError();
    }
    if (!res.ok) {
      const message = await readErrorMessage(res, "Zip listing failed");
      throw new Error(message);
    }
    return res.json();
  },

  /** Returns immediately; ImportJobContext polls the job. */
  zipFromLink: async (payload: ImportLinkPayload & { entries: string[] }): Promise<{ job_id: string }> => {
    const res = await fetch(`${apiBase()}/import/zip`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    if (res.status === 401) {
      throw new UnauthorizedError();
    }
    if (!res.ok) {
      const message = await readErrorMessage(res, "Zip import failed");
      throw new Error(message);
    }
    return res.json();
  },

  /** A provider's collection, likes or bookmarks, to pick models from. */
  listEntries: async (provider: ProviderId, payload: ImportLinkPayload): Promise<ImportCollectionEntriesResult> => {
    const res = await fetch(`${apiBase()}/import/${provider}/list/entries`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Could not load this list"));
    return res.json();
  },

  /** Returns immediately: a job ImportJobContext polls, or, for a provider whose files come through Thingport Grab,
   *  the models queued for it, filed into a collection named after the list. */
  startList: async (
    provider: ProviderId,
    payload: ImportLinkPayload & { model_ids: string[] },
  ): Promise<{ job_id: string } | { queued: number; collection_id: string }> => {
    const res = await fetch(`${apiBase()}/import/${provider}/list`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Import failed"));
    return res.json();
  },

  /** Returns immediately; ImportJobContext polls the job. ("url" is a plain fromLink import.) */
  startProfiles: async (
    provider: ProviderId,
    payload: ImportLinkPayload & { scope: Exclude<MakerworldProfileScope, "url"> },
  ): Promise<{ job_id: string }> => {
    const res = await fetch(`${apiBase()}/import/${provider}/profiles`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Import failed"));
    return res.json();
  },

  /** Returns immediately; ImportJobContext polls the job. A pasted list of links, imported one at
   *  a time; what fails can be rerun with retryImportJob. */
  fromLinks: async (
    payload: Omit<ImportLinkPayload, "url"> & { urls: string[]; scope?: MakerworldProfileScope },
  ): Promise<{ job_id: string }> => {
    const res = await fetch(`${apiBase()}/import/links`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Import failed"));
    return res.json();
  },

  /** Reruns just a link-list job's failed links. */
  retryImportJob: async (jobId: string): Promise<{ job_id: string }> => {
    const res = await fetch(`${apiBase()}/import/jobs/${jobId}/retry`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Retry failed"));
    return res.json();
  },

  /** MakerOnline gives its files only to its own pages: the link waits for Thingport Grab's next visit there. */
  queueMakeronline: async (
    payload: ImportLinkPayload & { scope: MakerworldProfileScope },
  ): Promise<{ queued: number }> => {
    const res = await fetch(`${apiBase()}/import/makeronline/queue`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "MakerOnline import failed"));
    return res.json();
  },

  getActiveImportJob: async (): Promise<ImportJob | null> => {
    const res = await fetch(`${apiBase()}/import/jobs/active`, { headers: authHeaders() });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to check for an active import"));
    return res.json();
  },

  getImportJob: async (jobId: string): Promise<ImportJob> => {
    const res = await fetch(`${apiBase()}/import/jobs/${jobId}`, { headers: authHeaders() });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to load import progress"));
    return res.json();
  },

  /** Per-link state of a queue job, for the progress bar's detail view. */
  getImportJobItems: async (jobId: string): Promise<ImportJobItem[]> => {
    const res = await fetch(`${apiBase()}/import/jobs/${jobId}/items`, { headers: authHeaders() });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to load the import queue"));
    return res.json();
  },
};
