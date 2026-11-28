// What a plate's objects cover of the bed, seen from above: a grid of 1 mm cells, each taken where a printed triangle
// is over it, and how far each free cell is from a taken one. A wipe tower is tested against this, as an object's
// bounds can cover the whole bed while it leaves most of it free (a plate of baubles). A bed past any printer's gets
// larger cells, so a file's bed size can't make the grid any bigger than MAX_CELLS.

import type { BedBox } from "../../adapter/printer";
import type { Box2, LayoutPlate } from "./layout";

const CELL = 1;
const MAX_CELLS = 4_000_000;

export type Footprint = {
  /** A cell's side, in mm. */
  cell: number;
  x0: number;
  y0: number;
  cols: number;
  rows: number;
  taken: Uint8Array;
  /** Each cell's distance to the nearest taken one, in mm. */
  distance: Float32Array;
};

/** The part of a segment over the grid (Liang-Barsky), or null where it misses it. */
function clipped(
  f: Footprint,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): [number, number, number, number] | null {
  const [x1, y1] = [f.x0 + f.cols * f.cell, f.y0 + f.rows * f.cell];
  let [t0, t1] = [0, 1];
  const [dx, dy] = [bx - ax, by - ay];
  for (const [p, q] of [
    [-dx, ax - f.x0],
    [dx, x1 - ax],
    [-dy, ay - f.y0],
    [dy, y1 - ay],
  ]) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return null;
  }
  return [ax + t0 * dx, ay + t0 * dy, ax + t1 * dx, ay + t1 * dy];
}

/** The cells a point is in, and those a segment passes through, sampled at half a cell. */
function markSegment(f: Footprint, fromX: number, fromY: number, toX: number, toY: number) {
  const inside = clipped(f, fromX, fromY, toX, toY);
  if (!inside) return;
  const [ax, ay, bx, by] = inside;
  const steps = Math.max(1, Math.ceil((Math.hypot(bx - ax, by - ay) / f.cell) * 2));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    mark(f, ax + (bx - ax) * t, ay + (by - ay) * t);
  }
}

function mark(f: Footprint, x: number, y: number) {
  const c = Math.floor((x - f.x0) / f.cell);
  const r = Math.floor((y - f.y0) / f.cell);
  if (c >= 0 && r >= 0 && c < f.cols && r < f.rows) f.taken[r * f.cols + c] = 1;
}

/** A triangle's cells: along its edges, and those whose middle it covers. */
function markTriangle(f: Footprint, ax: number, ay: number, bx: number, by: number, cx: number, cy: number) {
  markSegment(f, ax, ay, bx, by);
  markSegment(f, bx, by, cx, cy);
  markSegment(f, cx, cy, ax, ay);
  const minC = Math.max(Math.floor((Math.min(ax, bx, cx) - f.x0) / f.cell), 0);
  const maxC = Math.min(Math.floor((Math.max(ax, bx, cx) - f.x0) / f.cell), f.cols - 1);
  const minR = Math.max(Math.floor((Math.min(ay, by, cy) - f.y0) / f.cell), 0);
  const maxR = Math.min(Math.floor((Math.max(ay, by, cy) - f.y0) / f.cell), f.rows - 1);
  if (maxC - minC < 2 && maxR - minR < 2) return;
  const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
  if (Math.abs(area) < 1e-12) return;
  for (let r = minR; r <= maxR; r++)
    for (let c = minC; c <= maxC; c++) {
      const px = f.x0 + (c + 0.5) * f.cell;
      const py = f.y0 + (r + 0.5) * f.cell;
      const w0 = ((bx - px) * (cy - py) - (cx - px) * (by - py)) / area;
      const w1 = ((cx - px) * (ay - py) - (ax - px) * (cy - py)) / area;
      if (w0 >= 0 && w1 >= 0 && w0 + w1 <= 1) f.taken[r * f.cols + c] = 1;
    }
}

/** Two passes of a chamfer distance, in mm: exact along rows and columns, close enough on the diagonals. */
function measure(f: Footprint) {
  const { cols, rows, taken, distance } = f;
  const far = (cols + rows) * f.cell;
  for (let i = 0; i < taken.length; i++) distance[i] = taken[i] ? 0 : far;
  const diagonal = Math.SQRT2 * f.cell;
  const relax = (i: number, j: number, step: number) => {
    if (distance[j] + step < distance[i]) distance[i] = distance[j] + step;
  };
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (c > 0) relax(i, i - 1, f.cell);
      if (r > 0) {
        relax(i, i - cols, f.cell);
        if (c > 0) relax(i, i - cols - 1, diagonal);
        if (c < cols - 1) relax(i, i - cols + 1, diagonal);
      }
    }
  for (let r = rows - 1; r >= 0; r--)
    for (let c = cols - 1; c >= 0; c--) {
      const i = r * cols + c;
      if (c < cols - 1) relax(i, i + 1, f.cell);
      if (r < rows - 1) {
        relax(i, i + cols, f.cell);
        if (c < cols - 1) relax(i, i + cols + 1, diagonal);
        if (c > 0) relax(i, i + cols - 1, diagonal);
      }
    }
}

