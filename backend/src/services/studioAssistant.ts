import fs from "node:fs/promises";
import sharp from "sharp";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { StudioMessage } from "@prisma/client";
import { prisma } from "../db";
import { createLogger } from "../logger";
import { MCP_TOOLS } from "../mcp/tools";
import { WithImages, type McpToolContext, type McpToolDefinition } from "../mcp/toolTypes";
import { HttpError } from "../utils/fileUtils";
import { getAiConnection, resolveAiProvider } from "./aiConnectionService";
import { limited, noSecretError } from "./aiProviderClient";
import {
  toolChatTurn,
  type ChatImage,
  type ChatMessage,
  type ToolCall,
  type ToolResult,
  type ToolSpec,
} from "./aiToolChat";
import { LIMITS } from "../studio/document.generated";
import { getPublicUrl, getStudioAssistantPrefs } from "./settingsService";
import { STUDIO_GUIDE } from "./studioGuide";
import { getStudioDesign, studioPicturePath, type StudioPicture } from "./studioService";

// Studio's own assistant: a person asks in the prompt on the page, and the AI an admin offers for it makes the change
// with the design's MCP tools (mcp/studioTools.ts), the same commands as the toolbar, for that design only. Each step
// is a revision the page shows as it lands. One run per design at a time, kept here while it lasts; the conversation
// is kept in StudioMessage, as text, so a later prompt can build on it.

const log = createLogger("studio-assistant");

/** Tool calls one run may make before it's stopped. */
export const MAX_STEPS = 30;
/** How long one run may take in all. */
const RUN_MS = 10 * 60_000;
/** How much of the conversation a new prompt is sent with; less for the compact set's small models. */
const HISTORY = 20;
const COMPACT_HISTORY = 6;
/** Pictures one prompt may carry. */
export const MAX_PICTURES = 4;
// What an AI is sent of a picture: about as much as it looks at (Claude's own advice), as a JPEG.
const PICTURE_SEND_PX = 1568;

const SYSTEM = `You are the assistant in Thingport Studio, a CAD page for designing 3D-printable parts. The person asks
you to make or change the design open on their screen, and watches each step land as you take it.

- Work with the tools: they're the steps the person can take on the page. The design is already chosen, so the tools
  take no design id.
- Each request comes with the design as it is now. Name faces and edges from studio_inspect_body, and look at the result
  with studio_view_design when that helps.
- After a change, read the tool's reply for problems, and fix them before you finish.
- Don't ask before an ordinary change. Ask only when the request is unclear in a way that matters.
- When you're done, answer in one to three short sentences, in the person's language, saying what you made or changed.
  No tables, code or ids they didn't use.

${STUDIO_GUIDE}`;

// The design's own tools, for the open design only, and the library search an import needs. The guide goes in the
// system prompt, and other designs aren't this run's business.
const LEFT_OUT = new Set(["studio_list_designs", "studio_create_design", "studio_delete_design", "studio_guide"]);
const LIBRARY = new Set(["search_models", "list_model_files"]);

// With Claude's tool search, these are sent up front, the rest found by what they do.
const CORE = new Set([
  "studio_get_design",
  "studio_inspect_body",
  "studio_add_box",
  "studio_add_cylinder",
  "studio_boolean",
]);
const SEARCH_NOTE = `Only a few of your tools are loaded at first. Search for the rest by what they do: other shapes
(cone, sphere, torus), text, tracing a picture, sketches, extrude and revolve, press/pull, fillet, chamfer, hole,
shell, split, separating parts, scaling, moving, editing, renaming and deleting features, undo, looking at the design,
and finding a library model to import.`;

