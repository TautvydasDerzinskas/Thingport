// Which objects on a plate the slicer would print into each other. Bambu Studio refuses a plate where two objects'
// extrusions cross on a layer (ConflictChecker.cpp, "G-code path conflicts"), which their solids overlapping makes
// them do; objects that only touch keep each one's lines inside it. It prints each object from the bed up, so an
// object above the bed comes down onto it first: an inlay sitting in its pocket as an object of its own ends up in
// what's under the pocket. So the test is the slicer's own: put each on the bed, slice both at a few heights and
// measure how much their cross-sections share.

import { printedHeights, type Box3, type LayoutItem, type LayoutPlate } from "./layout";

// Bounds that share less than this along an axis only touch.
const TOUCH = 0.05;
// Heights sliced: one per this much of the shared height, at most MAX_LEVELS of them.
const LEVEL_STEP = 0.2;
const MAX_LEVELS = 48;
// Rows the cross-sections are measured along, and the shared area that counts as overlapping, in mm and mm².
const ROW = 0.1;
const MIN_AREA = 0.25;
// Triangles cut at all heights, past which fewer heights are sliced.
const WORK = 2e8;

/** Where the item prints: its bounds once the slicer has put it on the bed. */
function printed(item: LayoutItem): Box3 {
  const [bottom, top] = printedHeights(item);
  return { min: [item.world.min[0], item.world.min[1], bottom], max: [item.world.max[0], item.world.max[1], top] };
}

function shared(a: Box3, b: Box3): Box3 | null {
  const min = [0, 1, 2].map((axis) => Math.max(a.min[axis], b.min[axis])) as Box3["min"];
  const max = [0, 1, 2].map((axis) => Math.min(a.max[axis], b.max[axis])) as Box3["max"];
  return [0, 1, 2].every((axis) => max[axis] - min[axis] > TOUCH) ? { min, max } : null;
}

/** An item's vertices where they print, part by part, made once per item. */
const placedVertices = new WeakMap<LayoutItem, { positions: Float32Array; triangles: Uint32Array }[]>();

function verticesOf(item: LayoutItem) {
  let out = placedVertices.get(item);
  if (out) return out;
  out = item.parts.map(({ mesh, matrix: t }) => {
    const p = mesh.positions;
    const positions = new Float32Array(p.length);
    for (let i = 0; i < p.length; i += 3) {
      const [x, y, z] = [p[i], p[i + 1], p[i + 2]];
      positions[i] = x * t[0] + y * t[3] + z * t[6] + t[9];
      positions[i + 1] = x * t[1] + y * t[4] + z * t[7] + t[10];
      positions[i + 2] = x * t[2] + y * t[5] + z * t[8] + t[11];
    }
    return { positions, triangles: mesh.triangles };
  });
  placedVertices.set(item, out);
  return out;
}

/** The item's cross-section at printed height `z`, part by part, as segments x1 y1 x2 y2. */
function sections(item: LayoutItem, printedZ: number): number[][] {
  const z = printedZ + item.lift;
  const out: number[][] = [];
  for (const { positions: p, triangles: t } of verticesOf(item)) {
    const segments: number[] = [];
    out.push(segments);
    for (let f = 0; f < t.length; f += 3) {
      const a = t[f] * 3;
      const b = t[f + 1] * 3;
      const c = t[f + 2] * 3;
      const za = p[a + 2];
      const zb = p[b + 2];
      const zc = p[c + 2];
      const above = Number(za > z) + Number(zb > z) + Number(zc > z);
      if (above === 0 || above === 3) continue;
      const points: number[] = [];
      for (const [u, v, zu, zv] of [
        [a, b, za, zb],
        [b, c, zb, zc],
        [c, a, zc, za],
      ]) {
        if (zu > z === zv > z) continue;
        const k = (z - zu) / (zv - zu);
        points.push(p[u] + k * (p[v] - p[u]), p[u + 1] + k * (p[v + 1] - p[u + 1]));
      }
      if (points.length === 4) segments.push(points[0], points[1], points[2], points[3]);
    }
  }
  return out;
}

/** Each row's spans of the parts together: each part's by the even-odd rule, so its holes stay holes, then joined, as
 *  parts that overlap print as one. */
