import { authHeaders } from "../utils/auth";
import { apiBase, readErrorMessage, UnauthorizedError } from "./client";
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

export type ImportJobType = "COLLECTION" | "ZIP";
export type ImportJobStatus = "RUNNING" | "DONE" | "ERROR";

/** A batch import (MakerWorld collection, or a remote zip's selected entries) running in the
 *  background -- see ImportJobContext, which polls GET /import/jobs/:id for this shape until
 *  status leaves RUNNING. */
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
  // Set only for a "ZIP" job (a single link that turned out to need the zip-entry picker) that
  // finished having created exactly one Print -- see the backend's runZipImportJob. Used to
  // redirect into that print's edit mode, mirroring what a synchronous single-link import
  // already does (see useUploadImport's openForEditing).
  result_print_id: string | null;
};

type ImportLinkPayload = {
  url: string;
  title?: string;
  notes?: string;
  tags?: string[];
  category_id?: string;
  filename?: string;
  makerworld_cookie?: string;
};

/** What POST /import did -- "profile_added" when a MakerWorld model already in the library
 *  gained another print profile's file instead of a new model being created. */
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
      } catch {
        // ignore parse errors
      }
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

  /** Registers a background job for the selected zip entries and returns immediately -- see
   *  ImportJobContext.startZipImport, which follows up with the actual polling. */
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

  listCollectionEntries: async (payload: ImportLinkPayload): Promise<ImportCollectionEntriesResult> => {
    const res = await fetch(`${apiBase()}/import/collection/entries`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    if (res.status === 401) {
      throw new UnauthorizedError();
    }
    if (!res.ok) {
      const message = await readErrorMessage(res, "Could not load collection");
      throw new Error(message);
    }
    return res.json();
  },

  /** Registers a background job for the selected designs and returns immediately -- see
   *  ImportJobContext.startCollectionImport, which follows up with the actual polling. */
  fromCollection: async (payload: ImportLinkPayload & { design_ids: string[] }): Promise<{ job_id: string }> => {
    const res = await fetch(`${apiBase()}/import/collection`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    if (res.status === 401) {
      throw new UnauthorizedError();
    }
    if (!res.ok) {
      const message = await readErrorMessage(res, "Collection import failed");
      throw new Error(message);
    }
    return res.json();
  },

  listThingiverseLikesEntries: async (payload: ImportLinkPayload): Promise<ImportCollectionEntriesResult> => {
    const res = await fetch(`${apiBase()}/import/thingiverse-likes/entries`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    if (res.status === 401) {
      throw new UnauthorizedError();
    }
    if (!res.ok) {
      const message = await readErrorMessage(res, "Could not load this user's likes");
      throw new Error(message);
    }
    return res.json();
  },

  /** Registers a background job for the selected Things and returns immediately -- see
   *  ImportJobContext.startThingiverseLikesImport, which follows up with the actual polling.
   *  Every successful import lands in a shared "Thingiverse Likes" collection. */
  fromThingiverseLikes: async (payload: ImportLinkPayload & { thing_ids: string[] }): Promise<{ job_id: string }> => {
    const res = await fetch(`${apiBase()}/import/thingiverse-likes`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    if (res.status === 401) {
      throw new UnauthorizedError();
    }
    if (!res.ok) {
      const message = await readErrorMessage(res, "Thingiverse Likes import failed");
      throw new Error(message);
    }
    return res.json();
  },

  listThingiverseCollectionEntries: async (payload: ImportLinkPayload): Promise<ImportCollectionEntriesResult> => {
    const res = await fetch(`${apiBase()}/import/thingiverse-collection/entries`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    if (res.status === 401) {
      throw new UnauthorizedError();
    }
    if (!res.ok) {
      const message = await readErrorMessage(res, "Could not load this collection");
      throw new Error(message);
    }
    return res.json();
  },

  /** Registers a background job for the selected Things and returns immediately -- see
   *  ImportJobContext.startThingiverseCollectionImport, which follows up with the actual
   *  polling. Every successful import lands in a Thingport Collection named after the real
   *  Thingiverse Collection name. */
  fromThingiverseCollection: async (payload: ImportLinkPayload & { thing_ids: string[] }): Promise<{ job_id: string }> => {
    const res = await fetch(`${apiBase()}/import/thingiverse-collection`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    if (res.status === 401) {
      throw new UnauthorizedError();
    }
    if (!res.ok) {
      const message = await readErrorMessage(res, "Thingiverse Collection import failed");
      throw new Error(message);
    }
    return res.json();
  },

  listPrintablesCollectionEntries: async (payload: ImportLinkPayload): Promise<ImportCollectionEntriesResult> => {
    const res = await fetch(`${apiBase()}/import/printables-collection/entries`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    if (res.status === 401) {
      throw new UnauthorizedError();
    }
    if (!res.ok) {
      const message = await readErrorMessage(res, "Could not load this collection");
      throw new Error(message);
    }
    return res.json();
  },

  /** Registers a background job for the selected models and returns immediately -- see
   *  ImportJobContext.startPrintablesCollectionImport, which follows up with the actual polling.
   *  Every successful import lands in a Thingport Collection named after the real Printables
   *  Collection name. */
  fromPrintablesCollection: async (payload: ImportLinkPayload & { model_ids: string[] }): Promise<{ job_id: string }> => {
    const res = await fetch(`${apiBase()}/import/printables-collection`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    if (res.status === 401) {
      throw new UnauthorizedError();
    }
    if (!res.ok) {
      const message = await readErrorMessage(res, "Printables Collection import failed");
      throw new Error(message);
    }
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
};
