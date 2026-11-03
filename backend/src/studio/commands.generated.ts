// GENERATED from frontend/src/studio/commands.ts by scripts/sync-studio.mjs. Don't edit it here:
// change frontend/src/studio/ and run npm run studio:sync.
import { z } from "zod";
import {
  consumerOf,
  DEFAULT_SEGMENTS,
  featureById,
  inputsOf,
  isBody,
  LIMITS,
  type BodyFeature,
  type Feature,
  type FeatureType,
  type SketchFeature,
  type SketchShape,
  type StudioDocument,
  type Transform,
  type Vec3,
} from "./document.generated";

// Every change to a Studio design, as a command: the toolbar, the panels and the viewport run these and nothing else,
// and each one is also an MCP tool (backend/src/mcp/studioTools.ts) and, later, a tool for Studio's own AI. So whatever a
// person can do to a design, an assistant can do the same way. A new action in the UI is a new command here first.
//
// Descriptions are written for an AI that has only them to go on: units, axes, where a shape's origin is, what an id is.
//
// `apply` is pure: it gets its own copy of the document and returns the next one, the same in the browser (which applies
// it at once) and on the server (which keeps the result). Commands without one, undo and redo and the design's name,
// are the server's to carry out.

/** A command that can't be carried out as asked. Its message is for whoever asked, person or AI. */
export class CommandError extends Error {}

export type CommandOutcome = {
  document: StudioDocument;
  /** What it did, in a sentence: for an assistant and for the design's history. */
  summary: string;
  /** The ids of the features it made. */
  created: string[];
};

type CommandDefinition<S extends z.ZodRawShape> = {
  /** Short, for an MCP client's tool list. */
  title: string;
  description: string;
  args: S;
  /** "document" commands change the feature tree; "history" ones move through it; "design" ones change the design. */
  kind?: "document" | "history" | "design";
  /** Changes or removes something already there, rather than only adding. */
  destructive?: boolean;
  apply?: (doc: StudioDocument, args: z.output<z.ZodObject<S>>) => CommandOutcome;
};

const command = <S extends z.ZodRawShape>(definition: CommandDefinition<S>) => definition;

const coordinate = z.number().finite().min(-LIMITS.size).max(LIMITS.size);
const vec2 = z.tuple([coordinate, coordinate]);
const vec3 = z.tuple([coordinate, coordinate, coordinate]);
const length = (description: string) => z.number().positive().max(LIMITS.size).describe(description);
const segments = z
  .number()
  .int()
  .min(LIMITS.segmentsMin)
  .max(LIMITS.segmentsMax)
  .optional()
  .describe(`Facets around each curve: more is smoother and heavier. Default ${DEFAULT_SEGMENTS}.`);
const featureName = z
  .string()
  .trim()
  .max(80)
  .optional()
  .describe("A name for the feature list. Leave it out to show its type and number, e.g. Box 3.");
const featureId = z.string().min(1).describe("The feature's id, as studio_get_design lists it, e.g. box-1.");
const sketchId = z.string().min(1).describe("The sketch's id, e.g. sketch-2.");

const placement = {
  position: vec3
    .optional()
    .describe("Where its origin goes, in mm, as [x, y, z]. Default [0, 0, 0]: the middle of the bed."),
  rotation: vec3.optional().describe("Degrees about the world X, then Y, then Z axis. Default [0, 0, 0]."),
  name: featureName,
};

const hole = z.boolean().optional().describe("Cut it out of the sketch's other shapes instead of adding to them.");
const shapeCenter = vec2.describe("Its centre on the plane, as [u, v] in mm.");
const shape = z
  .discriminatedUnion("type", [
    z
      .object({
        type: z.literal("rectangle"),
        center: shapeCenter,
        width: length("Along the plane's u axis, in mm."),
        height: length("Along the plane's v axis, in mm."),
        hole,
      })
      .strict(),
    z.object({ type: z.literal("circle"), center: shapeCenter, radius: length("In mm."), hole }).strict(),
    z
      .object({
        type: z.literal("polygon"),
        points: z
          .array(vec2)
          .min(3)
          .max(LIMITS.pointsPerPolygon)
          .describe(
            "Its corners in order, as [u, v] in mm; the last joins back to the first. It mustn't cross itself.",
          ),
        hole,
      })
      .strict(),
  ])
  .describe(
    "A closed shape on the sketch's plane, in the plane's own [u, v] coordinates: on XY u is X and v is Y, on XZ u is X " +
      "and v is Z, on YZ u is Y and v is Z.",
  );
