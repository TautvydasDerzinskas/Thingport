import type { CrossSection, Manifold, ManifoldToplevel, Mat4 } from "manifold-3d";
import {
  DEFAULT_SEGMENTS,
  featureById,
  isBody,
  LIMITS,
  shapeOutline,
  sketchFrame,
  sketchMatrix,
  topLevel,
  transformMatrix,
  type BodyFeature,
  type MeshData,
  type SketchFeature,
  type StudioDocument,
} from "./document";
import { edgeWork, extrudeRings, holeCutter, loft, roundedCylinder, sectionOf, wallsOf, type Own } from "./solids";
import { analyze, faceTriangles2d, findEdge, findFace, type Topology } from "./topology";
import {
  applyMatrix,
  applyNormal,
  cross,
  dot,
  frameMatrix,
  perpendicular,
  scale,
  sub,
  type Vec2,
  type Vec3,
} from "./vec";

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
  /** In mm³; NaN for an open mesh, which encloses none. */
  volume: number;
  triangles: number;
};

export type Evaluation = {
  bodies: EvaluatedBody[];
  /** Bodies that couldn't be made, and why. */
  errors: { id: string; message: string }[];
};

/** An imported mesh's triangles by its asset id, once the caller has loaded them. */
export type MeshLookup = (assetId: string) => MeshData | undefined;

/** A manifold's triangles as a plain mesh. */
function meshOf(solid: Manifold): MeshData {
  const mesh = solid.getMesh();
  const stride = mesh.numProp;
  const count = mesh.vertProperties.length / stride;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = mesh.vertProperties[i * stride];
    positions[i * 3 + 1] = mesh.vertProperties[i * stride + 1];
    positions[i * 3 + 2] = mesh.vertProperties[i * stride + 2];
  }
  return { positions, indices: new Uint32Array(mesh.triVerts) };
}

/** Outlines, reversed one by one: a section mirrored across its v axis. */
function mirrored(outlines: Vec2[][]): Vec2[][] {
  return outlines.map((outline) => outline.map(([x, y]): Vec2 => [-x, y]).toReversed());
}

/**
 * Makes a design's bodies on demand: each body's solid in its own frame (`local`) or where it is (`inWorld`), each made
 * once. `dispose` frees them all: manifold's objects live in WebAssembly memory, which nothing collects.
 */
