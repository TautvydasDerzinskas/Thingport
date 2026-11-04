// A Studio design: a parametric feature tree, kept as plain JSON so it's stored, sent and read by an AI as it is.
// Every change to one is a command (commands.ts); nothing else writes it.
//
// This folder runs in the browser and in Node: scripts/sync-studio.mjs copies it to backend/src/studio/ as
// *.generated.ts. Keep it free of DOM, React and backend imports; zod and manifold's types are all it may use.
//
// Units are millimetres, and Z is up, as on a printer's bed.

export const DOCUMENT_VERSION = 1;

export type { Vec2, Vec3 } from "./vec";
import { applyMatrix, cross, frameMatrix, normalize, type Vec2, type Vec3 } from "./vec";
import { treatCorners } from "./shapes2d";
import { textContours, type TextShape } from "./text";
import { pathContours } from "./svgPath";
import { traceContours, type TraceShape } from "./trace";
export { applyMatrix };

/** Scale first, then rotation (degrees about the world X, then Y, then Z axis), then position. */
export type Transform = { position: Vec3; rotation: Vec3; scale: Vec3 };

/** XY is the bed seen from above, XZ the front, YZ the right side; FACE is a body's flat face, kept in `frame`. */
export type SketchPlane = "XY" | "XZ" | "YZ" | "FACE";

export type SketchShape =
  | { type: "rectangle"; center: Vec2; width: number; height: number; corner_radius?: number; hole?: boolean }
  | { type: "circle"; center: Vec2; radius: number; hole?: boolean }
  | { type: "polygon"; points: Vec2[]; corner_radius?: number; hole?: boolean }
  | TextShape
  | TraceShape
  | PathShape;
/** Outlines drawn as SVG path data, in the sketch's own [u, v] mm (v up). Evenodd, the default, makes a loop inside
 *  another a hole whichever way it's drawn; nonzero goes by which way each loop winds, as SVG does. */
export type PathShape = { type: "path"; d: string; fill?: "evenodd" | "nonzero"; hole?: boolean };
/** The shapes drawn as one closed loop. */
export type OutlineShape = Exclude<SketchShape, TextShape | TraceShape | PathShape>;

export type BooleanOperation = "union" | "subtract" | "intersect";

/** A rounded or bevelled edge: the radius of a fillet, or how far a chamfer cuts back along both faces, in mm. */
export type EdgeTreatment = { type: "fillet" | "chamfer"; size: number };

/** A flat face of a body: a point on it and the way it faces out, in the body's own frame (before its transform), so
 *  the reference moves with the body. */
export type FaceRef = { point: Vec3; normal: Vec3 };
/** A straight edge of a body, by two points on it, in the body's own frame. Found again on the body as it is now. */
export type EdgeRef = { a: Vec3; b: Vec3 };

type Common = {
  id: string;
  /** Empty until someone names it; the UI then shows its type and number. */
  name: string;
  visible: boolean;
  /** Formulas some of its numbers follow, over the design's parameters, by field: "width", "position.x",
   *  "shapes.0.radius". The numbers themselves are kept in the feature too, worked out again as parameters change. */
  expressions?: Record<string, string>;
};
type Body = Common & { transform: Transform };

export type BoxFeature = Body & { type: "box"; width: number; depth: number; height: number };
export type CylinderFeature = Body & {
  type: "cylinder";
  radius: number;
  height: number;
  segments: number;
  top_edge?: EdgeTreatment | null;
  bottom_edge?: EdgeTreatment | null;
};
export type ConeFeature = Body & {
  type: "cone";
  radius_bottom: number;
  radius_top: number;
  height: number;
  segments: number;
  top_edge?: EdgeTreatment | null;
  bottom_edge?: EdgeTreatment | null;
};
export type SphereFeature = Body & { type: "sphere"; radius: number; segments: number };
/** An ISO metric screw thread along its own Z from its origin, `length` up: a threaded rod, or (internal) the solid a
 *  matching threaded hole is cut with. `clearance` is taken off a rod's radius and added to a cutter's, so printed
 *  parts fit together. */