const plane = z
  .enum(["XY", "XZ", "YZ"])
  .describe(
    "XY is the bed seen from above (an extrude goes up, +Z), XZ the front (an extrude comes towards the front, -Y), YZ " +
      "the right side (an extrude goes towards +X).",
  );
const planeOffset = coordinate
  .optional()
  .describe("How far the plane sits along the axis it faces, in mm: z for XY, y for XZ, x for YZ. Default 0.");

const fmt = (n: number) => String(Number(n.toFixed(3)));
const size3 = (a: number, b: number, c: number) => `${fmt(a)} × ${fmt(b)} × ${fmt(c)} mm`;

function nextId(doc: StudioDocument, type: FeatureType): string {
  const id = `${type}-${doc.next_id}`;
  doc.next_id += 1;
  return id;
}

function addFeature(doc: StudioDocument, feature: Feature): void {
  if (doc.features.length >= LIMITS.features)
    throw new CommandError(`A design holds up to ${LIMITS.features} features. Delete or combine some first.`);
  doc.features.push(feature);
}

function placed(args: { position?: Vec3; rotation?: Vec3 }): Transform {
  return { position: args.position ?? [0, 0, 0], rotation: args.rotation ?? [0, 0, 0], scale: [1, 1, 1] };
}

function find(doc: StudioDocument, id: string): Feature {
  const feature = featureById(doc, id);
  if (!feature) throw new CommandError(`There's no feature ${id} in this design.`);
  return feature;
}

function findBody(doc: StudioDocument, id: string): BodyFeature {
  const feature = find(doc, id);
  if (!isBody(feature)) throw new CommandError(`${id} is a sketch, not a body. Extrude it first.`);
  return feature;
}

function findSketch(doc: StudioDocument, id: string): SketchFeature {
  const feature = find(doc, id);
  if (feature.type !== "sketch") throw new CommandError(`${id} is a ${feature.type}, not a sketch.`);
  return feature;
}

function assertFree(doc: StudioDocument, id: string): void {
  const user = consumerOf(doc, id);
  if (user) throw new CommandError(`${id} is already part of ${user.id}.`);
}

function shapeAt(sketch: SketchFeature, index: number): SketchShape {
  const found = sketch.shapes[index];
  if (!found) throw new CommandError(`${sketch.id} has no shape ${index}; it has ${sketch.shapes.length}.`);
  return found;
}

function checkTorus(major: number, minor: number): void {
  if (minor >= major)
    throw new CommandError("A torus's minor_radius must be smaller than its major_radius, or the ring closes up.");
}

// What update_feature may change on each type of feature.
const EDITABLE: Record<FeatureType, string[]> = {
  box: ["width", "depth", "height"],
  cylinder: ["radius", "height", "segments"],
  cone: ["radius_bottom", "radius_top", "height", "segments"],
  sphere: ["radius", "segments"],
  torus: ["major_radius", "minor_radius", "segments"],
  extrude: ["distance"],
  boolean: ["operation"],
  sketch: ["plane", "offset"],
};

/** Copies a feature and everything it's built from, inputs first so the order still holds. Returns the copy's id. */
function copyTree(doc: StudioDocument, id: string, copies: Map<string, string>): string {
  const source = find(doc, id);
  for (const input of inputsOf(source)) copyTree(doc, input, copies);
  const copy = structuredClone(source);
  copy.id = nextId(doc, source.type);
  copies.set(source.id, copy.id);
  if (copy.type === "extrude") copy.sketch_id = copies.get(copy.sketch_id)!;
  if (copy.type === "boolean") {
    copy.target_id = copies.get(copy.target_id)!;
    copy.tool_ids = copy.tool_ids.map((tool) => copies.get(tool)!);
  }
  addFeature(doc, copy);
  return copy.id;
}

