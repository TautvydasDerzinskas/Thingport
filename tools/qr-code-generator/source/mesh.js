// Turning flat rings into solids.
//
// Everything the tool makes is a flat shape given a thickness: the plate, a module, the band of light around a
// dark dot, a letter of the caption. So there is one small set of tools here — a mesh being filled in, a fan over
// a ring, a strip between two rings, a wall between two heights, and ear clipping for the one shape that has
// holes in it — and the geometry file builds everything from those. No shape is ever subtracted from another,
// which is why none of this needs a modelling kernel.

/** A mesh being filled in. Vertices are shared only where a caller asks for it, which keeps the walls creased. */
export function createMesh(name, kind) {
  const vertices = [];
  const triangles = [];
  return {
    name,
    kind,
    /** A vertex, giving back its index. */
    point(x, y, z) {
      vertices.push(x, y, z);
      return vertices.length / 3 - 1;
    },
    face(a, b, c) {
      triangles.push(a, b, c);
    },
    /** Four corners as two triangles, wound the way they were given. */
    quad(a, b, c, d) {
      triangles.push(a, b, c, a, c, d);
    },
    get count() {
      return triangles.length / 3;
    },
    get empty() {
      return triangles.length === 0;
    },
    done() {
      return {
        name,
        kind,
        vertices: new Float32Array(vertices),
        triangles: new Uint32Array(triangles),
      };
    },
  };
}

/** Twice the area of a ring, signed: positive anticlockwise. */
export function signedArea(ring) {
  let total = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    total += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  }
  return total / 2;
}

export const asCounterClockwise = (ring) => (signedArea(ring) < 0 ? [...ring].reverse() : ring);
export const asClockwise = (ring) => (signedArea(ring) > 0 ? [...ring].reverse() : ring);

/** The middle of a ring, which is where a fan of triangles starts. */
export function middleOf(ring) {
  let x = 0;
  let y = 0;
  for (const point of ring) {
    x += point[0];
    y += point[1];
  }
  return [x / ring.length, y / ring.length];
}

/** A ring scaled about a point, which is how a relief steps inwards as it rises. */
export const scaleRing = (ring, scale, about) =>
  ring.map(([x, y]) => [about[0] + (x - about[0]) * scale, about[1] + (y - about[1]) * scale]);

/** A face over a ring, as a fan from its middle. `up` faces +z, otherwise -z. */
function fan(mesh, ring, z, up) {
  const middle = middleOf(ring);
  const centre = mesh.point(middle[0], middle[1], z);
  const indices = ring.map(([x, y]) => mesh.point(x, y, z));
  for (let i = 0; i < indices.length; i++) {
    const next = indices[(i + 1) % indices.length];
    if (up) mesh.face(centre, indices[i], next);
    else mesh.face(centre, next, indices[i]);
  }
}

/** The wall between two rings of the same length, at two heights. */
function wall(mesh, lower, upper, zLower, zUpper) {
  const bottom = lower.map(([x, y]) => mesh.point(x, y, zLower));
  const top = upper.map(([x, y]) => mesh.point(x, y, zUpper));
  for (let i = 0; i < bottom.length; i++) {
    const next = (i + 1) % bottom.length;
    mesh.quad(bottom[i], bottom[next], top[next], top[i]);
  }
}

/**
 * A ring given a thickness, stepping through the levels a relief asks for: a closed solid standing on `z0`.
 *
 * `levels` are `{ scale, z }` from the bottom up, each ring scaled about the middle of the shape; with `apex` the
 * last step closes to a point instead of a face, which is what a pyramid is.
 */
export function extrudeRing(mesh, ring, z0, levels, apex = false) {
  const anticlockwise = asCounterClockwise(ring);
  const middle = middleOf(anticlockwise);
  const at = (level) => (level.scale === 1 ? anticlockwise : scaleRing(anticlockwise, level.scale, middle));
  fan(mesh, at(levels[0]), z0 + levels[0].z, false);
  for (let i = 0; i + 1 < levels.length; i++) {
    wall(mesh, at(levels[i]), at(levels[i + 1]), z0 + levels[i].z, z0 + levels[i + 1].z);
  }
  const last = levels[levels.length - 1];
  if (apex) {
    const tip = mesh.point(middle[0], middle[1], z0 + apex.z);
    const edge = at(last).map(([x, y]) => mesh.point(x, y, z0 + last.z));
    for (let i = 0; i < edge.length; i++) mesh.face(edge[i], edge[(i + 1) % edge.length], tip);
  } else {
    fan(mesh, at(last), z0 + last.z, true);
  }
}

/**
 * The solid between two rings of the same length — a band, a frame, a cell with its dark shape taken out of it.
 *
 * Both rings must wind the same way and have the same number of points, which is what the radial shapes in
 * `shapes.js` guarantee: point `i` of one answers point `i` of the other.
 */
export function extrudeBand(mesh, outer, inner, z0, z1) {
  if (outer.length !== inner.length) throw new Error("A band needs two rings of the same length");
  const anticlockwise = signedArea(outer) > 0;
  const out = anticlockwise ? outer : [...outer].reverse();
  const inn = anticlockwise ? inner : [...inner].reverse();
  const topOuter = out.map(([x, y]) => mesh.point(x, y, z1));
  const topInner = inn.map(([x, y]) => mesh.point(x, y, z1));
  const bottomOuter = out.map(([x, y]) => mesh.point(x, y, z0));
  const bottomInner = inn.map(([x, y]) => mesh.point(x, y, z0));
  for (let i = 0; i < out.length; i++) {
    const next = (i + 1) % out.length;
    mesh.quad(topInner[i], topOuter[i], topOuter[next], topInner[next]); // the face on top
    mesh.quad(bottomOuter[i], bottomInner[i], bottomInner[next], bottomOuter[next]); // and underneath
    mesh.quad(bottomOuter[i], bottomOuter[next], topOuter[next], topOuter[i]); // the outside wall
    mesh.quad(bottomInner[next], bottomInner[i], topInner[i], topInner[next]); // and the inside one
  }
}

