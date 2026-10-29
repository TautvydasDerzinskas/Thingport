import { authHeaders } from "../utils/auth";
import { apiBase, readErrorMessage, UnauthorizedError } from "./client";

/** The models whose files are gone, and the repair of them (backend services/missingFilesService.ts). */

export type MissingFilesSummary = {
  /** The user's models, counting only those with files recorded. */
  total: number;
  broken: number;
  /** Of the broken ones: files this Thingport can fetch itself. */
  server: number;
  /** Files only Thingport Grab can fetch, on the site's own pages. */
  grab: number;
  /** Uploads: nothing to fetch them from. */
  no_source: number;
  by_provider: { provider: string | null; count: number }[];
  sample: { id: string; name: string }[];
  scanned_at: string;
  /** Whether this looks like an accident worth asking about, rather than a model or two. */
  prompt: boolean;
};

export type ModelRepairAction = "reimport" | "delete";

export type ModelRepairRun = {
  action: ModelRepairAction;
  running: boolean;
  started_at: string;
  finished_at: string | null;
  total: number;
  done: number;
  repaired: number;
  queued: number;
  deleted: number;
  skipped: number;
  failed: number;
  cancelled: boolean;
  stop_reason: "rateLimited" | "downloadLimit" | "auth" | "blocked" | null;
  last_error: string | null;
};

async function request<T>(path: string, method = "GET", payload?: unknown): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    method,
    headers: authHeaders(payload === undefined ? undefined : { "Content-Type": "application/json" }),
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error(await readErrorMessage(res, `Request failed (${res.status})`));
  return res.json() as Promise<T>;
}

export const modelRepairApi = {
  /** The last scan, or a fresh one with `refresh`. */
  missingFiles: (refresh = false): Promise<MissingFilesSummary> =>
    request(`/prints/missing-files${refresh ? "?refresh=1" : ""}`),
  runState: (): Promise<{ run: ModelRepairRun | null }> => request("/prints/repair/run"),
  startRun: (action: ModelRepairAction): Promise<{ run: ModelRepairRun }> =>
    request("/prints/repair", "POST", { action }),
  cancelRun: (): Promise<{ run: ModelRepairRun | null }> => request("/prints/repair/cancel", "POST", {}),
};
