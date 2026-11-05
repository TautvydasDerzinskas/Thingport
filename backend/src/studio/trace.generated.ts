// GENERATED from frontend/src/studio/trace.ts by scripts/sync-studio.mjs. Don't edit it here:
// change frontend/src/studio/ and run npm run studio:sync.
import type { Vec2 } from "./vec.generated";

// Tracing a picture: its dark shapes (or its light ones) as outlines, which a sketch then holds as one traced shape.
//
// The same code runs on the server, which traces for trace_picture, and on the page, which previews it as its settings
// change. A picture comes in as brightness, and each shape's boundary is followed along the pixels' own edges, so
// outsides and holes come out wound opposite ways: a nonzero fill makes a ring a ring, and keeps an island in its hole.

/** A picture as brightness, 0 (black) to 255 (white), row by row from the top; see bright(). */
export type Brightness = { width: number; height: number; data: Uint8Array };
export type TraceDetail = "low" | "medium" | "high";
export type TraceSettings = {
  /** Brightness where ink ends; null finds it from the picture. */
  threshold: number | null;
  /** Traces the light shapes on a dark ground instead. */
  invert: boolean;
  detail: TraceDetail;
};
export type Traced = {
  /** The outlines, packed: decode with traceContours. */
  outline: string;
  /** Height over width, of what was traced. */
  aspect: number;
  /** The threshold used, found or given. */
  threshold: number;
  /** How many shapes, and of them how many holes. */
  loops: number;
  holes: number;
  points: number;
};

/** Points one trace keeps at most: more is far finer than a print, and every change to the design keeps them. */
export const TRACE_POINTS = 6000;

/** A picture's pixels as brightness, see-through ones counted as white paper. */
export function bright(rgba: ArrayLike<number>, width: number, height: number): Brightness {
  const data = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) {
    const alpha = rgba[i * 4 + 3] / 255;
    const luma = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
    data[i] = Math.round(luma * alpha + 255 * (1 - alpha));
  }
  return { width, height, data };
}

/** The threshold that best splits the picture's pixels into two groups (Otsu's), for a picture of ink on paper. */
export function findThreshold({ data }: Brightness): number {
  const counts = new Uint32Array(256);
  for (const value of data) counts[value]++;
  const total = data.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * counts[i];
  let below = 0;
  let belowSum = 0;
  let best = 128;
  let bestSpread = -1;
  for (let t = 0; t < 255; t++) {
    below += counts[t];
    if (!below) continue;
    const above = total - below;
    if (!above) break;
    belowSum += t * counts[t];
    const spread = below * above * (belowSum / below - (sum - belowSum) / above) ** 2;
    if (spread > bestSpread) {
      bestSpread = spread;
      best = t + 1;
    }
  }
  return best;
}

// Each detail's straightening, in pixels a line may stray, and the smallest speck kept, in pixels.
const DETAIL: Record<TraceDetail, { tolerance: number; speck: number }> = {
  high: { tolerance: 0.6, speck: 4 },
  medium: { tolerance: 1.2, speck: 12 },
  low: { tolerance: 2.5, speck: 40 },
};

