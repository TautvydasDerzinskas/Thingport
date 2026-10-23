import fs from "node:fs/promises";
import { prisma } from "../db";
import type { ReasoningEffort } from "@prisma/client";
import type { Logger } from "../logger";
import { previewImagePath } from "./previewImageService";
import { aiPreviewJpeg } from "./imageProcessing";
import type { AiProvider } from "./aiConnectionService";

/** What one request to a provider needs, saved or only typed into the settings form. */
export type ProviderSettings = Omit<AiProvider, "baseUrl" | "model" | "concurrency"> & {
  baseUrl: string | null;
  model: string | null;
};

export type ProviderContent = ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[];

// Per AI: each provider has its own limit, and a slow one shouldn't hold up another, whichever feature asks.
const slots = new Map<string, { active: number; waiters: (() => void)[] }>();
let retryDelay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

/** Keeps timeout and retry tests fast without changing production backoff behavior. */
export function setAiRetryDelayForTest(delay?: (milliseconds: number) => Promise<void>): void {
  retryDelay = delay ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
}

export async function limited<T>(key: string, limit: number, task: () => Promise<T>): Promise<T> {
  let slot = slots.get(key);
  if (!slot) {
    slot = { active: 0, waiters: [] };
    slots.set(key, slot);
  }
  // A waiter can be woken while another request takes the slot first, so it retries acquisition.
  if (slot.active >= limit) {
    await new Promise<void>((resolve) => slot.waiters.push(resolve));
    return limited(key, limit, task);
  }
  slot.active++;
  try {
    return await task();
  } finally {
    slot.active--;
    slot.waiters.shift()?.();
  }
}

export function noSecretError(error: unknown): Error {
  if (error instanceof Error) return new Error(error.message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]"));
  return new Error("AI provider request failed");
}

/** What a failed fetch means to an admin; fetch itself only says "fetch failed" or "aborted". */
function readableNetworkError(error: unknown, waited: { timeoutMs: number; stalled?: boolean }): unknown {
  if (error instanceof Error && error.name === "AbortError")
    return new Error(
      waited.stalled
        ? `The AI provider stopped answering for ${Math.round(waited.timeoutMs / 1000)} s`
        : `The AI provider did not answer within ${Math.round(waited.timeoutMs / 1000)} s`,
    );
  if (error instanceof TypeError) return new Error("Could not reach the AI provider. Check the API base URL.");
  return error;
}

/** The model's first preview image, small enough for a provider, when sending it is turned on. */
export async function previewPart(
  printId: string,
  enabled: boolean,
): Promise<{ type: "image_url"; image_url: { url: string } } | null> {
  if (!enabled) return null;
  const image = await prisma.previewImage.findFirst({
    where: { printId },
    orderBy: { position: "asc" },
    include: { print: { select: { assetsPath: true } } },
  });
  if (!image) return null;
  try {
    const data = await aiPreviewJpeg(await fs.readFile(previewImagePath(image.id, image.print.assetsPath)));
    return { type: "image_url", image_url: { url: `data:image/jpeg;base64,${data.toString("base64")}` } };
  } catch {
    return null;
  }
}

function chatUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

/**
 * Providers that ignore response_format (Xiaomi MiMo) wrap the object in prose or markdown, e.g.
 * `**{...}**`; the outermost braces are tried when the whole text doesn't parse. undefined when
 * neither does.
 */
function parseAnswerJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) return undefined;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return undefined;
    }
  }
}

type ChatBody = {
  choices?: { message?: { content?: unknown }; finish_reason?: unknown }[];
  usage?: { completion_tokens?: unknown; completion_tokens_details?: { reasoning_tokens?: unknown } };
};

/**
 * Puts a streamed answer back together as the one-piece answer would have been. Every piece, thinking included,
 * tells `onPiece` the provider is still at it.
 */
async function readStream(response: Response, onPiece: () => void): Promise<ChatBody> {
  const reader = response.body?.getReader();
  if (!reader) return {};
  const decoder = new TextDecoder();
  let pending = "";
  let content = "";
  let finishReason: unknown;
  let usage: ChatBody["usage"];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    onPiece();
    pending += decoder.decode(value, { stream: true });
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      const data = line.trim().replace(/^data:\s*/, "");
      if (!data || data === "[DONE]" || !line.trim().startsWith("data:")) continue;
      try {
        const chunk = JSON.parse(data) as {
          choices?: { delta?: { content?: unknown }; finish_reason?: unknown }[];
          usage?: ChatBody["usage"];
        };
        const piece = chunk.choices?.[0]?.delta?.content;
        if (typeof piece === "string") content += piece;
        if (chunk.choices?.[0]?.finish_reason) finishReason = chunk.choices[0].finish_reason;
        if (chunk.usage) usage = chunk.usage;
      } catch {
        // A keep-alive or comment line: nothing to add.
      }
    }
  }
  return { choices: [{ message: { content }, finish_reason: finishReason }], usage };
}

// Connections (base URL and model) that answered 400 to reasoning_effort, so later requests leave it out.
const reasoningEffortRejected = new Set<string>();

// A reasoning model's thinking comes out of max_tokens too, so each effort gets room for it on top of the answer.
// No effort sent leaves the model at its own default, which is about medium.
const THINKING_TOKENS: Record<ReasoningEffort | "unset", number> = {
  none: 0,
  low: 2048,
  medium: 6144,
  high: 12288,
  unset: 6144,
};

/** Throws the given message as the answer's problem, logging what an admin needs to tell why. */
export type Unusable = (message: string) => Error;

/**
 * Asks a provider for one JSON answer in `schema`, retrying what a retry can fix, and hands the parsed object to
 * `read`, which returns what the feature needs or throws `unusable(...)` for an answer it can't use.
 */
