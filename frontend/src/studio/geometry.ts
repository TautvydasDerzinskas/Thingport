import type { CrossSection, Manifold, ManifoldToplevel, Mat4 } from "manifold-3d";
import {
  DEFAULT_SEGMENTS,
  featureById,
  inputsOf,
  isBody,
  LIMITS,
  shapeContours,
  shapeFill,
  sketchFrame,
  sketchMatrix,
  topLevel,
  transformMatrix,
  type BodyFeature,
  type Feature,
  type MeshData,
  type PartFeature,
  type PatternFeature,
  type PartMeasure,
  type SketchFeature,
  type StudioDocument,
} from "./document";
import { boundsOfPositions, closedParts, matchParts, openParts, partOrder, type Bounds } from "./parts";
import { edgeWork, extrudeRings, holeCutter, loft, roundedCylinder, sectionOf, wallsOf, type Own } from "./solids";
import { checkPrint, type PrintCheck, type PrintCheckOptions } from "./printCheck";
import { loftSolid, sweepSolid } from "./sweep";
import { threadSolid, threadTriangles } from "./threads";
import { analyze, faceTriangles2d, findEdge, findFace, type Topology } from "./topology";
import {
  add,
  applyMatrix,
  applyNormal,
  cross,
  dot,
  frameMatrix,
  normalize,
  perpendicular,
  rotationAbout,
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

/** A mesh's corners put through a matrix. */
function movedMesh(mesh: MeshData, matrix: number[]): MeshData {
  const positions = new Float32Array(mesh.positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const [x, y, z] = applyMatrix(matrix, [mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]]);
    positions[i] = x;
    positions[i + 1] = y;
    positions[i + 2] = z;
  }
  return { positions, indices: mesh.indices };
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
      own(new CrossSection(shapeContours(shape, DEFAULT_SEGMENTS), shapeFill(shape)));
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

  const bodyOf = (id: string): BodyFeature => {
    const feature = featureById(doc, id);
    if (!feature || !isBody(feature)) throw new Error(`${id} is missing`);
    return feature;
  };

  // A body that another feature changes, where it is, and the matrix that places references made in its own frame.
  const target = (id: string) => ({ solid: inWorld(id), matrix: transformMatrix(bodyOf(id).transform) });

  // A body's loose parts in its own frame, found once for all the parts separated from it: a closed body's as solids,
  // a mesh with gaps as its triangles.
  type Piece = { bounds: Bounds; solid: Manifold | null; mesh: MeshData | null };
  const pieceSets = new Map<string, Piece[]>();
  const piecesOf = (source: BodyFeature): Piece[] => {
    const known = pieceSets.get(source.id);
    if (known) return known;
    const open = openOf(source);
    const pieces: Piece[] = open
      ? openParts(open).map((mesh) => ({ bounds: boundsOfPositions(mesh.positions), solid: null, mesh }))
      : closedParts(wasm, own, local(source)).map((solid) => {
          const box = solid.boundingBox();
          return { bounds: { min: [...box.min] as Vec3, max: [...box.max] as Vec3 }, solid, mesh: null };
        });
    pieces.sort((a, b) => partOrder(a.bounds, b.bounds));
    pieceSets.set(source.id, pieces);
    return pieces;
  };

  // Which of its source's parts a part is, matched with its siblings so each is taken once, and the matrix from the
  // source's own frame to the part's: where the source puts it, less where the part's origin was.
  const assigned = new Map<string, number>();
  const pieceOf = (part: PartFeature) => {
    const source = bodyOf(part.source_id);
    const pieces = piecesOf(source);
    if (!assigned.has(part.id)) {
      const siblings = doc.features.filter(
        (feature): feature is PartFeature => feature.type === "part" && feature.source_id === part.source_id,
      );
      const found = matchParts(
        siblings.map((sibling) => sibling.bounds),
        pieces.map((piece) => piece.bounds),
      );
      siblings.forEach((sibling, index) => assigned.set(sibling.id, found[index]));
    }
    const index = assigned.get(part.id)!;
    if (index < 0) throw new Error(`The part ${part.id} was isn't in ${part.source_id} any more`);
    const matrix = transformMatrix(source.transform);
    for (let axis = 0; axis < 3; axis++) matrix[12 + axis] -= part.origin[axis];
    return { piece: pieces[index], matrix };
  };

  // The triangles of a body that isn't closed, in its own frame; null for one that is.
  const openOf = (feature: BodyFeature): MeshData | null => {
    if (feature.type === "mesh") return feature.solid ? null : meshData(feature.id, feature.asset_id);
    if (feature.type !== "part" || feature.solid) return null;
    const { piece, matrix } = pieceOf(feature);
    return piece.mesh ? movedMesh(piece.mesh, matrix) : null;
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
        const hair = hairOf(solid);
        let cutter: Manifold;
        if (feature.thread) {
          // As deep as asked, or as far as the body goes along the hole: a thread's triangles grow with its length.
          const across = Math.max(
            ...[0, 1, 2, 3, 4, 5, 6, 7].map((corner) =>
              dot(
                sub(point, [0, 1, 2].map((axis) => ((corner >> axis) & 1 ? box.max : box.min)[axis]) as Vec3),
                normal,
              ),
            ),
          );
          const deep = feature.depth ?? across + 1;
          const thread = threadSolid(wasm, own, {
            diameter: feature.diameter,
            pitch: feature.thread.pitch,
            length: deep,
            internal: true,
            clearance: feature.thread.clearance,
            hand: "right",
            chamfer: true,
            segments: feature.segments,
          });
          // Into the body from its surface, its mouth a hair above it.
          cutter = own(own(thread.mirror([0, 0, 1])).translate([0, 0, hair]));
        } else {
          const through = Math.hypot(...box.max.map((max, axis) => max - box.min[axis])) * 2 + 10;
          cutter = holeCutter(wasm, own, feature, through, hair);
        }
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
      case "thread":
        return threadSolid(wasm, own, feature);
      case "pattern": {
        const source = inWorld(feature.source_id);
        if (feature.kind === "mirror") {
          const point = feature.plane_point;
          const image = own(
            own(own(source.translate(scale(point, -1))).mirror(normalize(feature.plane_normal))).translate(point),
          );
          return feature.keep_original ? own(Manifold.union([source, image])) : image;
        }
        const copies: Manifold[] = [];
        if (feature.kind === "linear") {
          const along = scale(normalize(feature.direction), feature.spacing);
          const across = feature.grid_direction ? scale(normalize(feature.grid_direction), feature.grid_spacing) : null;
          for (let i = 0; i < feature.count; i++)
            for (let j = 0; j < (across ? feature.grid_count : 1); j++)
              copies.push(own(source.translate(add(scale(along, i), across ? scale(across, j) : [0, 0, 0]))));
        } else {
          // All the way round, the copies share the circle; part way, the first and last are at its ends.
          const step = feature.angle >= 360 ? 360 / feature.count : feature.angle / (feature.count - 1);
          for (let i = 0; i < feature.count; i++)
            copies.push(
              own(source.transform(rotationAbout(feature.axis_point, feature.axis_direction, step * i) as Mat4)),
            );
        }
        return own(Manifold.union(copies));
      }
      case "hull":
        return own(Manifold.hull(feature.body_ids.map(inWorld)));
      case "loft": {
        const loops = feature.sketch_ids.map((id) => {
          const sketch = sketchOf(id);
          const outlines = section(sketch).toPolygons() as Vec2[][];
          if (outlines.length !== 1)
            throw new Error(`${id} has to be one outline with no holes to loft through; it has ${outlines.length}`);
          const matrix = sketchMatrix(sketch);
          return outlines[0].map(([u, v]) => applyMatrix(matrix, [u, v, 0]));
        });
        return loftSolid(wasm, own, loops);
      }
      case "sweep": {
        // The profile stays where it's drawn, as CAD sweeps a sketch.
        const sketch = sketchOf(feature.sketch_id);
        const { origin, u, v } = sketchFrame(sketch);
        const outlines = section(sketch).toPolygons() as Vec2[][];
        return sweepSolid(wasm, own, outlines, feature.path, {
          closed: feature.closed,
          smooth: feature.smooth,
          drawn: { origin, u, v },
        });
      }
      case "part": {
        const { piece, matrix } = pieceOf(feature);
        if (piece.solid) return own(piece.solid.transform(matrix as Mat4));
        if (!feature.solid) throw new Error(`${feature.id} isn't a closed solid`);
        // A part of a mesh with gaps that's closed itself.
        const mesh = movedMesh(piece.mesh!, matrix);
        return own(new Manifold(new wasm.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.indices })));
      }
    }
  };

  // What separate_parts makes of a body: its parts, where they are in its own frame and in the world.
  const measure = (id: string): PartMeasure[] => {
    const source = bodyOf(id);
    const matrix = transformMatrix(source.transform);
    return piecesOf(source).map((piece) => {
      let solid = Boolean(piece.solid);
      let world: Bounds;
      if (piece.solid) {
        const box = own(piece.solid.transform(matrix as Mat4)).boundingBox();
        world = { min: [...box.min] as Vec3, max: [...box.max] as Vec3 };
      } else {
        const moved = movedMesh(piece.mesh!, matrix);
        world = boundsOfPositions(moved.positions);
        try {
          const closed = own(
            new Manifold(new wasm.Mesh({ numProp: 3, vertProperties: moved.positions, triVerts: moved.indices })),
          );
          solid = closed.status() === "NoError" && !closed.isEmpty();
        } catch {
          // Not manifold: this part has the gaps.
        }
      }
      return {
        bounds: { min: round3v(piece.bounds.min), max: round3v(piece.bounds.max) },
        origin: round3v([(world.min[0] + world.max[0]) / 2, (world.min[1] + world.max[1]) / 2, world.min[2]]),
        solid,
      };
    });
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
    openOf,
    measure,
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
        const open = made.openOf(feature);
        if (open) {
          bodies.push(openMesh(feature.id, open, transformMatrix(feature.transform)));
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

/**
 * A body's loose parts, as separate_parts would make them: largest first, each with where it is in the body's own frame
 * (by which it's found again), the world point at its base's middle, and whether it's closed. Throws when the body
 * can't be made.
 */
export function measureParts(
  wasm: ManifoldToplevel,
  doc: StudioDocument,
  id: string,
  meshes?: MeshLookup,
): PartMeasure[] {
  const made = evaluator(wasm, doc, meshes);
  try {
    return made.measure(id);
  } finally {
    made.dispose();
  }
}

/** Bodies' extents in the world (any bodies, top-level or part of another), as align and lay_flat measure them. Throws
 *  when one can't be made. */
export function measureBounds(
  wasm: ManifoldToplevel,
  doc: StudioDocument,
  ids: readonly string[],
  meshes?: MeshLookup,
): Record<string, { min: Vec3; max: Vec3 }> {
  const made = evaluator(wasm, doc, meshes);
  try {
    const out: Record<string, { min: Vec3; max: Vec3 }> = {};
    for (const id of ids) {
      const feature = featureById(doc, id);
      if (!feature || !isBody(feature)) throw new Error(`${id} is missing`);
      const open = made.openOf(feature);
      if (open) {
        out[id] = openMesh(id, open, transformMatrix(feature.transform)).bounds;
        continue;
      }
      const box = made.inWorld(id).boundingBox();
      if (box.min.some((value) => !Number.isFinite(value))) throw new Error(`${id} came out empty`);
      out[id] = { min: [...box.min] as Vec3, max: [...box.max] as Vec3 };
    }
    return out;
  } finally {
    made.dispose();
  }
}

/** Checks the design's visible top-level bodies for printing, where they are. A body that isn't a closed solid can't
 *  be checked, and is said so; one that can't be made is left out, as the view says why. */
export function checkDesign(
  wasm: ManifoldToplevel,
  doc: StudioDocument,
  options: PrintCheckOptions,
  meshes?: MeshLookup,
): PrintCheck & { open: string[] } {
  const made = evaluator(wasm, doc, meshes);
  const plainDoc = plainThreads(doc);
  const plain = plainDoc ? evaluator(wasm, plainDoc, meshes) : null;
  const checked: { delete(): void }[] = [];
  const own: Own = (value) => {
    checked.push(value);
    return value;
  };
  try {
    const bodies: { id: string; solid: Manifold; plain?: Manifold }[] = [];
    const open: string[] = [];
    for (const feature of topLevel(doc)) {
      if (!isBody(feature) || !feature.visible) continue;
      try {
        if (made.openOf(feature)) open.push(feature.id);
        else
          bodies.push({
            id: feature.id,
            solid: made.inWorld(feature.id),
            plain: plain && threaded(doc, feature.id) ? plain.inWorld(feature.id) : undefined,
          });
      } catch {
        // Not made: its own error says why.
      }
    }
    const report = checkPrint(wasm, own, bodies, options);
    return {
      ...report,
      open,
      problems: [
        ...report.problems,
        ...open.map((id) => `${id} has gaps, so it isn't a closed solid and can't be checked or printed as it is.`),
      ],
    };
  } finally {
    for (const each of checked) each.delete();
    made.dispose();
    plain?.dispose();
  }
}

/** Whether a body has a thread in it: a thread, a tapped hole, or a body built from one. */
function threaded(doc: StudioDocument, id: string): boolean {
  const feature = featureById(doc, id);
  if (!feature) return false;
  if (feature.type === "thread" || (feature.type === "hole" && feature.thread)) return true;
  return inputsOf(feature).some((input) => threaded(doc, input));
}

/** The design with its threads as CAD analyses them, null where it has none: a thread as the plain cylinder it's cut
 *  on (a rod's outside, a cutter's bore, by its clearance), a tapped hole as a plain one of its size. Its ridges are
 *  printed, but they're no overhang or thin wall to fix. */
function plainThreads(doc: StudioDocument): StudioDocument | null {
  if (!doc.features.some((feature) => feature.type === "thread" || (feature.type === "hole" && feature.thread)))
    return null;
  return {
    ...doc,
    features: doc.features.map((feature): Feature => {
      if (feature.type === "hole" && feature.thread) return { ...feature, thread: null };
      if (feature.type !== "thread") return feature;
      const {
        diameter,
        length,
        internal,
        clearance,
        segments,
        pitch: _pitch,
        hand: _hand,
        chamfer: _chamfer,
        ...body
      } = feature;
      return {
        ...body,
        type: "cylinder",
        radius: diameter / 2 + (internal ? clearance : -clearance),
        height: length,
        segments,
      };
    }),
  };
}

/** How two bodies stand to each other: the gap between them (0 where they touch or overlap, up to 1 m), how much they
 *  overlap, and each one's extent in the world. */
export function measureBetween(
  wasm: ManifoldToplevel,
  doc: StudioDocument,
  a: string,
  b: string,
  meshes?: MeshLookup,
): { gap: number; overlap: number; a: { min: Vec3; max: Vec3 }; b: { min: Vec3; max: Vec3 } } {
  const made = evaluator(wasm, doc, meshes);
  try {
    const first = made.inWorld(a);
    const second = made.inWorld(b);
    const both = first.intersect(second);
    const overlap = both.volume();
    both.delete();
    const box = (solid: Manifold) => {
      const { min, max } = solid.boundingBox();
      return { min: round3v([...min] as Vec3), max: round3v([...max] as Vec3) };
    };
    return {
      gap: overlap > 1e-6 ? 0 : round3(first.minGap(second, 1000)),
      overlap: round3(overlap),
      a: box(first),
      b: box(second),
    };
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
 * on X and Y and standing on Z = 0, and as manifold cleaned it when it's a closed solid. Says how many loose parts it
 * is, too.
 */
export function prepareMesh(
  wasm: ManifoldToplevel,
  triangles: Float32Array,
): { mesh: MeshData; solid: boolean; size: Vec3; parts: number } {
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
  const open = () => ({ mesh: welded, solid: false, size, parts: openParts(welded).length });
  const made: { delete(): void }[] = [];
  const own: Own = (value) => {
    made.push(value);
    return value;
  };
  try {
    const solid = own(new wasm.Manifold(new wasm.Mesh({ numProp: 3, vertProperties: centred, triVerts: indices })));
    if (solid.status() !== "NoError" || solid.isEmpty()) return open();
    return { mesh: meshOf(solid), solid: true, size, parts: closedParts(wasm, own, solid).length };
  } catch {
    // "Not manifold": it has gaps, or edges shared by more than two triangles.
    return open();
  } finally {
    for (const each of made) each.delete();
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

/** How many copies of its body a pattern makes. */
export function patternCopies(feature: PatternFeature): number {
  if (feature.kind === "linear") return feature.count * (feature.grid_direction ? feature.grid_count : 1);
  if (feature.kind === "circular") return feature.count;
  return feature.keep_original ? 2 : 1;
}

/** Roughly how many triangles the design makes, before any of it is made: a server refuses one far too heavy. Each
 *  body counts what it's made from, as many times as a pattern copies it. */
export function estimateTriangles(doc: StudioDocument): number {
  const known = new Map<string, number>();
  const itself = (feature: Feature): number => {
    if (feature.type === "box") return 12;
    if (feature.type === "cylinder" || feature.type === "cone") return feature.segments * 4;
    if (feature.type === "sphere") return (feature.segments * feature.segments) / 2;
    if (feature.type === "torus") return feature.segments * feature.segments * 2;
    if (feature.type === "mesh") return feature.triangles;
    if (feature.type === "revolve") return feature.segments * 64;
    if (feature.type === "fillet") return feature.edges.length * feature.segments * 4;
    if (feature.type === "thread") return threadTriangles(feature);
    if (feature.type === "loft") return feature.sketch_ids.length * 256;
    if (feature.type === "sweep") return feature.path.length * (feature.smooth ? 8 : 1) * 128;
    if (feature.type === "hole" && feature.thread)
      return threadTriangles({
        diameter: feature.diameter,
        pitch: feature.thread.pitch,
        length: feature.depth ?? 30,
        internal: true,
        clearance: feature.thread.clearance,
        hand: "right",
        chamfer: true,
        segments: feature.segments,
      });
    if (feature.type !== "sketch") return 0;
    return feature.shapes.reduce(
      (sum, shape) =>
        sum +
        4 *
          (shape.type === "polygon"
            ? shape.points.length
            : shape.type === "circle"
              ? 64
              : // A letter takes about this many points; a traced outline packs one in four bytes.
                shape.type === "text"
                ? shape.text.length * 60
                : shape.type === "trace"
                  ? (shape.outline.length * 3) / 16
                  : // Roughly a point per few characters of path data.
                    shape.type === "path"
                    ? shape.d.length / 3
                    : 4),
      0,
    );
  };
  const of = (id: string): number => {
    const cached = known.get(id);
    if (cached !== undefined) return cached;
    const feature = featureById(doc, id);
    if (!feature) return 0;
    const inputs = inputsOf(feature).reduce((sum, input) => sum + of(input), 0);
    const total = itself(feature) + inputs * (feature.type === "pattern" ? patternCopies(feature) : 1);
    known.set(id, total);
    return total;
  };
  return topLevel(doc).reduce((sum, feature) => sum + of(feature.id), 0);
}
