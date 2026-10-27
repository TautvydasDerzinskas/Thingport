// Gridfinity parts as triangle meshes, and binary STL. Every shell is closed and wound outward, so a part slices as
// it's drawn; a part made of several shells (a bin's feet, its body, its dividers) overlaps them slightly rather than
// letting faces touch, which slicers join cleanly.
//
// Sizes follow the Gridfinity system (Zack Freedman's, MIT): a 42 mm cell, bins 0.5 mm smaller than their cells,
// 7 mm height units, and the stepped profile that seats a bin's feet in the baseplate's pockets.

export const CELL = 42;
export const HEIGHT_UNIT = 7;
/** A bin is this much narrower than the cells it covers, so it drops into them. */
const BIN_CLEARANCE = 0.5;

// A bin's foot, from the bottom: a 0.8 mm chamfer, 1.8 mm straight, a 2.15 mm chamfer, as [height, inset, radius]
// from the full 41.5 mm size and 3.75 mm corner.
const FOOT = [
  [0, 2.95, 0.8],
  [0.8, 2.15, 1.6],
  [2.6, 2.15, 1.6],
  [4.75, 0, 3.75],
];
const FOOT_TOP = 4.75;
const BIN_RADIUS = 3.75;
const WALL = 1.2;
const FLOOR_TOP = 6;
const DIVIDER = 1.2;

// A baseplate pocket, from the bottom: 0.7 mm chamfer, 1.8 mm straight, 2.15 mm chamfer. Its opening is 41.9 mm rather
// than the cell's full 42, so neighbouring pockets keep a ridge between them.
const POCKET_OPENING = 41.9;
const POCKET = [
  [0, 2.85, 1.1],
  [0.7, 2.15, 1.8],
  [2.5, 2.15, 1.8],
  [4.65, 0, 3.95],
];
export const BASEPLATE_HEIGHT = 4.65;

// Points on each rounded corner; more is smoother and heavier.
const ARC = 6;

/** A rounded rectangle centred on (cx, cy), counter-clockwise: four arcs of ARC + 1 points, starting at the
 *  bottom-right corner's lowest point. */
function roundedRect(cx, cy, w, h, r) {
  const hw = w / 2;
  const hh = h / 2;
  const corners = [
    [cx + hw - r, cy - hh + r, -Math.PI / 2],
    [cx + hw - r, cy + hh - r, 0],
    [cx - hw + r, cy + hh - r, Math.PI / 2],
    [cx - hw + r, cy - hh + r, Math.PI],
  ];
  const points = [];
  for (const [ox, oy, start] of corners)
    for (let i = 0; i <= ARC; i++) {
      const a = start + (i / ARC) * (Math.PI / 2);
      points.push([ox + r * Math.cos(a), oy + r * Math.sin(a)]);
    }
  return points;
}

const at = (points, z) => points.map(([x, y]) => [x, y, z]);

class Mesh {
  constructor() {
    this.triangles = [];
  }
  tri(a, b, c) {
    this.triangles.push([a, b, c]);
  }
  quad(a, b, c, d) {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }
  /** A convex polygon (counter-clockwise from above), facing up or down. */
  cap(loop, up) {
    for (let i = 1; i < loop.length - 1; i++)
      if (up) this.tri(loop[0], loop[i], loop[i + 1]);
      else this.tri(loop[0], loop[i + 1], loop[i]);
  }
  /** The band between two loops of as many points, the lower first; facing out, or in for a hole's walls. */
  wall(lower, upper, out = true) {
    const n = lower.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (out) this.quad(lower[i], lower[j], upper[j], upper[i]);
      else this.quad(lower[j], lower[i], upper[i], upper[j]);
    }
  }
  /** The flat band between an outer and an inner loop of as many points, facing up or down. */
  band(outer, inner, up) {
    const n = outer.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (up) this.quad(outer[i], outer[j], inner[j], inner[i]);
      else this.quad(outer[j], outer[i], inner[i], inner[j]);
    }
  }
  /** A closed box. */
  box(x0, y0, z0, x1, y1, z1) {
    const bottom = [
      [x0, y0, z0],
      [x1, y0, z0],
      [x1, y1, z0],
      [x0, y1, z0],
    ];
    const top = bottom.map(([x, y]) => [x, y, z1]);
    this.cap(bottom, false);
    this.cap(top, true);
    this.wall(bottom, top);
  }
}

