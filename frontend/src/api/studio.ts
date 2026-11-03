import { authHeaders } from "../utils/auth";
import { apiBase, UnauthorizedError } from "./client";
import type { StudioCommandArgs, StudioCommandName } from "../studio/commands";
import type { StudioDocument } from "../studio/document";

export type StudioDesignSummary = {
  id: string;
  name: string;
  feature_count: number;
  version: number;
  updated_at: string;
};

export type StudioDesign = StudioDesignSummary & {
  document: StudioDocument;
  can_undo: boolean;
  can_redo: boolean;
  created_at: string;
};

export type StudioCommandResult = { design: StudioDesign; summary: string; created: string[] };

/** An AI from Administration > AI, as the prompt's picker shows it. */
export type StudioAiModel = { id: string; model: string; host: string; is_default: boolean };

/** What the server said no to, in its words: a command it couldn't carry out says why. */
export class StudioError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
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
    let message = `Request failed (${res.status})`;
    let code: string | null = null;
    try {
      const body = (await res.json()) as { detail?: unknown; code?: unknown };
      if (typeof body.detail === "string") message = body.detail;
      if (typeof body.code === "string") code = body.code;
    } catch {}
    throw new StudioError(message, res.status, code);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const design = (id: string) => `/studio/designs/${encodeURIComponent(id)}`;

export const studioApi = {
  status: () => request<{ enabled: boolean }>("/studio/status"),
  aiModels: () => request<StudioAiModel[]>("/studio/ai-models"),
  list: () => request<StudioDesignSummary[]>("/studio/designs"),
  create: (name: string) => request<StudioDesign>("/studio/designs", "POST", { name }),
  get: (id: string) => request<StudioDesign>(design(id)),
  version: (id: string) => request<{ version: number }>(`${design(id)}/version`),
  remove: (id: string) => request<void>(design(id), "DELETE"),
  /** Every change to a design goes through here, as the same commands an assistant runs. */
  run: <N extends StudioCommandName>(id: string, command: N, args: StudioCommandArgs<N>) =>
    request<StudioCommandResult>(`${design(id)}/commands`, "POST", { command, args }),
};
