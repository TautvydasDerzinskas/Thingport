// Flat geometry the engine leans on: measuring polygons, sliding letters until they touch, finding where the
// pieces of a broken-up outline are nearest each other, and placing a ring hole somewhere it will hold.

/** Twice the area, halved: positive anticlockwise, so a negative one is a hole. */
export const signedArea = (polygon) =>
  polygon.reduce((total, a, i) => {
    const b = polygon[(i + 1) % polygon.length];
    return total + a[0] * b[1] - b[0] * a[1];
  }, 0) / 2;

/** The box round a set of polygons. */
export function bounds(polygons) {
  const min = [Infinity, Infinity];
  const max = [-Infinity, -Infinity];
  for (const polygon of polygons) {
    for (const point of polygon) {
      for (let axis = 0; axis < 2; axis++) {
        if (point[axis] < min[axis]) min[axis] = point[axis];
        if (point[axis] > max[axis]) max[axis] = point[axis];
      }
    }
  }
  return { min, max };
}

export const shiftPolys = (polygons, x, y) => polygons.map((p) => p.map(([px, py]) => [px + x, py + y]));

const edgesOf = (polygons) => polygons.flatMap((p) => p.map((a, i) => [a, p[(i + 1) % p.length]]));

/** Where an edge sits at a height, taking the far side of a horizontal one. */
function atHeight(a, b, y, rightmost) {
  if (Math.abs(a[1] - b[1]) < 1e-9) return rightmost ? Math.max(a[0], b[0]) : Math.min(a[0], b[0]);
  return a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]);
}

/**
 * How far the second shape has to move right to just touch the first.
 *
 * This is what sets a letter beside its neighbour. Spacing on advance widths alone leaves "AV" looking gapped and
 * "rn" looking joined; sliding the real outlines together until they meet, then adding the gap, spaces by what
 * the letters actually look like. Both shapes are made of straight edges, so each pair reaches its closest at one
 * of the two heights where they overlap — no sampling in between is needed.
 */
export function touchingShift(aPolys, bPolys, fallback = true) {
  let shift = -Infinity;
  for (const [a, b] of edgesOf(aPolys)) {
    for (const [c, d] of edgesOf(bPolys)) {
      const low = Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1]));
      const high = Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1]));
      if (low > high + 1e-9) continue;
      for (const y of [low, high]) shift = Math.max(shift, atHeight(a, b, y, true) - atHeight(c, d, y, false));
    }
  }
  if (Number.isFinite(shift)) return shift;
  return fallback ? bounds(aPolys).max[0] - bounds(bPolys).min[0] : -Infinity;
}

/**
 * The shortest links that tie every separate piece of an outline into one.
 *
 * Letters that don't touch leave the keyring in pieces, so a bar is run between them; this works out where each
 * bar should go. It builds a minimum spanning tree over the pieces, comparing each pair once, and compares boxes
 * before points so most pairs are dismissed without looking at them.
 */
export function componentLinks(polygons) {
  if (polygons.length < 2) return [];
  // A long outline is sampled rather than walked point by point: every sample is still on the real contour.
  const sample = (p) => p.filter((_, i) => i % Math.max(1, Math.ceil(p.length / 256)) === 0);
  const shapes = polygons.map((p) => ({ points: sample(p), ...bounds([p]) }));
  const linked = new Set([0]);
  const best = shapes.map(() => ({ d: Infinity }));
  const links = [];
  let newest = 0;

  while (linked.size < shapes.length) {
    const from = shapes[newest];
    for (let b = 0; b < shapes.length; b++) {
      if (linked.has(b)) continue;
      const to = shapes[b];
      const dx = Math.max(0, from.min[0] - to.max[0], to.min[0] - from.max[0]);
      const dy = Math.max(0, from.min[1] - to.max[1], to.min[1] - from.max[1]);
      // Even at their closest the boxes are further apart than the best link found so far.
      if (dx * dx + dy * dy >= best[b].d) continue;
      for (const p of from.points) {
        for (const q of to.points) {
          const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
          if (d < best[b].d) best[b] = { d, p, q, b };
        }
      }
    }
    let edge = { d: Infinity };
    for (let b = 0; b < best.length; b++) if (!linked.has(b) && best[b].d < edge.d) edge = best[b];
    if (!edge.q) break;
    links.push(edge);
    linked.add(edge.b);
    newest = edge.b;
  }
  return links;
}

/** The nearest point of a segment to somewhere. */
function onSegment(a, b, x, y) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const along = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return [a[0] + along * dx, a[1] + along * dy];
}

/** Whether a point is inside a set of polygons, counting the crossings of a ray going right. */
export function pointInPolys(polygons, x, y) {
  let inside = false;
  for (const polygon of polygons) {
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i];
      const b = polygon[j];
      if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
  }
  return inside;
}

/** How far a point is from the nearest edge. */
export function distanceToPolys(polygons, x, y) {
  let nearest = Infinity;
  for (const polygon of polygons) {
    for (let i = 0; i < polygon.length; i++) {
      const point = onSegment(polygon[i], polygon[(i + 1) % polygon.length], x, y);
      nearest = Math.min(nearest, Math.hypot(point[0] - x, point[1] - y));
    }
  }
  return nearest;
}

