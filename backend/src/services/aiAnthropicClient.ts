import Anthropic from "@anthropic-ai/sdk";
import type { ReasoningEffort } from "@prisma/client";
import { parseAnswerJson } from "./aiAnswerJson";
import type { AskOptions, ProviderContent, Unusable } from "./aiProviderClient";

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
  const fallback =
    FALLBACK_MODELS.has(settings.model) && URL.canParse(baseUrl) && new URL(baseUrl).hostname === "api.anthropic.com";

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
