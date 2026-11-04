import type { CrossSection, Manifold, ManifoldToplevel, Mat4 } from "manifold-3d";
import type { EdgeTreatment } from "./document";
import { insetOutline, signedArea, stillValid, treatCorners } from "./shapes2d";
import { creases, faceTriangles2d, onFace, type Topology } from "./topology";
import {
  add,
  cross,
  distance,
  dot,
  frameMatrix,
  normalize,
  perpendicular,
  scale,
  sub,
  type Vec2,
  type Vec3,
} from "./vec";

// The solids Studio's features are made of, beyond manifold's own: lofted extrudes (a taper, rounded or bevelled ends),
// rounded cylinder rims, drilled holes, the cutters that round and bevel a body's edges, and a shell's walls.

/** Keeps a manifold object to be freed with the rest. */
export type Own = <T extends { delete(): void }>(value: T) => T;

/** A layer of a loft: how high, and how far the outline is moved in there. */
export type Ring = { z: number; inset: number };

const QUARTER_STEPS = 8;

/**
 * The layers of an extrude `length` long: the taper (degrees the sides lean in towards the far end) and the ends'
 * rounding or bevel. Throws when the ends' treatments don't fit in the length.
 */
export function extrudeRings(
  length: number,
  taper: number,
  top: EdgeTreatment | null | undefined,
  bottom: EdgeTreatment | null | undefined,
): Ring[] {
  const lean = Math.tan((taper * Math.PI) / 180);
  const atBottom = bottom?.size ?? 0;
  const atTop = top?.size ?? 0;
  if (atBottom + atTop > length + 1e-9)
    throw new Error("The ends' fillets or chamfers are bigger than the extrude is long");
  const rings: Ring[] = [];
  const end = (treatment: EdgeTreatment | null | undefined, flip: boolean) => {
    if (!treatment || treatment.size <= 0) return;
    const r = treatment.size;
    const steps = treatment.type === "fillet" ? QUARTER_STEPS : 1;
    for (let s = 0; s <= steps; s++) {
      const beta = (s / steps) * (Math.PI / 2);
      const [z, inset] =
        treatment.type === "fillet"
          ? [r - r * Math.cos(beta), r - r * Math.sin(beta)]
          : [r * (s / steps), r * (1 - s / steps)];
      rings.push({ z: flip ? length - z : z, inset });
    }
  };
  end(bottom, false);
  end(top, true);
  rings.push({ z: 0, inset: atBottom > 0 ? Number.NaN : 0 }, { z: length, inset: atTop > 0 ? Number.NaN : 0 });
  // One layer per height: the treatment's, where an end has one.
  const byZ = new Map<string, Ring>();
  for (const ring of rings) {
    const key = ring.z.toFixed(9);
    const known = byZ.get(key);
    if (!known || Number.isNaN(known.inset)) byZ.set(key, ring);
  }
  return [...byZ.values()]
    .filter((ring) => !Number.isNaN(ring.inset))
    .toSorted((a, b) => a.z - b.z)
    .map((ring) => ({ z: ring.z, inset: ring.inset + ring.z * lean }));
}

/**
 * A solid lofted through `rings` from outlines on the XY plane (counter-clockwise outer outlines, clockwise holes),
 * going up Z. Throws when a layer's inset folds an outline into itself.
 */
