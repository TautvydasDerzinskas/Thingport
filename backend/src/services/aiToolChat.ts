import type { Logger } from "../logger";
import { claudeToolTurn } from "./aiAnthropicClient";
import {
  chatUrl,
  noSecretError,
  readableNetworkError,
  reasoningEffortRejected,
  THINKING_TOKENS,
  waitToRetry,
  type ProviderSettings,
} from "./aiProviderClient";

// A conversation in which an AI uses tools, one turn at a time, for either kind of AI: the OpenAI-style function
// calling below, or Claude's tool use (aiAnthropicClient.ts). The caller runs the tools and keeps the conversation.

export type ToolSpec = {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  /** Left out of the prompt until the AI searches for it, where the AI can search (Claude's tool search). */
  deferred?: boolean;
};
/** `invalid` when the AI's arguments weren't a JSON object: the tool isn't run, and the AI is told. */
export type ToolCall = { id: string; name: string; args: Record<string, unknown>; invalid?: string };
export type ToolResult = {
  id: string;
  name: string;
  text: string;
  isError: boolean;
  /** Base64 PNGs, for AIs that see pictures. */
  images: ChatImage[];
};
/** A picture as an AI is sent it. */
export type ChatImage = { data: string; mimeType: string };
export type ChatMessage =
  /** `images` are the person's own pictures, sent with what they asked: only to an AI that sees them. */
  | { role: "user"; text: string; images?: ChatImage[] }
  /** `raw` is the provider's own answer, replayed as it came: Claude's thinking has to go back unchanged. */
  | { role: "assistant"; text: string; calls: ToolCall[]; raw?: unknown }
  | { role: "tool"; results: ToolResult[] };

export type ChatTurn = {
  text: string;
  calls: ToolCall[];
  raw?: unknown;
  /** tools: it called some; answer: it's done; limit: it ran out of tokens; refusal: it declined; paused: it stopped
   *  mid-turn on its own side (Claude's server tools) and goes on when asked again as it is. */
  ended: "tools" | "answer" | "limit" | "refusal" | "paused";
};

export type ToolChatRequest = {
  system: string;
  messages: ChatMessage[];
  tools: ToolSpec[];
  /** Stops the turn: the run was stopped or ran out of time. */
  signal: AbortSignal;
  log: Logger;
  /** Lets an AI that can find tools itself be sent only the ones not deferred. */
  toolSearch?: boolean;
};

// Room for one turn's text and tool calls, before thinking.
const TURN_TOKENS = 8192;
// A turn can take a while: a long design to read, thinking, a slow local model.
const MIN_TURN_MS = 120_000;
const ATTEMPTS = 3;

/** The AI that can't use tools is told apart from any other bad request: the assistant needs them. */
export const NO_TOOLS = "This AI can't use tools, which the Studio assistant needs. Pick another one.";
/** An AI marked as seeing pictures that turned the person's own down: leaving them out would answer another question. */
export const NO_PICTURES =
  "This AI turned the pictures down. An admin can switch off Sees pictures for it in Administration > AI, or pick another AI.";

// Connections whose provider turned pictures down in a tool result's follow-up, so later turns leave them out.
const imagesRejected = new Set<string>();

/** One turn of the conversation: the AI's text and the tools it wants run. */
export function toolChatTurn(settings: ProviderSettings, request: ToolChatRequest): Promise<ChatTurn> {
  if (settings.kind === "anthropic") return claudeToolTurn(settings, request, waitToRetry);
  return openAiToolTurn(settings, request);
}

type OpenAiMessage = Record<string, unknown>;

const imagePart = (image: ChatImage) => ({
  type: "image_url",
  image_url: { url: `data:${image.mimeType};base64,${image.data}` },
});

/** The conversation as OpenAI-style chat messages. A tool message can only hold text, so pictures follow in a user
 *  message of their own. `withImages` is for the tools' pictures; the person's own always go. */
function openAiMessages(request: ToolChatRequest, withImages: boolean): OpenAiMessage[] {
  const out: OpenAiMessage[] = [{ role: "system", content: request.system }];
  for (const message of request.messages) {
    if (message.role === "user")
      out.push({
        role: "user",
        content: message.images?.length
          ? [...message.images.map(imagePart), { type: "text", text: message.text }]
          : message.text,
      });
    else if (message.role === "assistant")
      out.push({
        role: "assistant",
        content: message.text || null,
        ...(message.calls.length
          ? {
              tool_calls: message.calls.map((call) => ({
                id: call.id,
                type: "function",
                function: { name: call.name, arguments: JSON.stringify(call.args) },
              })),
            }
          : {}),
      });
    else {
      for (const result of message.results) out.push({ role: "tool", tool_call_id: result.id, content: result.text });
      const images = withImages ? message.results.flatMap((result) => result.images) : [];
      if (images.length)
        out.push({
          role: "user",
          content: [{ type: "text", text: "The pictures the tool took:" }, ...images.map(imagePart)],
        });
    }
  }
  return out;
}

