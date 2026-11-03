import Anthropic from "@anthropic-ai/sdk";
import type { ReasoningEffort } from "@prisma/client";
import { parseAnswerJson } from "./aiAnswerJson";
import type { AskOptions, ProviderContent, ProviderSettings, Unusable } from "./aiProviderClient";
import type { ChatMessage, ChatTurn, ToolCall, ToolChatRequest } from "./aiToolChat";

// Claude, through Anthropic's own Messages API: what askProvider does for an OpenAI-style provider, for an AI of the
// "anthropic" kind. The same question in and the same parsed answer or error out, so a feature can't tell which.

/** Where Claude answers unless an admin points it at a proxy. */
export const CLAUDE_BASE_URL = "https://api.anthropic.com";

// Models whose safety classifiers can decline something harmless, a prop sword's description say. Anthropic's
// server-side fallback then answers with another model in the same request; only its own API offers it.
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

type ClaudeEffort = "low" | "medium" | "high";
// Current Claude models always think, so "none" asks for as little as they take.
const EFFORT: Record<ReasoningEffort, ClaudeEffort> = { none: "low", low: "low", medium: "medium", high: "high" };
// Thinking comes out of max_tokens too. With no effort sent a model takes its own default, high on some.
const THINKING_TOKENS: Record<ClaudeEffort | "unset", number> = { low: 4096, medium: 8192, high: 16384, unset: 16384 };

// What structured outputs don't take; the features check these themselves.
const UNSUPPORTED_KEYWORDS = new Set([
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
]);

// Anthropic lists a few dozen models, a thousand to a page.
const MODEL_PAGES = 10;

// Connections (base URL and model) that answered 400 to an effort or to structured outputs, older models that take
// neither, so later requests leave it out.
const effortRejected = new Set<string>();
const formatRejected = new Set<string>();
const toolSearchRejected = new Set<string>();

function wantsFallback(model: string, baseUrl: string): boolean {
  return FALLBACK_MODELS.has(model) && URL.canParse(baseUrl) && new URL(baseUrl).hostname === "api.anthropic.com";
}

/** A feature's schema as Claude's structured outputs take it. */
export function claudeSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(claudeSchema);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (UNSUPPORTED_KEYWORDS.has(key)) continue;
    if (key === "enum" || key === "const") out[key] = value;
    // Property names are the feature's own, not keywords: "maximum" may well be one.
    else if ((key === "properties" || key === "$defs") && value && typeof value === "object")
      out[key] = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, claudeSchema(child)]));
    else out[key] = claudeSchema(value);
  }
  return out;
}

/** The question as Claude's content blocks: the preview image first, as Claude reads an image best before the text
 *  about it. */
export function claudeContent(content: ProviderContent): Anthropic.Beta.BetaContentBlockParam[] {
  const images = content.flatMap((part): Anthropic.Beta.BetaContentBlockParam[] => {
    if (part.type !== "image_url") return [];
    const data = /^data:(image\/(?:jpeg|png|gif|webp));base64,(.+)$/.exec(part.image_url.url);
    if (!data) return [{ type: "image", source: { type: "url", url: part.image_url.url } }];
    const mediaType = data[1] as "image/jpeg" | "image/png" | "image/gif" | "image/webp";
    return [{ type: "image", source: { type: "base64", media_type: mediaType, data: data[2] } }];
  });
  const texts = content.flatMap((part): Anthropic.Beta.BetaContentBlockParam[] =>
    part.type === "text" ? [{ type: "text", text: part.text }] : [],
  );
  return [...images, ...texts];
}

/** The Claude API's own words for what went wrong, without the key. */
function apiMessage(error: InstanceType<typeof Anthropic.APIError>, apiKey: string): string {
  const body = error.error as { error?: { message?: unknown } } | undefined;
  const message = typeof body?.error?.message === "string" ? body.error.message : "";
  return message.replaceAll(apiKey, "[redacted]");
}

function readableHttpError(error: InstanceType<typeof Anthropic.APIError>, apiKey: string): Error {
  const message = apiMessage(error, apiKey);
  if (error.status === 401) return new Error("Claude rejected the API key (HTTP 401)");
  return new Error(`AI provider returned HTTP ${error.status}${message ? `: ${message}` : ""}`);
}

/** The models the key may use, from Anthropic's Models API, for the settings form and the health check. The whole
 *  list gets `timeoutMs` and at most MODEL_PAGES pages, so a proxy that always says there are more can't hold it. */