function evaluator(wasm: ManifoldToplevel, doc: StudioDocument, meshes?: MeshLookup) {
  const { Manifold, CrossSection } = wasm;
  const made: { delete(): void }[] = [];
  const own: Own = (value) => {
    made.push(value);
    return value;
  };
  const locals = new Map<string, Manifold | Error>();
  const placed = new Map<string, Manifold>();

  const sketchOf = (id: string): SketchFeature => {
    const sketch = featureById(doc, id);
    if (sketch?.type !== "sketch") throw new Error(`${id} is missing`);
    return sketch;
  };

  const section = (sketch: SketchFeature): CrossSection => {
    const part = (shape: SketchFeature["shapes"][number]) =>
      own(new CrossSection([shapeOutline(shape, DEFAULT_SEGMENTS)], "NonZero"));
    const solids = sketch.shapes.filter((shape) => !shape.hole).map(part);
    const holes = sketch.shapes.filter((shape) => shape.hole).map(part);
    if (!solids.length) throw new Error(`${sketch.id} has no shape to extrude`);
    const joined = own(CrossSection.union(solids));
    return holes.length ? own(joined.subtract(own(CrossSection.union(holes)))) : joined;
  };

  const meshData = (id: string, assetId: string): MeshData => {
    const data = meshes?.(assetId);
    if (!data) throw new Error(`${id}'s mesh isn't loaded`);
    return data;
  };

  const topologyOf = (solid: Manifold): Topology => analyze(meshOf(solid));
  const hairOf = (solid: Manifold) => {
    const box = solid.boundingBox();
    const size = Math.max(...box.max.map((max, axis) => max - box.min[axis]));
    return Math.max(1e-4, size * 1e-5);
  };

  // A body that another feature changes, where it is, and the matrix that places references made in its own frame.
  const target = (id: string) => {
    const feature = featureById(doc, id);
    if (!feature || !isBody(feature)) throw new Error(`${id} is missing`);
    return { solid: inWorld(id), matrix: transformMatrix(feature.transform) };
  };

  // The body as made, before its own transform.
  const make = (feature: BodyFeature): Manifold => {
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
        return roundedCylinder(
          wasm,
          own,
          feature.radius,
          feature.radius,
          feature.height,
          feature.segments,
          feature.top_edge,
          feature.bottom_edge,
        );
      case "cone":
        return roundedCylinder(
          wasm,
          own,
          feature.radius_bottom,
          feature.radius_top,
          feature.height,
          feature.segments,
          feature.top_edge,
          feature.bottom_edge,
        );
      case "sphere":
        return own(own(Manifold.sphere(feature.radius, feature.segments)).translate([0, 0, feature.radius]));
      case "torus": {
        const ring = own(
          own(CrossSection.circle(feature.minor_radius, feature.segments)).translate([feature.major_radius, 0]),
        );
        return own(own(ring.revolve(feature.segments)).translate([0, 0, feature.minor_radius]));
      }
      case "extrude": {
        const sketch = sketchOf(feature.sketch_id);
        const base = section(sketch);
        const length = Math.abs(feature.distance);
        const taper = feature.taper ?? 0;
        let solid =
          taper || feature.top_edge || feature.bottom_edge
            ? loft(
                wasm,
                own,
                base.toPolygons() as Vec2[][],
                extrudeRings(length, taper, feature.top_edge, feature.bottom_edge),
              )
            : own(base.extrude(length));
        const way = Math.sign(feature.distance);
        if (way < 0) solid = own(solid.mirror([0, 0, 1]));
        const shift = way * ((feature.start_offset ?? 0) - (feature.symmetric ? length / 2 : 0));
        if (shift) solid = own(solid.translate([0, 0, shift]));
        return own(solid.transform(sketchMatrix(sketch) as Mat4));
      }
      case "revolve": {
        const sketch = sketchOf(feature.sketch_id);
        const { origin, u, v, n } = sketchFrame(sketch);
        // Manifold turns a section about its Y axis: the sketch's v, or its u turned onto Y.
        let outlines = section(sketch).toPolygons() as Vec2[][];
        if (feature.axis === "u") outlines = outlines.map((outline) => outline.map(([x, y]): Vec2 => [-y, x]));
        const xs = outlines.flat().map(([x]) => x);
        const slack = 1e-6;
        if (Math.min(...xs) < -slack && Math.max(...xs) > slack)
          throw new Error(`${sketch.id} crosses the axis it turns about: keep its shapes on one side`);
        if (Math.max(...xs) <= slack) outlines = mirrored(outlines);
        const solid = own(own(new CrossSection(outlines, "NonZero")).revolve(feature.segments, feature.angle));
        // Its Z is the axis, X the sketch's side of it at 0°.
        const [x, z] = feature.axis === "v" ? [u, v] : [scale(v, -1), u];
        return own(solid.transform(frameMatrix(x, scale(n, -1), z, origin) as Mat4));
      }
      case "mesh": {
        if (!feature.solid) throw new Error(`${feature.id} isn't a closed solid`);
        const data = meshData(feature.id, feature.asset_id);
        return own(new Manifold(new wasm.Mesh({ numProp: 3, vertProperties: data.positions, triVerts: data.indices })));
      }
      case "boolean": {
        const first = inWorld(feature.target_id);
        const tools = feature.tool_ids.map(inWorld);
        if (feature.operation === "union") return own(Manifold.union([first, ...tools]));
        if (feature.operation === "intersect") return own(Manifold.intersection([first, ...tools]));
        return own(first.subtract(own(Manifold.union(tools))));
      }
      case "press_pull": {
        const { solid, matrix } = target(feature.target_id);
        const top = topologyOf(solid);
        const point = applyMatrix(matrix, feature.face.point);
        const index = findFace(top, point, applyNormal(matrix, feature.face.normal));
        if (index < 0) throw new Error(`The face ${feature.id} pushes or pulls isn't on ${feature.target_id} any more`);
        const normal = top.faces[index].normal;
        const origin = sub(point, scale(normal, dot(normal, point) - top.faces[index].offset));
        const u = perpendicular(normal);
        const v = cross(normal, u);
        const face = sectionOf(wasm, own, faceTriangles2d(top, index, origin, u, v));
        const hair = hairOf(solid);
        const depth = Math.abs(feature.distance);
        const block = own(own(face.extrude(depth + hair)).translate([0, 0, feature.distance > 0 ? -hair : -depth]));
        const placedBlock = own(block.transform(frameMatrix(u, v, normal, origin) as Mat4));
        return own(feature.distance > 0 ? solid.add(placedBlock) : solid.subtract(placedBlock));
      }
      case "fillet":
      case "chamfer": {
        const { solid, matrix } = target(feature.target_id);
        const top = topologyOf(solid);
        const indices = new Set<number>();
        for (const ref of feature.edges) {
          const index = findEdge(top, applyMatrix(matrix, ref.a), applyMatrix(matrix, ref.b));
          if (index < 0) throw new Error(`An edge ${feature.id} rounds isn't on ${feature.target_id} any more`);
          indices.add(index);
        }
        const size = feature.type === "fillet" ? feature.radius : feature.distance;
        const segments = feature.type === "fillet" ? feature.segments : 4;
        const work = edgeWork(wasm, own, top, [...indices], feature.type, size, segments);
        let result = solid;
        if (work.cut.length) result = own(result.subtract(own(Manifold.union(work.cut))));
        if (work.fill.length) result = own(result.add(own(Manifold.union(work.fill))));
        return result;
      }
      case "hole": {
        const { solid, matrix } = target(feature.target_id);
        const point = applyMatrix(matrix, feature.face.point);
        const normal = applyNormal(matrix, feature.face.normal);
        const box = solid.boundingBox();
        const through = Math.hypot(...box.max.map((max, axis) => max - box.min[axis])) * 2 + 10;
        const cutter = holeCutter(wasm, own, feature, through, hairOf(solid));
        const x = perpendicular(normal);
        return own(solid.subtract(own(cutter.transform(frameMatrix(x, cross(normal, x), normal, point) as Mat4))));
      }
      case "shell": {
        const { solid, matrix } = target(feature.target_id);
        if (solid.numTri() > LIMITS.shellTriangles)
          throw new Error(
            `${feature.target_id} is too detailed to shell (${solid.numTri()} triangles, up to ${LIMITS.shellTriangles}): shell its parts before combining them`,
          );
        const top = topologyOf(solid);
        const hair = hairOf(solid);
        const open = new Set<number>();
        for (const ref of feature.open_faces) {
          const index = findFace(top, applyMatrix(matrix, ref.point), applyNormal(matrix, ref.normal));
          if (index < 0) throw new Error(`A face ${feature.id} leaves open isn't on ${feature.target_id} any more`);
          open.add(index);
        }
        const walls = wallsOf(wasm, own, top, feature.thickness, open, hair);
        const shell = own(solid.intersect(walls));
        if (shell.volume() > solid.volume() * (1 - 1e-6))
          throw new Error(`Walls ${feature.thickness} mm thick would fill all of ${feature.target_id}`);
        // An open face's walls are left out, so the hollow runs out through it, unless the walls beside it close it.
        for (const index of open) {
          const face = top.faces[index];
          const origin = scale(face.normal, face.offset);
          const u = perpendicular(face.normal);
          const v = cross(face.normal, u);
          const depth = feature.thickness / 100;
          const outline = sectionOf(wasm, own, faceTriangles2d(top, index, origin, u, v));
          const skin = own(own(outline.extrude(depth)).translate([0, 0, -depth]));
          if (own(own(skin.transform(frameMatrix(u, v, face.normal, origin) as Mat4)).subtract(walls)).isEmpty())
            throw new Error(`The walls are too thick to leave a face of ${feature.target_id} open: they close it`);
        }
        return shell;
      }
      case "split": {
        const { solid, matrix } = target(feature.source_id);
        if (feature.plane) {
          const point = applyMatrix(matrix, feature.plane.point);
          const normal = applyNormal(matrix, feature.plane.normal);
          const side = feature.keep === "back" ? -1 : 1;
          return own(solid.trimByPlane(scale(normal, side), side * dot(normal, point)));
        }
        if (!feature.tool_id) throw new Error(`${feature.id} has nothing to split by`);
        const tool = inWorld(feature.tool_id);
        return own(feature.keep === "inside" ? solid.intersect(tool) : solid.subtract(tool));
      }
    }
  };

  // Each body is made once, or tried once when it can't be: both halves of a split, say, are made from one.
  const local = (feature: BodyFeature): Manifold => {
    const known = locals.get(feature.id);
    if (known instanceof Error) throw known;
    if (known) return known;
    try {
      const solid = make(feature);
      locals.set(feature.id, solid);
      return solid;
    } catch (error) {
      locals.set(feature.id, error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  };

  // The body where it is: what a boolean or a change to it is made of.
  const inWorld = (id: string): Manifold => {
    const known = placed.get(id);
    if (known) return known;
    const feature = featureById(doc, id);
    if (!feature || !isBody(feature)) throw new Error(`${id} is missing`);
    const solid = own(local(feature).transform(transformMatrix(feature.transform) as Mat4));
    placed.set(id, solid);
    return solid;
  };

  return {
    local,
    inWorld,
    meshData,
    dispose: () => {
      for (const each of made) each.delete();
    },
  };
}

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
  const made = evaluator(wasm, doc, meshes);
  const wanted = ids ? new Set(ids) : null;
  const bodies: EvaluatedBody[] = [];
  const errors: Evaluation["errors"] = [];
  try {
    for (const feature of topLevel(doc)) {
      if (!isBody(feature) || (wanted && !wanted.has(feature.id))) continue;
      try {
        // An open mesh isn't a solid manifold can make, but it shows, moves and exports as it is.
        if (feature.type === "mesh" && !feature.solid) {
          bodies.push(
            openMesh(feature.id, made.meshData(feature.id, feature.asset_id), transformMatrix(feature.transform)),
          );
          continue;
        }
        const solid = made.local(feature);
        const status = solid.status();
        if (status !== "NoError") throw new Error(`manifold reported ${status}`);
        if (solid.isEmpty()) {
          errors.push({
            id: feature.id,
            message: `${feature.id} came out empty: nothing is left of what it was made from`,
          });
          continue;
        }
        const matrix = transformMatrix(feature.transform);
        const world = made.inWorld(feature.id);
        const box = world.boundingBox();
        const mesh = meshOf(solid);
        bodies.push({
          id: feature.id,
          mesh,
          matrix,
          bounds: { min: [...box.min] as Vec3, max: [...box.max] as Vec3 },
          volume: world.volume(),
          triangles: mesh.indices.length / 3,
        });
      } catch (error) {
        errors.push({ id: feature.id, message: error instanceof Error ? error.message : String(error) });
      }
    }
  } finally {
    made.dispose();
  }
  return { bodies, errors };
}

