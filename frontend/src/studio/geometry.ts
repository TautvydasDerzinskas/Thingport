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
  type MeshData,
  type SketchFeature,
  type StudioDocument,
  type Vec3,
} from "./document";

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

/** An imported mesh's triangles by its asset id, once the caller has loaded them. */
export type MeshLookup = (assetId: string) => MeshData | undefined;

/**
 * Makes the design's top-level bodies, or only the ones in `ids`. One that fails, say a boolean that came out empty,
 * is reported in `errors` and the rest still come out. Imported meshes come from `meshes`.
 */
export function evaluateDesign(
  wasm: ManifoldToplevel,
  doc: StudioDocument,
  ids?: readonly string[],
  meshes?: MeshLookup,
): Evaluation {
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
      case "mesh": {
        if (!feature.solid) throw new Error(`${feature.id} isn't a closed solid`);
        const data = meshOf(feature.id, feature.asset_id);
        return own(new Manifold(new wasm.Mesh({ numProp: 3, vertProperties: data.positions, triVerts: data.indices })));
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

  const meshOf = (id: string, assetId: string): MeshData => {
    const data = meshes?.(assetId);
    if (!data) throw new Error(`${id}'s mesh isn't loaded`);
    return data;
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
        // An open mesh isn't a solid manifold can make, but it shows, moves and exports as it is.
        if (feature.type === "mesh" && !feature.solid) {
          bodies.push(openMesh(feature.id, meshOf(feature.id, feature.asset_id), transformMatrix(feature.transform)));
          continue;
        }
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

/** An open mesh as a body: as it is, measured but with no volume, which it doesn't enclose. */
function openMesh(id: string, mesh: MeshData, matrix: number[]): EvaluatedBody {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const point = applyMatrix(matrix, [mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]]);
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], point[axis]);
      max[axis] = Math.max(max[axis], point[axis]);
    }
  }
  return { id, mesh, matrix, bounds: { min, max }, volume: Number.NaN, triangles: mesh.indices.length / 3 };
}

/**
 * Makes an imported model's triangles (nine numbers each, Z up, in mm) into the design's copy: corners shared, centred
 * on X and Y and standing on Z = 0, and as manifold cleaned it when it's a closed solid.
 */
export function prepareMesh(
  wasm: ManifoldToplevel,
  triangles: Float32Array,
): { mesh: MeshData; solid: boolean; size: Vec3 } {
  // Corners at the same place become one, as an STL repeats each corner for every triangle that has it.
  const corners = new Map<string, number>();
  const positions: number[] = [];
  const indices = new Uint32Array(triangles.length / 3);
  for (let i = 0; i < triangles.length; i += 3) {
    const key = `${triangles[i]},${triangles[i + 1]},${triangles[i + 2]}`;
    let index = corners.get(key);
    if (index === undefined) {
      index = positions.length / 3;
      corners.set(key, index);
      positions.push(triangles[i], triangles[i + 1], triangles[i + 2]);
    }
    indices[i / 3] = index;
  }
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], positions[i + axis]);
      max[axis] = Math.max(max[axis], positions[i + axis]);
    }
  }
  const shift: Vec3 = [-(min[0] + max[0]) / 2, -(min[1] + max[1]) / 2, -min[2]];
  const centred = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i++) centred[i] = positions[i] + shift[i % 3];
  const size: Vec3 = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const welded: MeshData = { positions: centred, indices };
  try {
    const solid = new wasm.Manifold(new wasm.Mesh({ numProp: 3, vertProperties: centred, triVerts: indices }));
    try {
      if (solid.status() !== "NoError" || solid.isEmpty()) return { mesh: welded, solid: false, size };
      const clean = solid.getMesh();
      const stride = clean.numProp;
      const count = clean.vertProperties.length / stride;
      const out = new Float32Array(count * 3);
      for (let i = 0; i < count; i++)
        for (let axis = 0; axis < 3; axis++) out[i * 3 + axis] = clean.vertProperties[i * stride + axis];
      return { mesh: { positions: out, indices: new Uint32Array(clean.triVerts) }, solid: true, size };
    } finally {
      solid.delete();
    }
  } catch {
    // "Not manifold": it has gaps, or edges shared by more than two triangles.
    return { mesh: welded, solid: false, size };
  }
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
    else if (feature.type === "mesh") total += feature.triangles;
    else if (feature.type === "sketch")
      total += feature.shapes.reduce(
        (sum, shape) => sum + 4 * (shape.type === "polygon" ? shape.points.length : shape.type === "circle" ? 64 : 4),
        0,
      );
  }
  return total;
}
