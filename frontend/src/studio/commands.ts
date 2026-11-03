import { z } from "zod";
import {
  consumerOf,
  DEFAULT_SEGMENTS,
  featureById,
  inputsOf,
  isBody,
  isSolid,
  LIMITS,
  shapeOutline,
  transformMatrix,
  type BodyFeature,
  type BooleanOperation,
  type EdgeRef,
  type FaceRef,
  type Feature,
  type FeatureType,
  type MeshFeature,
  type PartMeasure,
  type SketchFeature,
  type SketchShape,
  type StudioDocument,
  type Transform,
  type Vec3,
} from "./document";
import { applyMatrix, applyNormal, cross, invertAffine, normalize, perpendicular } from "./vec";

// Every change to a Studio design, as a command: the toolbar, the panels and the viewport run these and nothing else,
// and each one is also an MCP tool (backend/src/mcp/studioTools.ts) and, later, a tool for Studio's own AI. So whatever a
// person can do to a design, an assistant can do the same way. A new action in the UI is a new command here first.
//
// Descriptions are written for an AI that has only them to go on: units, axes, where a shape's origin is, what an id is,
// how a face or an edge is named, and what happens to the bodies a command works on.
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

export type CommandKind = "document" | "history" | "design" | "import" | "measure";

type CommandDefinition<S extends z.ZodRawShape> = {
  /** Short, for an MCP client's tool list. */
  title: string;
  description: string;
  args: S;
  /** "document" commands change the feature tree; "history" ones move through it; "design" ones change the design;
   *  "import" ones need the server to bring something in first, and "measure" ones need it to measure the design's
   *  geometry first, then change the tree with a helper here. */
  kind?: CommandKind;
  /** Changes or removes something already there, rather than only adding. */
  destructive?: boolean;
  apply?: (doc: StudioDocument, args: z.output<z.ZodObject<S>>) => CommandOutcome;
};

const command = <S extends z.ZodRawShape>(definition: CommandDefinition<S>) => definition;

// --- Arguments, shared ---

const coordinate = z.number().finite().min(-LIMITS.size).max(LIMITS.size);
const vec2 = z.tuple([coordinate, coordinate]);
const vec3 = z.tuple([coordinate, coordinate, coordinate]);
const length = (description: string) => z.number().positive().max(LIMITS.size).describe(description);
const signedLength = (description: string) =>
  z
    .number()
    .finite()
    .min(-LIMITS.size)
    .max(LIMITS.size)
    .refine((value) => value !== 0, "must not be 0")
    .describe(description);
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
const bodyId = z
  .string()
  .min(1)
  .describe("The body to work on: a top-level body's id from studio_get_design, e.g. box-1 or boolean-4.");
const sketchId = z.string().min(1).describe("The sketch's id, e.g. sketch-2.");

const placement = {
  position: vec3
    .optional()
    .describe("Where its origin goes, in mm, as [x, y, z]. Default [0, 0, 0]: the middle of the bed."),
  rotation: vec3.optional().describe("Degrees about the world X, then Y, then Z axis. Default [0, 0, 0]."),
  name: featureName,
};

const edgeTreatment = z
  .object({
    type: z.enum(["fillet", "chamfer"]).describe("fillet rounds the edge; chamfer bevels it flat."),
    size: length("A fillet's radius, or how far a chamfer cuts back along both faces, in mm."),
  })
  .strict();
const rimArgs = {
  top_edge: edgeTreatment
    .nullable()
    .optional()
    .describe("Round or bevel the top rim. Null or left out keeps it sharp."),
  bottom_edge: edgeTreatment
    .nullable()
    .optional()
    .describe("Round or bevel the bottom rim. Null or left out keeps it sharp."),
};

/** A face, as a point on it and the way it faces, in the world: what studio_inspect_body lists under faces. */
const faceArg = z
  .object({
    point: vec3.describe("A point on the face, in mm, in the world."),
    normal: vec3.describe("The way the face faces, out of the body, e.g. [0, 0, 1] for a top face."),
  })
  .strict();
/** An edge, as two points on it, in the world: what studio_inspect_body lists under edges. */
const edgeArg = z
  .object({ a: vec3.describe("One end of the edge, in mm, in the world."), b: vec3.describe("Its other end.") })
  .strict();

const hole = z.boolean().optional().describe("Cut it out of the sketch's other shapes instead of adding to them.");
const shapeCenter = vec2.describe("Its centre on the plane, as [u, v] in mm.");
const cornerRadius = z
  .number()
  .min(0)
  .max(LIMITS.size)
  .optional()
  .describe("Rounds every corner with this radius, in mm. Default 0, sharp.");
const shape = z
  .discriminatedUnion("type", [
    z
      .object({
        type: z.literal("rectangle"),
        center: shapeCenter,
        width: length("Along the plane's u axis, in mm."),
        height: length("Along the plane's v axis, in mm."),
        corner_radius: cornerRadius,
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
        corner_radius: cornerRadius,
        hole,
      })
      .strict(),
  ])
  .describe(
    "A closed shape on the sketch's plane, in the plane's own [u, v] coordinates: on XY u is X and v is Y, on XZ u is X " +
      "and v is Z, on YZ u is Y and v is Z; on a face, u and v are as add_sketch reported them.",
  );