/** A box, for a run of light cells or a plain slab. */
export function extrudeBox(mesh, x0, y0, x1, y1, z0, z1) {
  extrudeRing(
    mesh,
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ],
    z0,
    [
      { scale: 1, z: 0 },
      { scale: 1, z: z1 - z0 },
    ],
  );
}

// ---- shapes with holes in them ---------------------------------------------------------------------------------

const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Whether a point is inside the triangle abc, edges included. */
function inTriangle(a, b, c, p) {
  const d1 = cross(a, b, p);
  const d2 = cross(b, c, p);
  const d3 = cross(c, a, p);
  return (d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0);
}

/** Whether two segments cross each other anywhere but at a shared end. */
function segmentsCross(p1, p2, p3, p4) {
  const same = (a, b) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
  if (same(p1, p3) || same(p1, p4) || same(p2, p3) || same(p2, p4)) return false;
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);
  return (
    (d1 > 0 !== d2 > 0 || Math.abs(d1) < 1e-12 || Math.abs(d2) < 1e-12) &&
    (d3 > 0 !== d4 > 0 || Math.abs(d3) < 1e-12 || Math.abs(d4) < 1e-12)
  );
}

const inRing = (ring, p) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
};

/**
 * One ring with its holes joined into it, each by a bridge to the nearest vertex it can see.
 *
 * Ear clipping only understands a single ring, so a letter's counter or the hole in a keyring tab is tied into
 * the outline with a pair of coincident edges first. The shapes here have tens of points, not thousands, so the
 * plainest search — every vertex, every edge — is both fast enough and hard to get wrong.
 */
function joinHoles(outer, holes) {
  let ring = asCounterClockwise(outer).map((p) => [...p]);
  const pending = holes
    .map((hole) => asClockwise(hole).map((p) => [...p]))
    .sort((a, b) => Math.max(...b.map((p) => p[0])) - Math.max(...a.map((p) => p[0])));

  for (let h = 0; h < pending.length; h++) {
    const hole = pending[h];
    const others = pending.slice(h + 1);
    const edges = [ring, ...others].flatMap((r) => r.map((p, i) => [p, r[(i + 1) % r.length]]));
    let best = null;
    for (let from = 0; from < hole.length; from++) {
      for (let to = 0; to < ring.length; to++) {
        const a = hole[from];
        const b = ring[to];
        const distance = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
        if (best && distance >= best.distance) continue;
        if (edges.some(([p, q]) => segmentsCross(a, b, p, q))) continue;
        const middle = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        if (!inRing(ring, middle)) continue;
        if ([hole, ...others].some((r) => inRing(r, middle))) continue;
        best = { from, to, distance };
      }
    }
    if (!best) return null; // nowhere to tie it in: the caller falls back to leaving the hole out
    const turned = [...hole.slice(best.from), ...hole.slice(0, best.from)];
    ring = [...ring.slice(0, best.to + 1), ...turned, turned[0], ...ring.slice(best.to)];
  }
  return ring;
}

/** A ring cut into triangles by clipping its ears. Returns index triples into the ring. */
function earClip(ring) {
  const indices = ring.map((_, i) => i);
  const triangles = [];
  let guard = indices.length * 3;
  while (indices.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < indices.length; i++) {
      const previous = indices[(i - 1 + indices.length) % indices.length];
      const current = indices[i];
      const next = indices[(i + 1) % indices.length];
      const a = ring[previous];
      const b = ring[current];
      const c = ring[next];
      if (cross(a, b, c) <= 0) continue; // a reflex corner, or three points in a line
      const blocked = indices.some((other) => {
        if (other === previous || other === current || other === next) return false;
        return inTriangle(a, b, c, ring[other]);
      });
      if (blocked) continue;
      triangles.push([previous, current, next]);
      indices.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break; // nothing left that is an ear: whatever is left is degenerate and is dropped
  }
  if (indices.length === 3) triangles.push([indices[0], indices[1], indices[2]]);
  return triangles;
}

/** A shape with holes, cut into triangles. Gives back the points it used and triples into them. */
export function triangulate(outer, holes = []) {
  const ring = holes.length ? joinHoles(outer, holes) : asCounterClockwise(outer);
  if (!ring) return { points: asCounterClockwise(outer), triangles: earClip(asCounterClockwise(outer)) };
  return { points: ring, triangles: earClip(ring) };
}

/**
 * A flat shape with holes in it, given a thickness: the plate with its keyring hole, a letter with its counter.
 */
export function extrudeShape(mesh, outer, holes, z0, z1) {
  const { points, triangles } = triangulate(outer, holes);
  const top = points.map(([x, y]) => mesh.point(x, y, z1));
  const bottom = points.map(([x, y]) => mesh.point(x, y, z0));
  for (const [a, b, c] of triangles) {
    mesh.face(top[a], top[b], top[c]);
    mesh.face(bottom[a], bottom[c], bottom[b]);
  }
  for (const ring of [asCounterClockwise(outer), ...holes.map((hole) => asClockwise(hole))]) {
    const low = ring.map(([x, y]) => mesh.point(x, y, z0));
    const high = ring.map(([x, y]) => mesh.point(x, y, z1));
    for (let i = 0; i < ring.length; i++) {
      const next = (i + 1) % ring.length;
      mesh.quad(low[i], low[next], high[next], high[i]);
    }
  }
}