export type ThreadFeature = Body & {
  type: "thread";
  diameter: number;
  pitch: number;
  length: number;
  internal: boolean;
  clearance: number;
  hand: "right" | "left";
  chamfer: boolean;
  segments: number;
};
export type TorusFeature = Body & { type: "torus"; major_radius: number; minor_radius: number; segments: number };
export type ExtrudeFeature = Body & {
  type: "extrude";
  sketch_id: string;
  distance: number;
  /** Half the distance each way from the sketch. */
  symmetric?: boolean;
  /** Where it starts, along the way it goes, from the sketch's plane. */
  start_offset?: number;
  /** Degrees the sides lean in towards the far end: a draft. Negative leans them out. */
  taper?: number;
  /** The far end's edges, and the near end's. */
  top_edge?: EdgeTreatment | null;
  bottom_edge?: EdgeTreatment | null;
};
export type RevolveFeature = Body & {
  type: "revolve";
  sketch_id: string;
  /** The sketch's own u or v axis, through its origin. */
  axis: "u" | "v";
  angle: number;
  segments: number;
};
export type BooleanFeature = Body & {
  type: "boolean";
  operation: BooleanOperation;
  target_id: string;
  tool_ids: string[];
};
export type PressPullFeature = Body & { type: "press_pull"; target_id: string; face: FaceRef; distance: number };
export type FilletFeature = Body & {
  type: "fillet";
  target_id: string;
  edges: EdgeRef[];
  radius: number;
  segments: number;
};
export type ChamferFeature = Body & { type: "chamfer"; target_id: string; edges: EdgeRef[]; distance: number };
export type HoleFeature = Body & {
  type: "hole";
  target_id: string;
  /** Where it's drilled, and the face's outward normal there: it goes in against it. */
  face: FaceRef;
  diameter: number;
  /** Null goes right through. */
  depth: number | null;
  counterbore?: { diameter: number; depth: number } | null;
  countersink?: { diameter: number; angle: number } | null;
  /** An ISO metric thread cut in it instead of a plain bore, `diameter` then being its nominal size. */
  thread?: { pitch: number; clearance: number } | null;
  segments: number;
};
export type ShellFeature = Body & { type: "shell"; target_id: string; thickness: number; open_faces: FaceRef[] };
/** One of the two parts a split makes; the split makes both. */
export type SplitFeature = Body & {
  type: "split";
  source_id: string;
  /** A plane in the source's own frame, or another body to cut with. */
  plane: { point: Vec3; normal: Vec3 } | null;
  tool_id: string | null;
  /** By a plane: the side its normal points to (front) or the other (back). By a body: inside it or outside it. */
  keep: "front" | "back" | "inside" | "outside";
};
export type SketchFeature = Common & {
  type: "sketch";
  plane: SketchPlane;
  offset: number;
  /** For a sketch on a face: the face's plane as it was, with u along it; v is normal × u. */
  frame?: { origin: Vec3; u: Vec3; normal: Vec3 } | null;
  shapes: SketchShape[];
};
/** A model brought in from the library. Its triangles are the design's own copy, `asset_id`, kept beside the design:
 *  a later change to the library model doesn't reach it. */
export type MeshFeature = Body & {
  type: "mesh";
  asset_id: string;
  /** Closed, with no gaps, so a boolean can use it. One that isn't can still be moved, scaled and exported. */
  solid: boolean;
  triangles: number;
  /** Its size as it came in, in mm, [x, y, z]. */
  size: Vec3;
  /** How many loose parts it came in as, which separate_parts makes bodies of their own. Not known for older imports. */
  parts?: number;
  /** Where it came from, as it was then. */
  source: { model_id: string; file_id: string; file_name: string; model_title: string };
};
/** One of the loose parts of a body, which separate_parts makes all of. */
export type PartFeature = Body & {
  type: "part";
  source_id: string;
  /** Where it is in its source, in the source's own frame: it's found again by this each time the source is made. */
  bounds: { min: Vec3; max: Vec3 };
  /** The point of the world its own origin was at as it was separated: its base's middle. */
  origin: Vec3;
  /** Closed, so a boolean can use it; a part of a mesh with gaps may not be. */
  solid: boolean;
};
/** How a pattern copies its body: in a row (or a grid), round an axis, or mirrored across a plane, in the world. */
export type PatternKind =
  | {
      kind: "linear";
      direction: Vec3;
      count: number;
      spacing: number;
      /** A second way, for a grid: null for a row. */
      grid_direction: Vec3 | null;
      grid_count: number;
      grid_spacing: number;
    }
  | {
      kind: "circular";
      axis_point: Vec3;
      axis_direction: Vec3;
      count: number;
      /** The angle the copies spread over: 360 spaces them evenly all the way round. */
      angle: number;
    }
  | { kind: "mirror"; plane_point: Vec3; plane_normal: Vec3; keep_original: boolean };