export const STUDIO_COMMANDS = {
  add_box: command({
    title: "Add a box",
    description:
      "Adds a box: width along X, depth along Y, height along Z, in mm. Its origin is the centre of its base, so at " +
      "position z=0 it stands on the bed.",
    args: {
      width: length("Along X, in mm."),
      depth: length("Along Y, in mm."),
      height: length("Along Z, in mm."),
      ...placement,
    },
    apply(doc, args) {
      const id = nextId(doc, "box");
      addFeature(doc, {
        id,
        type: "box",
        name: args.name ?? "",
        visible: true,
        transform: placed(args),
        width: args.width,
        depth: args.depth,
        height: args.height,
      });
      return { document: doc, created: [id], summary: `Added ${id}, ${size3(args.width, args.depth, args.height)}` };
    },
  }),

  add_cylinder: command({
    title: "Add a cylinder",
    description:
      "Adds an upright cylinder along Z. Its origin is the centre of its base, so at position z=0 it stands on the bed.",
    args: { radius: length("In mm."), height: length("Along Z, in mm."), segments, ...placement },
    apply(doc, args) {
      const id = nextId(doc, "cylinder");
      addFeature(doc, {
        id,
        type: "cylinder",
        name: args.name ?? "",
        visible: true,
        transform: placed(args),
        radius: args.radius,
        height: args.height,
        segments: args.segments ?? DEFAULT_SEGMENTS,
      });
      return {
        document: doc,
        created: [id],
        summary: `Added ${id}, radius ${fmt(args.radius)} mm, height ${fmt(args.height)} mm`,
      };
    },
  }),

  add_cone: command({
    title: "Add a cone",
    description:
      "Adds an upright cone or truncated cone along Z, narrowing from radius_bottom to radius_top (0 for a point). Its " +
      "origin is the centre of its base, so at position z=0 it stands on the bed.",
    args: {
      radius_bottom: length("At the base, in mm."),
      radius_top: z.number().min(0).max(LIMITS.size).describe("At the top, in mm: 0 makes a point."),
      height: length("Along Z, in mm."),
      segments,
      ...placement,
    },
    apply(doc, args) {
      const id = nextId(doc, "cone");
      addFeature(doc, {
        id,
        type: "cone",
        name: args.name ?? "",
        visible: true,
        transform: placed(args),
        radius_bottom: args.radius_bottom,
        radius_top: args.radius_top,
        height: args.height,
        segments: args.segments ?? DEFAULT_SEGMENTS,
      });
      return { document: doc, created: [id], summary: `Added ${id}, height ${fmt(args.height)} mm` };
    },
  }),

  add_sphere: command({
    title: "Add a sphere",
    description: "Adds a sphere. Its origin is its lowest point, so at position z=0 it rests on the bed.",
    args: { radius: length("In mm."), segments, ...placement },
    apply(doc, args) {
      const id = nextId(doc, "sphere");
      addFeature(doc, {
        id,
        type: "sphere",
        name: args.name ?? "",
        visible: true,
        transform: placed(args),
        radius: args.radius,
        segments: args.segments ?? DEFAULT_SEGMENTS,
      });
      return { document: doc, created: [id], summary: `Added ${id}, radius ${fmt(args.radius)} mm` };
    },
  }),

  add_torus: command({
    title: "Add a torus",
    description:
      "Adds a torus (a ring) lying flat around the Z axis. major_radius goes from the centre to the middle of the ring's " +
      "tube, minor_radius is the tube's own. Its origin is the centre of its base, so at position z=0 it lies on the bed.",
    args: {
      major_radius: length("From the centre to the middle of the tube, in mm."),
      minor_radius: length("The tube's radius, in mm; smaller than major_radius."),
      segments,
      ...placement,
    },
    apply(doc, args) {
      checkTorus(args.major_radius, args.minor_radius);
      const id = nextId(doc, "torus");
      addFeature(doc, {
        id,
        type: "torus",
        name: args.name ?? "",
        visible: true,
        transform: placed(args),
        major_radius: args.major_radius,
        minor_radius: args.minor_radius,
        segments: args.segments ?? DEFAULT_SEGMENTS,
      });
      return { document: doc, created: [id], summary: `Added ${id}` };
    },
  }),

  add_sketch: command({
    title: "Start a sketch",
    description:
      "Starts a 2D sketch on a plane: rectangles, circles and polygons that an extrude then pulls into a solid. Shapes " +
      "that overlap join; a shape marked as a hole is cut out of the others.",
    args: {
      plane,
      offset: planeOffset,
      shapes: z.array(shape).max(LIMITS.shapesPerSketch).optional().describe("Its shapes; more can be added later."),
      name: featureName,
    },
    apply(doc, args) {
      const id = nextId(doc, "sketch");
      addFeature(doc, {
        id,
        type: "sketch",
        name: args.name ?? "",
        visible: true,
        plane: args.plane,
        offset: args.offset ?? 0,
        shapes: args.shapes ?? [],
      });
      return { document: doc, created: [id], summary: `Started ${id} on the ${args.plane} plane` };
    },
  }),

  add_sketch_shape: command({
    title: "Draw a shape on a sketch",
    description: "Adds a rectangle, circle or polygon to a sketch. Its index is its place in the sketch's shapes list.",
    args: { sketch_id: sketchId, shape },
    apply(doc, args) {
      const sketch = findSketch(doc, args.sketch_id);
      if (sketch.shapes.length >= LIMITS.shapesPerSketch)
        throw new CommandError(`A sketch holds up to ${LIMITS.shapesPerSketch} shapes.`);
      sketch.shapes.push(args.shape);
      return { document: doc, created: [], summary: `Drew a ${args.shape.type} on ${sketch.id}` };
    },
  }),

  update_sketch_shape: command({
    title: "Change a sketch's shape",
    description: "Replaces one of a sketch's shapes, by its index in the sketch's shapes list (from 0).",
    destructive: true,
    args: { sketch_id: sketchId, index: z.number().int().min(0).describe("From 0."), shape },
    apply(doc, args) {
      const sketch = findSketch(doc, args.sketch_id);
      shapeAt(sketch, args.index);
      sketch.shapes[args.index] = args.shape;
      return { document: doc, created: [], summary: `Changed shape ${args.index} of ${sketch.id}` };
    },
  }),

  remove_sketch_shape: command({
    title: "Remove a sketch's shape",
    description: "Removes one of a sketch's shapes, by its index (from 0). The shapes after it move up one.",
    destructive: true,
    args: { sketch_id: sketchId, index: z.number().int().min(0).describe("From 0.") },
    apply(doc, args) {
      const sketch = findSketch(doc, args.sketch_id);
      shapeAt(sketch, args.index);
      sketch.shapes.splice(args.index, 1);
      return { document: doc, created: [], summary: `Removed shape ${args.index} from ${sketch.id}` };
    },
  }),

  extrude: command({
    title: "Extrude a sketch",
    description:
      "Pulls a sketch's shapes into a solid body, along the way its plane faces (see add_sketch); a negative distance " +
      "goes the other way. The sketch then belongs to the body and stays editable: changing it changes the body.",
    args: {
      sketch_id: sketchId,
      distance: z
        .number()
        .finite()
        .min(-LIMITS.size)
        .max(LIMITS.size)
        .refine((value) => value !== 0, "must not be 0")
        .describe("How far, in mm."),
      name: featureName,
    },
    apply(doc, args) {
      const sketch = findSketch(doc, args.sketch_id);
      assertFree(doc, sketch.id);
      if (!sketch.shapes.some((each) => !each.hole))
        throw new CommandError(`${sketch.id} has nothing to extrude: draw a shape that isn't a hole on it first.`);
      const id = nextId(doc, "extrude");
      addFeature(doc, {
        id,
        type: "extrude",
        name: args.name ?? "",
        visible: true,
        transform: placed({}),
        sketch_id: sketch.id,
        distance: args.distance,
      });
      return { document: doc, created: [id], summary: `Extruded ${sketch.id} by ${fmt(args.distance)} mm into ${id}` };
    },
  }),

  boolean: command({
    title: "Combine bodies",
    description:
      "Combines bodies into one: union joins them, subtract cuts the tools out of the target, intersect keeps only " +
      "where they all overlap. The bodies then belong to the result and stay editable: moving or resizing one changes " +
      "it. Deleting the result gives them back.",
    args: {
      operation: z.enum(["union", "subtract", "intersect"]),
      target_id: z.string().min(1).describe("The body the others are joined to, cut from or overlapped with."),
      tool_ids: z.array(z.string().min(1)).min(1).max(LIMITS.features).describe("The other bodies."),
      name: featureName,
    },
    apply(doc, args) {
      const ids = [args.target_id, ...args.tool_ids];
      if (new Set(ids).size !== ids.length) throw new CommandError("Each body can only be in a boolean once.");
      for (const id of ids) {
        findBody(doc, id);
        assertFree(doc, id);
      }
      const id = nextId(doc, "boolean");
      addFeature(doc, {
        id,
        type: "boolean",
        name: args.name ?? "",
        visible: true,
        transform: placed({}),
        operation: args.operation,
        target_id: args.target_id,
        tool_ids: args.tool_ids,
      });
      const tools = args.tool_ids.join(", ");
      const summary =
        args.operation === "subtract"
          ? `Cut ${tools} out of ${args.target_id} into ${id}`
          : `${args.operation === "union" ? "Joined" : "Intersected"} ${args.target_id} with ${tools} into ${id}`;
      return { document: doc, created: [id], summary };
    },
  }),

  set_transform: command({
    title: "Move, rotate or scale a body",
    description:
      "Sets where a body is, how it's turned and how it's scaled, as absolute values: what's left out stays as it is. " +
      "A body that's part of a boolean moves within it.",
    destructive: true,
    args: {
      feature_id: featureId,
      position: vec3.optional().describe("Where its origin goes, in mm, as [x, y, z]."),
      rotation: vec3.optional().describe("Degrees about the world X, then Y, then Z axis."),
      scale: z
        .tuple([z.number().positive().max(1000), z.number().positive().max(1000), z.number().positive().max(1000)])
        .optional()
        .describe("A factor along each axis, as [x, y, z]; [1, 1, 1] is its own size."),
    },
    apply(doc, args) {
      const body = findBody(doc, args.feature_id);
      if (!args.position && !args.rotation && !args.scale)
        throw new CommandError("Give a position, a rotation or a scale to change.");
      body.transform = {
        position: args.position ?? body.transform.position,
        rotation: args.rotation ?? body.transform.rotation,
        scale: args.scale ?? body.transform.scale,
      };
      return { document: doc, created: [], summary: `Moved ${body.id}` };
    },
  }),

  update_feature: command({
    title: "Change a feature's dimensions",
    description:
      "Changes what a feature was made with, keeping its place and the rest. Which fields it takes depends on the type: " +
      "box width, depth, height; cylinder radius, height, segments; cone radius_bottom, radius_top, height, segments; " +
      "sphere radius, segments; torus major_radius, minor_radius, segments; extrude distance; boolean operation; " +
      "sketch plane, offset.",
    destructive: true,
    args: {
      feature_id: featureId,
      width: length("In mm.").optional(),
      depth: length("In mm.").optional(),
      height: length("In mm.").optional(),
      radius: length("In mm.").optional(),
      radius_bottom: length("In mm.").optional(),
      radius_top: z.number().min(0).max(LIMITS.size).optional().describe("In mm."),
      major_radius: length("In mm.").optional(),
      minor_radius: length("In mm.").optional(),
      segments,
      distance: z
        .number()
        .finite()
        .min(-LIMITS.size)
        .max(LIMITS.size)
        .refine((value) => value !== 0, "must not be 0")
        .optional()
        .describe("In mm."),
      operation: z.enum(["union", "subtract", "intersect"]).optional(),
      plane: plane.optional(),
      offset: planeOffset,
    },
    apply(doc, { feature_id, ...changes }) {
      const feature = find(doc, feature_id);
      const given = Object.keys(changes).filter((key) => changes[key as keyof typeof changes] !== undefined);
      if (!given.length) throw new CommandError("Give at least one value to change.");
      const allowed = EDITABLE[feature.type];
      const wrong = given.filter((key) => !allowed.includes(key));
      if (wrong.length)
        throw new CommandError(`A ${feature.type} has no ${wrong.join(" or ")}. It takes: ${allowed.join(", ")}.`);
      Object.assign(feature, Object.fromEntries(given.map((key) => [key, changes[key as keyof typeof changes]])));
      if (feature.type === "torus") checkTorus(feature.major_radius, feature.minor_radius);
      return { document: doc, created: [], summary: `Changed ${given.join(", ")} of ${feature.id}` };
    },
  }),

  rename_feature: command({
    title: "Rename a feature",
    description: "Names a feature in the feature list. An empty name goes back to its type and number.",
    destructive: true,
    args: { feature_id: featureId, name: z.string().trim().max(80).describe("The new name; empty for none.") },
    apply(doc, args) {
      const feature = find(doc, args.feature_id);
      feature.name = args.name;
      return {
        document: doc,
        created: [],
        summary: args.name ? `Named ${feature.id} “${args.name}”` : `Unnamed ${feature.id}`,
      };
    },
  }),

  set_visibility: command({
    title: "Show or hide a feature",
    description:
      "Hides a feature from the view and from exports, or shows it again. A hidden feature stays in the design.",
    destructive: true,
    args: { feature_id: featureId, visible: z.boolean().describe("true shows it, false hides it.") },
    apply(doc, args) {
      const feature = find(doc, args.feature_id);
      feature.visible = args.visible;
      return { document: doc, created: [], summary: `${args.visible ? "Showed" : "Hid"} ${feature.id}` };
    },
  }),

  duplicate_feature: command({
    title: "Duplicate a feature",
    description:
      "Copies a feature, with everything it's built from, as a new one on its own. A body's copy can be moved by an offset.",
    args: {
      feature_id: featureId,
      offset: vec3
        .optional()
        .describe("How far to move a body's copy from the original, in mm, as [x, y, z]. Default none."),
    },
    apply(doc, args) {
      find(doc, args.feature_id);
      const id = copyTree(doc, args.feature_id, new Map());
      const copy = find(doc, id);
      if (args.offset && isBody(copy)) {
        const [dx, dy, dz] = args.offset;
        const [x, y, height] = copy.transform.position;
        copy.transform.position = [x + dx, y + dy, height + dz];
      }
      return { document: doc, created: [id], summary: `Copied ${args.feature_id} as ${id}` };
    },
  }),

  delete_feature: command({
    title: "Delete a feature",
    description:
      "Deletes a feature. Deleting a boolean or an extrude gives back the bodies or the sketch it was made from. A " +
      "feature that's part of another one can't be deleted until that one is.",
    destructive: true,
    args: { feature_id: featureId },
    apply(doc, args) {
      const feature = find(doc, args.feature_id);
      const user = consumerOf(doc, feature.id);
      if (user)
        throw new CommandError(
          `${feature.id} is part of ${user.id}. Delete ${user.id} first, which gives its parts back, then ${feature.id}.`,
        );
      doc.features = doc.features.filter((each) => each.id !== feature.id);
      // What it was built from shows on its own again.
      for (const input of inputsOf(feature)) {
        const freed = featureById(doc, input);
        if (freed) freed.visible = true;
      }
      return { document: doc, created: [], summary: `Deleted ${feature.id}` };
    },
  }),

  rename_design: command({
    title: "Rename the design",
    description: "Gives the design a new name.",
    kind: "design",
    destructive: true,
    args: { name: z.string().trim().min(1).max(120).describe("The design's new name.") },
  }),

  undo: command({
    title: "Undo",
    description: "Takes back the design's last change, whoever made it.",
    kind: "history",
    destructive: true,
    args: {},
  }),

  redo: command({
    title: "Redo",
    description: "Makes again the change undo last took back.",
    kind: "history",
    destructive: true,
    args: {},
  }),
};

