// The shapes a module can be, and the relief that lifts them.
//
// Every shape is written as how far its edge lies from the middle of its cell in a given direction. That one form
// does all the work the tool needs: a ring of points for the mesh, the same ring for the picture on screen, a fan
// of triangles for a top face, and — because a cell and the shape inside it can be sampled in the very same
// directions — the band of light around a dark dot, without ever subtracting one shape from another. That is what
// keeps a code of ten thousand modules quick.
//
// A shape is always inside its cell and always star-shaped about the middle, which is what makes the fan and the
// band sound. Where a shape has corners, the directions of those corners are always among the ones sampled, so a
// square comes out square and not as an eight-sided approximation of one.

/** The eight module shapes, in the order the window offers them. */
export const BODIES = ["square", "rounded", "connected", "dot", "diamond", "leaf", "plus", "bar"];
/** The outer ring of the three big eyes. */
export const EYE_FRAMES = ["square", "rounded", "circle", "leaf"];
/** The pupil inside them. */
export const EYE_CENTRES = ["square", "rounded", "circle", "dot"];
/** How the tops are shaped, across the code. */
export const RELIEFS = ["flat", "bevel", "dome", "pyramid", "ripple", "ramp"];

/** Which way each neighbour lies, as bits, so a shape can round only the corners that stand free. */
export const N = 1;
export const E = 2;
export const S = 4;
export const W = 8;

const TAU = Math.PI * 2;
/** Which way a cell's own corners lie: a band has to be cut at these, or it would miss them. */
export const CELL_CORNERS = [0.25, 0.75, 1.25, 1.75].map((turn) => turn * Math.PI);

/** How far a square's edge is, in a direction. */
const toSquare = (cos, sin, half) => half / Math.max(Math.abs(cos), Math.abs(sin));

/** How far a rectangle's edge is, in a direction. */
const toRect = (cos, sin, halfX, halfY) =>
  Math.min(
    Math.abs(cos) < 1e-12 ? Infinity : halfX / Math.abs(cos),
    Math.abs(sin) < 1e-12 ? Infinity : halfY / Math.abs(sin),
  );

/**
 * How far the edge of a square with rounded corners is, in a direction.
 *
 * The ray leaves either through a flat side or through a corner's arc; which one is settled by where the flat
 * side would be met. `corners` is each corner's radius, anticlockwise from the one at +x +y, so a shape can round
 * one corner and leave the next square.
 */
function toRounded(cos, sin, half, corners) {
  const quadrant = cos >= 0 ? (sin >= 0 ? 0 : 3) : sin >= 0 ? 1 : 2;
  const radius = Math.max(0, Math.min(half, corners[quadrant]));
  if (radius < 1e-9) return toSquare(cos, sin, half);
  const inner = half - radius;
  if (Math.abs(cos) > 1e-12) {
    const t = half / Math.abs(cos);
    if (Math.abs(t * sin) <= inner + 1e-12) return t;
  }
  if (Math.abs(sin) > 1e-12) {
    const t = half / Math.abs(sin);
    if (Math.abs(t * cos) <= inner + 1e-12) return t;
  }
  const cx = Math.sign(cos || 1) * inner;
  const cy = Math.sign(sin || 1) * inner;
  const along = cos * cx + sin * cy;
  return along + Math.sqrt(Math.max(0, along * along - (cx * cx + cy * cy) + radius * radius));
}

/** How wide a plus's arms are, as a share of its cell. */
const ARM = 0.52;

/** Each corner's radius, anticlockwise from +x +y. */
function cornersFor(kind, cell, neighbours) {
  const half = cell / 2;
  if (kind === "rounded") return [0.34, 0.34, 0.34, 0.34].map((share) => share * cell);
  if (kind === "leaf") return [half, 0, half, 0];
  if (kind === "connected") {
    // A corner is rounded only where both the sides meeting there stand free, so a run of modules reads as one
    // smooth band and a lone module as a rounded square.
    const free = (a, b) => (neighbours & a) === 0 && (neighbours & b) === 0;
    return [free(N, E) ? half : 0, free(N, W) ? half : 0, free(S, W) ? half : 0, free(S, E) ? half : 0];
  }
  if (kind === "bar") {
    // Rounded at the ends of a horizontal run, square where the run carries on.
    const right = (neighbours & E) !== 0;
    const left = (neighbours & W) !== 0;
    return [right ? 0 : half, left ? 0 : half, left ? 0 : half, right ? 0 : half];
  }
  return [0, 0, 0, 0];
}