/** Copies of a body made into one body with it, as the body is where it is. */
export type PatternFeature = Body & { type: "pattern"; source_id: string } & PatternKind;
/** A solid through two or more sketches' outlines in order, with straight sides between them and flat ends. */
export type LoftFeature = Body & { type: "loft"; sketch_ids: string[] };
/** A sketch's shapes pulled along a path of points in the world, square to it all the way, the sketch's origin on it. */
export type SweepFeature = Body & { type: "sweep"; sketch_id: string; path: Vec3[]; closed: boolean; smooth: boolean };
/** The smallest convex body around others, as if they were shrink-wrapped together. */
export type HullFeature = Body & { type: "hull"; body_ids: string[] };

/** A loose part as a body is measured for separate_parts: what its part feature keeps. */
export type PartMeasure = Pick<PartFeature, "bounds" | "origin" | "solid">;

export type PrimitiveFeature =
  BoxFeature | CylinderFeature | ConeFeature | SphereFeature | TorusFeature | ThreadFeature;
/** Features that change one body, which they then belong to. */
export type ModifyFeature = PressPullFeature | FilletFeature | ChamferFeature | HoleFeature | ShellFeature;
export type BodyFeature =
  | PrimitiveFeature
  | MeshFeature
  | ExtrudeFeature
  | RevolveFeature
  | BooleanFeature
  | ModifyFeature
  | SplitFeature
  | PartFeature
  | PatternFeature
  | HullFeature
  | LoftFeature
  | SweepFeature;
export type Feature = BodyFeature | SketchFeature;
export type FeatureType = Feature["type"];

/** A named number a design's formulas use, such as wall = 2. */
export type Parameter = { name: string; value: number };

export type StudioDocument = {
  version: typeof DOCUMENT_VERSION;
  /** Absent in a design that never had one. */
  parameters?: Parameter[];
  /** In the order they were made, so a feature only ever uses ones before it. */
  features: Feature[];
  /** The number in the next feature's id. Ids are never reused, so an old one can't point at a new feature. */
  next_id: number;
};

// What one design may hold. A server evaluates designs for assistants, so these keep that bounded.
export const LIMITS = {
  features: 200,
  shapesPerSketch: 50,
  pointsPerPolygon: 500,
  /** A text shape's characters. */
  textLength: 200,
  /** The largest any length may be, in mm. */
  size: 10_000,
  segmentsMin: 3,
  segmentsMax: 256,
  /** An imported mesh's triangles. */
  meshTriangles: 1_000_000,
  /** The edges one fillet or chamfer rounds. */
  edgesPerFeature: 100,
  /** A shell builds walls under every face, which takes time with every triangle: past this it's refused. */
  shellTriangles: 20_000,
  /** The parts one body separates into. */
  partsPerBody: 100,
  /** The copies one pattern makes, in all. */
  patternCopies: 200,
  /** A design's parameters. */
  parameters: 100,
} as const;

/** A mesh as a design keeps it: corners shared between triangles, centred on X and Y, standing on Z = 0, in mm. */
export type MeshData = { positions: Float32Array; indices: Uint32Array };

/** An imported mesh's id, as its file beside the design is named. */
export const ASSET_ID = /^[0-9a-f]{24}$/;

export const DEFAULT_SEGMENTS = 64;

export const IDENTITY: Transform = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };

export function emptyDocument(): StudioDocument {
  return { version: DOCUMENT_VERSION, features: [], next_id: 1 };
}

export function isBody(feature: Feature): feature is BodyFeature {
  return feature.type !== "sketch";
}

/** The features this one is built from. */
export function inputsOf(feature: Feature): string[] {
  switch (feature.type) {
    case "extrude":
    case "revolve":
    case "sweep":
      return [feature.sketch_id];
    case "loft":
      return feature.sketch_ids;
    case "boolean":
      return [feature.target_id, ...feature.tool_ids];
    case "press_pull":
    case "fillet":
    case "chamfer":
    case "hole":
    case "shell":
      return [feature.target_id];
    case "split":
      return feature.tool_id ? [feature.source_id, feature.tool_id] : [feature.source_id];
    case "part":
    case "pattern":
      return [feature.source_id];
    case "hull":
      return feature.body_ids;
    default:
      return [];
  }
}

