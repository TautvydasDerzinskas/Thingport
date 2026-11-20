import type { StudioPrintSetup } from "./document";
import type { Bounds } from "./parts";
import type { Vec2, Vec3 } from "./vec";

export const DEFAULT_PRINT_BED: Vec3 = [256, 256, 256];

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
  if (outline?.shape === "circle") return Math.hypot(x / (bed[0] / 2), y / (bed[1] / 2)) <= 1.00001;
  if (outline?.shape !== "polygon") return Math.abs(x) <= bed[0] / 2 + 0.01 && Math.abs(y) <= bed[1] / 2 + 0.01;
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
    const find = (placed: PlatePlacement[]) => {
      const xs = new Set([floorX, -part.width / 2]);
      const ys = new Set([floorY, -part.depth / 2]);
      for (const item of placed) {
        xs.add(item.x + item.width + spacing);
        xs.add(item.x - part.width - spacing);
        ys.add(item.y + item.depth + spacing);
        ys.add(item.y - part.depth - spacing);
      }
      // Sample inward from the edges for curved and irregular beds.
      if (outline) {
        for (let i = 1; i <= 12; i++) {
          xs.add(floorX + ((bed[0] - 2 * spacing - part.width) * i) / 12);
          ys.add(floorY + ((bed[1] - 2 * spacing - part.depth) * i) / 12);
        }
      }
      const columns = [...xs].toSorted((a, b) => a - b);
      for (const y of [...ys].toSorted((a, b) => a - b)) {
        for (const x of columns) {
          const x1 = x + part.width;
          const y1 = y + part.depth;
          if (x < floorX || y < floorY || x1 > -floorX || y1 > -floorY) continue;
          if (
            ![x - spacing, (x + x1) / 2, x1 + spacing].every((px) =>
              [y - spacing, (y + y1) / 2, y1 + spacing].every((py) => onBed(px, py, bed, outline)),
            )
          )
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