/** How far a module's edge is from the middle of its cell, in a direction. */
function moduleRadius(kind, cos, sin, cell, neighbours) {
  const half = cell / 2;
  if (kind === "dot") return half;
  if (kind === "diamond") return half / (Math.abs(cos) + Math.abs(sin) || 1);
  if (kind === "plus") return Math.max(toRect(cos, sin, half, half * ARM), toRect(cos, sin, half * ARM, half));
  return toRounded(cos, sin, half, cornersFor(kind, cell, neighbours));
}

const turnOf = (x, y) => {
  const angle = Math.atan2(y, x);
  return angle < 0 ? angle + TAU : angle;
};

/** Angles in order, with the ones that land on each other dropped. */
function tidyAngles(angles) {
  const sorted = [...angles].map((angle) => ((angle % TAU) + TAU) % TAU).sort((a, b) => a - b);
  return sorted.filter((angle, i) => i === 0 || angle - sorted[i - 1] > 1e-7);
}

/** An arc's worth of angles, enough of them that the curve is smooth at the size it's drawn. */
function arcAngles(from, to, steps) {
  const out = [];
  for (let i = 0; i <= steps; i++) out.push(from + ((to - from) * i) / steps);
  return out;
}

/**
 * Which directions a shape has to be sampled in: its corners, and enough points along its curves.
 *
 * `points` is how finely a whole circle would be drawn; a corner's arc gets its share of that.
 */