// For small local models: the few tools most requests need, each said in a line, and the arguments that matter. Every
// one is the same command as in full, so a person and the AI still change a design the same way.
const COMPACT: Record<string, { description: string; args: string[] }> = {
  studio_get_design: {
    description: "Reads the design: every feature with its id and sizes, and each body's size.",
    args: [],
  },
  studio_add_box: {
    description: "Adds a box: width (X), depth (Y), height (Z) in mm, its base centred on position.",
    args: ["width", "depth", "height", "position", "rotation"],
  },
  studio_add_cylinder: {
    description: "Adds a cylinder: radius and height in mm, its base centred on position.",
    args: ["radius", "height", "position", "rotation"],
  },
  studio_add_cone: {
    description:
      "Adds a cone: radius_bottom, radius_top (0 for a point) and height in mm, its base centred on position.",
    args: ["radius_bottom", "radius_top", "height", "position", "rotation"],
  },
  studio_add_sphere: {
    description: "Adds a sphere of a radius in mm, its lowest point at position.",
    args: ["radius", "position"],
  },
  studio_set_transform: {
    description:
      "Moves, turns or scales a body: position [x, y, z] in mm, rotation [x, y, z] in degrees, scale [x, y, z].",
    args: ["feature_id", "position", "rotation", "scale"],
  },
  studio_update_feature: {
    description: "Changes a shape's sizes in mm: a box's width, depth, height; a cylinder's radius; a hole's diameter.",
    args: ["feature_id", "width", "depth", "height", "radius", "radius_bottom", "radius_top", "diameter"],
  },
  studio_boolean: {
    description:
      "Makes one body of several: union joins them, subtract cuts tool_ids out of target_id, intersect keeps the overlap.",
    args: ["operation", "target_id", "tool_ids"],
  },
  studio_add_text: {
    description:
      "Adds 3D text: letters of a size in mm (a capital's height), standing height mm up from the bed (plane XY), centred on center.",
    args: ["text", "size", "height", "plane", "center"],
  },
  studio_trace_picture: {
    description:
      "Traces a picture attached to the prompt, by its id, into a solid: its dark shapes (light, with invert) as an outline width mm wide, extruded height mm up from the bed (plane XY).",
    args: ["picture_id", "width", "height", "invert", "plane"],
  },
  studio_hole: {
    description:
      "Drills a round hole into a body at point, going in against normal ([0, 0, 1] from the top); right through unless depth is given.",
    args: ["feature_id", "point", "normal", "diameter", "depth"],
  },
  studio_duplicate_feature: {
    description: "Copies a body, moved by offset [x, y, z] in mm.",
    args: ["feature_id", "offset"],
  },
  studio_delete_feature: { description: "Deletes a feature.", args: ["feature_id"] },
  studio_undo: { description: "Takes back the last change.", args: [] },
};
const COMPACT_SYSTEM = `You build and change 3D-printable parts in Thingport Studio with the tools. Millimetres; Z is up and
the bed is z = 0. A box, cylinder or cone stands on its position, the middle of its base; a sphere on its lowest point.
Rotation is degrees about X, then Y, then Z. Features have ids like box-1. Take one step at a time and read each reply.
When done, say in one or two sentences, in the person's language, what you made.`;

type AssistantTool = {
  tool: McpToolDefinition;
  schema: Record<string, unknown>;
  compact: Record<string, unknown> | null;
  scoped: boolean;
};
/** How a run's tools are sent: all of them; Claude's few, the rest found by search; or the compact few. */
type ToolMode = "full" | "search" | "compact";

// The converter MCP's SDK uses, so a tool reads as MCP clients see it. Typed loosely: its generics, over a shape of
// any tool's, recurse past TypeScript's limit.
const toJsonSchema = zodToJsonSchema as unknown as (schema: unknown, options: object) => Record<string, unknown>;

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A schema as it's sent: without what costs tokens and tells the AI nothing it needs (the server checks every call
 *  anyway): `additionalProperties: false`, the ±10 m limit on every coordinate, a tuple's same item said three times;
 *  and, for the compact set, the fields' own descriptions. */
function tighten(node: unknown, keepDescriptions: boolean): unknown {
  if (Array.isArray(node)) return node.map((item) => tighten(item, keepDescriptions));
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "additionalProperties" && value === false) continue;
    if ((key === "minimum" || key === "maximum") && Math.abs(value as number) === LIMITS.size) continue;
    if (key === "description" && !keepDescriptions && typeof value === "string") continue;
    if (
      key === "items" &&
      Array.isArray(value) &&
      value.length > 1 &&
      value.every((item) => sameJson(item, value[0]))
    ) {
      out.items = tighten(value[0], keepDescriptions);
      continue;
    }
    out[key] =
      key === "properties" && value && typeof value === "object"
        ? Object.fromEntries(Object.entries(value).map(([name, child]) => [name, tighten(child, keepDescriptions)]))
        : tighten(value, keepDescriptions);
  }
  return out;
}