/** What the plate's objects and the bed's no-print areas cover of the bed. */
export function plateFootprint(plate: LayoutPlate, bed: BedBox, exclude: Box2[]): Footprint {
  const [width, depth] = [bed.maxX - bed.minX, bed.maxY - bed.minY];
  const cell = Math.max(CELL, Math.sqrt((width * depth) / MAX_CELLS));
  const cols = Math.max(1, Math.min(Math.ceil(width / cell), MAX_CELLS));
  const rows = Math.max(1, Math.min(Math.ceil(depth / cell), Math.floor(MAX_CELLS / cols)));
  const f: Footprint = {
    cell,
    x0: bed.minX,
    y0: bed.minY,
    cols,
    rows,
    taken: new Uint8Array(cols * rows),
    distance: new Float32Array(cols * rows),
  };
  const [ox, oy] = plate.origin;
  for (const item of plate.items)
    for (const { mesh, matrix: t } of item.parts) {
      const p = mesh.positions;
      const xy = new Float32Array((p.length / 3) * 2);
      for (let i = 0, j = 0; i < p.length; i += 3, j += 2) {
        xy[j] = p[i] * t[0] + p[i + 1] * t[3] + p[i + 2] * t[6] + t[9] - ox;
        xy[j + 1] = p[i] * t[1] + p[i + 1] * t[4] + p[i + 2] * t[7] + t[10] - oy;
      }
      const tri = mesh.triangles;
      for (let k = 0; k < tri.length; k += 3) {
        const [a, b, c] = [tri[k] * 2, tri[k + 1] * 2, tri[k + 2] * 2];
        markTriangle(f, xy[a], xy[a + 1], xy[b], xy[b + 1], xy[c], xy[c + 1]);
      }
    }
  // Each area's cells, the area clipped to the grid first, so one larger than the bed costs no more than the bed.
  for (const area of exclude) {
    const minC = Math.max(Math.floor((area.minX - f.x0) / f.cell), 0);
    const maxC = Math.min(Math.floor((area.maxX - f.x0) / f.cell), f.cols - 1);
    const minR = Math.max(Math.floor((area.minY - f.y0) / f.cell), 0);
    const maxR = Math.min(Math.floor((area.maxY - f.y0) / f.cell), f.rows - 1);
    // An area off the grid clips to nothing, which fill would take from the array's end.
    if (minC > maxC || minR > maxR) continue;
    for (let r = minR; r <= maxR; r++) f.taken.fill(1, r * f.cols + minC, r * f.cols + maxC + 1);
  }
  measure(f);
  return f;
}

/** How far the box keeps from everything taken, in mm: 0 where it covers some of it. */
export function clearance(f: Footprint, box: Box2, enough = Infinity): number {
  const minC = Math.max(Math.floor((box.minX - f.x0) / f.cell), 0);
  const maxC = Math.min(Math.ceil((box.maxX - f.x0) / f.cell) - 1, f.cols - 1);
  const minR = Math.max(Math.floor((box.minY - f.y0) / f.cell), 0);
  const maxR = Math.min(Math.ceil((box.maxY - f.y0) / f.cell) - 1, f.rows - 1);
  let least = enough;
  for (let r = minR; r <= maxR; r++) {
    const row = r * f.cols;
    for (let c = minC; c <= maxC; c++) {
      const d = f.distance[row + c];
      if (d < least) {
        least = d;
        if (least === 0) return 0;
      }
    }
  }
  return least;
}

/** The convex hull of points given as x y pairs, counter-clockwise (Andrew's monotone chain). */
export function convexHull(xy: ArrayLike<number>): [number, number][] {
  const points: [number, number][] = [];
  for (let i = 0; i + 1 < xy.length; i += 2) points.push([xy[i], xy[i + 1]]);
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (points.length < 3) return points;
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of points) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (const p of points.toReversed()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Whether a counter-clockwise convex polygon and a box share any area: no axis of either separates them. The box's
 *  axes are its bounds; each hull edge separates them where all four corners are on or past its outer side. */
export function hullMeetsBox(hull: [number, number][], box: Box2): boolean {
  if (!hull.length) return false;
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of hull) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (maxX <= box.minX || minX >= box.maxX || maxY <= box.minY || minY >= box.maxY) return false;
  const corners: [number, number][] = [
    [box.minX, box.minY],
    [box.maxX, box.minY],
    [box.maxX, box.maxY],
    [box.minX, box.maxY],
  ];
  for (let i = 0; i < hull.length; i++) {
    const [ax, ay] = hull[i];
    const [bx, by] = hull[(i + 1) % hull.length];
    // Left of a counter-clockwise edge is inside; a corner on the edge only touches.
    if (corners.every(([x, y]) => (bx - ax) * (y - ay) - (by - ay) * (x - ax) <= 0)) return false;
  }
  return true;
}
