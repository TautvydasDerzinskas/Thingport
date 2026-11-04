import { authHeaders } from "../utils/auth";
import { apiBase, readErrorMessage, UnauthorizedError } from "./client";
import { invalidateAiCategorizationStatus } from "./aiCategorization";
import { invalidateAiDescriptionStatus } from "./aiDescriptions";

/** How Thingport talks to an AI: the OpenAI-style API most providers and local servers offer, or Claude's own. */
export const AI_KINDS = ["openai", "anthropic"] as const;
export type AiKind = (typeof AI_KINDS)[number];

/** Where Claude answers unless it's reached through a proxy. */
export const CLAUDE_BASE_URL = "https://api.anthropic.com";

/** What a connection may send as reasoning_effort; null sends nothing. */
export const REASONING_EFFORTS = ["none", "low", "medium", "high"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export type AiConnection = {
  id: string;
  kind: AiKind;
  base_url: string;
  model: string;
  has_api_key: boolean;
  timeout_ms: number;
  concurrency: number;
  reasoning_effort: ReasoningEffort | null;
  /** It takes pictures in a prompt, as an admin says. */
  vision: boolean;
  is_default: boolean;
};

/** api_key: omitted keeps the saved one, null or "" removes it. */
export type AiConnectionInput = {
  kind: AiKind;
  base_url: string;
  model: string;
  api_key?: string | null;
  timeout_ms: number;
  concurrency: number;
  reasoning_effort: ReasoningEffort | null;
  /** Left out of a new one, it's guessed from the model. */
  vision?: boolean;
};

// Models whose names say they take pictures, as the backend guesses for a new AI (guessVision in
// aiConnectionService.ts): Claude, OpenAI's multimodal ones, Gemini, and the open vision models.
const VISION_MODELS =
  /(gpt-4o|gpt-4\.1|gpt-4-turbo|gpt-5|^o[134](?:[-_]|$)|gemini|claude|llava|vision|vl(?:[-_:.]|$)|gemma-?3|minicpm-v|pixtral|llama-?4|mistral-small-?3\.[12]|moondream|internvl|multimodal|omni)/i;

/** Whether an AI takes pictures, as far as its kind and model name tell. */
export function guessVision(kind: AiKind, model: string): boolean {
  return kind === "anthropic" || VISION_MODELS.test(model);
}

export type AiConnectionTest = { ok: boolean; latency_ms?: number; model?: string; error?: string };
export type AiModelList = { ok: true; models: string[] } | { ok: false; error: string };

async function request<T>(path: string, method = "GET", payload?: unknown): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    method,
    headers: authHeaders(payload === undefined ? undefined : { "Content-Type": "application/json" }),
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error(await readErrorMessage(res, `Request failed (${res.status})`));
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** The instance's AIs. Adding, deleting or changing the default can turn AI features on or off, so the cached
 *  statuses are dropped after each. */
export const aiConnectionsApi = {
  list: (): Promise<AiConnection[]> => request("/settings/ai-connections"),
  create: async (input: AiConnectionInput): Promise<AiConnection> => {
    const created = await request<AiConnection>("/settings/ai-connections", "POST", input);
    invalidateAiCategorizationStatus();
    invalidateAiDescriptionStatus();
    return created;
  },
  update: (id: string, input: Partial<AiConnectionInput>): Promise<AiConnection> =>
    request(`/settings/ai-connections/${encodeURIComponent(id)}`, "PATCH", input),
  remove: async (id: string): Promise<void> => {
    await request<void>(`/settings/ai-connections/${encodeURIComponent(id)}`, "DELETE");
    invalidateAiCategorizationStatus();
    invalidateAiDescriptionStatus();
  },
  makeDefault: async (id: string): Promise<AiConnection> => {
    const made = await request<AiConnection>(`/settings/ai-connections/${encodeURIComponent(id)}/default`, "POST");
    invalidateAiCategorizationStatus();
    invalidateAiDescriptionStatus();
    return made;
  },
  /** `id` fills in what the form leaves out from that saved AI, such as its key. */
  test: (payload: Partial<AiConnectionInput> & { id?: string }): Promise<AiConnectionTest> =>
    request("/settings/ai-connections/test", "POST", payload),
  models: (payload: { id?: string; kind?: AiKind; base_url?: string; api_key?: string | null }): Promise<AiModelList> =>
    request("/settings/ai-connections/models", "POST", payload),
};
