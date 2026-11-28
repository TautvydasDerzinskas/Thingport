// What a plate's objects cover of the bed, seen from above: a grid of 1 mm cells, each taken where a printed triangle
// is over it, and how far each free cell is from a taken one. A wipe tower is tested against this, as an object's
// bounds can cover the whole bed while it leaves most of it free (a plate of baubles).

import type { BedBox } from "../../adapter/printer";
import type { Box2, LayoutPlate } from "./layout";

const CELL = 1;

export type Footprint = {
  x0: number;
  y0: number;
  cols: number;
  rows: number;
  taken: Uint8Array;
  /** Each cell's distance to the nearest taken one, in mm. */
  distance: Float32Array;
};

/** The cells a point is in, and those a segment passes through, sampled at half a cell. */
function markSegment(f: Footprint, ax: number, ay: number, bx: number, by: number) {
  const steps = Math.max(1, Math.ceil((Math.hypot(bx - ax, by - ay) / CELL) * 2));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    mark(f, ax + (bx - ax) * t, ay + (by - ay) * t);
  }
}

function mark(f: Footprint, x: number, y: number) {
  const c = Math.floor((x - f.x0) / CELL);
  const r = Math.floor((y - f.y0) / CELL);
  if (c >= 0 && r >= 0 && c < f.cols && r < f.rows) f.taken[r * f.cols + c] = 1;
}

/** A triangle's cells: along its edges, and those whose middle it covers. */
function markTriangle(f: Footprint, ax: number, ay: number, bx: number, by: number, cx: number, cy: number) {
  markSegment(f, ax, ay, bx, by);
  markSegment(f, bx, by, cx, cy);
  markSegment(f, cx, cy, ax, ay);
  const minC = Math.max(Math.floor((Math.min(ax, bx, cx) - f.x0) / CELL), 0);
  const maxC = Math.min(Math.floor((Math.max(ax, bx, cx) - f.x0) / CELL), f.cols - 1);
  const minR = Math.max(Math.floor((Math.min(ay, by, cy) - f.y0) / CELL), 0);
  const maxR = Math.min(Math.floor((Math.max(ay, by, cy) - f.y0) / CELL), f.rows - 1);
  if (maxC - minC < 2 && maxR - minR < 2) return;
  const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
  if (Math.abs(area) < 1e-12) return;
  for (let r = minR; r <= maxR; r++)
    for (let c = minC; c <= maxC; c++) {
      const px = f.x0 + (c + 0.5) * CELL;
      const py = f.y0 + (r + 0.5) * CELL;
      const w0 = ((bx - px) * (cy - py) - (cx - px) * (by - py)) / area;
      const w1 = ((cx - px) * (ay - py) - (ax - px) * (cy - py)) / area;
      if (w0 >= 0 && w1 >= 0 && w0 + w1 <= 1) f.taken[r * f.cols + c] = 1;
    }
}

/** Two passes of a chamfer distance, in mm: exact along rows and columns, close enough on the diagonals. */
function measure(f: Footprint) {
  const { cols, rows, taken, distance } = f;
  const far = (cols + rows) * CELL;
  for (let i = 0; i < taken.length; i++) distance[i] = taken[i] ? 0 : far;
  const diagonal = Math.SQRT2 * CELL;
  const relax = (i: number, j: number, step: number) => {
    if (distance[j] + step < distance[i]) distance[i] = distance[j] + step;
  };
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (c > 0) relax(i, i - 1, CELL);
      if (r > 0) {
        relax(i, i - cols, CELL);
        if (c > 0) relax(i, i - cols - 1, diagonal);
        if (c < cols - 1) relax(i, i - cols + 1, diagonal);
      }
    }
  for (let r = rows - 1; r >= 0; r--)
    for (let c = cols - 1; c >= 0; c--) {
      const i = r * cols + c;
      if (c < cols - 1) relax(i, i + 1, CELL);
      if (r < rows - 1) {
        relax(i, i + cols, CELL);
        if (c < cols - 1) relax(i, i + cols + 1, diagonal);
        if (c > 0) relax(i, i + cols - 1, diagonal);
      }
    }
}

/** What the plate's objects and the bed's no-print areas cover of the bed. */
export function plateFootprint(plate: LayoutPlate, bed: BedBox, exclude: Box2[]): Footprint {
  const cols = Math.max(1, Math.ceil((bed.maxX - bed.minX) / CELL));
  const rows = Math.max(1, Math.ceil((bed.maxY - bed.minY) / CELL));
  const f: Footprint = {
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
  for (const area of exclude)
    for (let y = area.minY; y <= area.maxY; y += CELL / 2) markSegment(f, area.minX, y, area.maxX, y);
  measure(f);
  return f;
}

/** How far the box keeps from everything taken, in mm: 0 where it covers some of it. */
export function clearance(f: Footprint, box: Box2, enough = Infinity): number {
  const minC = Math.max(Math.floor((box.minX - f.x0) / CELL), 0);
  const maxC = Math.min(Math.ceil((box.maxX - f.x0) / CELL) - 1, f.cols - 1);
  const minR = Math.max(Math.floor((box.minY - f.y0) / CELL), 0);
  const maxR = Math.min(Math.ceil((box.maxY - f.y0) / CELL) - 1, f.rows - 1);
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