type OpenAiAnswer = {
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; prompt_tokens_details?: { cached_tokens?: unknown } };
  choices?: {
    message?: {
      content?: unknown;
      tool_calls?: { id?: unknown; function?: { name?: unknown; arguments?: unknown } }[];
    };
    finish_reason?: unknown;
  }[];
};

function readCalls(answer: OpenAiAnswer): ToolCall[] {
  const raw = answer.choices?.[0]?.message?.tool_calls;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((call, index): ToolCall[] => {
    const name = call.function?.name;
    if (typeof name !== "string") return [];
    // Ollama names no ids, and some providers send the arguments as an object rather than JSON text.
    const id = typeof call.id === "string" && call.id ? call.id : `call_${index}`;
    const given = call.function?.arguments;
    if (given && typeof given === "object" && !Array.isArray(given))
      return [{ id, name, args: given as Record<string, unknown> }];
    try {
      const parsed: unknown = JSON.parse(typeof given === "string" && given.trim() ? given : "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
        return [{ id, name, args: parsed as Record<string, unknown> }];
    } catch {
      // Falls through to an invalid call.
    }
    return [{ id, name, args: {}, invalid: String(given).slice(0, 200) }];
  });
}

async function openAiToolTurn(settings: ProviderSettings, request: ToolChatRequest): Promise<ChatTurn> {
  if (!settings.baseUrl || !settings.model) throw new Error("Set the API base URL and model name first");
  const connection = `${settings.baseUrl}|${settings.model}`;
  let reasoningEffort = reasoningEffortRejected.has(connection) ? null : settings.reasoningEffort;
  let withImages = !imagesRejected.has(connection);
  const timeoutMs = Math.max(settings.timeoutMs, MIN_TURN_MS);
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const last = attempt === ATTEMPTS - 1;
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]);
    try {
      const response = await fetch(chatUrl(settings.baseUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(settings.apiKey ? { authorization: `Bearer ${settings.apiKey}` } : {}),
        },
        signal,
        body: JSON.stringify({
          model: settings.model,
          max_tokens: TURN_TOKENS + THINKING_TOKENS[reasoningEffort ?? "unset"],
          messages: openAiMessages(request, withImages),
          tools: request.tools.map((tool) => ({
            type: "function",
            function: { name: tool.name, description: tool.description, parameters: tool.schema },
          })),
          tool_choice: "auto",
          ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
        }),
      });
      if (!response.ok) {
        const problem = response.status === 400 ? await response.text() : "";
        // What the provider can't take is left out, and it's asked again; that doesn't count as an attempt.
        if (reasoningEffort && /reasoning/i.test(problem)) {
          reasoningEffort = null;
          reasoningEffortRejected.add(connection);
          attempt--;
          continue;
        }
        if (
          /image/i.test(problem) &&
          request.messages.some((message) => message.role === "user" && message.images?.length)
        )
          throw new Error(NO_PICTURES);
        if (withImages && /image/i.test(problem)) {
          withImages = false;
          imagesRejected.add(connection);
          request.log.warn("provider turned pictures down, asking again without them");
          attempt--;
          continue;
        }
        if (/tool/i.test(problem) && /support|not allowed|unsupported/i.test(problem)) throw new Error(NO_TOOLS);
        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable || last) throw new Error(`AI provider returned HTTP ${response.status}`);
        const retryAfter = Number(response.headers.get("retry-after") ?? Number.NaN);
        await waitToRetry(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(30000, retryAfter * 1000) : 2000);
        continue;
      }
      const answer = (await response.json()) as OpenAiAnswer;
      // OpenAI and the like cache a prompt's unchanged start on their own: this says how much of it they reused.
      request.log.debug("turn answered", {
        input_tokens: answer.usage?.prompt_tokens,
        cached_tokens: answer.usage?.prompt_tokens_details?.cached_tokens,
        output_tokens: answer.usage?.completion_tokens,
      });
      const content = answer.choices?.[0]?.message?.content;
      const text = typeof content === "string" ? content.trim() : "";
      const calls = readCalls(answer);
      const finish = answer.choices?.[0]?.finish_reason;
      return {
        text,
        calls,
        ended: calls.length ? "tools" : finish === "length" ? "limit" : "answer",
      };
    } catch (error) {
      if (request.signal.aborted) throw error;
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      if (!(error instanceof TypeError) || last)
        throw noSecretError(
          timedOut
            ? new Error(`The AI provider did not answer within ${Math.round(timeoutMs / 1000)} s`)
            : readableNetworkError(error, { timeoutMs }),
        );
      await waitToRetry(attempt === 0 ? 1000 : 3000);
    }
  }
  throw new Error("AI provider request failed");
}