export function loft(wasm: ManifoldToplevel, own: Own, outlines: Vec2[][], rings: Ring[]): Manifold {
  const layers = rings.map((ring) =>
    outlines.map((outline) => {
      const moved = ring.inset === 0 ? outline : insetOutline(outline, ring.inset);
      if (!moved) throw new Error("The shape has a corner too sharp to taper or round");
      return moved;
    }),
  );
  for (const layer of layers)
    if (!stillValid(outlines, layer))
      throw new Error("The taper or the rounding is too big for this shape: its outline would fold into itself");
  const count = outlines.reduce((sum, outline) => sum + outline.length, 0);
  const positions = new Float32Array(rings.length * count * 3);
  rings.forEach((ring, k) => {
    let at = k * count;
    for (const outline of layers[k]) {
      for (const [x, y] of outline) {
        positions.set([x, y, ring.z], at * 3);
        at++;
      }
    }
  });
  const triangles: number[] = [];
  const starts: number[] = [];
  outlines.reduce((start, outline) => {
    starts.push(start);
    return start + outline.length;
  }, 0);
  for (let k = 0; k + 1 < rings.length; k++) {
    outlines.forEach((outline, c) => {
      for (let i = 0; i < outline.length; i++) {
        const a0 = k * count + starts[c] + i;
        const b0 = k * count + starts[c] + ((i + 1) % outline.length);
        const a1 = a0 + count;
        const b1 = b0 + count;
        triangles.push(a0, b0, b1, a0, b1, a1);
      }
    });
  }
  const cap = (k: number, up: boolean) => {
    for (const [i, j, l] of wasm.triangulate(layers[k])) {
      const [a, b, c] = [i, j, l].map((index) => k * count + index);
      if (up) triangles.push(a, b, c);
      else triangles.push(a, c, b);
    }
  };
  cap(0, false);
  cap(rings.length - 1, true);
  try {
    return own(
      new wasm.Manifold(
        new wasm.Mesh({ numProp: 3, vertProperties: positions, triVerts: Uint32Array.from(triangles) }),
      ),
    );
  } catch {
    throw new Error("The taper or the rounding is too big for this shape");
  }
}

/** A profile in (radius, height) turned about the Z axis, counter-clockwise either way it's given. */
export function revolveProfile(own: Own, wasm: ManifoldToplevel, profile: Vec2[], segments: number, degrees = 360) {
  const outline = signedArea(profile) < 0 ? profile.toReversed() : profile;
  return own(own(new wasm.CrossSection([outline], "Positive")).revolve(segments, degrees));
}

/** A cylinder or a cone along Z from its base, its rims rounded or bevelled as asked. */
export function roundedCylinder(
  wasm: ManifoldToplevel,
  own: Own,
  bottomRadius: number,
  topRadius: number,
  height: number,
  segments: number,
  top: EdgeTreatment | null | undefined,
  bottom: EdgeTreatment | null | undefined,
): Manifold {
  if (!top && !bottom) return own(wasm.Manifold.cylinder(height, bottomRadius, topRadius, segments));
  if (top && topRadius <= 0) throw new Error("A cone that comes to a point has no top edge to round");
  const profile: Vec2[] = [
    [0, 0],
    [bottomRadius, 0],
    [topRadius, height],
    [0, height],
  ];
  const treated = treatCorners(profile, (i) => (i === 1 ? (bottom ?? null) : i === 2 ? (top ?? null) : null));
  return revolveProfile(own, wasm, treated, segments);
}

export type HoleSpec = {
  diameter: number;
  depth: number | null;
  counterbore?: { diameter: number; depth: number } | null;
  countersink?: { diameter: number; angle: number } | null;
  segments: number;
};

/** A hole's cutter along -Z from z=0 (the face), poking a hair above it. `through` is how deep "right through" is. */
export function holeCutter(wasm: ManifoldToplevel, own: Own, hole: HoleSpec, through: number, hair: number): Manifold {
  const r = hole.diameter / 2;
  const depth = hole.depth ?? through;
  const profile: Vec2[] = [
    [0, hair],
    [0, -depth],
    [r, -depth],
  ];
  if (hole.counterbore) {
    const { diameter, depth: bore } = hole.counterbore;
    if (diameter / 2 <= r) throw new Error("A counterbore has to be wider than the hole");
    if (bore >= depth) throw new Error("A counterbore has to be shallower than the hole");
    profile.push([r, -bore], [diameter / 2, -bore], [diameter / 2, hair]);
  } else if (hole.countersink) {
    const { diameter, angle } = hole.countersink;
    if (diameter / 2 <= r) throw new Error("A countersink has to be wider than the hole");
    const sink = (diameter / 2 - r) / Math.tan((angle * Math.PI) / 360);
    if (sink >= depth) throw new Error("A countersink has to be shallower than the hole");
    profile.push([r, -sink], [diameter / 2, 0], [diameter / 2, hair]);
  } else {
    profile.push([r, hair]);
  }
  return revolveProfile(own, wasm, profile, hole.segments);
}

/** What rounding or bevelling edges takes off a body, and what it adds into its inside corners. */
export type EdgeWork = { cut: Manifold[]; fill: Manifold[] };