let toolList: AssistantTool[] | null = null;

/** Each tool with its JSON schema, as MCP clients see it but without the design id, which a run fills in. */
function assistantTools(): AssistantTool[] {
  toolList ??= MCP_TOOLS.filter(
    (tool) => (tool.group === "studio" && !LEFT_OUT.has(tool.name)) || LIBRARY.has(tool.name),
  ).map((tool) => {
    const scoped = "design_id" in tool.inputSchema;
    const shape = Object.fromEntries(Object.entries(tool.inputSchema).filter(([key]) => key !== "design_id"));
    const json = (fields: object) => {
      // Inlined rather than with $refs, which small models follow badly; tightened, it comes out no longer.
      const schema = toJsonSchema(z.object(fields as z.ZodRawShape), {
        strictUnions: true,
        pipeStrategy: "input",
        $refStrategy: "none",
      });
      delete schema.$schema;
      return schema;
    };
    const small = COMPACT[tool.name];
    return {
      tool,
      schema: tighten(json(shape), true) as Record<string, unknown>,
      compact: small
        ? (tighten(
            json(Object.fromEntries(Object.entries(shape).filter(([key]) => small.args.includes(key)))),
            false,
          ) as Record<string, unknown>)
        : null,
      scoped,
    };
  });
  return toolList;
}

/** The tools as a run of this mode sends them. */
function toolSpecs(mode: ToolMode): ToolSpec[] {
  const tools = assistantTools();
  if (mode === "compact")
    return tools.flatMap((entry) =>
      entry.compact
        ? [{ name: entry.tool.name, description: COMPACT[entry.tool.name].description, schema: entry.compact }]
        : [],
    );
  return tools.map((entry) => ({
    name: entry.tool.name,
    description: entry.tool.description,
    schema: entry.schema,
    ...(mode === "search" && !CORE.has(entry.tool.name) ? { deferred: true } : {}),
  }));
}

/** The design as a compact run is told it: features and bodies with what's set, without the defaults and the rest. */
function compactState(state: string): string {
  try {
    const read = JSON.parse(state) as Record<string, unknown>;
    const plain = (key: string, value: unknown) =>
      (key === "name" && value === "") ||
      (key === "visible" && value === true) ||
      (key === "rotation" && sameJson(value, [0, 0, 0])) ||
      (key === "scale" && sameJson(value, [1, 1, 1]))
        ? undefined
        : value;
    return JSON.stringify({ top_level: read.top_level, features: read.features, bodies: read.bodies }, plain);
  } catch {
    return state;
  }
}

export type AssistantStep = { tool: string; title: string; summary: string | null; ok: boolean };
export type AssistantOutcome = "done" | "stopped" | "limit" | "failed";

type Run = {
  designId: string;
  userId: string;
  status: "running" | AssistantOutcome;
  steps: AssistantStep[];
  model: string;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  controller: AbortController;
};

// By design: the one running, or the last to finish, until the next starts or the conversation is cleared.
const runs = new Map<string, Run>();

function runOut(run: Run) {
  return {
    status: run.status,
    steps: run.steps,
    model: run.model,
    error: run.error,
    started_at: run.startedAt,
    finished_at: run.finishedAt,
  };
}

const picturesOf = (message: StudioMessage) => (message.pictures as StudioPicture[] | null) ?? [];

/** The pictures as the AI is told of them, by the ids trace_picture takes. */
function pictureNote(pictures: StudioPicture[]): string {
  return pictures.length
    ? `Pictures attached, by id: ${pictures.map((each) => `${each.id} (${each.width} × ${each.height} px)`).join(", ")}. ` +
        "studio_trace_picture turns a picture's shapes into a sketch outline to extrude, which is how a logo, a " +
        "silhouette or a drawn outline comes out exact; for an object, build it from shapes and compare it with " +
        "studio_view_design."
    : "";
}

