import { z } from "zod";
import { STUDIO_COMMAND_LIST } from "../studio/commands.generated";
import {
  createStudioDesign,
  deleteStudioDesign,
  getStudioDesign,
  listStudioDesigns,
  runStudioCommand,
  studioAssetDir,
  studioDesignHistory,
  type StudioDesignOut,
} from "../services/studioService";
import { describeStudioBody, inspectStudioDesign } from "../services/studioInspect";
import { STUDIO_GUIDE } from "../services/studioGuide";
import { STUDIO_VIEWS } from "../services/studioWorker";
import { HttpError } from "../utils/fileUtils";
import { WithImages, type McpToolContext, type McpToolDefinition } from "./toolTypes";

// Studio over MCP: the designs, and one tool per command in frontend/src/studio/commands.ts, made from that list, so
// every step a person takes on the page is one an assistant can take too. Offered only while STUDIO_ENABLED is on
// (mcpToolsFor), and shown to a token's user as a single "Studio" permission.

const designId = z.string().min(1).describe("The design's id, from studio_list_designs or studio_create_design.");
const RENDER_COLOR = "#4f8fd8";

function designUrl(ctx: McpToolContext, id: string): string | null {
  return ctx.publicUrl ? `${ctx.publicUrl}/studio?design=${id}` : null;
}

function brief(ctx: McpToolContext, design: StudioDesignOut) {
  return {
    design_id: design.id,
    name: design.name,
    version: design.version,
    can_undo: design.can_undo,
    can_redo: design.can_redo,
    url: designUrl(ctx, design.id),
  };
}

const listDesigns: McpToolDefinition = {
  name: "studio_list_designs",
  title: "List Studio designs",
  description: "Lists the user's designs in Studio, Thingport's CAD page, most recently changed first.",
  readOnly: true,
  group: "studio",
  inputSchema: {},
  async run(ctx) {
    const designs = await listStudioDesigns(ctx.userId);
    return {
      designs: designs.map((design) => ({
        design_id: design.id,
        name: design.name,
        feature_count: design.feature_count,
        updated_at: design.updated_at,
        url: designUrl(ctx, design.id),
      })),
    };
  },
};

const getDesign: McpToolDefinition = {
  name: "studio_get_design",
  title: "Read a Studio design",
  description:
    "Reads a design: its feature tree (every feature with its id, type, dimensions and transform), the size and place " +
    "of each body, problems such as a boolean that came out empty, and the latest changes and who made them, the user " +
    "included. Units are mm and Z is up; the bed is the XY plane at z=0. Features listed under top_level show on their " +
    "own; the rest are part of a boolean or an extrude. Read it before changing a design the user has been working on.",
  readOnly: true,
  group: "studio",
  inputSchema: { design_id: designId },
  async run(ctx, args) {
    const design = await getStudioDesign(ctx.userId, args.design_id as string);
    const [inspected, recent] = await Promise.all([
      inspectStudioDesign(
        `${design.id}:${design.version}`,
        design.document,
        studioAssetDir(ctx.userId, design.id),
        null,
      ),
      studioDesignHistory(design, 10),
    ]);
    const used = new Set(
      design.document.features.flatMap((feature) =>
        feature.type === "boolean"
          ? [feature.target_id, ...feature.tool_ids]
          : feature.type === "extrude"
            ? [feature.sketch_id]
            : [],
      ),
    );
    return {
      ...brief(ctx, design),
      units: "mm",
      up: "+Z",
      features: design.document.features,
      top_level: design.document.features.filter((feature) => !used.has(feature.id)).map((feature) => feature.id),
      bodies:
        inspected.status === "ok"
          ? inspected.bodies.map((body) => ({
              id: body.id,
              bounds: body.bounds,
              size: body.bounds.max.map((max, axis) => max - body.bounds.min[axis]),
              // An open mesh encloses nothing to measure.
              volume_mm3: Number.isNaN(body.volume) ? null : Math.round(body.volume * 100) / 100,
            }))
          : null,
      problems:
        inspected.status === "ok"
          ? inspected.errors
          : inspected.status === "too-complex"
            ? [{ id: null, message: `Too heavy to measure here (about ${inspected.triangles} triangles)` }]
            : [{ id: null, message: "Couldn't measure the design" }],
      recent_changes: recent,
    };
  },
};