/**
 * The cutters that round (fillet) or bevel (chamfer) the given straight edges of a body, in the world, by `size`: the
 * radius of a fillet, or how far a chamfer cuts back along both faces. An outside edge is cut; an inside one is filled.
 * Where three rounded edges meet square at a corner, the corner is a ball's; two meet in a mitre. Throws, saying
 * which, for what can't be done properly: too big for its faces, or a corner it can't blend.
 */
export function edgeWork(
  wasm: ManifoldToplevel,
  own: Own,
  top: Topology,
  edgeIndices: number[],
  kind: "fillet" | "chamfer",
  size: number,
  segments: number,
): EdgeWork {
  const hair = Math.max(top.tolerance * 50, 1e-4);
  const work: EdgeWork = { cut: [], fill: [] };
  const ends: { point: Vec3; edge: number; away: Vec3 }[] = [];
  const reachOf = (index: number) => {
    const [d1, d2] = top.edges[index].into;
    const wedge = Math.acos(Math.max(-1, Math.min(1, dot(d1, d2))));
    return kind === "fillet" ? size / Math.tan(wedge / 2) : size;
  };

  // Two edges along the same face, side by side: their roundings mustn't run into each other across it.
  for (let i = 0; i < edgeIndices.length; i++) {
    for (let j = i + 1; j < edgeIndices.length; j++) {
      const [first, second] = [top.edges[edgeIndices[i]], top.edges[edgeIndices[j]]];
      if (!first.faces.some((face) => second.faces.includes(face))) continue;
      const along = normalize(sub(first.b, first.a));
      if (Math.abs(dot(along, normalize(sub(second.b, second.a)))) < 0.9995) continue;
      const across = sub(second.a, first.a);
      const apart = Math.hypot(...sub(across, scale(along, dot(across, along))));
      if (reachOf(edgeIndices[i]) + reachOf(edgeIndices[j]) > apart + top.tolerance * 10)
        throw new Error(
          `The ${kind === "fillet" ? "radius" : "chamfer"} is too big: two of the edges are ${apart.toFixed(2)} mm apart on one face, and their roundings would overlap`,
        );
    }
  }

  for (const index of edgeIndices) {
    const edge = top.edges[index];
    const along = normalize(sub(edge.b, edge.a));
    const [d1, d2] = edge.into;
    const [n1, n2] = edge.faces.map((f) => top.faces[f].normal);
    const wedge = Math.acos(Math.max(-1, Math.min(1, dot(d1, d2))));
    const reach = reachOf(index);
    // The faces have to be at least that wide all along the edge.
    const span = distance(edge.a, edge.b);
    for (const t of [0.02, 0.5, 0.98]) {
      const at = add(edge.a, scale(along, span * t));
      if (
        !onFace(top, edge.faces[0], add(at, scale(d1, reach))) ||
        !onFace(top, edge.faces[1], add(at, scale(d2, reach)))
      )
        throw new Error(
          `The ${kind === "fillet" ? "radius" : "chamfer"} is too big for one of the edges: its faces are narrower than ${reach.toFixed(2)} mm`,
        );
    }
    // The cutter's outline, in a plane square to the edge, around the edge's point: out of the material by a hair where
    // it lies along a face, so its faces never sit exactly on the body's.
    const out = edge.convex ? 1 : -1;
    const x = d1;
    const y = cross(along, d1);
    const to2d = (p: Vec3): Vec2 => [dot(p, x), dot(p, y)];
    const t1 = scale(d1, reach);
    const t2 = scale(d2, reach);
    const points: Vec3[] = [
      add(t1, scale(n1, hair * out)),
      scale(add(n1, n2), hair * out),
      add(t2, scale(n2, hair * out)),
      t2,
    ];
    if (kind === "fillet") {
      const bisector = normalize(add(d1, d2));
      const center = scale(bisector, size / Math.sin(wedge / 2));
      const from = sub(t2, center);
      const to = sub(t1, center);
      const sweep = Math.acos(Math.max(-1, Math.min(1, dot(normalize(from), normalize(to)))));
      const axis = normalize(cross(from, to));
      const steps = Math.max(2, Math.ceil((segments * sweep) / (Math.PI * 2)));
      for (let s = 1; s < steps; s++) {
        const angle = (sweep * s) / steps;
        // Rodrigues: `from` turned `angle` about `axis`.
        const rotated = add(
          add(scale(from, Math.cos(angle)), scale(cross(axis, from), Math.sin(angle))),
          scale(axis, dot(axis, from) * (1 - Math.cos(angle))),
        );
        points.push(add(center, rotated));
      }
    }
    points.push(t1);
    let outline = points.map(to2d);
    if (signedArea(outline) < 0) outline = outline.toReversed();
    const section = own(new wasm.CrossSection([outline], "Positive"));
    const prism = own(
      own(section.extrude(span + 2 * hair)).transform(
        frameMatrix(x, y, along, sub(edge.a, scale(along, hair))) as Mat4,
      ),
    );
    (edge.convex ? work.cut : work.fill).push(prism);
    ends.push({ point: edge.a, edge: index, away: along }, { point: edge.b, edge: index, away: scale(along, -1) });
  }

  // Corners: where the edges' ends meet.
  const corners: (typeof ends)[] = [];
  for (const end of ends) {
    const corner = corners.find((group) => distance(group[0].point, end.point) < top.tolerance * 100);
    if (corner) corner.push(end);
    else corners.push([end]);
  }
  for (const corner of corners) {
    if (corner.length < 2) continue;
    const convex = corner.map((end) => top.edges[end.edge].convex);
    if (convex.some((c) => c !== convex[0]))
      throw new Error(
        "An outside edge and an inside edge chosen together meet at a corner, which can't be blended: do them in two steps",
      );
    if (corner.length > 3) throw new Error("More than three chosen edges meet at one corner, which can't be blended");
    if (corner.length === 2 || kind === "chamfer") continue;
    const [a1, a2, a3] = corner.map((end) => end.away);
    const square = Math.abs(dot(a1, a2)) < 1e-3 && Math.abs(dot(a1, a3)) < 1e-3 && Math.abs(dot(a2, a3)) < 1e-3;
    if (!square)
      throw new Error(
        "Three rounded edges meet at a corner that isn't square, which can't be blended: round them in two steps",
      );
    // The ball's corner: the cube of the radius at the corner, less the ball that rolls along all three fillets.
    const [x, y] = dot(cross(a1, a2), a3) > 0 ? [a1, a2] : [a2, a1];
    const v = corner[0].point;
    const center = add(v, scale(add(add(a1, a2), a3), size));
    const block = own(
      own(own(wasm.Manifold.cube([size + hair, size + hair, size + hair])).translate([-hair, -hair, -hair])).transform(
        frameMatrix(x, y, a3, v) as Mat4,
      ),
    );
    const ball = own(own(wasm.Manifold.sphere(size, segments)).translate(center));
    (convex[0] ? work.cut : work.fill).push(own(block.subtract(ball)));
  }
  return work;
}