export type StudioCommandName = keyof typeof STUDIO_COMMANDS;
export type StudioCommandArgs<N extends StudioCommandName> = z.input<z.ZodObject<(typeof STUDIO_COMMANDS)[N]["args"]>>;

/** A command as code that handles any of them sees it. */
export type AnyStudioCommand = {
  name: StudioCommandName;
  title: string;
  description: string;
  args: z.ZodRawShape;
  kind: "document" | "history" | "design";
  destructive: boolean;
  apply?: (doc: StudioDocument, args: Record<string, unknown>) => CommandOutcome;
};

export const STUDIO_COMMAND_LIST: readonly AnyStudioCommand[] = Object.entries(STUDIO_COMMANDS).map(
  ([name, definition]) => {
    const each = definition as CommandDefinition<z.ZodRawShape>;
    return {
      name: name as StudioCommandName,
      title: each.title,
      description: each.description,
      args: each.args,
      kind: each.kind ?? "document",
      destructive: each.destructive ?? false,
      apply: each.apply as AnyStudioCommand["apply"],
    };
  },
);

export function studioCommand(name: string): AnyStudioCommand | undefined {
  return STUDIO_COMMAND_LIST.find((each) => each.name === name);
}

/** The arguments as the command takes them, or a CommandError saying what's wrong with them. */
export function parseCommandArgs(definition: AnyStudioCommand, args: unknown): Record<string, unknown> {
  const parsed = z
    .object(definition.args)
    .strict()
    .safeParse(args ?? {});
  if (parsed.success) return parsed.data;
  throw new CommandError(
    parsed.error.issues.map((issue) => `${issue.path.join(".") || "arguments"}: ${issue.message}`).join("; "),
  );
}

/** Carries out a document command on a copy of `doc`. */
export function applyCommand(doc: StudioDocument, name: string, args: unknown): CommandOutcome {
  const definition = studioCommand(name);
  if (!definition) throw new CommandError(`There's no Studio command ${name}.`);
  if (!definition.apply) throw new CommandError(`${name} isn't a change to the feature tree.`);
  return definition.apply(structuredClone(doc), parseCommandArgs(definition, args));
}