export async function listClaudeModels(
  provider: { baseUrl: string | null; apiKey: string | null },
  timeoutMs: number,
): Promise<{ ok: true; models: string[] } | { ok: false; error: string }> {
  if (!provider.apiKey) return { ok: false, error: "Claude needs an API key" };
  const client = new Anthropic({
    apiKey: provider.apiKey,
    baseURL: provider.baseUrl ?? CLAUDE_BASE_URL,
    maxRetries: 0,
  });
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const ids: string[] = [];
    let afterId: string | null = null;
    for (let page = 0; page < MODEL_PAGES; page++) {
      const listed = await client.models.list({ limit: 1000, ...(afterId ? { after_id: afterId } : {}) }, { signal });
      ids.push(...listed.data.map((model) => model.id));
      if (!listed.has_more || !listed.last_id) break;
      afterId = listed.last_id;
    }
    return { ok: true, models: [...new Set(ids)].toSorted((a, b) => a.localeCompare(b)) };
  } catch (error) {
    if (error instanceof Anthropic.APIUserAbortError || error instanceof Anthropic.APIConnectionTimeoutError)
      return { ok: false, error: `The AI provider did not answer within ${timeoutMs / 1000} s` };
    if (error instanceof Anthropic.APIConnectionError)
      return { ok: false, error: "Could not reach the AI provider. Check the API base URL." };
    if (error instanceof Anthropic.APIError)
      return { ok: false, error: readableHttpError(error, provider.apiKey).message };
    throw error;
  }
}