export async function askProvider<T>(options: {
  settings: ProviderSettings;
  content: ProviderContent;
  schemaName: string;
  schema: object;
  /** Room for the answer itself; room for thinking is added for the reasoning effort sent. */
  answerTokens: number;
  attempts?: number;
  log: Logger;
  /** What a missing answer is called in the error, e.g. "no classification". */
  noAnswer: string;
  /**
   * For long answers: the provider streams it, and the wait is for each piece rather than the whole. It gets
   * `firstChunkMs` to start (reading a long prompt on a CPU takes a while), then gives up only after `idleMs`
   * without a new piece, however long the answer takes in all. A timed-out stream isn't asked again: the abandoned
   * one would still be running ahead of it.
   */
  stream?: { firstChunkMs: number; idleMs: number };
  read: (json: unknown, unusable: Unusable, answer: Record<string, unknown>) => T;
}): Promise<T> {
  const {
    settings,
    content,
    schemaName,
    schema,
    answerTokens,
    attempts = 3,
    log: requestLog,
    noAnswer,
    read,
  } = options;
  const { stream } = options;
  const connection = `${settings.baseUrl}|${settings.model}`;
  let reasoningEffort = reasoningEffortRejected.has(connection) ? null : settings.reasoningEffort;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const last = attempt === attempts - 1;
    const started = Date.now();
    const controller = new AbortController();
    // Streaming, the wait starts over with every piece; otherwise it's one wait for the whole answer.
    const waited = { timeoutMs: stream ? stream.firstChunkMs : settings.timeoutMs, stalled: false };
    let timeout = setTimeout(() => controller.abort(), waited.timeoutMs);
    const stillAnswering = () => {
      if (!stream) return;
      clearTimeout(timeout);
      waited.timeoutMs = stream.idleMs;
      waited.stalled = true;
      timeout = setTimeout(() => controller.abort(), stream.idleMs);
    };
    try {
      const response = await fetch(chatUrl(settings.baseUrl!), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(settings.apiKey ? { authorization: `Bearer ${settings.apiKey}` } : {}),
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: settings.model,
          temperature: 0,
          // A safety net against a model that loops, not a fit: a normal answer should never reach it.
          max_tokens: answerTokens + THINKING_TOKENS[reasoningEffort ?? "unset"],
          ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
          response_format: { type: "json_schema", json_schema: { name: schemaName, strict: true, schema } },
          // These tasks rarely need much thought, and a reasoning model spends max_tokens on it before answering.
          // Models differ in what they take: "none" stops qwen3 thinking, but gpt-oss ignores it and needs "low".
          ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
          messages: [{ role: "user", content }],
        }),
      });
      if (!response.ok) {
        // Strict providers reject the field outright, e.g. OpenAI for a model that doesn't reason: ask again
        // without it, which doesn't count as an attempt. Only when the error names it, so another bad request
        // isn't taken for proof that the connection can't take a reasoning effort.
        if (response.status === 400 && reasoningEffort && /reasoning/i.test(await response.clone().text())) {
          reasoningEffort = null;
          reasoningEffortRejected.add(connection);
          requestLog.warn("provider rejected reasoning_effort, asking again without it");
          attempt--;
          continue;
        }
        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable || last) throw new Error(`AI provider returned HTTP ${response.status}`);
        const retryAfterHeader = response.headers.get("retry-after");
        const retryAfter = retryAfterHeader === null ? Number.NaN : Number(retryAfterHeader);
        const delay =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(30000, retryAfter * 1000)
            : attempt === 0
              ? 1000
              : 3000;
        requestLog.warn("provider request failed, retrying", {
          status: response.status,
          attempt: attempt + 1,
          attempts,
          delay_ms: delay,
        });
        await retryDelay(delay);
        continue;
      }
      // A provider that ignores `stream` answers in one piece, which reads the usual way.
      const body: ChatBody = (response.headers.get("content-type") ?? "").includes("text/event-stream")
        ? await readStream(response, stillAnswering)
        : ((await response.json()) as ChatBody);
      const raw = body.choices?.[0]?.message?.content;
      // What an admin needs to tell a cut-off answer (a reasoning model spending the token budget) from a bad one.
      const answer = {
        ms: Date.now() - started,
        finish_reason: body.choices?.[0]?.finish_reason,
        completion_tokens: body.usage?.completion_tokens,
        reasoning_tokens: body.usage?.completion_tokens_details?.reasoning_tokens,
        answer_chars: typeof raw === "string" ? raw.length : undefined,
      };
      const unusable: Unusable = (message) => {
        requestLog.warn("provider answer unusable", {
          problem: message,
          ...answer,
          answer_end: typeof raw === "string" ? raw.slice(-120) : undefined,
        });
        return new Error(message);
      };
      if (typeof raw !== "string") throw unusable(`AI provider returned ${noAnswer}`);
      const unfenced = raw
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "");
      const json = parseAnswerJson(unfenced);
      if (json === undefined) {
        // JSON.parse only says where it stopped, which tells an admin nothing about the provider.
        if (body.choices?.[0]?.finish_reason === "length")
          throw unusable("AI provider cut the answer off at its token limit");
        throw unusable("AI provider returned an answer that is not valid JSON");
      }
      return read(json, unusable, answer);
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "AbortError";
      const retryable = error instanceof TypeError || (timedOut && !stream);
      if (!retryable || last) throw noSecretError(readableNetworkError(error, waited));
      requestLog.warn("provider unreachable, retrying", {
        error: noSecretError(readableNetworkError(error, waited)),
        attempt: attempt + 1,
        attempts,
      });
      await retryDelay(attempt === 0 ? 1000 : 3000);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error("AI provider request failed");
}