/** A loft of rounded rectangles, closed at both ends: a bin's foot. */
function solidLoft(mesh, cx, cy, w, h, profile) {
  const loops = profile.map(([z, inset, r]) => at(roundedRect(cx, cy, w - 2 * inset, h - 2 * inset, r), z));
  mesh.cap(loops[0], false);
  for (let i = 0; i < loops.length - 1; i++) mesh.wall(loops[i], loops[i + 1]);
  mesh.cap(loops[loops.length - 1], true);
}

/**
 * The flat region between a rectangle and a rounded rectangle inside it, as the top or bottom of a baseplate cell:
 * the rectangle's corners each fan to their arc, and its sides meet the rounded rectangle's straight sides square on.
 * Returns the rectangle's boundary as each side's points in counter-clockwise order (bottom, right, top, left), for
 * the walls of a tile's outside.
 */
function rectAroundRounded(mesh, rect, inner, z, up) {
  const [x0, y0, x1, y1] = rect;
  const arcs = [0, 1, 2, 3].map((k) => inner.slice(k * (ARC + 1), (k + 1) * (ARC + 1)).map(([x, y]) => [x, y, z]));
  const corners = [
    [x1, y0, z],
    [x1, y1, z],
    [x0, y1, z],
    [x0, y0, z],
  ];
  // Where each arc's ends meet the rectangle: square on, on the side each end lies along.
  const project = (point, side) =>
    side === "bottom"
      ? [point[0], y0, z]
      : side === "right"
        ? [x1, point[1], z]
        : side === "top"
          ? [point[0], y1, z]
          : [x0, point[1], z];
  const before = ["bottom", "right", "top", "left"];
  const after = ["right", "top", "left", "bottom"];
  const starts = arcs.map((arc, k) => project(arc[0], before[k]));
  const ends = arcs.map((arc, k) => project(arc[ARC], after[k]));
  const t = (a, b, c) => (up ? mesh.tri(a, b, c) : mesh.tri(a, c, b));
  for (let k = 0; k < 4; k++) {
    const c = corners[k];
    const arc = arcs[k];
    t(c, ends[k], arc[ARC]);
    for (let i = ARC - 1; i >= 0; i--) t(c, arc[i + 1], arc[i]);
    t(c, arc[0], starts[k]);
    // The straight stretch to the next corner.
    const next = (k + 1) % 4;
    t(ends[k], starts[next], arcs[next][0]);
    t(ends[k], arcs[next][0], arc[ARC]);
  }
  // Each side of the rectangle, from corner to corner.
  return [0, 1, 2, 3].map((k) => {
    const prev = (k + 3) % 4;
    return [corners[prev], ends[prev], starts[k], corners[k]];
  });
}

/**
 * A baseplate tile of `cols` × `rows` pockets, `pitchX` × `pitchY` mm apart (42 for Gridfinity, more when cells are
 * stretched to fill a drawer), with a flat border of `pad` mm on each side, [left, right, bottom, top], filling the
 * drawer's leftover space along its walls. Open at the bottom, as a light baseplate, so it prints fast and lies flat.
 * Its corner is at the origin.
 */
export function baseplateTile({ cols, rows, pitchX = CELL, pitchY = CELL, pad = [0, 0, 0, 0] }) {
  const mesh = new Mesh();
  const [left, right, bottom, topPad] = pad;
  // Grid lines, then the outermost moved out by the border.
  const gx = Array.from({ length: cols + 1 }, (_, i) => left + i * pitchX);
  const gy = Array.from({ length: rows + 1 }, (_, j) => bottom + j * pitchY);
  const xs = [0, ...gx.slice(1, -1), gx[cols] + right];
  const ys = [0, ...gy.slice(1, -1), gy[rows] + topPad];
  const outline = [[], [], [], []];
  for (let col = 0; col < cols; col++)
    for (let row = 0; row < rows; row++) {
      const rect = [xs[col], ys[row], xs[col + 1], ys[row + 1]];
      const cx = (gx[col] + gx[col + 1]) / 2;
      const cy = (gy[row] + gy[row + 1]) / 2;
      const levels = POCKET.map(([z, inset, r]) =>
        at(roundedRect(cx, cy, POCKET_OPENING - 2 * inset, POCKET_OPENING - 2 * inset, r), z),
      );
      const topSides = rectAroundRounded(mesh, rect, levels[levels.length - 1], BASEPLATE_HEIGHT, true);
      const bottomSides = rectAroundRounded(mesh, rect, levels[0], 0, false);
      for (let i = 0; i < levels.length - 1; i++) mesh.wall(levels[i], levels[i + 1], false);
      // The tile's outside: only the sides of cells on its edge (bottom, right, top, left).
      const onEdge = [row === 0, col === cols - 1, row === rows - 1, col === 0];
      onEdge.forEach((edge, k) => {
        if (edge) outline[k].push([bottomSides[k], topSides[k]]);
      });
    }
  for (const side of outline)
    for (const [lower, upper] of side)
      for (let i = 0; i < lower.length - 1; i++) mesh.quad(lower[i], lower[i + 1], upper[i + 1], upper[i]);
  return mesh.triangles;
}