export function moduleAngles(kind, cell, neighbours = 0, points = 24) {
  const shape = BODIES.includes(kind) ? kind : "square";
  if (shape === "dot") return tidyAngles(arcAngles(0, TAU, Math.max(8, points)).slice(0, -1));
  if (shape === "diamond") return [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
  if (shape === "plus") {
    const half = cell / 2;
    const arm = half * ARM;
    return tidyAngles([
      ...[
        [half, arm],
        [arm, arm],
        [arm, half],
      ].flatMap(([x, y]) => [turnOf(x, y), turnOf(-x, y), turnOf(-x, -y), turnOf(x, -y)]),
    ]);
  }
  const corners = cornersFor(shape, cell, neighbours);
  const steps = Math.max(2, Math.round(points / 4));
  const angles = [];
  for (let quadrant = 0; quadrant < 4; quadrant++) {
    const from = (quadrant * Math.PI) / 2;
    const corner = from + Math.PI / 4;
    if (corners[quadrant] < 1e-9) angles.push(corner);
    else angles.push(...arcAngles(corner - Math.PI / 4 + 1e-6, corner + Math.PI / 4 - 1e-6, steps));
  }
  return tidyAngles(angles);
}

/** A closed ring, anticlockwise, from a radial function sampled in the directions given. */
function radialRing(radius, cx, cy, angles) {
  return angles.map((angle) => {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const r = radius(cos, sin);
    return [cx + r * cos, cy + r * sin];
  });
}

/** One module as a ring. `fill` shrinks or swells the shape within its cell. */
export function moduleRing(kind, cx, cy, cell, neighbours = 0, angles = null, fill = 1) {
  const shape = BODIES.includes(kind) ? kind : "square";
  const directions = angles ?? moduleAngles(shape, cell, neighbours);
  return radialRing((cos, sin) => moduleRadius(shape, cos, sin, cell, neighbours) * fill, cx, cy, directions);
}

/** A whole cell as a ring, sampled in the same directions as the shape it surrounds. */
export const cellRing = (cx, cy, cell, angles = CELL_CORNERS) =>
  radialRing((cos, sin) => toSquare(cos, sin, cell / 2), cx, cy, angles);

/**
 * The rings one of the three big eyes is drawn from: the block of cells it fills, the outside and inside of its
 * frame, and its pupil — all sampled in the same directions, so the light between any two of them is a band.
 *
 * `towards` says which way the middle of the code lies, so a leaf keeps the corner that points outwards square.
 */
export function eyeRings(frame, centre, cx, cy, cell, towards, points = 64) {
  const style = EYE_FRAMES.includes(frame) ? frame : "square";
  const pupilStyle = EYE_CENTRES.includes(centre) ? centre : "square";
  const angles = tidyAngles([...arcAngles(0, TAU, points).slice(0, -1), ...CELL_CORNERS]);
  const outer = cell * 3.5;
  const inner = cell * 2.5;
  const pupil = cell * 1.5;

  // Which quadrant faces away from the middle of the code: the one a leaf leaves square.
  const away = turnOf(-towards[0], -towards[1]);
  const squareQuadrant = Math.floor(((away + TAU - Math.PI / 4) % TAU) / (Math.PI / 2));
  const leafRadii = (radius) => [0, 1, 2, 3].map((quadrant) => (quadrant === squareQuadrant ? 0 : radius));

  const shape = (half, radius, kind) => {
    if (kind === "circle") return radialRing(() => half, cx, cy, angles);
    if (kind === "square") return radialRing((cos, sin) => toSquare(cos, sin, half), cx, cy, angles);
    if (kind === "leaf") {
      const radii = leafRadii(radius);
      return radialRing((cos, sin) => toRounded(cos, sin, half, radii), cx, cy, angles);
    }
    const radii = [radius, radius, radius, radius];
    return radialRing((cos, sin) => toRounded(cos, sin, half, radii), cx, cy, angles);
  };

  return {
    block: radialRing((cos, sin) => toSquare(cos, sin, outer), cx, cy, angles),
    frameOuter: shape(
      outer,
      cell * 1.8,
      style === "circle" ? "circle" : style === "square" ? "square" : style === "leaf" ? "leaf" : "rounded",
    ),
    frameInner: shape(
      inner,
      cell * 1.3,
      style === "circle" ? "circle" : style === "square" ? "square" : style === "leaf" ? "leaf" : "rounded",
    ),
    pupilOuter: shape(
      pupilStyle === "dot" ? pupil * 0.82 : pupil,
      cell * 0.5,
      pupilStyle === "circle" || pupilStyle === "dot" ? "circle" : pupilStyle === "square" ? "square" : "rounded",
    ),
  };
}

// ---- relief ----------------------------------------------------------------------------------------------------

/**
 * How tall a module stands, where the relief varies across the code rather than within a module.
 *
 * `ripple` runs rings of height out from the middle and `ramp` climbs from one corner to the other; the rest
 * stand the same height everywhere and are shaped at the top instead.
 */
export function reliefHeight(style, height, column, row, size) {
  if (style === "ripple") {
    const dx = column - (size - 1) / 2;
    const dy = row - (size - 1) / 2;
    const away = Math.hypot(dx, dy) / Math.max(1, size / 2);
    return height * (0.55 + 0.45 * Math.cos(away * Math.PI * 2.2));
  }
  if (style === "ramp") return height * (0.4 + (0.6 * (column + row)) / Math.max(1, 2 * (size - 1)));
  return height;
}

/**
 * The levels a module's walls step through, from its bottom to its top: `scale` shrinks the ring about the middle
 * of the cell, `z` is how far up that ring sits. The last level is the top face, unless `apex` is given, where
 * the shape closes to a point instead.
 */
export function reliefLevels(style, height, cell) {
  if (style === "bevel") {
    const chamfer = Math.min(cell * 0.18, height * 0.6);
    const scale = Math.max(0.25, 1 - (chamfer * 2) / cell);
    return {
      levels: [
        { scale: 1, z: 0 },
        { scale: 1, z: height - chamfer },
        { scale, z: height },
      ],
      apex: false,
    };
  }
  if (style === "dome") {
    const cap = Math.min(cell * 0.5, height * 0.75);
    const steps = 4;
    const levels = [
      { scale: 1, z: 0 },
      { scale: 1, z: height - cap },
    ];
    for (let i = 1; i <= steps; i++) {
      const angle = (i / steps) * (Math.PI / 2);
      levels.push({ scale: Math.max(0.0001, Math.cos(angle)), z: height - cap + Math.sin(angle) * cap });
    }
    return { levels, apex: false };
  }
  if (style === "pyramid") {
    const tip = Math.min(cell * 0.75, height * 0.85);
    return {
      levels: [
        { scale: 1, z: 0 },
        { scale: 1, z: height - tip },
      ],
      apex: { z: height },
    };
  }
  return {
    levels: [
      { scale: 1, z: 0 },
      { scale: 1, z: height },
    ],
    apex: false,
  };
}
