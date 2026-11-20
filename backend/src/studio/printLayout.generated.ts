// GENERATED from frontend/src/studio/printLayout.ts by scripts/sync-studio.mjs. Don't edit it here:
// change frontend/src/studio/ and run npm run studio:sync.
import type { StudioPrintSetup } from "./document.generated";
import type { Bounds } from "./parts.generated";
import type { Vec2, Vec3 } from "./vec.generated";

export const DEFAULT_PRINT_BED: Vec3 = [256, 256, 256];

export function centeredPrinterOutline(bed: {
  shape: "rectangle" | "circle" | "polygon";
  x: number;
  y: number;
  origin: Vec2;
  points?: readonly Vec2[];
}): StudioPrintSetup["outline"] {
  if (bed.shape === "circle") return { shape: "circle" };
  if (bed.shape === "polygon" && bed.points?.length) {
    const points = bed.points.map<Vec2>(([x, y]) => [x - bed.origin[0] - bed.x / 2, y - bed.origin[1] - bed.y / 2]);
    if (points[0][0] === points.at(-1)![0] && points[0][1] === points.at(-1)![1]) points.pop();
    return { shape: "polygon", points };
  }
  return undefined;
}

/** Rejects zero-area outlines, repeated corners, and edges that cross, touch, or double back. */
export function isSimpleBedPolygon(points: readonly Vec2[]): boolean {
  const epsilon = 1e-8;
  const cross = (a: Vec2, b: Vec2, p: Vec2) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  const sign = (value: number) => (Math.abs(value) <= epsilon ? 0 : Math.sign(value));
  const between = (p: Vec2, a: Vec2, b: Vec2) =>
    p.every((value, i) => value >= Math.min(a[i], b[i]) - epsilon && value <= Math.max(a[i], b[i]) + epsilon);
  const count = points.length;
  if (count < 3) return false;
  let area = 0;
  for (let i = 0; i < count; i++) {
    const a = points[i];
    const b = points[(i + 1) % count];
    const next = points[(i + 2) % count];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) <= epsilon) return false;
    if (sign(cross(a, b, next)) === 0 && (b[0] - a[0]) * (next[0] - b[0]) + (b[1] - a[1]) * (next[1] - b[1]) < 0)
      return false;
    area += a[0] * b[1] - a[1] * b[0];
    for (let j = i + 2; j < count; j++) {
      if (i === 0 && j === count - 1) continue;
      const c = points[j];
      const d = points[(j + 1) % count];
      const [abC, abD, cdA, cdB] = [cross(a, b, c), cross(a, b, d), cross(c, d, a), cross(c, d, b)].map(sign);
      if (
        (abC * abD < 0 && cdA * cdB < 0) ||
        (!abC && between(c, a, b)) ||
        (!abD && between(d, a, b)) ||
        (!cdA && between(a, c, d)) ||
        (!cdB && between(b, c, d))
      )
        return false;
    }
  }
  return Math.abs(area) > epsilon;
}

export function bedOutline(bed: Vec3, outline?: StudioPrintSetup["outline"]): Vec2[] {
  const [x, y] = bed.map((size) => size / 2);
  if (outline?.shape === "polygon") return outline.points;
  if (outline?.shape === "circle")
    return Array.from({ length: 96 }, (_, i) => {
      const angle = (i * Math.PI) / 48;
      return [x * Math.cos(angle), y * Math.sin(angle)];
    });
  return [
    [-x, -y],
    [x, -y],
    [x, y],
    [-x, y],
  ];
}

export function onBed(x: number, y: number, bed: Vec3, outline?: StudioPrintSetup["outline"]): boolean {
  if (!(Math.abs(x) <= bed[0] / 2 + 0.01 && Math.abs(y) <= bed[1] / 2 + 0.01)) return false;
  if (outline?.shape === "circle") return Math.hypot(x / (bed[0] / 2), y / (bed[1] / 2)) <= 1.00001;
  if (outline?.shape !== "polygon") return true;
  const points = outline.points;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [ax, ay] = points[j];
    const [bx, by] = points[i];
    const dx = bx - ax;
    const dy = by - ay;
    const along = (x - ax) * dx + (y - ay) * dy;
    if (
      along >= 0 &&
      along <= dx * dx + dy * dy &&
      Math.abs((x - ax) * dy - (y - ay) * dx) <= 0.01 * Math.hypot(dx, dy) &&
      (dx || dy)
    )
      return true;
    if (ay > y !== by > y && x < ax + ((y - ay) * dx) / dy) inside = !inside;
  }
  return inside;
}

/** Check between polygon crossings as well as at the endpoints, including crossings through a corner of a notch. */
function segmentOnBed(
  a: Vec2,
  b: Vec2,
  bed: Vec3,
  outline: Extract<StudioPrintSetup["outline"], { shape: "polygon" }>,
) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const cuts = [0, 1];
  for (const [i, p] of outline.points.entries()) {
    const q = outline.points[(i + 1) % outline.points.length];
    const ex = q[0] - p[0];
    const ey = q[1] - p[1];
    const cross = dx * ey - dy * ex;
    if (Math.abs(cross) < 1e-12) continue;
    const px = p[0] - a[0];
    const py = p[1] - a[1];
    const t = (px * ey - py * ex) / cross;
    const u = (px * dy - py * dx) / cross;
    if (t > 0 && t < 1 && u >= -1e-9 && u <= 1 + 1e-9) cuts.push(t);
  }
  if (cuts.length === 2) return onBed((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, bed, outline);
  const sorted = cuts.toSorted((x, y) => x - y);
  return sorted.slice(1).every((end, i) => {
    if (end - sorted[i] < 1e-9) return true;
    const t = (end + sorted[i]) / 2;
    return onBed(a[0] + t * dx, a[1] + t * dy, bed, outline);
  });
}