/** askProvider for Claude. `wait` is the pause before a retry, which tests shorten. */
export async function askClaude<T>(options: AskOptions<T>, wait: (milliseconds: number) => Promise<void>): Promise<T> {
  const { settings, content, schema, answerTokens, attempts = 3, log, noAnswer, read, stream } = options;
  if (!settings.apiKey) throw new Error("Claude needs an API key");
  if (!settings.model) throw new Error("Set the model name first");
  const apiKey = settings.apiKey;
  const baseUrl = settings.baseUrl ?? CLAUDE_BASE_URL;
  const connection = `${baseUrl}|${settings.model}`;
  // Its own retries are off: these below are the same for every provider, and know when a retry can't help.
  const client = new Anthropic({ apiKey, baseURL: baseUrl, maxRetries: 0 });
  let effort = settings.reasoningEffort && !effortRejected.has(connection) ? EFFORT[settings.reasoningEffort] : null;
  let structured = !formatRejected.has(connection);
  const fallback = wantsFallback(settings.model, baseUrl);

  for (let attempt = 0; attempt < attempts; attempt++) {
    const last = attempt === attempts - 1;
    const started = Date.now();
    const controller = new AbortController();
    const waited = { timeoutMs: stream ? stream.firstChunkMs : settings.timeoutMs, stalled: false };
    let timeout = setTimeout(() => controller.abort(), waited.timeoutMs);
    const stillAnswering = () => {
      if (!stream) return;
      clearTimeout(timeout);
      waited.timeoutMs = stream.idleMs;
      waited.stalled = true;
      timeout = setTimeout(() => controller.abort(), stream.idleMs);
    };
    // Without structured outputs the schema goes in the question, and the answer is read as leniently as an
    // OpenAI-style provider's.
    const question: ProviderContent = structured
      ? content
      : [
          ...content,
          {
            type: "text",
            text: `Answer with only a JSON object that follows this JSON schema:\n${JSON.stringify(schema)}`,
          },
        ];
    const outputConfig = {
      ...(structured
        ? { format: { type: "json_schema" as const, schema: claudeSchema(schema) as Record<string, unknown> } }
        : {}),
      ...(effort ? { effort } : {}),
    };
    const params = {
      model: settings.model,
      max_tokens: answerTokens + THINKING_TOKENS[effort ?? "unset"],
      messages: [{ role: "user" as const, content: claudeContent(question) }],
      ...(Object.keys(outputConfig).length ? { output_config: outputConfig } : {}),
      ...(fallback ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
    };
    try {
      let message: Anthropic.Beta.BetaMessage;
      if (stream) {
        const running = client.beta.messages.stream(params, { signal: controller.signal });
        // Every event, thinking included, says Claude is still at it.
        running.on("streamEvent", stillAnswering);
        message = await running.finalMessage();
      } else {
        message = await client.beta.messages.create(params, { signal: controller.signal });
      }
      const raw = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
      // What an admin needs to tell a cut-off answer from a bad one.
      const answer = {
        ms: Date.now() - started,
        stop_reason: message.stop_reason,
        output_tokens: message.usage.output_tokens,
        answer_chars: raw.length,
        model: message.model,
      };
      const unusable: Unusable = (problem) => {
        log.warn("provider answer unusable", { problem, ...answer, answer_end: raw.slice(-120) });
        return new Error(problem);
      };
      if (message.stop_reason === "refusal") {
        const category = message.stop_details?.category;
        throw unusable(`Claude declined to answer${category ? ` (${category})` : ""}`);
      }
      if (message.stop_reason === "max_tokens") throw unusable("AI provider cut the answer off at its token limit");
      if (!raw.trim()) throw unusable(`AI provider returned ${noAnswer}`);
      const json = parseAnswerJson(raw);
      if (json === undefined) throw unusable("AI provider returned an answer that is not valid JSON");
      return read(json, unusable, answer);
    } catch (error) {
      if (error instanceof Anthropic.BadRequestError) {
        // An older model that takes no effort, or no structured outputs: ask again without it, which doesn't count
        // as an attempt. Only when the error names it, so another bad request isn't taken for that.
        const problem = apiMessage(error, apiKey);
        if (effort && /effort/i.test(problem)) {
          effort = null;
          effortRejected.add(connection);
          log.warn("Claude rejected the effort, asking again without it", { problem });
          attempt--;
          continue;
        }
        if (structured && /output_config|output_format|structured output|json_schema/i.test(problem)) {
          structured = false;
          formatRejected.add(connection);
          log.warn("Claude rejected structured outputs, asking for JSON in the prompt", { problem });
          attempt--;
          continue;
        }
      }
      if (error instanceof Anthropic.APIUserAbortError) {
        // A timed-out stream isn't asked again: the abandoned one would still be running ahead of it.
        const timedOut = new Error(
          waited.stalled
            ? `The AI provider stopped answering for ${Math.round(waited.timeoutMs / 1000)} s`
            : `The AI provider did not answer within ${Math.round(waited.timeoutMs / 1000)} s`,
        );
        if (stream || last) throw timedOut;
        log.warn("provider unreachable, retrying", { error: timedOut.message, attempt: attempt + 1, attempts });
        await wait(attempt === 0 ? 1000 : 3000);
        continue;
      }
      if (error instanceof Anthropic.APIConnectionError) {
        const unreachable = new Error("Could not reach the AI provider. Check the API base URL.");
        if (last) throw unreachable;
        log.warn("provider unreachable, retrying", { error: unreachable.message, attempt: attempt + 1, attempts });
        await wait(attempt === 0 ? 1000 : 3000);
        continue;
      }
      if (error instanceof Anthropic.APIError && typeof error.status === "number") {
        // 429 and the 5xx family, overloaded (529) included, are worth another try.
        const retryable = error.status === 429 || error.status >= 500;
        if (!retryable || last) throw readableHttpError(error, apiKey);
        const retryAfter = Number(error.headers?.get("retry-after") ?? Number.NaN);
        const delay =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(30000, retryAfter * 1000)
            : attempt === 0
              ? 1000
              : 3000;
        log.warn("provider request failed, retrying", {
          status: error.status,
          attempt: attempt + 1,
          attempts,
          delay_ms: delay,
        });
        await wait(delay);
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error("AI provider request failed");
}

// Room for one turn of a tool conversation, before thinking; and how long a turn may take at least.
const TURN_TOKENS = 8192;
const MIN_TURN_MS = 120_000;

/** The conversation as Claude's messages: its own answers as they came, tool results with their pictures. */
function claudeMessages(messages: ChatMessage[]): Anthropic.Beta.BetaMessageParam[] {
  return messages.flatMap((message): Anthropic.Beta.BetaMessageParam[] => {
    if (message.role === "user") return [{ role: "user", content: message.text }];
    if (message.role === "assistant") {
      if (message.raw) return [{ role: "assistant", content: message.raw as Anthropic.Beta.BetaContentBlockParam[] }];
      const blocks: Anthropic.Beta.BetaContentBlockParam[] = [
        ...(message.text ? [{ type: "text" as const, text: message.text }] : []),
        ...message.calls.map((call) => ({ type: "tool_use" as const, id: call.id, name: call.name, input: call.args })),
      ];
      return blocks.length ? [{ role: "assistant", content: blocks }] : [];
    }
    return [
      {
        role: "user",
        content: message.results.map((result) => ({
          type: "tool_result" as const,
          tool_use_id: result.id,
          is_error: result.isError,
          content: [
            { type: "text" as const, text: result.text },
            ...result.images.map((image) => ({
              type: "image" as const,
              source: {
                type: "base64" as const,
                media_type: image.mimeType as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
                data: image.data,
              },
            })),
          ],
        })),
      },
    ];
  });
}

/** One turn of a tool conversation with Claude (aiToolChat.ts), retried as askClaude retries. */
export async function claudeToolTurn(
  settings: ProviderSettings,
  request: ToolChatRequest,
  wait: (milliseconds: number) => Promise<void>,
): Promise<ChatTurn> {
  if (!settings.apiKey) throw new Error("Claude needs an API key");
  if (!settings.model) throw new Error("Set the model name first");
  const apiKey = settings.apiKey;
  const baseUrl = settings.baseUrl ?? CLAUDE_BASE_URL;
  const connection = `${baseUrl}|${settings.model}`;
  const client = new Anthropic({ apiKey, baseURL: baseUrl, maxRetries: 0 });
  let effort = settings.reasoningEffort && !effortRejected.has(connection) ? EFFORT[settings.reasoningEffort] : null;
  const fallback = wantsFallback(settings.model, baseUrl);
  const timeoutMs = Math.max(settings.timeoutMs, MIN_TURN_MS);
  let search = Boolean(request.toolSearch) && !toolSearchRejected.has(connection);
  const messages = claudeMessages(request.messages);
  for (let attempt = 0; attempt < 3; attempt++) {
    // With tool search, Claude is sent the few tools it uses most and finds the rest by what they do; the deferred
    // ones stay out of the prompt, and what it finds is added further on, so the cached start stays as it was.
    const tools: Anthropic.Beta.BetaToolUnion[] = [
      ...(search ? [{ type: "tool_search_tool_bm25_20251119" as const, name: "tool_search_tool_bm25" as const }] : []),
      ...request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.schema as Anthropic.Beta.BetaTool.InputSchema,
        ...(search && tool.deferred ? { defer_loading: true } : {}),
      })),
    ];
    const last = attempt === 2;
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]);
    try {
      // Streamed, as a turn this long has to be; only the whole answer is used.
      const message = await client.beta.messages
        .stream(
          {
            model: settings.model,
            max_tokens: TURN_TOKENS + THINKING_TOKENS[effort ?? "unset"],
            // Cached up to the end of the instructions, so another run within a few minutes reads the tools and the
            // guide at a tenth of the price; and, by the top-level marker, up to the conversation's end as it grows.
            system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
            cache_control: { type: "ephemeral" },
            tools,
            messages,
            ...(effort ? { output_config: { effort } } : {}),
            ...(fallback ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
          },
          { signal },
        )
        .finalMessage();
      request.log.debug("turn answered", {
        input_tokens: message.usage.input_tokens,
        cache_read_tokens: message.usage.cache_read_input_tokens,
        cache_written_tokens: message.usage.cache_creation_input_tokens,
        output_tokens: message.usage.output_tokens,
      });
      const text = message.content
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join("")
        .trim();
      if (message.stop_reason === "refusal") {
        const category = message.stop_details?.category;
        return {
          text: `Claude declined to answer${category ? ` (${category})` : ""}`,
          calls: [],
          raw: message.content,
          ended: "refusal",
        };
      }
      // A tool call cut off at the token limit is only half there: none is run.
      if (message.stop_reason === "max_tokens") return { text, calls: [], raw: message.content, ended: "limit" };
      // A server tool, its search, went on too long for one turn: asked again with this as it is, Claude goes on.
      if (message.stop_reason === "pause_turn") return { text, calls: [], raw: message.content, ended: "paused" };
      const calls = message.content.flatMap((block): ToolCall[] =>
        block.type === "tool_use"
          ? [
              {
                id: block.id,
                name: block.name,
                args: (block.input && typeof block.input === "object" ? block.input : {}) as Record<string, unknown>,
              },
            ]
          : [],
      );
      return { text, calls, raw: message.content, ended: calls.length ? "tools" : "answer" };
    } catch (error) {
      if (request.signal.aborted) throw error;
      if (error instanceof Anthropic.BadRequestError && effort && /effort/i.test(apiMessage(error, apiKey))) {
        effort = null;
        effortRejected.add(connection);
        attempt--;
        continue;
      }
      // A model or a proxy without tool search gets every tool up front instead.
      if (
        error instanceof Anthropic.BadRequestError &&
        search &&
        /tool_search|defer_loading/i.test(apiMessage(error, apiKey))
      ) {
        search = false;
        toolSearchRejected.add(connection);
        request.log.warn("Claude turned tool search down, sending every tool instead");
        attempt--;
        continue;
      }
      // A turn that took too long isn't asked again: it would still be running ahead of the new one.
      if (error instanceof Anthropic.APIUserAbortError)
        throw new Error(`The AI provider did not answer within ${Math.round(timeoutMs / 1000)} s`, { cause: error });
      if (error instanceof Anthropic.APIConnectionError) {
        if (last) throw new Error("Could not reach the AI provider. Check the API base URL.", { cause: error });
        await wait(attempt === 0 ? 1000 : 3000);
        continue;
      }
      if (error instanceof Anthropic.APIError && typeof error.status === "number") {
        const retryable = error.status === 429 || error.status >= 500;
        if (!retryable || last) throw readableHttpError(error, apiKey);
        const retryAfter = Number(error.headers?.get("retry-after") ?? Number.NaN);
        await wait(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(30000, retryAfter * 1000) : 2000);
        continue;
      }
      throw error;
    }
  }
  throw new Error("AI provider request failed");
}