/** A section made of a face's triangles, as one outline with any holes. */
export function sectionOf(wasm: ManifoldToplevel, own: Own, triangles: Vec2[][]): CrossSection {
  return own(new wasm.CrossSection(triangles, "NonZero"));
}

/**
 * Everything inside a body that's within `thickness` of its surface, its `open` faces left out: the walls a shell
 * keeps. Exact rather than a rolled ball: a slab under each flat face, which covers its outside edges too; along each
 * inside edge between kept faces, the wedge between their slabs; and a ball at each corner where the material reaches
 * past all of them. The wedges and balls are a hair over size, so their facets leave no wall thinner than asked.
 * Taking these away from the body leaves the hollow.
 */
export function wallsOf(
  wasm: ManifoldToplevel,
  own: Own,
  top: Topology,
  thickness: number,
  open: Set<number>,
  hair: number,
  segments = 24,
): Manifold {
  const { Manifold, CrossSection } = wasm;
  const pieces: Manifold[] = [];
  top.faces.forEach((face, index) => {
    if (open.has(index)) return;
    const origin = scale(face.normal, face.offset);
    const u = perpendicular(face.normal);
    const v = cross(face.normal, u);
    const section = sectionOf(wasm, own, faceTriangles2d(top, index, origin, u, v));
    const slab = own(own(section.extrude(thickness + hair)).translate([0, 0, -thickness]));
    pieces.push(own(slab.transform(frameMatrix(u, v, face.normal, origin) as Mat4)));
  });

  const step = (2 * Math.PI) / segments;
  const corners = new Set<number>();
  for (const crease of creases(top)) {
    if (!crease.inside || open.has(crease.faces[0]) || open.has(crease.faces[1])) continue;
    // Points nearer this edge than either face are between the faces' inward normals, round the edge.
    const along = sub(crease.b, crease.a);
    const z = normalize(along);
    const x = scale(top.faces[crease.faces[0]].normal, -1);
    const y = cross(z, x);
    const inward = scale(top.faces[crease.faces[1]].normal, -1);
    const turn = Math.atan2(dot(inward, y), dot(inward, x));
    const from = Math.min(0, turn) - step / 4;
    const to = Math.max(0, turn) + step / 4;
    const steps = Math.max(1, Math.ceil((to - from) / step));
    const reach = thickness / Math.cos((to - from) / steps / 2);
    const outline: Vec2[] = [[0, 0]];
    for (let i = 0; i <= steps; i++) {
      const angle = from + ((to - from) * i) / steps;
      outline.push([reach * Math.cos(angle), reach * Math.sin(angle)]);
    }
    const wedge = own(own(new CrossSection([outline], "NonZero")).extrude(Math.hypot(...along)));
    pieces.push(own(wedge.transform(frameMatrix(x, y, z, crease.a) as Mat4)));
    for (const end of crease.ends) corners.add(end);
  }

  const balls = [...corners].filter((corner) => reachesPast(top, corner));
  if (balls.length) {
    const unit = own(Manifold.sphere(1, segments)).getMesh();
    let inradius = 1;
    for (let t = 0; t < unit.triVerts.length; t += 3) {
      const [a, b, c] = [0, 1, 2].map((k): Vec3 => {
        const i = unit.triVerts[t + k] * unit.numProp;
        return [unit.vertProperties[i], unit.vertProperties[i + 1], unit.vertProperties[i + 2]];
      });
      inradius = Math.min(inradius, Math.abs(dot(normalize(cross(sub(b, a), sub(c, a))), a)));
    }
    const ball = own(Manifold.sphere(thickness / inradius, segments));
    for (const corner of balls) pieces.push(own(ball.translate(vertexAt(top, corner))));
  }
  return own(Manifold.union(pieces));
}