/**
 * A bin `w` × `d` cells of `pitchX` × `pitchY` mm, `units` × 7 mm tall, with `across` × `along` compartments.
 * Its corner is at the origin; it stands on its feet, one under each cell.
 */
export function bin({ w, d, units, across = 1, along = 1, pitchX = CELL, pitchY = CELL }) {
  const mesh = new Mesh();
  const outerW = w * pitchX - BIN_CLEARANCE;
  const outerD = d * pitchY - BIN_CLEARANCE;
  const height = units * HEIGHT_UNIT;
  const foot = CELL - BIN_CLEARANCE;
  for (let i = 0; i < w; i++)
    for (let j = 0; j < d; j++) solidLoft(mesh, (i + 0.5) * pitchX, (j + 0.5) * pitchY, foot, foot, FOOT);

  // The body: a cup whose bottom sinks a little into the feet, so the shells overlap.
  const cx = (w * pitchX) / 2;
  const cy = (d * pitchY) / 2;
  const bottomZ = FOOT_TOP - 0.15;
  const outer = roundedRect(cx, cy, outerW, outerD, BIN_RADIUS);
  const inner = roundedRect(cx, cy, outerW - 2 * WALL, outerD - 2 * WALL, Math.max(0.5, BIN_RADIUS - WALL));
  mesh.cap(at(outer, bottomZ), false);
  mesh.wall(at(outer, bottomZ), at(outer, height));
  mesh.band(at(outer, height), at(inner, height), true);
  mesh.wall(at(inner, FLOOR_TOP), at(inner, height), false);
  mesh.cap(at(inner, FLOOR_TOP), true);

  // Dividers, into the floor and walls a little, and a millimetre under the rim.
  const x0 = cx - outerW / 2 + WALL;
  const x1 = cx + outerW / 2 - WALL;
  const y0 = cy - outerD / 2 + WALL;
  const y1 = cy + outerD / 2 - WALL;
  const dividerTop = height - 1;
  for (let i = 1; i < across; i++) {
    const x = x0 + ((x1 - x0) * i) / across;
    mesh.box(x - DIVIDER / 2, y0 - 0.3, FLOOR_TOP - 0.2, x + DIVIDER / 2, y1 + 0.3, dividerTop);
  }
  for (let j = 1; j < along; j++) {
    const y = y0 + ((y1 - y0) * j) / along;
    mesh.box(x0 - 0.3, y - DIVIDER / 2, FLOOR_TOP - 0.2, x1 + 0.3, y + DIVIDER / 2, dividerTop);
  }
  return mesh.triangles;
}

/** Binary STL of triangles, with normals from their winding. */
export function stl(triangles, name = "thingport") {
  const buffer = new ArrayBuffer(84 + 50 * triangles.length);
  const view = new DataView(buffer);
  const header = `${name} - made with Thingport`.slice(0, 80);
  for (let i = 0; i < header.length; i++) view.setUint8(i, header.charCodeAt(i) & 0x7f);
  view.setUint32(80, triangles.length, true);
  let offset = 84;
  for (const [a, b, c] of triangles) {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const length = Math.hypot(n[0], n[1], n[2]) || 1;
    for (const value of [n[0] / length, n[1] / length, n[2] / length, ...a, ...b, ...c]) {
      view.setFloat32(offset, value, true);
      offset += 4;
    }
    offset += 2;
  }
  return buffer;
}
