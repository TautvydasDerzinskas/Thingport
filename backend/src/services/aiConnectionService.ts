import type { AiConnection, AiProviderKind, Prisma, ReasoningEffort } from "@prisma/client";
import { prisma } from "../db";
import { HttpError } from "../utils/fileUtils";
import { normalizeAiBaseUrl } from "./settingsService";

/** What a request to a provider needs, whether the connection is saved or only typed into the form. */
export type AiProvider = Pick<
  AiConnection,
  "kind" | "baseUrl" | "apiKey" | "model" | "timeoutMs" | "concurrency" | "reasoningEffort"
>;

export type AiConnectionInput = {
  /** OpenAI-compatible unless said otherwise. */
  kind?: AiProviderKind;
  baseUrl: string;
  apiKey: string | null;
  model: string;
  timeoutMs: number;
  concurrency: number;
  reasoningEffort: ReasoningEffort | null;
  /** Takes pictures in a prompt; guessed from the model when not given. */
  vision?: boolean;
};

// Models whose names say they take pictures: Claude, OpenAI's multimodal ones, Gemini, and the open vision models. The
// migration that brought the setting in starts the AIs already saved on the same guess.
const VISION_MODELS =
  /(gpt-4o|gpt-4\.1|gpt-4-turbo|gpt-5|^o[134](?:[-_]|$)|gemini|claude|llava|vision|vl(?:[-_:.]|$)|gemma-?3|minicpm-v|pixtral|llama-?4|mistral-small-?3\.[12]|moondream|internvl|multimodal|omni)/i;

/** Whether an AI takes pictures, as far as its kind and model name tell: what a new one starts with. */
export function guessVision(kind: AiProviderKind, model: string): boolean {
  return kind === "anthropic" || VISION_MODELS.test(model);
}

export const DEFAULT_AI_PROVIDER: Omit<AiProvider, "baseUrl" | "model"> = {
  kind: "openai",
  apiKey: null,
  timeoutMs: 60000,
  concurrency: 1,
  reasoningEffort: null,
};

// Any number, as long as only the default's writers take it. Two AIs added at once would otherwise both count no
// default under Read Committed, and both become it.
const DEFAULT_LOCK = 74_210_301;

async function lockDefault(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${DEFAULT_LOCK})`;
}

export async function listAiConnections(): Promise<AiConnection[]> {
  return prisma.aiConnection.findMany({ orderBy: [{ position: "asc" }, { createdAt: "asc" }] });
}

export async function getAiConnection(id: string): Promise<AiConnection> {
  const connection = await prisma.aiConnection.findUnique({ where: { id } });
  if (!connection) throw new HttpError(404, "AI not found", "ai_not_found");
  return connection;
}

/** The one a feature set to `id` uses: that AI while it exists, otherwise the default. */
export async function resolveAiConnection(id: string | null | undefined): Promise<AiConnection | null> {
  if (id) {
    const chosen = await prisma.aiConnection.findUnique({ where: { id } });
    if (chosen) return chosen;
  }
  return prisma.aiConnection.findFirst({ where: { isDefault: true } });
}

/** What a feature set to `id` talks to; base URL and model are null while there's no AI at all. */
export type ResolvedAiProvider = Omit<AiProvider, "baseUrl" | "model"> & {
  baseUrl: string | null;
  model: string | null;
  connectionId: string | null;
};

export async function resolveAiProvider(id: string | null | undefined): Promise<ResolvedAiProvider> {
  const connection = await resolveAiConnection(id);
  if (!connection) return { ...DEFAULT_AI_PROVIDER, baseUrl: null, model: null, connectionId: null };
  return {
    kind: connection.kind,
    baseUrl: connection.baseUrl,
    apiKey: connection.apiKey,
    model: connection.model,
    timeoutMs: connection.timeoutMs,
    concurrency: connection.concurrency,
    reasoningEffort: connection.reasoningEffort,
    connectionId: connection.id,
  };
}

/** The first AI becomes the default, so a feature always has one to use. */
export async function createAiConnection(input: AiConnectionInput): Promise<AiConnection> {
  return prisma.$transaction(async (tx) => {
    await lockDefault(tx);
    const last = await tx.aiConnection.findFirst({ orderBy: { position: "desc" } });
    const hasDefault = await tx.aiConnection.count({ where: { isDefault: true } });
    return tx.aiConnection.create({
      data: {
        ...input,
        vision: input.vision ?? guessVision(input.kind ?? DEFAULT_AI_PROVIDER.kind, input.model),
        baseUrl: normalizeAiBaseUrl(input.baseUrl, input.kind) ?? input.baseUrl,
        isDefault: !hasDefault,
        position: last ? last.position + 1 : 0,
      },
    });
  });
}

export async function updateAiConnection(id: string, patch: Partial<AiConnectionInput>): Promise<AiConnection> {
  const saved = await getAiConnection(id);
  const kind = patch.kind ?? saved.kind;
  return prisma.aiConnection.update({
    where: { id },
    data: {
      ...patch,
      ...(patch.baseUrl !== undefined ? { baseUrl: normalizeAiBaseUrl(patch.baseUrl, kind) ?? "" } : {}),
    },
  });
}

export async function setDefaultAiConnection(id: string): Promise<AiConnection> {
  await getAiConnection(id);
  return prisma.$transaction(async (tx) => {
    await lockDefault(tx);
    await tx.aiConnection.updateMany({ where: { isDefault: true, NOT: { id } }, data: { isDefault: false } });
    return tx.aiConnection.update({ where: { id }, data: { isDefault: true } });
  });
}

/** Deleting the default hands the role to the next AI in order, so features keep working while any is left. */
export async function deleteAiConnection(id: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockDefault(tx);
    // Read under the lock: a default made meanwhile must still be handed on.
    const connection = await tx.aiConnection.findUnique({ where: { id } });
    if (!connection) throw new HttpError(404, "AI not found", "ai_not_found");
    await tx.aiConnection.delete({ where: { id } });
    if (!connection.isDefault) return;
    const next = await tx.aiConnection.findFirst({ orderBy: [{ position: "asc" }, { createdAt: "asc" }] });
    if (next) await tx.aiConnection.update({ where: { id: next.id }, data: { isDefault: true } });
  });
}