const plane = z
  .enum(["XY", "XZ", "YZ"])
  .describe(
    "XY is the bed seen from above (an extrude goes up, +Z), XZ the front (an extrude comes towards the front, -Y), YZ " +
      "the right side (an extrude goes towards +X).",
  );
const planeOffset = coordinate
  .optional()
  .describe(
    "How far the plane sits along the way it faces, in mm: z for XY, -y for XZ, x for YZ, out of the face for a face. " +
      "Default 0.",
  );
const operation = z
  .enum(["new", "join", "cut", "intersect"])
  .optional()
  .describe(
    "new (default) makes a body of its own. join adds it to target_id, cut takes it away from target_id, intersect keeps " +
      "only where they overlap; the result is one body, made as a boolean.",
  );
const operationTarget = z
  .string()
  .min(1)
  .optional()
  .describe("The body to join to, cut from or intersect with; needed unless operation is new.");

// --- Helpers ---

const fmt = (n: number) => String(Number(n.toFixed(3)));
const size3 = (a: number, b: number, c: number) => `${fmt(a)} × ${fmt(b)} × ${fmt(c)} mm`;
const v3 = (v: Vec3) => `[${v.map(fmt).join(", ")}]`;

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
  if (user) throw new CommandError(`${id} is already part of ${user.id}: work on ${user.id} instead.`);
}

/** A top-level body to change, free to be built on. */
function freeBody(doc: StudioDocument, id: string): BodyFeature {
  const body = findBody(doc, id);
  assertFree(doc, id);
  return body;
}

/** Whether a body is a closed solid, as booleans need; an open imported mesh isn't. */
function assertSolid(body: BodyFeature): void {
  if (!isSolid(body))
    throw new CommandError(
      `${body.id} isn't a closed solid, so it can't be combined or changed. It can still be moved, scaled and exported.`,
    );
}

function shapeAt(sketch: SketchFeature, index: number): SketchShape {
  const found = sketch.shapes[index];
  if (!found) throw new CommandError(`${sketch.id} has no shape ${index}; it has ${sketch.shapes.length}.`);
  return found;
}

/** Checks a shape's corner radius fits. */
function checkShape(value: SketchShape): SketchShape {
  try {
    shapeOutline(value);
  } catch (error) {
    throw new CommandError(error instanceof Error ? error.message : String(error));
  }
  return value;
}

function checkTorus(major: number, minor: number): void {
  if (minor >= major)
    throw new CommandError("A torus's minor_radius must be smaller than its major_radius, or the ring closes up.");
}

/** World references into the body's own frame, so they move with it. */
function intoFrame(body: BodyFeature) {
  const inverse = invertAffine(transformMatrix(body.transform));
  return {
    face: (face: { point: Vec3; normal: Vec3 }): FaceRef => ({
      point: applyMatrix(inverse, face.point),
      normal: applyNormal(inverse, normalize(face.normal)),
    }),
    edge: (edge: { a: Vec3; b: Vec3 }): EdgeRef => ({
      a: applyMatrix(inverse, edge.a),
      b: applyMatrix(inverse, edge.b),
    }),
  };
}

const BOOLEAN_OF: Record<"join" | "cut" | "intersect", BooleanOperation> = {
  join: "union",
  cut: "subtract",
  intersect: "intersect",
};

/** After a new body: for join, cut or intersect, the boolean of it with the target. */
function combineWith(
  doc: StudioDocument,
  made: string,
  how: "new" | "join" | "cut" | "intersect" | undefined,
  targetId: string | undefined,
): { created: string[]; summary: string } {
  if (!how || how === "new") {
    if (targetId) throw new CommandError("target_id is only for join, cut or intersect.");
    return { created: [made], summary: `into ${made}` };
  }
  if (!targetId) throw new CommandError(`${how} needs target_id, the body to work on.`);
  const target = freeBody(doc, targetId);
  assertSolid(target);
  const id = nextId(doc, "boolean");
  addFeature(doc, {
    id,
    type: "boolean",
    name: "",
    visible: true,
    transform: placed({}),
    operation: BOOLEAN_OF[how],
    target_id: targetId,
    tool_ids: [made],
  });
  const verb = how === "join" ? "joined to" : how === "cut" ? "cut from" : "intersected with";
  return { created: [id], summary: `as ${made}, ${verb} ${targetId} into ${id}` };
}

// What update_feature may change on each type of feature.
const EDITABLE: Record<FeatureType, string[]> = {
  box: ["width", "depth", "height"],
  cylinder: ["radius", "height", "segments", "top_edge", "bottom_edge"],
  cone: ["radius_bottom", "radius_top", "height", "segments", "top_edge", "bottom_edge"],
  sphere: ["radius", "segments"],
  torus: ["major_radius", "minor_radius", "segments"],
  extrude: ["distance", "symmetric", "start_offset", "taper", "top_edge", "bottom_edge"],
  revolve: ["axis", "angle", "segments"],
  boolean: ["operation"],
  press_pull: ["distance"],
  fillet: ["radius", "segments"],
  chamfer: ["distance"],
  hole: ["diameter", "depth", "counterbore", "countersink", "segments"],
  shell: ["thickness"],
  split: ["keep"],
  sketch: ["plane", "offset"],
  mesh: [],
  part: [],
};