/** A closed footprint fits if its boundary fits a simple bed outline. Curved and rectangular beds are convex. */
export function footprintOnBed(points: readonly Vec2[], bed: Vec3, outline?: StudioPrintSetup["outline"]): boolean {
  return (
    points.every(([x, y]) => onBed(x, y, bed, outline)) &&
    (outline?.shape !== "polygon" ||
      points.every((point, i) => segmentOnBed(point, points[(i + 1) % points.length], bed, outline)))
  );
}

function rectangle(x0: number, y0: number, x1: number, y1: number): Vec2[] {
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

export function boundsOnBed({ min, max }: Bounds, bed: Vec3, outline?: StudioPrintSetup["outline"]): boolean {
  return (
    min[2] >= -0.01 &&
    max[2] <= bed[2] + 0.01 &&
    footprintOnBed(rectangle(min[0], min[1], max[0], max[1]), bed, outline)
  );
}

type Footprint = { x: number; y: number; width: number; depth: number };
export type LayoutBody = { id: string; bound: Bounds; locked?: boolean };
export type PlatePlacement = Footprint & { id: string; plate: number; shift: Vec3; locked: boolean };

/** Packs world-aligned footprints around locked bodies. Z and print orientation stay as the user set them. */
export function arrangeFootprints(
  bodies: LayoutBody[],
  bed: Vec3,
  spacing: number,
  outline?: StudioPrintSetup["outline"],
) {
  const floorX = -bed[0] / 2 + spacing;
  const floorY = -bed[1] / 2 + spacing;
  const planes: PlatePlacement[][] = [[]];
  const overflow: string[] = [];
  const footprint = ({ min, max }: Bounds): Footprint => ({
    x: min[0],
    y: min[1],
    width: max[0] - min[0],
    depth: max[1] - min[1],
  });
  for (const body of bodies.filter((each) => each.locked)) {
    planes[0].push({ id: body.id, plate: 0, ...footprint(body.bound), shift: [0, 0, 0], locked: true });
  }
  const movable = bodies
    .filter((body) => !body.locked)
    .map((body) => Object.assign(footprint(body.bound), { id: body.id }))
    .toSorted((a, b) => b.width * b.depth - a.width * a.depth);
  for (const part of movable) {
    if (part.width > -2 * floorX || part.depth > -2 * floorY) {
      overflow.push(part.id);
      continue;
    }
    const bedXs = [floorX, -part.width / 2];
    const bedYs = [floorY, -part.depth / 2];
    if (outline?.shape === "polygon") {
      // Align either padded edge with a bed corner, including narrow corridors between corners.
      for (const [x, y] of outline.points) {
        bedXs.push(x + spacing, x - part.width - spacing);
        bedYs.push(y + spacing, y - part.depth - spacing);
      }
    }
    // Sample inward from the edges for curves and slanted boundaries.
    if (outline) {
      for (let i = 1; i <= 12; i++) {
        bedXs.push(floorX + ((bed[0] - 2 * spacing - part.width) * i) / 12);
        bedYs.push(floorY + ((bed[1] - 2 * spacing - part.depth) * i) / 12);
      }
    }
    const find = (placed: PlatePlacement[]) => {
      const xs = new Set(bedXs);
      const ys = new Set(bedYs);
      for (const item of placed) {
        xs.add(item.x + item.width + spacing);
        xs.add(item.x - part.width - spacing);
        ys.add(item.y + item.depth + spacing);
        ys.add(item.y - part.depth - spacing);
      }
      const columns = [...xs].filter((x) => x >= floorX && x + part.width <= -floorX).toSorted((a, b) => a - b);
      const rows = [...ys].filter((y) => y >= floorY && y + part.depth <= -floorY).toSorted((a, b) => a - b);
      for (const y of rows) {
        for (const x of columns) {
          const x1 = x + part.width;
          const y1 = y + part.depth;
          if (outline && !footprintOnBed(rectangle(x - spacing, y - spacing, x1 + spacing, y1 + spacing), bed, outline))
            continue;
          if (
            placed.some(
              (p) =>
                x < p.x + p.width + spacing - 1e-8 &&
                x1 + spacing > p.x + 1e-8 &&
                y < p.y + p.depth + spacing - 1e-8 &&
                y1 + spacing > p.y + 1e-8,
            )
          )
            continue;
          return { x, y };
        }
      }
      return null;
    };
    let plate = 0;
    let at = find(planes[plate]);
    while (!at && ++plate < planes.length) at = find(planes[plate]);
    if (!at) {
      at = find([]);
      if (at) planes.push([]);
    }
    if (!at) overflow.push(part.id);
    else planes[plate].push({ ...part, ...at, plate, shift: [at.x - part.x, at.y - part.y, 0], locked: false });
  }
  return { planes, overflow };
}
