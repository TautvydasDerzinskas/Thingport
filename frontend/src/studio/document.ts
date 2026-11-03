// A Studio design: a parametric feature tree, kept as plain JSON so it's stored, sent and read by an AI as it is.
// Every change to one is a command (commands.ts); nothing else writes it.
//
// This folder runs in the browser and in Node: scripts/sync-studio.mjs copies it to backend/src/studio/ as
// *.generated.ts. Keep it free of DOM, React and backend imports; zod and manifold's types are all it may use.
//
// Units are millimetres, and Z is up, as on a printer's bed.

export const DOCUMENT_VERSION = 1;

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

/** Scale first, then rotation (degrees about the world X, then Y, then Z axis), then position. */
export type Transform = { position: Vec3; rotation: Vec3; scale: Vec3 };

/** XY is the bed seen from above, XZ the front, YZ the right side. */
export type SketchPlane = "XY" | "XZ" | "YZ";

export type SketchShape =
  | { type: "rectangle"; center: Vec2; width: number; height: number; hole?: boolean }
  | { type: "circle"; center: Vec2; radius: number; hole?: boolean }
  | { type: "polygon"; points: Vec2[]; hole?: boolean };

export type BooleanOperation = "union" | "subtract" | "intersect";

type Common = {
  id: string;
  /** Empty until someone names it; the UI then shows its type and number. */
  name: string;
  visible: boolean;
};
type Body = Common & { transform: Transform };

export type BoxFeature = Body & { type: "box"; width: number; depth: number; height: number };
export type CylinderFeature = Body & { type: "cylinder"; radius: number; height: number; segments: number };
export type ConeFeature = Body & {
  type: "cone";
  radius_bottom: number;
  radius_top: number;
  height: number;
  segments: number;
};
export type SphereFeature = Body & { type: "sphere"; radius: number; segments: number };
export type TorusFeature = Body & { type: "torus"; major_radius: number; minor_radius: number; segments: number };
export type ExtrudeFeature = Body & { type: "extrude"; sketch_id: string; distance: number };
export type BooleanFeature = Body & {
  type: "boolean";
  operation: BooleanOperation;
  target_id: string;
  tool_ids: string[];
};
export type SketchFeature = Common & { type: "sketch"; plane: SketchPlane; offset: number; shapes: SketchShape[] };

export type PrimitiveFeature = BoxFeature | CylinderFeature | ConeFeature | SphereFeature | TorusFeature;
export type BodyFeature = PrimitiveFeature | ExtrudeFeature | BooleanFeature;
export type Feature = BodyFeature | SketchFeature;
export type FeatureType = Feature["type"];

export type StudioDocument = {
  version: typeof DOCUMENT_VERSION;
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
  /** The largest any length may be, in mm. */
  size: 10_000,
  segmentsMin: 3,
  segmentsMax: 256,
} as const;

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
  if (feature.type === "extrude") return [feature.sketch_id];
  if (feature.type === "boolean") return [feature.target_id, ...feature.tool_ids];
  return [];
}

/** The feature built from this one, which it then belongs to: a boolean, or the extrude of a sketch. */
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
export function planeAxes(plane: SketchPlane): { u: Vec3; v: Vec3; n: Vec3; offsetAxis: 0 | 1 | 2 } {
  if (plane === "XZ") return { u: [1, 0, 0], v: [0, 0, 1], n: [0, -1, 0], offsetAxis: 1 };
  if (plane === "YZ") return { u: [0, 1, 0], v: [0, 0, 1], n: [1, 0, 0], offsetAxis: 0 };
  return { u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1], offsetAxis: 2 };
}

/** A point on a sketch in world coordinates. */
export function sketchPointToWorld(sketch: Pick<SketchFeature, "plane" | "offset">, point: Vec2): Vec3 {
  const { u, v, offsetAxis } = planeAxes(sketch.plane);
  const world: Vec3 = [
    u[0] * point[0] + v[0] * point[1],
    u[1] * point[0] + v[1] * point[1],
    u[2] * point[0] + v[2] * point[1],
  ];
  world[offsetAxis] += sketch.offset;
  return world;
}

/** A shape's outline as a closed loop of points on its plane, as it's drawn and as it's extruded. */
export function shapeOutline(shape: SketchShape, segments = DEFAULT_SEGMENTS): Vec2[] {
  if (shape.type === "polygon") return shape.points;
  const [cx, cy] = shape.center;
  if (shape.type === "rectangle") {
    const w = shape.width / 2;
    const h = shape.height / 2;
    return [
      [cx - w, cy - h],
      [cx + w, cy - h],
      [cx + w, cy + h],
      [cx - w, cy + h],
    ];
  }
  return Array.from({ length: segments }, (_, i): Vec2 => {
    const angle = (i / segments) * Math.PI * 2;
    return [cx + Math.cos(angle) * shape.radius, cy + Math.sin(angle) * shape.radius];
  });
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

export function applyMatrix(m: number[], [x, y, z]: Vec3): Vec3 {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}