/** Copies a feature and everything it's built from, inputs first so the order still holds. Returns the copy's id. */
function copyTree(doc: StudioDocument, id: string, copies: Map<string, string>): string {
  const known = copies.get(id);
  if (known) return known;
  const source = find(doc, id);
  for (const input of inputsOf(source)) copyTree(doc, input, copies);
  const copy = structuredClone(source);
  copy.id = nextId(doc, source.type);
  copies.set(source.id, copy.id);
  const map = (ref: string) => copies.get(ref) ?? ref;
  switch (copy.type) {
    case "extrude":
    case "revolve":
      copy.sketch_id = map(copy.sketch_id);
      break;
    case "boolean":
      copy.target_id = map(copy.target_id);
      copy.tool_ids = copy.tool_ids.map(map);
      break;
    case "press_pull":
    case "fillet":
    case "chamfer":
    case "hole":
    case "shell":
      copy.target_id = map(copy.target_id);
      break;
    case "split":
      copy.source_id = map(copy.source_id);
      if (copy.tool_id) copy.tool_id = map(copy.tool_id);
      break;
    case "part":
      copy.source_id = map(copy.source_id);
      break;
  }
  addFeature(doc, copy);
  return copy.id;
}

/** The sketch's frame on a face of the world: u along the world's X as laid on the face, v = normal × u. */
function faceFrame(face: { point: Vec3; normal: Vec3 }) {
  const normal = normalize(face.normal);
  if (Math.hypot(...normal) === 0) throw new CommandError("The face's normal can't be [0, 0, 0].");
  const u = perpendicular(normal);
  return { origin: face.point, u, normal, v: cross(normal, u) };
}

const BODY_REF_HELP =
  "Faces and edges are named in the world as studio_inspect_body lists them, and follow the body if it moves later.";