const round3 = (n: number) => Math.round(n * 1000) / 1000 + 0;
const round3v = (v: Vec3): Vec3 => [round3(v[0]), round3(v[1]), round3(v[2])];

export type BodyDescription = {
  id: string;
  bounds: { min: Vec3; max: Vec3 };
  /** Flat faces, largest first: a point on each and the way it faces, as the face references of other commands. */
  faces: { point: Vec3; normal: Vec3; area: number }[];
  /** Straight sharp edges, longest first: their ends, as the edge references of fillet and chamfer. */
  edges: { a: Vec3; b: Vec3; length: number; convex: boolean; angle: number }[];
};

/** What a body (top-level or part of another) is made of, in the world, for picking a face or edge to work on. */
export function describeBody(
  wasm: ManifoldToplevel,
  doc: StudioDocument,
  id: string,
  meshes?: MeshLookup,
): BodyDescription {
  const made = evaluator(wasm, doc, meshes);
  try {
    const solid = made.inWorld(id);
    const top = analyze(meshOf(solid));
    const box = solid.boundingBox();
    const faces = top.faces
      .map((face) => {
        // A point surely on the face: the middle of its largest triangle.
        let largest = face.triangles[0];
        let area = -1;
        for (const t of face.triangles) {
          const [a, b, c] = [0, 1, 2].map((k): Vec3 => {
            const i = top.mesh.indices[t * 3 + k] * 3;
            return [top.mesh.positions[i], top.mesh.positions[i + 1], top.mesh.positions[i + 2]];
          });
          const size = Math.hypot(...cross(sub(b, a), sub(c, a)));
          if (size > area) [area, largest] = [size, t];
        }
        const corners = [0, 1, 2].map((k): Vec3 => {
          const i = top.mesh.indices[largest * 3 + k] * 3;
          return [top.mesh.positions[i], top.mesh.positions[i + 1], top.mesh.positions[i + 2]];
        });
        const point = scale(
          corners.reduce((sum, c) => [sum[0] + c[0], sum[1] + c[1], sum[2] + c[2]] as Vec3, [0, 0, 0]),
          1 / 3,
        );
        return { point: round3v(point), normal: round3v(face.normal), area: round3(face.area) };
      })
      .toSorted((a, b) => b.area - a.area)
      .slice(0, 150);
    const edges = top.edges
      .map((edge) => ({
        a: round3v(edge.a),
        b: round3v(edge.b),
        length: round3(Math.hypot(...sub(edge.b, edge.a))),
        convex: edge.convex,
        angle: round3(edge.bend),
      }))
      .toSorted((a, b) => b.length - a.length)
      .slice(0, 200);
    return { id, bounds: { min: round3v([...box.min] as Vec3), max: round3v([...box.max] as Vec3) }, faces, edges };
  } finally {
    made.dispose();
  }
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
      return { mesh: meshOf(solid), solid: true, size };
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
    else if (feature.type === "revolve") total += feature.segments * 64;
    else if (feature.type === "fillet") total += feature.edges.length * feature.segments * 4;
    else if (feature.type === "sketch")
      total += feature.shapes.reduce(
        (sum, shape) => sum + 4 * (shape.type === "polygon" ? shape.points.length : shape.type === "circle" ? 64 : 4),
        0,
      );
  }
  return total;
}
