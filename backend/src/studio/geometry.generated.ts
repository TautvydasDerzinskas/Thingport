// GENERATED from frontend/src/studio/geometry.ts by scripts/sync-studio.mjs. Don't edit it here:
// change frontend/src/studio/ and run npm run studio:sync.
import type { CrossSection, Manifold, ManifoldToplevel, Mat4 } from "manifold-3d";
import {
  applyMatrix,
  DEFAULT_SEGMENTS,
  featureById,
  isBody,
  planeAxes,
  shapeOutline,
  topLevel,
  transformMatrix,
  type BodyFeature,
  type SketchFeature,
  type StudioDocument,
  type Vec3,
} from "./document.generated";

// A design's solids, made with manifold, which keeps every boolean watertight. The caller loads manifold (the browser
// from its WebAssembly file, Node from its package) and hands it in.

export type BodyMesh = {
  /** x, y, z per vertex. */
  positions: Float32Array;
  /** Three vertices per triangle, counter-clockwise from outside. */
  indices: Uint32Array;
};

export type EvaluatedBody = {
  id: string;
  /** In the body's own frame, before its transform: the viewer puts that on the object instead, so moving it is free. */
  mesh: BodyMesh;
  /** The body's transform, column-major, to bring `mesh` into the world. */
  matrix: number[];
  /** In the world, in mm. */
  bounds: { min: Vec3; max: Vec3 };
  /** In mm³. */
  volume: number;
  triangles: number;
};

export type Evaluation = {
  bodies: EvaluatedBody[];
  /** Bodies that couldn't be made, and why. */
  errors: { id: string; message: string }[];
};

type Disposable = { delete(): void };

function planeMatrix(sketch: SketchFeature): Mat4 {
  const { u, v, n, offsetAxis } = planeAxes(sketch.plane);
  const at: Vec3 = [0, 0, 0];
  at[offsetAxis] = sketch.offset;
  return [...u, 0, ...v, 0, ...n, 0, ...at, 1] as Mat4;
}

/**
 * Makes the design's top-level bodies, or only the ones in `ids`. One that fails, say a boolean that came out empty,
 * is reported in `errors` and the rest still come out.
 */