/** Whether a body is a closed solid, as booleans and changes to it need: an imported mesh with gaps, or a part of one,
 *  may not be. */
export function isSolid(feature: BodyFeature): boolean {
  return !((feature.type === "mesh" || feature.type === "part") && !feature.solid);
}

/** The feature built from this one, which it then belongs to: a boolean, a change to it, or the extrude of a sketch.
 *  A split's two parts both are, as are a body's separated parts; this is the first. */
export function consumerOf(doc: StudioDocument, id: string): Feature | undefined {
  return doc.features.find((feature) => inputsOf(feature).includes(id));
}

/** What shows on its own: every feature no other one is built from. */
export function topLevel(doc: StudioDocument): Feature[] {
  const used = new Set(doc.features.flatMap(inputsOf));
  return doc.features.filter((feature) => !used.has(feature.id));
}

export function featureById(doc: StudioDocument, id: string): Feature | undefined {
  return doc.features.find((feature) => feature.id === id);
}

/** The number in an id like `box-3`, for a name the UI can show in any language. */
export function featureNumber(id: string): number {
  const match = /-(\d+)$/.exec(id);
  return match ? Number(match[1]) : 0;
}

/** The plane's axes in the world: u and v span it, n is the way an extrude goes. Right-handed, so nothing mirrors. */
export function planeAxes(plane: Exclude<SketchPlane, "FACE">): { u: Vec3; v: Vec3; n: Vec3; offsetAxis: 0 | 1 | 2 } {
  if (plane === "XZ") return { u: [1, 0, 0], v: [0, 0, 1], n: [0, -1, 0], offsetAxis: 1 };
  if (plane === "YZ") return { u: [0, 1, 0], v: [0, 0, 1], n: [1, 0, 0], offsetAxis: 0 };
  return { u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1], offsetAxis: 2 };
}

/** Where a sketch lies in the world: its origin, its u and v axes, and n, the way an extrude of it goes. */
export type SketchFrame = { origin: Vec3; u: Vec3; v: Vec3; n: Vec3 };

export function sketchFrame(sketch: Pick<SketchFeature, "plane" | "offset" | "frame">): SketchFrame {
  if (sketch.plane === "FACE" && sketch.frame) {
    const n = normalize(sketch.frame.normal);
    const u = normalize(sketch.frame.u);
    const origin = sketch.frame.origin;
    return {
      origin: [origin[0] + n[0] * sketch.offset, origin[1] + n[1] * sketch.offset, origin[2] + n[2] * sketch.offset],
      u,
      v: cross(n, u),
      n,
    };
  }
  const { u, v, n, offsetAxis } = planeAxes(sketch.plane === "FACE" ? "XY" : sketch.plane);
  const origin: Vec3 = [0, 0, 0];
  origin[offsetAxis] = sketch.offset;
  return { origin, u, v, n };
}

/** The matrix taking a sketch's (u, v, n) coordinates into the world. */
export function sketchMatrix(sketch: Pick<SketchFeature, "plane" | "offset" | "frame">): number[] {
  const { origin, u, v, n } = sketchFrame(sketch);
  return frameMatrix(u, v, n, origin);
}

/** A point on a sketch in world coordinates. */
export function sketchPointToWorld(sketch: Pick<SketchFeature, "plane" | "offset" | "frame">, point: Vec2): Vec3 {
  return applyMatrix(sketchMatrix(sketch), [point[0], point[1], 0]);
}

/** A shape's outlines on its plane, as it's drawn and as it's extruded: one closed loop, or a text's letters or a
 *  traced picture's shapes, whose holes wind against their outsides (a nonzero fill makes them right). Throws when a
 *  corner radius doesn't fit, or a text's font can't draw it. */
export function shapeContours(shape: SketchShape, segments = DEFAULT_SEGMENTS): Vec2[][] {
  if (shape.type === "text") return textContours(shape);
  if (shape.type === "trace") return traceContours(shape);
  if (shape.type === "path") return pathContours(shape.d);
  return [shapeOutline(shape, segments)];
}

/** How a shape's outlines are filled: by winding (nonzero), or a path's loops inside others cut out (evenodd). */
export function shapeFill(shape: SketchShape): "NonZero" | "EvenOdd" {
  return shape.type === "path" && shape.fill !== "nonzero" ? "EvenOdd" : "NonZero";
}