/**
 * Where a ring hole can actually go, given where it was asked for.
 *
 * A ring has to overlap the body enough to hold, and must never eat into a letter. The outline's edges are walked
 * for the nearest place that satisfies both, so dragging a ring slides it along the edge rather than letting it
 * come off or cut through the text.
 */
export function snapHole(outlines, letters, hole, wantedX, wantedY, borderWidth) {
  if (hole.localJoin) return snapLocalHole(outlines, letters, hole, wantedX, wantedY, borderWidth);
  const radius = hole.outer / 2;
  const wall = (hole.outer - hole.inner) / 2;
  const overlap = Math.min(borderWidth * 0.5, wall * 0.45, 0.6);
  const candidates = [];

  for (const polygon of outlines) {
    if (signedArea(polygon) <= 0) continue;
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i];
      const b = polygon[(i + 1) % polygon.length];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const length = Math.hypot(dx, dy);
      if (length < 1e-8) continue;
      const anchor = onSegment(a, b, wantedX, wantedY);
      candidates.push({
        x: anchor[0] + (dy / length) * (radius - overlap),
        y: anchor[1] - (dx / length) * (radius - overlap),
        anchor,
        d: (anchor[0] - wantedX) ** 2 + (anchor[1] - wantedY) ** 2,
      });
    }
  }
  candidates.sort((a, b) => a.d - b.d);
  for (const candidate of candidates) {
    if (pointInPolys(outlines, candidate.x, candidate.y)) continue;
    if (pointInPolys(letters, candidate.x, candidate.y)) continue;
    const clearance = distanceToPolys(letters, candidate.x, candidate.y) - radius;
    if (clearance < 0.02) continue;
    return { ...candidate, clearance };
  }
  throw new Error("There's nowhere safe to put that ring. Widen the border, or make the ring smaller.");
}

/** A ring set into the body rather than hung off it: it may overlap, but never reach a letter. */
function snapLocalHole(outlines, letters, hole, wantedX, wantedY, borderWidth) {
  const radius = hole.outer / 2;
  const wall = (hole.outer - hole.inner) / 2;
  const protect = hole.inner / 2 + 0.3;
  const candidates = [];

  for (const polygon of outlines) {
    if (signedArea(polygon) <= 0) continue;
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i];
      const b = polygon[(i + 1) % polygon.length];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const length = Math.hypot(dx, dy);
      if (length < 1e-8) continue;
      const anchor = onSegment(a, b, wantedX, wantedY);
      const normal = [dy / length, -dx / length];
      const asked = hole.followPointer
        ? radius - ((wantedX - anchor[0]) * normal[0] + (wantedY - anchor[1]) * normal[1])
        : hole.inset;
      const wanted = Math.max(
        Math.min(0.3, wall * 0.3),
        Math.min(wall + borderWidth * 0.5, Number.isFinite(asked) ? asked : wall * 0.9),
      );
      // Pull the ring out of the body a tenth at a time until it clears the letters.
      for (let depth = wanted; depth >= Math.min(0.2, wall * 0.2) - 1e-6; depth -= 0.1) {
        const x = anchor[0] + normal[0] * (radius - depth);
        const y = anchor[1] + normal[1] * (radius - depth);
        if (pointInPolys(letters, x, y) || distanceToPolys(letters, x, y) < protect) continue;
        candidates.push({
          x,
          y,
          anchor,
          normal,
          inset: depth,
          protectedRadius: protect,
          clearance: distanceToPolys(letters, x, y) - hole.inner / 2,
          d: Math.hypot(anchor[0] - wantedX, anchor[1] - wantedY),
        });
        break;
      }
    }
  }
  candidates.sort((a, b) => a.d - b.d);
  if (candidates.length) return candidates[0];
  throw new Error("There's no room to join that ring. Widen the border, or make the ring smaller.");
}

/** Somewhere inside a region, as near as possible to where it was asked for and clear of what's already there. */
export function snapInRegion(polygons, wantedX, wantedY, others = [], radius = 0) {
  const fits = (x, y) =>
    pointInPolys(polygons, x, y) && others.every((o) => Math.hypot(x - o.x, y - o.y) >= radius + o.radius + 0.6);
  if (fits(wantedX, wantedY)) return { x: wantedX, y: wantedY };

  const box = bounds(polygons);
  const points = [];
  for (const polygon of polygons) {
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i];
      const b = polygon[(i + 1) % polygon.length];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const length = Math.hypot(dx, dy) || 1;
      const near = onSegment(a, b, wantedX, wantedY);
      // A hair inside the edge, so the point counts as within the region.
      points.push([near[0] - (dy / length) * 0.002, near[1] + (dx / length) * 0.002]);
      cx += a[0];
      cy += a[1];
    }
    points.push([cx / polygon.length, cy / polygon.length]);
  }
  const step = Math.max(0.15, Math.max(box.max[0] - box.min[0], box.max[1] - box.min[1]) / 65);
  for (let x = box.min[0]; x <= box.max[0]; x += step) {
    for (let y = box.min[1]; y <= box.max[1]; y += step) points.push([x, y]);
  }

  let best = null;
  let nearest = Infinity;
  for (const [x, y] of points) {
    const distance = (x - wantedX) ** 2 + (y - wantedY) ** 2;
    if (distance < nearest && fits(x, y)) {
      best = { x, y };
      nearest = distance;
    }
  }
  if (!best) throw new Error("There's no room for that magnet. Use fewer or smaller ones, or make the keyring bigger.");
  return best;
}