export const STUDIO_COMMANDS = {
  // --- Shapes ---

  add_box: command({
    title: "Add a box",
    description:
      "Adds a box: width along X, depth along Y, height along Z, in mm. Its origin is the centre of its base, so at " +
      "position z=0 it stands on the bed. Round its edges afterwards with fillet.",
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
      "Adds an upright cylinder along Z. Its origin is the centre of its base, so at position z=0 it stands on the bed. " +
      "Its top and bottom rims can be rounded or bevelled.",
    args: { radius: length("In mm."), height: length("Along Z, in mm."), segments, ...rimArgs, ...placement },
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
        top_edge: args.top_edge ?? null,
        bottom_edge: args.bottom_edge ?? null,
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
      "origin is the centre of its base, so at position z=0 it stands on the bed. Its rims can be rounded or bevelled " +
      "(not the top of one that comes to a point).",
    args: {
      radius_bottom: length("At the base, in mm."),
      radius_top: z.number().min(0).max(LIMITS.size).describe("At the top, in mm: 0 makes a point."),
      height: length("Along Z, in mm."),
      segments,
      ...rimArgs,
      ...placement,
    },
    apply(doc, args) {
      if (args.top_edge && args.radius_top === 0)
        throw new CommandError("A cone that comes to a point has no top rim to round.");
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
        top_edge: args.top_edge ?? null,
        bottom_edge: args.bottom_edge ?? null,
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

  // --- Sketches, and the solids made from them ---

  add_sketch: command({
    title: "Start a sketch",
    description:
      "Starts a 2D sketch, on one of the three main planes or on a flat face of a body: rectangles, circles and polygons " +
      "that extrude or revolve then make solid. Shapes that overlap join; a shape marked as a hole is cut out of the " +
      "others. On a face, the sketch takes the face's plane as it is now, with its origin at the given point; the reply " +
      "says which way u and v point in the world. Give plane or face, not both.",
    args: {
      plane: plane.optional(),
      face: faceArg
        .optional()
        .describe(
          "A flat face to sketch on, from studio_inspect_body's faces: a point on it and its normal, in the world.",
        ),
      offset: planeOffset,
      shapes: z.array(shape).max(LIMITS.shapesPerSketch).optional().describe("Its shapes; more can be added later."),
      name: featureName,
    },
    apply(doc, args) {
      if (Boolean(args.plane) === Boolean(args.face))
        throw new CommandError("Give a plane or a face to sketch on, one of them.");
      const shapes = (args.shapes ?? []).map(checkShape);
      const id = nextId(doc, "sketch");
      const frame = args.face ? faceFrame(args.face) : null;
      addFeature(doc, {
        id,
        type: "sketch",
        name: args.name ?? "",
        visible: true,
        plane: frame ? "FACE" : args.plane!,
        offset: args.offset ?? 0,
        frame: frame ? { origin: frame.origin, u: frame.u, normal: frame.normal } : null,
        shapes,
      });
      return {
        document: doc,
        created: [id],
        summary: frame
          ? `Started ${id} on a face at ${v3(frame.origin)}: u points ${v3(frame.u)}, v points ${v3(frame.v)}, extrudes go ${v3(frame.normal)}`
          : `Started ${id} on the ${args.plane} plane`,
      };
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
      sketch.shapes.push(checkShape(args.shape));
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
      sketch.shapes[args.index] = checkShape(args.shape);
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
      "Pulls a sketch's shapes into a solid, along the way its plane faces (see add_sketch); a negative distance goes the " +
      "other way. It can be a body of its own, or join, cut or intersect another body. Options: symmetric (half each way), " +
      "a start offset, a taper (a draft, degrees the sides lean in towards the far end), and rounded or bevelled edges " +
      "where it ends (top_edge, at the far end) and starts (bottom_edge). A taper or rounding too big for the shape is " +
      "refused. The sketch then belongs to the solid and stays editable: changing it changes the solid.",
    args: {
      sketch_id: sketchId,
      distance: signedLength("How far, in mm."),
      symmetric: z.boolean().optional().describe("Half the distance each way from the sketch. Default false."),
      start_offset: coordinate
        .optional()
        .describe("Starts this far from the sketch along the way it goes, in mm. Default 0."),
      taper: z
        .number()
        .min(-60)
        .max(60)
        .optional()
        .describe("Degrees the sides lean in towards the far end, a draft; negative leans them out. Default 0."),
      top_edge: edgeTreatment.nullable().optional().describe("Round or bevel the edges at the far end."),
      bottom_edge: edgeTreatment.nullable().optional().describe("Round or bevel the edges where it starts."),
      operation,
      target_id: operationTarget,
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
        symmetric: args.symmetric ?? false,
        start_offset: args.start_offset ?? 0,
        taper: args.taper ?? 0,
        top_edge: args.top_edge ?? null,
        bottom_edge: args.bottom_edge ?? null,
      });
      const combined = combineWith(doc, id, args.operation, args.target_id);
      return {
        document: doc,
        created: combined.created,
        summary: `Extruded ${sketch.id} by ${fmt(args.distance)} mm ${combined.summary}`,
      };
    },
  }),

  revolve: command({
    title: "Revolve a sketch",
    description:
      "Turns a sketch's shapes about one of its own axes, through its origin: v (up the sketch) or u (along it), by an " +
      "angle up to 360°. The shapes must all be on one side of the axis. Like extrude, it can be a body of its own or " +
      "join, cut or intersect another body. The sketch then belongs to the solid and stays editable.",
    args: {
      sketch_id: sketchId,
      axis: z.enum(["u", "v"]).describe("The sketch's axis to turn about."),
      angle: z.number().min(1).max(360).optional().describe("Degrees to turn, starting at the sketch. Default 360."),
      segments,
      operation,
      target_id: operationTarget,
      name: featureName,
    },
    apply(doc, args) {
      const sketch = findSketch(doc, args.sketch_id);
      assertFree(doc, sketch.id);
      if (!sketch.shapes.some((each) => !each.hole))
        throw new CommandError(`${sketch.id} has nothing to revolve: draw a shape that isn't a hole on it first.`);
      const id = nextId(doc, "revolve");
      addFeature(doc, {
        id,
        type: "revolve",
        name: args.name ?? "",
        visible: true,
        transform: placed({}),
        sketch_id: sketch.id,
        axis: args.axis,
        angle: args.angle ?? 360,
        segments: args.segments ?? DEFAULT_SEGMENTS,
      });
      const combined = combineWith(doc, id, args.operation, args.target_id);
      return {
        document: doc,
        created: combined.created,
        summary: `Revolved ${sketch.id} ${fmt(args.angle ?? 360)}° about its ${args.axis} axis ${combined.summary}`,
      };
    },
  }),

  // --- Changing a body ---

  press_pull: command({
    title: "Push or pull a face",
    description:
      "Moves a flat face of a body straight out (a positive distance adds material) or in (a negative distance cuts it " +
      "away), keeping its outline: a box's top pulled up 5 mm makes it 5 mm taller. The face is named by a point on it and " +
      `its normal. ${BODY_REF_HELP}`,
    args: {
      feature_id: bodyId,
      face: faceArg.describe("The flat face to move, from studio_inspect_body's faces."),
      distance: signedLength("How far out (positive) or in (negative), in mm."),
      name: featureName,
    },
    apply(doc, args) {
      const body = freeBody(doc, args.feature_id);
      assertSolid(body);
      const id = nextId(doc, "press_pull");
      addFeature(doc, {
        id,
        type: "press_pull",
        name: args.name ?? "",
        visible: true,
        transform: placed({}),
        target_id: body.id,
        face: intoFrame(body).face(args.face),
        distance: args.distance,
      });
      return {
        document: doc,
        created: [id],
        summary: `${args.distance > 0 ? "Pulled" : "Pushed"} a face of ${body.id} ${fmt(Math.abs(args.distance))} mm into ${id}`,
      };
    },
  }),

  fillet: command({
    title: "Round edges",
    description:
      "Rounds straight edges between flat faces of a body with one radius: an outside edge is rounded off, an inside edge " +
      "(where faces meet in a hollow) is filled with a rounded fillet. Edges are named by their two ends. Two rounded " +
      "edges meeting at a corner meet in a mitre; three meeting at a square corner (as on a box) get a ball-shaped " +
      "corner. Refused, with the reason, when the radius is bigger than the faces beside an edge allow, or for corners " +
      "it can't blend (three edges at a corner that isn't square, or an outside and an inside edge at the same corner). " +
      `Curved edges can't be chosen: round a cylinder's rims with its own top_edge and bottom_edge. ${BODY_REF_HELP}`,
    args: {
      feature_id: bodyId,
      edges: z.array(edgeArg).min(1).max(LIMITS.edgesPerFeature).describe("The edges, from studio_inspect_body."),
      radius: length("In mm."),
      segments: z
        .number()
        .int()
        .min(8)
        .max(LIMITS.segmentsMax)
        .optional()
        .describe("Facets in a full turn of the rounding. Default 32."),
      name: featureName,
    },
    apply(doc, args) {
      const body = freeBody(doc, args.feature_id);
      assertSolid(body);
      const frame = intoFrame(body);
      const id = nextId(doc, "fillet");
      addFeature(doc, {
        id,
        type: "fillet",
        name: args.name ?? "",
        visible: true,
        transform: placed({}),
        target_id: body.id,
        edges: args.edges.map(frame.edge),
        radius: args.radius,
        segments: args.segments ?? 32,
      });
      const count = args.edges.length;
      return {
        document: doc,
        created: [id],
        summary: `Rounded ${count} edge${count === 1 ? "" : "s"} of ${body.id} to ${fmt(args.radius)} mm into ${id}`,
      };
    },
  }),

  chamfer: command({
    title: "Bevel edges",
    description:
      "Bevels straight edges between flat faces of a body, cutting back the same distance along both faces: an outside " +
      "edge is cut off flat, an inside edge is filled with a flat bevel. Edges meeting at a corner meet in a mitre. " +
      "Refused, with the reason, when the distance is bigger than the faces allow, or where an outside and an inside edge " +
      `meet at a corner. ${BODY_REF_HELP}`,
    args: {
      feature_id: bodyId,
      edges: z.array(edgeArg).min(1).max(LIMITS.edgesPerFeature).describe("The edges, from studio_inspect_body."),
      distance: length("How far back along each face, in mm."),
      name: featureName,
    },
    apply(doc, args) {
      const body = freeBody(doc, args.feature_id);
      assertSolid(body);
      const frame = intoFrame(body);
      const id = nextId(doc, "chamfer");
      addFeature(doc, {
        id,
        type: "chamfer",
        name: args.name ?? "",
        visible: true,
        transform: placed({}),
        target_id: body.id,
        edges: args.edges.map(frame.edge),
        distance: args.distance,
      });
      const count = args.edges.length;
      return {
        document: doc,
        created: [id],
        summary: `Bevelled ${count} edge${count === 1 ? "" : "s"} of ${body.id} by ${fmt(args.distance)} mm into ${id}`,
      };
    },
  }),

  hole: command({
    title: "Drill a hole",
    description:
      "Drills a round hole into a body at a point on its surface, going in against the surface's normal there: a depth in " +
      "mm, or right through (leave depth out). Optionally counterbored (a wider, shallow bore at the top, for a screw " +
      "head) or countersunk (a cone at the top, for a flat-head screw); not both. The bottom is flat. " +
      BODY_REF_HELP,
    args: {
      feature_id: bodyId,
      point: vec3.describe("Where the hole starts, on the body's surface, in mm, in the world."),
      normal: vec3.describe(
        "The surface's outward normal there, e.g. [0, 0, 1] on a top face; the hole goes the other way.",
      ),
      diameter: length("The hole's diameter, in mm."),
      depth: length("How deep, in mm. Leave it out to go right through.").optional(),
      counterbore: z
        .object({ diameter: length("Wider than the hole, in mm."), depth: length("In mm.") })
        .strict()
        .optional()
        .describe("A wider bore at the top."),
      countersink: z
        .object({
          diameter: length("At the surface, wider than the hole, in mm."),
          angle: z
            .number()
            .min(30)
            .max(150)
            .describe("The cone's included angle, in degrees: 90 for most metric screws."),
        })
        .strict()
        .optional()
        .describe("A cone at the top."),
      segments,
      name: featureName,
    },
    apply(doc, args) {
      const body = freeBody(doc, args.feature_id);
      assertSolid(body);
      if (args.counterbore && args.countersink)
        throw new CommandError("A hole is counterbored or countersunk, not both.");
      if (args.counterbore && args.counterbore.diameter <= args.diameter)
        throw new CommandError("A counterbore has to be wider than the hole.");
      if (args.countersink && args.countersink.diameter <= args.diameter)
        throw new CommandError("A countersink has to be wider than the hole.");
      const id = nextId(doc, "hole");
      addFeature(doc, {
        id,
        type: "hole",
        name: args.name ?? "",
        visible: true,
        transform: placed({}),
        target_id: body.id,
        face: intoFrame(body).face({ point: args.point, normal: args.normal }),
        diameter: args.diameter,
        depth: args.depth ?? null,
        counterbore: args.counterbore ?? null,
        countersink: args.countersink ?? null,
        segments: args.segments ?? DEFAULT_SEGMENTS,
      });
      return {
        document: doc,
        created: [id],
        summary: `Drilled a ${fmt(args.diameter)} mm hole ${args.depth ? `${fmt(args.depth)} mm deep` : "right through"} ${body.id} into ${id}`,
      };
    },
  }),

  shell: command({
    title: "Hollow a body",
    description:
      "Hollows a body out, leaving walls of the given thickness under every face: flat walls exactly that thick, the " +
      "hollow rounded round inside edges and corners as far from them as from the faces (never thinner, at most 2.5% " +
      "thicker there). Optionally leaves flat faces open, like a box's top for a tray: that face gets no wall, so the " +
      "hollow runs out through it; it's refused if the walls beside it would close it, or if the walls fill the body. " +
      `Bodies over ${LIMITS.shellTriangles} triangles are refused, as hollowing them takes too long: shell the parts ` +
      `before combining them. ${BODY_REF_HELP}`,
    args: {
      feature_id: bodyId,
      thickness: length("The walls' thickness, in mm."),
      open_faces: z.array(faceArg).max(6).optional().describe("Flat faces to leave open, from studio_inspect_body."),
      name: featureName,
    },
    apply(doc, args) {
      const body = freeBody(doc, args.feature_id);
      assertSolid(body);
      const frame = intoFrame(body);
      const id = nextId(doc, "shell");
      addFeature(doc, {
        id,
        type: "shell",
        name: args.name ?? "",
        visible: true,
        transform: placed({}),
        target_id: body.id,
        thickness: args.thickness,
        open_faces: (args.open_faces ?? []).map(frame.face),
      });
      return {
        document: doc,
        created: [id],
        summary: `Hollowed ${body.id} to ${fmt(args.thickness)} mm walls into ${id}`,
      };
    },
  }),

  split: command({
    title: "Split a body",
    description:
      "Splits a body in two, by a plane or by another body, making two bodies that stay editable: by a plane, the part on " +
      "the side its normal points to and the part on the other side; by a body, the part inside it and the part outside " +
      "it (the cutting body stays as it is). Handy for cutting a model into printable pieces. " +
      BODY_REF_HELP,
    args: {
      feature_id: bodyId,
      plane: z
        .object({
          point: vec3.describe("A point on the plane, in mm, in the world."),
          normal: vec3.describe("The plane's normal: [0, 0, 1] splits into a top part and a bottom part."),
        })
        .strict()
        .optional()
        .describe("A plane to split by."),
      tool_id: z.string().min(1).optional().describe("A body to split by, instead of a plane."),
    },
    apply(doc, args) {
      if (Boolean(args.plane) === Boolean(args.tool_id))
        throw new CommandError("Give a plane or a tool_id to split by, one of them.");
      const body = freeBody(doc, args.feature_id);
      assertSolid(body);
      let toolCopy: string | null = null;
      let planeRef: FaceRef | null = null;
      if (args.tool_id) {
        if (args.tool_id === body.id) throw new CommandError("A body can't split itself.");
        assertSolid(findBody(doc, args.tool_id));
        // The cutting body stays as it is: the split uses a copy of it.
        toolCopy = copyTree(doc, args.tool_id, new Map());
      } else {
        planeRef = intoFrame(body).face(args.plane!);
      }
      const parts = (toolCopy ? (["inside", "outside"] as const) : (["front", "back"] as const)).map((keep) => {
        const id = nextId(doc, "split");
        addFeature(doc, {
          id,
          type: "split",
          name: "",
          visible: true,
          transform: placed({}),
          source_id: body.id,
          plane: planeRef,
          tool_id: toolCopy,
          keep,
        });
        return id;
      });
      return { document: doc, created: parts, summary: `Split ${body.id} into ${parts.join(" and ")}` };
    },
  }),

  separate_parts: command({
    title: "Separate a body into its parts",
    description:
      "Makes each loose part of a body, each piece of it that doesn't touch the rest, a body of its own: an imported " +
      "model of several parts (import_model says how many it has), say, or the pieces a cut left. A hollow inside a " +
      "part stays with it, and parts that overlap without being joined are separate parts: join those with boolean " +
      "union, as a boolean on overlapping parts left in one body counts the overlap twice. Each part's own origin is " +
      "the middle of its base, where it is now, so moving, turning or scaling one works about it. The parts stay " +
      "editable and belong to the body; deleting them all gives it back, and deleting one leaves that part out. " +
      `Refused for a body of one part, or of more than ${LIMITS.partsPerBody}. Parts of a mesh with gaps that are ` +
      "closed themselves can be combined; the rest can only be moved, scaled and exported.",
    kind: "measure",
    args: { feature_id: bodyId },
  }),

  boolean: command({
    title: "Combine bodies",
    description:
      "Combines bodies into one: union joins them, subtract cuts the tools out of the target, intersect keeps only " +
      "where they all overlap. The bodies then belong to the result and stay editable: moving or resizing one changes " +
      "it. Deleting the result gives them back. With keep_tools, the tools stay as they are and copies are used.",
    args: {
      operation: z.enum(["union", "subtract", "intersect"]),
      target_id: z.string().min(1).describe("The body the others are joined to, cut from or overlapped with."),
      tool_ids: z.array(z.string().min(1)).min(1).max(LIMITS.features).describe("The other bodies."),
      keep_tools: z.boolean().optional().describe("Leave the tools as they are and use copies of them. Default false."),
      name: featureName,
    },
    apply(doc, args) {
      const ids = [args.target_id, ...args.tool_ids];
      if (new Set(ids).size !== ids.length) throw new CommandError("Each body can only be in a boolean once.");
      for (const each of ids) {
        const body = args.keep_tools && each !== args.target_id ? findBody(doc, each) : freeBody(doc, each);
        assertSolid(body);
      }
      const tools = args.keep_tools ? args.tool_ids.map((tool) => copyTree(doc, tool, new Map())) : args.tool_ids;
      const id = nextId(doc, "boolean");
      addFeature(doc, {
        id,
        type: "boolean",
        name: args.name ?? "",
        visible: true,
        transform: placed({}),
        operation: args.operation,
        target_id: args.target_id,
        tool_ids: tools,
      });
      const list = args.tool_ids.join(", ");
      const summary =
        args.operation === "subtract"
          ? `Cut ${list} out of ${args.target_id} into ${id}`
          : `${args.operation === "union" ? "Joined" : "Intersected"} ${args.target_id} with ${list} into ${id}`;
      return { document: doc, created: [id], summary: args.keep_tools ? `${summary}, keeping ${list}` : summary };
    },
  }),

  // --- Place and size ---

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

  scale_feature: command({
    title: "Scale a body",
    description:
      "Scales a body by a factor about its own origin (a shape's base centre), on top of the scale it has: 2 doubles it, " +
      "0.5 halves it, or [x, y, z] for each axis.",
    destructive: true,
    args: {
      feature_id: featureId,
      factor: z
        .union([
          z.number().positive().max(100),
          z.tuple([z.number().positive().max(100), z.number().positive().max(100), z.number().positive().max(100)]),
        ])
        .describe("One factor for all three axes, or [x, y, z]."),
    },
    apply(doc, args) {
      const body = findBody(doc, args.feature_id);
      const factor: Vec3 = typeof args.factor === "number" ? [args.factor, args.factor, args.factor] : args.factor;
      const next = body.transform.scale.map((s, axis) => s * factor[axis]) as Vec3;
      if (next.some((s) => s > 1000 || s < 0.001))
        throw new CommandError("That would scale it past 1000× or below 0.001×.");
      body.transform = { ...body.transform, scale: next };
      return {
        document: doc,
        created: [],
        summary: `Scaled ${body.id} by ${typeof args.factor === "number" ? fmt(args.factor) : v3(factor)}`,
      };
    },
  }),

  update_feature: command({
    title: "Change a feature",
    description:
      "Changes what a feature was made with, keeping its place and the rest. Which fields it takes depends on the type: " +
      "box width, depth, height; cylinder radius, height, segments, top_edge, bottom_edge; cone radius_bottom, " +
      "radius_top, height, segments, top_edge, bottom_edge; sphere radius, segments; torus major_radius, minor_radius, " +
      "segments; extrude distance, symmetric, start_offset, taper, top_edge, bottom_edge; revolve axis, angle, segments; " +
      "boolean operation; press_pull distance; fillet radius, segments; chamfer distance; hole diameter, depth (null " +
      "goes right through), counterbore, countersink, segments; shell thickness; split keep; sketch plane (XY, XZ or " +
      "YZ), offset.",
    destructive: true,
    args: {
      feature_id: featureId,
      width: length("In mm.").optional(),
      depth: z
        .number()
        .positive()
        .max(LIMITS.size)
        .nullable()
        .optional()
        .describe("In mm; for a hole, null goes right through."),
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
      symmetric: z.boolean().optional().describe("For an extrude."),
      start_offset: coordinate.optional().describe("For an extrude, in mm."),
      taper: z.number().min(-60).max(60).optional().describe("For an extrude, in degrees."),
      top_edge: edgeTreatment.nullable().optional().describe("Null makes it sharp."),
      bottom_edge: edgeTreatment.nullable().optional().describe("Null makes it sharp."),
      axis: z.enum(["u", "v"]).optional().describe("For a revolve."),
      angle: z.number().min(1).max(360).optional().describe("For a revolve, in degrees."),
      diameter: length("For a hole, in mm.").optional(),
      counterbore: z
        .object({ diameter: length("In mm."), depth: length("In mm.") })
        .strict()
        .nullable()
        .optional()
        .describe("For a hole; null removes it."),
      countersink: z
        .object({ diameter: length("In mm."), angle: z.number().min(30).max(150).describe("Degrees.") })
        .strict()
        .nullable()
        .optional()
        .describe("For a hole; null removes it."),
      thickness: length("For a shell, in mm.").optional(),
      keep: z.enum(["front", "back", "inside", "outside"]).optional().describe("For a split part."),
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
        throw new CommandError(
          `A ${feature.type} has no ${wrong.join(" or ")}. ${allowed.length ? `It takes: ${allowed.join(", ")}.` : "It has nothing to change."}`,
        );
      if (feature.type === "sketch" && feature.plane === "FACE" && changes.plane)
        throw new CommandError("A sketch on a face keeps the face's plane; draw a new sketch for another plane.");
      if (feature.type === "chamfer" && changes.distance !== undefined && changes.distance <= 0)
        throw new CommandError("A chamfer's distance must be more than 0.");
      if (feature.type === "split" && changes.keep) {
        const byTool = Boolean(feature.tool_id);
        if (byTool !== (changes.keep === "inside" || changes.keep === "outside"))
          throw new CommandError(
            byTool ? "A part split by a body keeps inside or outside." : "A part split by a plane keeps front or back.",
          );
      }
      Object.assign(feature, Object.fromEntries(given.map((key) => [key, changes[key as keyof typeof changes]])));
      if (feature.type === "torus") checkTorus(feature.major_radius, feature.minor_radius);
      if (feature.type === "cone" && feature.top_edge && feature.radius_top === 0)
        throw new CommandError("A cone that comes to a point has no top rim to round.");
      if (feature.type === "hole" && feature.counterbore && feature.countersink)
        throw new CommandError("A hole is counterbored or countersunk, not both.");
      return { document: doc, created: [], summary: `Changed ${given.join(", ")} of ${feature.id}` };
    },
  }),

  // --- The feature list ---

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
      "Deletes a feature. Deleting one made from others (a boolean, an extrude or revolve, a fillet, a hole, a shell, a " +
      "split part...) gives back what it was made from, once nothing else is made from it: a body's separated parts " +
      "give it back when the last of them goes. A feature that's part of another can't be deleted until that one is.",
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
      // What it was built from shows on its own again, unless something else still holds it.
      for (const input of inputsOf(feature)) {
        const freed = featureById(doc, input);
        if (freed && !consumerOf(doc, input)) freed.visible = true;
      }
      return { document: doc, created: [], summary: `Deleted ${feature.id}` };
    },
  }),

  import_model: command({
    title: "Import a library model",
    description:
      "Brings one of the user's library models into the design as a mesh body: an STL, 3MF, STEP, OBJ or GLB file. " +
      "Find the model with search_models or list_models, and its files with list_model_files. It comes in at its own " +
      "size in mm, centred and standing on the bed, before position and rotation apply. A closed mesh can be combined, " +
      "rounded, drilled and hollowed like any body; one with gaps can only be moved, scaled and exported. It comes in " +
      "as one body however many loose parts it has (a 3MF's plate, or an STL of several pieces): the reply says how " +
      "many, and separate_parts makes each a body of its own. " +
      `Up to ${LIMITS.meshTriangles.toLocaleString("en")} triangles. The design keeps its own copy.`,
    kind: "import",
    args: {
      model_id: z.string().min(1).describe("The library model's id."),
      file_id: z
        .string()
        .min(1)
        .optional()
        .describe("Which of its 3D files, by its id from list_model_files. Default: its first one."),
      ...placement,
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
  kind: CommandKind;
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

/** What an import adds once the server has made the design's copy of the mesh: the import_model command's change to
 *  the feature tree, on a copy of `doc`. */
export function addMesh(
  doc: StudioDocument,
  mesh: Pick<MeshFeature, "asset_id" | "solid" | "triangles" | "size" | "parts" | "source">,
  args: { position?: Vec3; rotation?: Vec3; name?: string },
): CommandOutcome {
  const next = structuredClone(doc);
  const id = nextId(next, "mesh");
  addFeature(next, {
    id,
    type: "mesh",
    name: args.name ?? mesh.source.model_title.slice(0, 80),
    visible: true,
    transform: placed(args),
    ...mesh,
  });
  return {
    document: next,
    created: [id],
    summary:
      `Imported ${mesh.source.file_name} as ${id}, ${size3(...mesh.size)}` +
      (mesh.solid ? "" : ": not a closed solid, so it can't be combined") +
      (mesh.parts && mesh.parts > 1
        ? `. It's ${mesh.parts} separate parts in one body: separate_parts makes each a body of its own`
        : ""),
  };
}

/** The body separate_parts would work on, or why it can't: checked before it's measured, which takes a while. */
export function separableBody(doc: StudioDocument, id: string): BodyFeature {
  return freeBody(doc, id);
}

/** What separate_parts adds once the body's parts have been measured: a part feature for each, on a copy of `doc`.
 *  The browser previews it with parts it measured itself, the server makes it with its own. */
export function addParts(doc: StudioDocument, args: { feature_id: string }, parts: PartMeasure[]): CommandOutcome {
  const next = structuredClone(doc);
  const body = separableBody(next, args.feature_id);
  if (parts.length < 2) throw new CommandError(`${body.id} is one part: there's nothing to separate.`);
  if (parts.length > LIMITS.partsPerBody)
    throw new CommandError(
      `${body.id} is in ${parts.length} parts; Studio separates up to ${LIMITS.partsPerBody} at a time.`,
    );
  const created = parts.map((part) => {
    const id = nextId(next, "part");
    addFeature(next, {
      id,
      type: "part",
      name: "",
      visible: true,
      transform: { position: part.origin, rotation: [0, 0, 0], scale: [1, 1, 1] },
      source_id: body.id,
      bounds: part.bounds,
      origin: part.origin,
      solid: part.solid,
    });
    return id;
  });
  const open = parts.filter((part) => !part.solid).length;
  return {
    document: next,
    created,
    summary:
      `Separated ${body.id} into ${created.length} parts, ${created[0]} to ${created.at(-1)}, largest first` +
      (open ? `; ${open} of them have gaps, so they can't be combined` : ""),
  };
}

/** Carries out a document command on a copy of `doc`. */
export function applyCommand(doc: StudioDocument, name: string, args: unknown): CommandOutcome {
  const definition = studioCommand(name);
  if (!definition) throw new CommandError(`There's no Studio command ${name}.`);
  if (!definition.apply) throw new CommandError(`${name} isn't a change to the feature tree.`);
  return definition.apply(structuredClone(doc), parseCommandArgs(definition, args));
}
