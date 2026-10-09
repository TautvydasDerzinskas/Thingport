import { authHeaders } from "../utils/auth";
import { apiBase, readErrorMessage, UnauthorizedError } from "./client";
import type { Print } from "./prints";

export type AiCategorizationMode = "off" | "suggest" | "auto";

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
  failed: number;
  cancelled: boolean;
  last_error: string | null;
};
export type AiRunState = { counts: AiRunCounts; run: AiRun | null };
export type AiRunScope = { include_ai: boolean; include_rule: boolean; include_legacy: boolean };
export type AiSuggestions = { total: number; items: Print[] };
export type AiBulkResult = { accepted: number; rejected: number; failed: number };
export type AiRecategorizeOutcome = "applied" | "suggested" | "no_match" | "unchanged";
export type AiRecategorizeResult = { print: Print; outcome: AiRecategorizeOutcome };

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
    let code: string | null = null;
    let message: string;
    try {
      const body: unknown = await res.json();
      if (typeof body === "object" && body !== null) {
        const record = body as Record<string, unknown>;
        if (typeof record.code === "string") code = record.code;
        message =
          typeof record.error === "string"
            ? record.error
            : await readErrorMessage(res, `Request failed (${res.status})`);
      } else {
        message = `Request failed (${res.status})`;
      }
    } catch {
      message = `Request failed (${res.status})`;
    }
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