export function evaluateDesign(wasm: ManifoldToplevel, doc: StudioDocument, ids?: readonly string[]): Evaluation {
  const { Manifold, CrossSection } = wasm;
  // Manifold's objects live in WebAssembly memory, which nothing collects: everything made here goes at the end.
  const made: Disposable[] = [];
  const own = <T extends Disposable>(value: T): T => {
    made.push(value);
    return value;
  };
  const placed = new Map<string, Manifold>();

  const section = (sketch: SketchFeature): CrossSection => {
    const part = (shape: SketchFeature["shapes"][number]) =>
      own(new CrossSection([shapeOutline(shape, DEFAULT_SEGMENTS)], "NonZero"));
    const solids = sketch.shapes.filter((shape) => !shape.hole).map(part);
    const holes = sketch.shapes.filter((shape) => shape.hole).map(part);
    if (!solids.length) throw new Error(`${sketch.id} has no shape to extrude`);
    const joined = own(CrossSection.union(solids));
    return holes.length ? own(joined.subtract(own(CrossSection.union(holes)))) : joined;
  };

  // The body as made, before its own transform.
  const local = (feature: BodyFeature): Manifold => {
    switch (feature.type) {
      case "box":
        return own(
          own(Manifold.cube([feature.width, feature.depth, feature.height])).translate([
            -feature.width / 2,
            -feature.depth / 2,
            0,
          ]),
        );
      case "cylinder":
        return own(Manifold.cylinder(feature.height, feature.radius, feature.radius, feature.segments));
      case "cone":
        return own(Manifold.cylinder(feature.height, feature.radius_bottom, feature.radius_top, feature.segments));
      case "sphere":
        return own(own(Manifold.sphere(feature.radius, feature.segments)).translate([0, 0, feature.radius]));
      case "torus": {
        const ring = own(
          own(CrossSection.circle(feature.minor_radius, feature.segments)).translate([feature.major_radius, 0]),
        );
        return own(own(ring.revolve(feature.segments)).translate([0, 0, feature.minor_radius]));
      }
      case "extrude": {
        const sketch = featureById(doc, feature.sketch_id);
        if (sketch?.type !== "sketch") throw new Error(`${feature.sketch_id} is missing`);
        const height = Math.abs(feature.distance);
        let solid = own(section(sketch).extrude(height));
        if (feature.distance < 0) solid = own(solid.translate([0, 0, -height]));
        return own(solid.transform(planeMatrix(sketch)));
      }
      case "boolean": {
        const target = inWorld(feature.target_id);
        const tools = feature.tool_ids.map(inWorld);
        if (feature.operation === "union") return own(Manifold.union([target, ...tools]));
        if (feature.operation === "intersect") return own(Manifold.intersection([target, ...tools]));
        return own(target.subtract(own(Manifold.union(tools))));
      }
    }
  };

  // The body where it is: what a boolean is made of.
  const inWorld = (id: string): Manifold => {
    const known = placed.get(id);
    if (known) return known;
    const feature = featureById(doc, id);
    if (!feature || !isBody(feature)) throw new Error(`${id} is missing`);
    const solid = own(local(feature).transform(transformMatrix(feature.transform) as Mat4));
    placed.set(id, solid);
    return solid;
  };

  const wanted = ids ? new Set(ids) : null;
  const bodies: EvaluatedBody[] = [];
  const errors: Evaluation["errors"] = [];
  try {
    for (const feature of topLevel(doc)) {
      if (!isBody(feature) || (wanted && !wanted.has(feature.id))) continue;
      try {
        const solid = local(feature);
        const status = solid.status();
        if (status !== "NoError") throw new Error(`manifold reported ${status}`);
        if (solid.isEmpty()) {
          errors.push({
            id: feature.id,
            message:
              feature.type === "boolean"
                ? `${feature.id} came out empty: its bodies don't overlap the way the ${feature.operation} needs`
                : `${feature.id} came out empty`,
          });
          continue;
        }
        const matrix = transformMatrix(feature.transform);
        const world = own(solid.transform(matrix as Mat4));
        const mesh = solid.getMesh();
        const stride = mesh.numProp;
        const count = mesh.vertProperties.length / stride;
        const positions = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
          positions[i * 3] = mesh.vertProperties[i * stride];
          positions[i * 3 + 1] = mesh.vertProperties[i * stride + 1];
          positions[i * 3 + 2] = mesh.vertProperties[i * stride + 2];
        }
        const box = world.boundingBox();
        bodies.push({
          id: feature.id,
          mesh: { positions, indices: new Uint32Array(mesh.triVerts) },
          matrix,
          bounds: { min: [...box.min] as Vec3, max: [...box.max] as Vec3 },
          volume: world.volume(),
          triangles: mesh.triVerts.length / 3,
        });
      } catch (error) {
        errors.push({ id: feature.id, message: error instanceof Error ? error.message : String(error) });
      }
    }
  } finally {
    for (const each of made) each.delete();
  }
  return { bodies, errors };
}

/** A body's triangles in the world, nine numbers each, as an STL file or a renderer takes them. */
export function worldTriangles(body: EvaluatedBody): Float32Array {
  const { positions, indices } = body.mesh;
  const out = new Float32Array(indices.length * 3);
  for (let i = 0; i < indices.length; i++) {
    const at = indices[i] * 3;
    const [x, y, z] = applyMatrix(body.matrix, [positions[at], positions[at + 1], positions[at + 2]]);
    out[i * 3] = x;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = z;
  }
  return out;
}

/** Roughly how many triangles the design makes, before any of it is made: a server refuses one far too heavy. */
export function estimateTriangles(doc: StudioDocument): number {
  let total = 0;
  for (const feature of doc.features) {
    if (feature.type === "box") total += 12;
    else if (feature.type === "cylinder" || feature.type === "cone") total += feature.segments * 4;
    else if (feature.type === "sphere") total += (feature.segments * feature.segments) / 2;
    else if (feature.type === "torus") total += feature.segments * feature.segments * 2;
    else if (feature.type === "sketch")
      total += feature.shapes.reduce(
        (sum, shape) => sum + 4 * (shape.type === "polygon" ? shape.points.length : shape.type === "circle" ? 64 : 4),
        0,
      );
  }
  return total;
}