function area(points: readonly Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

/** Each shape's boundary, around the ink's pixels, its corners only: outsides one way round, holes the other. */
function boundaries(ink: Uint8Array, width: number, height: number): Vec2[][] {
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && ink[y * width + x] === 1;
  const stride = width + 1;
  // Every edge between ink and paper, going clockwise round the ink on screen (ink on its right): from a corner of the
  // pixel grid, in one of four ways. A corner has two ways out where two inked pixels touch only at it.
  const DX = [1, 0, -1, 0];
  const DY = [0, 1, 0, -1];
  const from: number[] = [];
  const way: number[] = [];
  const out1 = new Int32Array((width + 1) * (height + 1)).fill(-1);
  const out2 = new Int32Array((width + 1) * (height + 1)).fill(-1);
  const add = (x: number, y: number, dir: number) => {
    const corner = y * stride + x;
    const id = from.length;
    from.push(corner);
    way.push(dir);
    if (out1[corner] < 0) out1[corner] = id;
    else out2[corner] = id;
  };
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (!at(x, y)) continue;
      if (!at(x, y - 1)) add(x, y, 0);
      if (!at(x + 1, y)) add(x + 1, y, 1);
      if (!at(x, y + 1)) add(x + 1, y + 1, 2);
      if (!at(x - 1, y)) add(x, y + 1, 3);
    }
  const used = new Uint8Array(from.length);
  const loops: Vec2[][] = [];
  for (let start = 0; start < from.length; start++) {
    if (used[start]) continue;
    const loop: Vec2[] = [];
    let edge = start;
    let last = -1;
    do {
      used[edge] = 1;
      const corner = from[edge];
      const x = corner % stride;
      const y = (corner - x) / stride;
      // Only where it turns.
      if (way[edge] !== last) loop.push([x, y]);
      last = way[edge];
      const next = (y + DY[last]) * stride + x + DX[last];
      // Where two inked pixels touch only at a corner, it turns right, round its own pixel, so they stay apart: each
      // way in has one way out that does, so every loop closes.
      const b = out2[next];
      edge = b >= 0 && way[b] === (last + 1) % 4 ? b : out1[next];
    } while (edge !== start);
    // It started partway along a side: that first point isn't a corner.
    if (last === way[start]) loop.shift();
    if (loop.length > 2) loops.push(loop);
  }
  return loops;
}

/** Fewer points, none straying more than `tolerance` from the line it stood on (Douglas-Peucker), round the loop; at
 *  least four, so a small shape is a small shape still rather than a line. */
function straighten(loop: Vec2[], tolerance: number): Vec2[] {
  if (loop.length <= 4) return loop;
  // Split at the point farthest from the first, so the loop is two open runs.
  let far = 0;
  let farthest = -1;
  for (let i = 1; i < loop.length; i++) {
    const d = (loop[i][0] - loop[0][0]) ** 2 + (loop[i][1] - loop[0][1]) ** 2;
    if (d > farthest) {
      farthest = d;
      far = i;
    }
  }
  const keep = new Uint8Array(loop.length + 1);
  keep[0] = keep[far] = keep[loop.length] = 1;
  const point = (i: number) => loop[i % loop.length];
  const stack: [number, number, boolean][] = [
    [0, far, true],
    [far, loop.length, true],
  ];
  while (stack.length) {
    const [a, b, always] = stack.pop()!;
    const [ax, ay] = point(a);
    const [bx, by] = point(b);
    const length = Math.hypot(bx - ax, by - ay) || 1;
    let worst = -1;
    let worstAt = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = point(i);
      const d = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / length;
      if (d > worst) {
        worst = d;
        worstAt = i;
      }
    }
    if (worstAt >= 0 && (always || worst > tolerance)) {
      keep[worstAt] = 1;
      stack.push([a, worstAt, false], [worstAt, b, false]);
    }
  }
  return loop.filter((_, i) => keep[i]);
}

/**
 * The picture's shapes as outlines, packed, with what they came to. Throws when there's nothing to trace, or too
 * much to keep even at the plainest.
 */
export function tracePicture(picture: Brightness, settings: TraceSettings): Traced {
  const { width, height, data } = picture;
  const threshold = settings.threshold ?? findThreshold(picture);
  const ink = new Uint8Array(width * height);
  let inked = 0;
  for (let i = 0; i < data.length; i++)
    if (settings.invert ? data[i] >= threshold : data[i] < threshold) {
      ink[i] = 1;
      inked++;
    }
  if (!inked || inked === data.length)
    throw new Error(
      `At a threshold of ${threshold}, the picture is all ${inked ? "ink" : "paper"}: there's no shape to trace. ` +
        "Try another threshold, or invert.",
    );
  const raw = boundaries(ink, width, height);
  let { tolerance, speck } = DETAIL[settings.detail];
  // Over the points a trace keeps, it straightens more each time, and lets go of a little more of the smallest specks.
  for (let attempt = 0; attempt < 8; attempt++) {
    const kept = raw
      .filter((loop) => Math.abs(area(loop)) >= speck)
      .map((loop) => straighten(loop, tolerance))
      .filter((loop) => loop.length >= 3);
    const points = kept.reduce((sum, loop) => sum + loop.length, 0);
    if (!kept.length) {
      if (attempt) break;
      throw new Error("Every shape in the picture is a speck too small to keep: try more detail.");
    }
    if (points <= TRACE_POINTS) return pack(kept, threshold);
    tolerance *= 1.6;
    speck *= 1.25;
  }
  throw new Error(
    "The picture has too much detail to trace: try less detail, another threshold, or a simpler picture.",
  );
}