const vertexAt = (top: Topology, i: number): Vec3 => [
  top.mesh.positions[i * 3],
  top.mesh.positions[i * 3 + 1],
  top.mesh.positions[i * 3 + 2],
];

/**
 * Whether some way from this corner into the material leads away from every edge at it, as from a pocket's inner corner,
 * so the points that way are nearest the corner itself. A hole's rim or an L's foot has none: what's near them is
 * nearer a face or an edge. Unsure counts as yes, which only costs a ball.
 */
function reachesPast(top: Topology, corner: number): boolean {
  const { mesh } = top;
  const at = vertexAt(top, corner);
  const edges: Vec3[] = [];
  const normals: Vec3[] = [];
  for (let t = 0; t < mesh.indices.length / 3; t++) {
    const k = [0, 1, 2].find((j) => mesh.indices[t * 3 + j] === corner);
    if (k === undefined) continue;
    const next = vertexAt(top, mesh.indices[t * 3 + ((k + 1) % 3)]);
    const previous = vertexAt(top, mesh.indices[t * 3 + ((k + 2) % 3)]);
    edges.push(normalize(sub(next, at)), normalize(sub(previous, at)));
    normals.push(normalize(cross(sub(next, at), sub(previous, at))));
  }
  // The ways that lead away from every edge make a cone; its sides are square to two of the edges.
  let sum: Vec3 = [0, 0, 0];
  let found = 0;
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const side = cross(edges[i], edges[j]);
      if (Math.hypot(...side) < 1e-6) continue;
      for (const way of [normalize(side), scale(normalize(side), -1)]) {
        if (edges.every((edge) => dot(way, edge) <= 1e-7)) {
          sum = add(sum, way);
          found++;
        }
      }
    }
  }
  if (!found) return false;
  if (Math.hypot(...sum) < 1e-6) return true;
  const way = normalize(sum);
  return normals.reduce((total, normal) => total + dot(way, normal), 0) < 0;
}