/** A one-loop shape's outline as a closed loop of points on its plane. Throws when a corner radius doesn't fit. */
export function shapeOutline(shape: OutlineShape, segments = DEFAULT_SEGMENTS): Vec2[] {
  if (shape.type === "circle") {
    const [cx, cy] = shape.center;
    return Array.from({ length: segments }, (_, i): Vec2 => {
      const angle = (i / segments) * Math.PI * 2;
      return [cx + Math.cos(angle) * shape.radius, cy + Math.sin(angle) * shape.radius];
    });
  }
  let points: Vec2[];
  if (shape.type === "polygon") points = shape.points;
  else {
    const [cx, cy] = shape.center;
    const w = shape.width / 2;
    const h = shape.height / 2;
    points = [
      [cx - w, cy - h],
      [cx + w, cy - h],
      [cx + w, cy + h],
      [cx - w, cy + h],
    ];
  }
  const radius = shape.corner_radius ?? 0;
  return radius > 0 ? treatCorners(points, () => ({ type: "fillet", size: radius })) : points;
}

/** The rotation that turns `from` onto `to`, both unit vectors, by rows. */
export function turnOnto(from: Vec3, to: Vec3): number[][] {
  const axis = cross(from, to);
  const sin = Math.hypot(...axis);
  const cos = from[0] * to[0] + from[1] * to[1] + from[2] * to[2];
  if (sin < 1e-9) {
    if (cos > 0)
      return [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ];
    // Half a turn, about any axis square to them.
    const [x, y, z] = normalize(Math.abs(from[0]) < 0.9 ? cross(from, [1, 0, 0]) : cross(from, [0, 1, 0]));
    return [
      [2 * x * x - 1, 2 * x * y, 2 * x * z],
      [2 * x * y, 2 * y * y - 1, 2 * y * z],
      [2 * x * z, 2 * y * z, 2 * z * z - 1],
    ];
  }
  const [x, y, z] = [axis[0] / sin, axis[1] / sin, axis[2] / sin];
  const t = 1 - cos;
  return [
    [t * x * x + cos, t * x * y - sin * z, t * x * z + sin * y],
    [t * x * y + sin * z, t * y * y + cos, t * y * z - sin * x],
    [t * x * z - sin * y, t * y * z + sin * x, t * z * z + cos],
  ];
}

/** A rotation, by rows, as a transform's degrees about the world X, then Y, then Z: transformMatrix's, undone. */
export function rotationDegrees(r: number[][]): Vec3 {
  const deg = (radians: number) => Number(((radians * 180) / Math.PI).toFixed(4)) + 0;
  const sy = -r[2][0];
  // Straight up or down, X and Z turn about the same axis: it's all put on Z.
  if (Math.abs(sy) > 0.999999) return [0, deg(Math.sign(sy) * (Math.PI / 2)), deg(Math.atan2(-r[0][1], r[1][1]))];
  return [deg(Math.atan2(r[2][1], r[2][2])), deg(Math.asin(sy)), deg(Math.atan2(r[1][0], r[0][0]))];
}

/** A transform's rotation alone, by rows. */
export function rotationRows(rotation: Vec3): number[][] {
  const m = transformMatrix({ position: [0, 0, 0], rotation, scale: [1, 1, 1] });
  return [
    [m[0], m[4], m[8]],
    [m[1], m[5], m[9]],
    [m[2], m[6], m[10]],
  ];
}

/**
 * The transform as a column-major 4x4 matrix, as manifold and three.js take one: position * Rz * Ry * Rx * scale. The
 * rotations are about the world axes in X, Y, Z order, which is three.js's Euler order "ZYX".
 */
export function transformMatrix({ position, rotation, scale }: Transform): number[] {
  const [rx, ry, rz] = rotation.map((degrees) => (degrees * Math.PI) / 180);
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(rx), Math.sin(rx), Math.cos(ry), Math.sin(ry), Math.cos(rz), Math.sin(rz)];
  // Rz * Ry * Rx, by rows.
  const r = [
    [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
    [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
    [-sy, cy * sx, cy * cx],
  ];
  return [
    r[0][0] * scale[0],
    r[1][0] * scale[0],
    r[2][0] * scale[0],
    0,
    r[0][1] * scale[1],
    r[1][1] * scale[1],
    r[2][1] * scale[1],
    0,
    r[0][2] * scale[2],
    r[1][2] * scale[2],
    r[2][2] * scale[2],
    0,
    position[0],
    position[1],
    position[2],
    1,
  ];
}