/** A picture as the AI is sent it: flattened on white, no bigger than it looks at. */
async function chatImage(file: string): Promise<ChatImage> {
  const data = await sharp(await fs.readFile(file))
    .flatten({ background: "#ffffff" })
    .resize(PICTURE_SEND_PX, PICTURE_SEND_PX, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  return { data: data.toString("base64"), mimeType: "image/jpeg" };
}

function messageOut(message: StudioMessage) {
  return {
    id: message.id,
    role: message.role,
    text: message.text,
    pictures: picturesOf(message),
    steps: (message.steps as AssistantStep[] | null) ?? [],
    outcome: message.outcome,
    error: message.error,
    model: message.model,
    created_at: message.createdAt,
  };
}

/** The conversation about a design, and the run going on or just finished. */
export async function assistantThread(userId: string, designId: string) {
  await getStudioDesign(userId, designId);
  const messages = await prisma.studioMessage.findMany({
    where: { designId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const run = runs.get(designId);
  return { messages: messages.toReversed().map(messageOut), run: run ? runOut(run) : null };
}

/** What a run ends with as the conversation's next prompts read it: its answer, and what it did. */
function historyMessage(message: StudioMessage): ChatMessage | null {
  if (message.role === "user")
    return { role: "user", text: [message.text, pictureNote(picturesOf(message))].filter(Boolean).join("\n\n") };
  const steps = (message.steps as AssistantStep[] | null) ?? [];
  const done = steps.filter((step) => step.ok).map((step) => step.summary ?? step.title);
  const ending =
    message.outcome === "stopped"
      ? "The person stopped this run."
      : message.outcome === "limit"
        ? `This run stopped at the ${MAX_STEPS}-step limit.`
        : message.outcome === "failed"
          ? `This run failed: ${message.error ?? "unknown error"}.`
          : "";
  const text = [message.text, done.length ? `(Steps taken: ${done.join("; ")})` : "", ending ? `(${ending})` : ""]
    .filter(Boolean)
    .join("\n\n");
  return text ? { role: "assistant", text, calls: [] } : null;
}

async function runTool(
  entry: AssistantTool | undefined,
  call: ToolCall,
  ctx: McpToolContext,
  designId: string,
): Promise<{ result: ToolResult; summary: string | null }> {
  const fail = (text: string) => ({
    result: { id: call.id, name: call.name, text, isError: true, images: [] },
    summary: null,
  });
  if (!entry) return fail(`There's no tool called ${call.name}.`);
  if (call.invalid !== undefined) return fail(`The arguments weren't a JSON object: ${call.invalid}`);
  // The open design, whatever the AI said: a run only ever changes the design it was started on.
  const args = entry.scoped ? { ...call.args, design_id: designId } : call.args;
  // A shape of any tool's: typed loosely, as its generics recurse past TypeScript's limit.
  const parsed = (z.object(entry.tool.inputSchema) as z.ZodTypeAny).safeParse(args);
  if (!parsed.success)
    return fail(
      `Invalid arguments: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "(top)"}: ${issue.message}`).join("; ")}`,
    );
  try {
    const out = await entry.tool.run(ctx, parsed.data);
    const data = out instanceof WithImages ? out.data : out;
    const done = (data as { done?: unknown } | null)?.done;
    return {
      result: {
        id: call.id,
        name: call.name,
        text: JSON.stringify(data),
        isError: false,
        images: out instanceof WithImages ? out.images : [],
      },
      summary: typeof done === "string" ? done : null,
    };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

class Stopped extends Error {}

/** The pictures still kept, as the AI is sent them. */
async function picturesFor(userId: string, designId: string, pictures: StudioPicture[]): Promise<ChatImage[]> {
  const images: ChatImage[] = [];
  for (const picture of pictures) {
    const file = await studioPicturePath(userId, designId, picture.id);
    if (file) images.push(await chatImage(file));
  }
  return images;
}

/** Starts the assistant on a design. Runs in the background; the page follows it with assistantThread. */
export async function startAssistantRun(
  userId: string,
  designId: string,
  input: { prompt: string; aiConnectionId?: string | null; selected?: string[]; pictures?: string[] },
) {
  const prefs = await getStudioAssistantPrefs();
  if (!prefs.enabled)
    throw new HttpError(
      403,
      "The Studio assistant is off. An admin can turn it on in Administration > AI.",
      "studio_assistant_off",
    );
  const connectionId = input.aiConnectionId ?? prefs.defaultAiConnectionId;
  if (!connectionId || !prefs.aiConnectionIds.includes(connectionId))
    throw new HttpError(400, "That AI isn't one the Studio assistant offers", "studio_assistant_ai_unavailable");
  const connection = await getAiConnection(connectionId);
  // Claude finds its tools by search; a small local model gets the compact set; any other AI, every tool.
  const mode: ToolMode =
    connection.kind === "anthropic"
      ? "search"
      : prefs.compactAiConnectionIds.includes(connectionId)
        ? "compact"
        : "full";
  await getStudioDesign(userId, designId);
  const pictureIds = [...new Set(input.pictures ?? [])];
  if (pictureIds.length && !connection.vision)
    throw new HttpError(
      400,
      "That AI doesn't see pictures. Pick one that does, or send it without them.",
      "studio_assistant_no_vision",
    );
  const pictures: StudioPicture[] = [];
  for (const id of pictureIds) {
    const file = await studioPicturePath(userId, designId, id);
    if (!file) throw new HttpError(400, "One of the pictures isn't this design's", "studio_picture_not_found");
    const { width = 0, height = 0 } = await sharp(file).metadata();
    pictures.push({ id, width, height });
  }
  if (runs.get(designId)?.status === "running")
    throw new HttpError(409, "The assistant is already working on this design", "studio_assistant_busy");
  // Taken at once, before anything else is awaited, so a second prompt sent meanwhile finds it.
  const run: Run = {
    designId,
    userId,
    status: "running",
    steps: [],
    model: connection.model,
    error: null,
    startedAt: new Date(),
    finishedAt: null,
    controller: new AbortController(),
  };
  runs.set(designId, run);
  try {
    const history = await prisma.studioMessage.findMany({
      where: { designId },
      orderBy: { createdAt: "desc" },
      take: mode === "compact" ? COMPACT_HISTORY : HISTORY,
    });
    await prisma.studioMessage.create({
      data: { designId, role: "user", text: input.prompt, ...(pictures.length ? { pictures } : {}) },
    });
    void work(run, connectionId, mode, { ...input, pictures }, history.toReversed());
  } catch (error) {
    runs.delete(designId);
    throw error;
  }
  return runOut(run);
}

async function work(
  run: Run,
  connectionId: string,
  mode: ToolMode,
  input: { prompt: string; selected?: string[]; pictures: StudioPicture[] },
  history: StudioMessage[],
): Promise<void> {
  const settings = await resolveAiProvider(connectionId);
  const ctx: McpToolContext = { userId: run.userId, publicUrl: await getPublicUrl(), studioActor: "assistant" };
  const going = AbortSignal.any([run.controller.signal, AbortSignal.timeout(RUN_MS)]);
  const stillGoing = () => {
    if (going.aborted) throw new Stopped();
  };
  const specs = toolSpecs(mode);
  // Only what it was offered: a compact run's AI can't reach the rest.
  const offered = new Set(specs.map((spec) => spec.name));
  const byName = new Map(
    assistantTools()
      .filter((entry) => offered.has(entry.tool.name))
      .map((entry) => [entry.tool.name, entry]),
  );
  const system = mode === "compact" ? COMPACT_SYSTEM : mode === "search" ? `${SYSTEM}\n\n${SEARCH_NOTE}` : SYSTEM;
  let outcome: AssistantOutcome = "done";
  let text = "";
  try {
    // The design as it is now, as the read tool gives it, so the first turn needn't spend a step on it.
    const state = await runTool(
      byName.get("studio_get_design"),
      { id: "state", name: "studio_get_design", args: {} },
      ctx,
      run.designId,
    );
    const request = [
      input.prompt,
      pictureNote(input.pictures),
      input.selected?.length ? `Selected in the view: ${input.selected.join(", ")}` : "",
      `The design now (studio_get_design):\n${mode === "compact" ? compactState(state.result.text) : state.result.text}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    const earlier = history.flatMap((message) => {
      const said = historyMessage(message);
      return said ? [{ message, said }] : [];
    });
    // The newest pictures go along again when this prompt has none, so "more like the picture" still has one to
    // look at; older ones are only named.
    const lastPictured = input.pictures.length
      ? undefined
      : earlier.findLast(({ message }) => message.role === "user" && picturesOf(message).length);
    if (lastPictured?.said.role === "user")
      lastPictured.said.images = await picturesFor(run.userId, run.designId, picturesOf(lastPictured.message));
    const messages: ChatMessage[] = [
      ...earlier.map(({ said }) => said),
      {
        role: "user",
        text: request,
        ...(input.pictures.length ? { images: await picturesFor(run.userId, run.designId, input.pictures) } : {}),
      },
    ];
    for (;;) {
      stillGoing();
      const turn = await limited(connectionId, settings.concurrency, () =>
        toolChatTurn(settings, {
          system,
          messages,
          tools: specs,
          signal: going,
          log: log.child({ design: run.designId, model: run.model, mode }),
          toolSearch: mode === "search",
        }),
      );
      messages.push({ role: "assistant", text: turn.text, calls: turn.calls, raw: turn.raw });
      if (turn.ended === "refusal") throw new Error(turn.text);
      if (turn.text) text = turn.text;
      if (turn.ended === "limit") throw new Error("The AI ran out of room for its answer");
      if (turn.ended === "paused") continue;
      if (turn.ended === "answer") break;
      const results: ToolResult[] = [];
      for (const call of turn.calls) {
        stillGoing();
        if (run.steps.length >= MAX_STEPS) break;
        const entry = byName.get(call.name);
        const step: AssistantStep = {
          tool: call.name,
          title: entry?.tool.title ?? call.name,
          summary: null,
          ok: false,
        };
        run.steps.push(step);
        const { result, summary } = await runTool(entry, call, ctx, run.designId);
        step.ok = !result.isError;
        step.summary = summary ?? (result.isError ? result.text.slice(0, 300) : null);
        results.push(result);
      }
      if (run.steps.length >= MAX_STEPS) {
        outcome = "limit";
        break;
      }
      messages.push({ role: "tool", results });
    }
  } catch (error) {
    if (run.controller.signal.aborted) outcome = "stopped";
    else {
      outcome = "failed";
      run.error = going.aborted ? `It took longer than ${RUN_MS / 60_000} minutes` : noSecretError(error).message;
      log.warn("assistant run failed", { design: run.designId, model: run.model, error: run.error });
    }
  }
  // The answer is kept before the run says it's finished, so the page finds it when it looks.
  await prisma.studioMessage
    .create({
      data: {
        designId: run.designId,
        role: "assistant",
        text,
        steps: run.steps,
        outcome,
        error: run.error,
        model: run.model,
      },
    })
    .catch((error: unknown) =>
      log.warn("assistant answer not kept", { design: run.designId, error: noSecretError(error) }),
    );
  run.finishedAt = new Date();
  run.status = outcome;
}

/** Stops a run after the step it's on. */
export async function stopAssistantRun(userId: string, designId: string) {
  await getStudioDesign(userId, designId);
  const run = runs.get(designId);
  if (run?.status === "running") run.controller.abort();
  return run ? runOut(run) : null;
}

/** Forgets the conversation about a design; its changes stay. */
export async function clearAssistantThread(userId: string, designId: string): Promise<void> {
  await getStudioDesign(userId, designId);
  if (runs.get(designId)?.status === "running")
    throw new HttpError(409, "The assistant is still working on this design", "studio_assistant_busy");
  runs.delete(designId);
  await prisma.studioMessage.deleteMany({ where: { designId } });
}