function itemSpans(parts: number[][], y0: number, rows: number): number[][] {
  const perPart = parts.filter((segments) => segments.length).map((segments) => rowSpans(segments, y0, rows));
  if (perPart.length <= 1) return perPart[0] ?? Array.from({ length: rows }, () => []);
  return Array.from({ length: rows }, (_, r) => {
    const spans: [number, number][] = [];
    for (const part of perPart) for (let i = 0; i < part[r].length; i += 2) spans.push([part[r][i], part[r][i + 1]]);
    spans.sort((a, b) => a[0] - b[0]);
    const joined: number[] = [];
    for (const [from, to] of spans) {
      if (joined.length && from <= joined[joined.length - 1])
        joined[joined.length - 1] = Math.max(joined[joined.length - 1], to);
      else joined.push(from, to);
    }
    return joined;
  });
}

/** Each row's spans inside the section, by the even-odd rule, as [from, to, from, to, ...]. */
function rowSpans(segments: number[], y0: number, rows: number): number[][] {
  const crossings: number[][] = Array.from({ length: rows }, () => []);
  for (let s = 0; s < segments.length; s += 4) {
    const [x1, y1, x2, y2] = [segments[s], segments[s + 1], segments[s + 2], segments[s + 3]];
    if (y1 === y2) continue;
    const lo = Math.max(Math.ceil((Math.min(y1, y2) - y0) / ROW - 0.5), 0);
    const hi = Math.min(Math.floor((Math.max(y1, y2) - y0) / ROW - 0.5), rows - 1);
    for (let r = lo; r <= hi; r++) {
      const y = y0 + (r + 0.5) * ROW;
      if (y1 <= y === y2 <= y) continue;
      crossings[r].push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
    }
  }
  for (const row of crossings) {
    row.sort((p, q) => p - q);
    if (row.length % 2) row.pop();
  }
  return crossings;
}

/** How long two rows' spans overlap. */
function sharedLength(a: number[], b: number[]): number {
  let total = 0;
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const from = Math.max(a[i], b[j]);
    const to = Math.min(a[i + 1], b[j + 1]);
    if (to > from) total += to - from;
    if (a[i + 1] < b[j + 1]) i += 2;
    else j += 2;
  }
  return total;
}

function triangleCount(item: LayoutItem): number {
  return item.parts.reduce((n, { mesh }) => n + mesh.triangles.length / 3, 0);
}

/** Whether the two items' solids overlap: their cross-sections share area at some height. */
export function solidsOverlap(a: LayoutItem, b: LayoutItem): boolean {
  const box = shared(printed(a), printed(b));
  if (!box) return false;
  const [z0, z1] = [box.min[2], box.max[2]];
  const triangles = triangleCount(a) + triangleCount(b);
  const levels = Math.max(1, Math.min(MAX_LEVELS, Math.ceil((z1 - z0) / LEVEL_STEP), Math.floor(WORK / triangles)));
  const rows = Math.max(1, Math.ceil((box.max[1] - box.min[1]) / ROW));
  for (let level = 0; level < levels; level++) {
    // Off the layer grid a little, so a height isn't exactly a vertex's.
    const z = z0 + ((level + 0.5) * (z1 - z0)) / levels + 1e-5;
    const spansA = itemSpans(sections(a, z), box.min[1], rows);
    const spansB = itemSpans(sections(b, z), box.min[1], rows);
    let area = 0;
    for (let r = 0; r < rows; r++) {
      area += sharedLength(spansA[r], spansB[r]) * ROW;
      if (area >= MIN_AREA) return true;
    }
  }
  return false;
}

/** The plate's items in groups that print into each other, each of two or more, in build order. */
export function overlappingGroups(plate: LayoutPlate): LayoutItem[][] {
  const items = plate.items;
  const parent = items.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) {
      if (find(i) === find(j) || !shared(printed(items[i]), printed(items[j]))) continue;
      if (solidsOverlap(items[i], items[j])) parent[find(j)] = find(i);
    }
  const groups = new Map<number, LayoutItem[]>();
  items.forEach((item, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), item]);
  });
  return [...groups.values()].filter((group) => group.length > 1);
}
