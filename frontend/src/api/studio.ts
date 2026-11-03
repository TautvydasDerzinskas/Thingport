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

/** A library model Studio can import, with the 3D files it could take. */
export type StudioLibraryModel = {
  id: string;
  title: string;
  thumb_url: string | null;
  files: { id: string; name: string; size: number }[];
};

/** An AI from Administration > AI, as the prompt's picker shows it. */
export type StudioAiModel = { id: string; model: string; host: string; is_default: boolean };
/** The AIs an admin offers for the assistant; none while it's off. */
export type StudioAiModels = { enabled: boolean; models: StudioAiModel[] };

/** One tool call the assistant made: what it was, what it did, and whether it worked. */
export type StudioAssistantStep = { tool: string; title: string; summary: string | null; ok: boolean };
export type StudioAssistantOutcome = "done" | "stopped" | "limit" | "failed";
export type StudioAssistantMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  steps: StudioAssistantStep[];
  outcome: StudioAssistantOutcome | null;
  error: string | null;
  model: string | null;
  created_at: string;
};
export type StudioAssistantRun = {
  status: "running" | StudioAssistantOutcome;
  steps: StudioAssistantStep[];
  model: string;
  error: string | null;
  started_at: string;
  finished_at: string | null;
};
/** The conversation about a design, and the run going on or just finished. */
export type StudioAssistantThread = { messages: StudioAssistantMessage[]; run: StudioAssistantRun | null };

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
  aiModels: () => request<StudioAiModels>("/studio/ai-models"),
  list: () => request<StudioDesignSummary[]>("/studio/designs"),
  library: (q: string, offset = 0) =>
    request<{ models: StudioLibraryModel[]; next_offset: number | null }>(
      `/studio/library?${new URLSearchParams({ q, offset: String(offset) })}`,
    ),
  /** A design's copy of a mesh it imported, as frontend/src/studio/meshAsset.ts reads it. */
  asset: async (id: string, assetId: string): Promise<ArrayBuffer> => {
    const res = await fetch(`${apiBase()}${design(id)}/assets/${encodeURIComponent(assetId)}`, {
      headers: authHeaders(),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new StudioError(`Mesh not found (${res.status})`, res.status, null);
    return res.arrayBuffer();
  },
  create: (name: string) => request<StudioDesign>("/studio/designs", "POST", { name }),
  get: (id: string) => request<StudioDesign>(design(id)),
  version: (id: string) => request<{ version: number }>(`${design(id)}/version`),
  remove: (id: string) => request<void>(design(id), "DELETE"),
  assistant: (id: string) => request<StudioAssistantThread>(`${design(id)}/assistant`),
  /** Starts the assistant on a prompt; it works in the background, which `assistant` follows. */
  ask: (id: string, body: { prompt: string; ai_connection_id: string | null; selected: string[] }) =>
    request<{ run: StudioAssistantRun }>(`${design(id)}/assistant`, "POST", body),
  stopAssistant: (id: string) => request<{ run: StudioAssistantRun | null }>(`${design(id)}/assistant/stop`, "POST"),
  clearAssistant: (id: string) => request<void>(`${design(id)}/assistant`, "DELETE"),
  /** Every change to a design goes through here, as the same commands an assistant runs. */
  run: <N extends StudioCommandName>(id: string, command: N, args: StudioCommandArgs<N>) =>
    request<StudioCommandResult>(`${design(id)}/commands`, "POST", { command, args }),
};
