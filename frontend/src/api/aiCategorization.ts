import { authHeaders } from "../utils/auth";
import { apiBase, readCodedError, UnauthorizedError } from "./client";
import type { Print } from "./prints";

export type AiCategorizationMode = "suggest" | "auto";

export type AiCategorizationStatus = { enabled: boolean; mode: AiCategorizationMode };
export type AiRunCounts = {
  uncategorized: number;
  ai: number;
  rule: number;
  legacy: number;
  manual: number;
  folder: number;
};
export type AiRun = {
  running: boolean;
  started_at: string | null;
  finished_at: string | null;
  total: number;
  done: number;
  applied: number;
  suggested: number;
  no_match: number;
  unchanged: number;
  failed: number;
  cancelled: boolean;
  last_error: string | null;
};
export type AiRunState = { counts: AiRunCounts; run: AiRun | null };
export type AiRunScope = {
  include_uncategorized: boolean;
  include_folders: boolean;
  include_ai: boolean;
  include_rule: boolean;
  /** Also takes older categories, which may have been picked by hand. */
  include_manual: boolean;
  /** Only these models, still filtered by the flags above. */
  print_ids?: string[];
};
export type AiSuggestions = { total: number; items: Print[] };
export type AiBulkResult = { accepted: number; rejected: number; failed: number };

export class AiCategorizationError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
    this.name = "AiCategorizationError";
  }
}

async function request<T>(path: string, method = "GET", payload?: unknown): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    method,
    headers: authHeaders(payload === undefined ? undefined : { "Content-Type": "application/json" }),
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) {
    const { message, code } = await readCodedError(res, `Request failed (${res.status})`);
    throw new AiCategorizationError(message, res.status, code);
  }
  return res.json() as Promise<T>;
}

let statusRequest: Promise<AiCategorizationStatus> | null = null;

/** The status is fetched once per session; saving the admin settings drops it so menus follow. */
export function invalidateAiCategorizationStatus(): void {
  statusRequest = null;
}

export const aiCategorizationApi = {
  status: (): Promise<AiCategorizationStatus> => {
    if (!statusRequest) {
      statusRequest = request<AiCategorizationStatus>("/ai-categorization/status").catch((error: unknown) => {
        statusRequest = null;
        throw error;
      });
    }
    return statusRequest;
  },
  suggestions: (limit = 50, offset = 0): Promise<AiSuggestions> =>
    request(`/ai-categorization/suggestions?limit=${limit}&offset=${offset}`),
  accept: (printId: string): Promise<{ print: Print }> =>
    request(`/print/${encodeURIComponent(printId)}/ai-suggestion/accept`, "POST"),
  reject: (printId: string): Promise<{ print: Print }> =>
    request(`/print/${encodeURIComponent(printId)}/ai-suggestion/reject`, "POST"),
  bulk: (action: "accept" | "reject", printIds: string[]): Promise<AiBulkResult> =>
    request("/ai-categorization/suggestions/bulk", "POST", { action, print_ids: printIds }),
  runState: (): Promise<AiRunState> => request("/ai-categorization/run"),
  startRun: (scope: AiRunScope): Promise<{ run: AiRun }> => request("/ai-categorization/run", "POST", scope),
  cancelRun: (): Promise<{ run: AiRun }> => request("/ai-categorization/run/cancel", "POST"),
};