// Packed as little-endian 16-bit numbers: how many loops, then each one's point count and its points, each across the
// traced shapes' box from 0 to 65535, x left to right and y bottom to top. Base64, as a design is JSON.
const SCALE = 65535;

function pack(loops: Vec2[][], threshold: number): Traced {
  const xs = loops.flat().map(([x]) => x);
  const ys = loops.flat().map(([, y]) => y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const points = loops.reduce((sum, loop) => sum + loop.length, 0);
  const view = new DataView(new ArrayBuffer(2 * (1 + loops.length + points * 2)));
  let at = 0;
  const put = (value: number) => {
    view.setUint16(at, value, true);
    at += 2;
  };
  put(loops.length);
  // On screen y runs down; on a sketch v runs up, which turns every loop the other way, holes still against outsides.
  for (const loop of loops) {
    put(loop.length);
    for (const [x, y] of loop) {
      put(Math.round(((x - minX) / spanX) * SCALE));
      put(Math.round(((maxY - y) / spanY) * SCALE));
    }
  }
  let binary = "";
  const bytes = new Uint8Array(view.buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  // Outsides wind one way round, holes the other.
  const outside = Math.sign(area(loops.toSorted((a, b) => Math.abs(area(b)) - Math.abs(area(a)))[0]));
  return {
    outline: btoa(binary),
    aspect: spanY / spanX,
    threshold,
    loops: loops.length,
    holes: loops.filter((loop) => Math.sign(area(loop)) !== outside).length,
    points,
  };
}

/** A traced shape as it's kept in a sketch. */
export type TraceShape = {
  type: "trace";
  /** The design's picture it was traced from, to trace it again. */
  picture_id: string;
  /** Its box's middle on the plane, and its size there, in mm. */
  center: Vec2;
  width: number;
  height: number;
  threshold: number | null;
  invert: boolean;
  detail: TraceDetail;
  /** What tracePicture packed. */
  outline: string;
  hole?: boolean;
};

const unpacked = new Map<string, Vec2[][]>();

/** A traced shape's outlines on its plane, in mm. */
export function traceContours(shape: TraceShape): Vec2[][] {
  let loops = unpacked.get(shape.outline);
  if (!loops) {
    const binary = atob(shape.outline);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const view = new DataView(bytes.buffer);
    let at = 0;
    const take = () => {
      if (at + 2 > bytes.length) throw new Error("The traced outline is damaged: trace the picture again.");
      const value = view.getUint16(at, true);
      at += 2;
      return value / SCALE;
    };
    const count = take() * SCALE;
    loops = Array.from({ length: count }, () =>
      Array.from({ length: Math.round(take() * SCALE) }, (): Vec2 => [take(), take()]),
    );
    if (unpacked.size >= 50) unpacked.clear();
    unpacked.set(shape.outline, loops);
  }
  const [cu, cv] = shape.center;
  return loops.map((loop) => loop.map(([x, y]): Vec2 => [cu + (x - 0.5) * shape.width, cv + (y - 0.5) * shape.height]));
}

/** How a traced shape reads to an AI: its outlines' size, not the outlines themselves. */
export function traceSummary(outline: string): string {
  try {
    const loops = traceContours({ outline, center: [0, 0], width: 1, height: 1 } as TraceShape);
    return `(${loops.length} outlines, ${loops.reduce((sum, loop) => sum + loop.length, 0)} points)`;
  } catch {
    return "(a damaged outline)";
  }
}