const viewDesign: McpToolDefinition = {
  name: "studio_view_design",
  title: "Look at a Studio design",
  description:
    "Pictures of a design's visible bodies from the views asked for, to check how it looks. iso is from the front " +
    "right, above; front looks along +Y; right along -X; top straight down. Each picture is fitted to the bodies, so " +
    "it shows no scale: studio_get_design has the sizes.",
  readOnly: true,
  group: "studio",
  inputSchema: {
    design_id: designId,
    views: z.array(z.enum(STUDIO_VIEWS)).min(1).max(4).optional().describe('Up to 4. Default ["iso"].'),
    size: z
      .number()
      .int()
      .min(128)
      .max(1024)
      .optional()
      .describe("Each picture's width and height in pixels. Default 512."),
  },
  async run(ctx, args) {
    const design = await getStudioDesign(ctx.userId, args.design_id as string);
    const views = (args.views as (typeof STUDIO_VIEWS)[number][] | undefined) ?? ["iso"];
    const size = (args.size as number | undefined) ?? 512;
    const inspected = await inspectStudioDesign(
      `${design.id}:${design.version}`,
      design.document,
      studioAssetDir(ctx.userId, design.id),
      {
        views,
        size,
        color: RENDER_COLOR,
      },
    );
    if (inspected.status === "too-complex")
      throw new HttpError(422, `The design is too heavy to picture here (about ${inspected.triangles} triangles).`);
    if (inspected.status !== "ok") throw new Error(`studio_view_design failed: ${JSON.stringify(inspected)}`);
    return new WithImages(
      { ...brief(ctx, design), views, bodies: inspected.bodies.length, problems: inspected.errors },
      inspected.images.map((image) => ({ data: image.png, mimeType: "image/png" })),
    );
  },
};

const guide: McpToolDefinition = {
  name: "studio_guide",
  title: "How to design in Studio",
  description:
    "Read this before designing in Studio: the coordinates, how a design is built, how to name faces and edges, what " +
    "each step can and can't do, and recipes.",
  readOnly: true,
  group: "studio",
  inputSchema: {},
  async run() {
    return { guide: STUDIO_GUIDE };
  },
};

const inspectBody: McpToolDefinition = {
  name: "studio_inspect_body",
  title: "List a body's faces and edges",
  description:
    "Lists a body's flat faces (a point on each and its outward normal, largest first, with its area) and its straight " +
    "sharp edges (both ends, whether it's an outside (convex) or inside edge, and the angle between its faces), in the " +
    "world, in mm. These are the face and edge references that press_pull, fillet, chamfer, hole, shell, split and " +
    "add_sketch take: copy them as they are.",
  readOnly: true,
  group: "studio",
  inputSchema: {
    design_id: designId,
    feature_id: z.string().min(1).describe("The body, e.g. box-1; usually a top-level one."),
  },
  async run(ctx, args) {
    const design = await getStudioDesign(ctx.userId, args.design_id as string);
    const outcome = await describeStudioBody(
      `${design.id}:${design.version}`,
      design.document,
      studioAssetDir(ctx.userId, design.id),
      args.feature_id as string,
    );
    if (outcome.status === "refused") throw new HttpError(400, outcome.reason);
    if (outcome.status === "too-complex")
      throw new HttpError(422, `The design is too heavy to look at here (about ${outcome.triangles} triangles).`);
    if (outcome.status !== "described") throw new Error(`studio_inspect_body failed: ${JSON.stringify(outcome)}`);
    return { ...outcome.body, faces_listed: outcome.body.faces.length, edges_listed: outcome.body.edges.length };
  },
};

const createDesign: McpToolDefinition = {
  name: "studio_create_design",
  title: "Create a Studio design",
  description: "Starts a new, empty design in Studio. Its id is what the other studio_ tools take.",
  readOnly: false,
  group: "studio",
  inputSchema: { name: z.string().trim().max(120).optional().describe("Default “Untitled design”.") },
  async run(ctx, args) {
    return brief(ctx, await createStudioDesign(ctx.userId, args.name as string | undefined, "mcp"));
  },
};

const deleteDesign: McpToolDefinition = {
  name: "studio_delete_design",
  title: "Delete a Studio design",
  description: "Deletes a design and its history for good. Only when the user asked for it.",
  readOnly: false,
  destructive: true,
  group: "studio",
  inputSchema: { design_id: designId },
  async run(ctx, args) {
    await deleteStudioDesign(ctx.userId, args.design_id as string);
    return { deleted: true };
  },
};

const commandTools: McpToolDefinition[] = STUDIO_COMMAND_LIST.map((command) => ({
  name: `studio_${command.name}`,
  title: command.title,
  description: command.description,
  readOnly: false,
  destructive: command.destructive,
  group: "studio",
  inputSchema: { design_id: designId, ...command.args },
  async run(ctx, args) {
    const { design_id, ...rest } = args;
    const { design, summary, created } = await runStudioCommand(
      ctx.userId,
      design_id as string,
      command.name,
      rest,
      "mcp",
    );
    // What couldn't be made, said straight away: a fillet too big for its edge, a shell too detailed.
    const inspected = await inspectStudioDesign(
      `${design.id}:${design.version}`,
      design.document,
      studioAssetDir(ctx.userId, design.id),
      null,
    );
    return {
      done: summary,
      created,
      problems: inspected.status === "ok" ? inspected.errors : [],
      ...brief(ctx, design),
    };
  },
}));

export const STUDIO_MCP_TOOLS: readonly McpToolDefinition[] = [
  guide,
  listDesigns,
  inspectBody,
  getDesign,
  viewDesign,
  createDesign,
  deleteDesign,
  ...commandTools,
];
