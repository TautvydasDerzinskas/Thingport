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
//
// A shape also sees which of its sides have a neighbour, and that is what joins modules up: a bar reaches the full
// width of its cell along its run, so the next cell's bar meets it exactly, and is only shaped at the end where
// the run stops. Nothing is ever cut against anything else.

/** The eight module shapes, in the order the window offers them. */
export const BODIES = ["square", "rounded", "dot", "bevel", "bars", "columns", "roundBars", "roundColumns"];
/** The outer ring of the three big eyes. `default` is whichever suits the module shape. */
export const EYE_FRAMES = ["default", "square", "rounded", "soft", "circle"];
/** The pupil inside them. */
export const EYE_CENTRES = ["default", "square", "rounded", "soft", "circle"];
/** How the tops are shaped, across the code. */
export const RELIEFS = ["flat", "bevel", "dome", "pyramid", "ripple", "ramp", "terraces", "saddle"];

/** What `default` means for an eye: the shape that belongs with the modules around it. */
const EYES_FOR_BODY = {
  square: "square",
  bars: "square",
  columns: "square",
  rounded: "rounded",
  bevel: "rounded",
  roundBars: "soft",
  roundColumns: "soft",
  dot: "circle",
};

/** The eye shape a body asks for, where the window is left on `default`. */
export const eyesFor = (body) => EYES_FOR_BODY[body] ?? "square";

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

/** How much of its cell a bar fills across its run: the gap left over is what makes a row read as a row. */
const BAR = 0.86;
/** How much of a cell a rounded corner takes. */
const ROUND = 0.32;
/** How much a bevelled corner cuts off. */
const BEVEL = 0.34;

/**
 * A module as a rectangle in its cell, each corner either square, rounded by a radius or cut off at 45°.
 *
 * Corners are listed anticlockwise from the one at +x +y, so a shape can round one and leave the next square.
 * Only a corner that stands free is ever shaped: a run of modules is then smooth on the outside and solid where
 * one meets the next.
 */
function profileOf(kind, cell, neighbours) {
  const shape = BODIES.includes(kind) ? kind : "square";
  const half = cell / 2;
  const square = [0, 0, 0, 0];
  const free = (a, b) => ((neighbours & a) === 0 && (neighbours & b) === 0 ? 1 : 0);
  const corners = [free(N, E), free(N, W), free(S, W), free(S, E)];

  if (shape === "dot") return { halfX: half, halfY: half, radii: [half, half, half, half], cuts: square };
  if (shape === "rounded")
    return { halfX: half, halfY: half, radii: corners.map((on) => on * cell * ROUND), cuts: square };
  if (shape === "bevel")
    return { halfX: half, halfY: half, radii: square, cuts: corners.map((on) => on * cell * BEVEL) };
  if (shape === "bars" || shape === "roundBars") {
    // Full width, so the next cell's bar meets this one; thinner than its cell, so the row above stays a row of
    // its own. A round bar closes with a half-circle where the run ends.
    const halfY = half * BAR;
    const end = (side) => (shape === "roundBars" && (neighbours & side) === 0 ? halfY : 0);
    return { halfX: half, halfY, radii: [end(E), end(W), end(W), end(E)], cuts: square };
  }
  if (shape === "columns" || shape === "roundColumns") {
    const halfX = half * BAR;
    const end = (side) => (shape === "roundColumns" && (neighbours & side) === 0 ? halfX : 0);
    return { halfX, halfY: half, radii: [end(N), end(N), end(S), end(S)], cuts: square };
  }
  return { halfX: half, halfY: half, radii: square, cuts: square };
}

/** Which quadrant a direction is in, numbered anticlockwise from +x +y. */
const quadrantOf = (cos, sin) => (cos >= 0 ? (sin >= 0 ? 0 : 3) : sin >= 0 ? 1 : 2);

/**
 * How far a profile's edge lies in a direction.
 *
 * The ray leaves through a flat side, through a corner's arc, or across a corner's cut; which one is settled by
 * where the flat sides would be met.
 */
function edgeOf(cos, sin, shape) {
  const { halfX, halfY } = shape;
  const quadrant = quadrantOf(cos, sin);
  const radius = Math.max(0, Math.min(halfX, halfY, shape.radii[quadrant]));
  const cut = Math.max(0, Math.min(halfX, halfY, shape.cuts[quadrant]));
  if (radius > 1e-9) {
    const innerX = halfX - radius;
    const innerY = halfY - radius;
    if (Math.abs(cos) > 1e-12) {
      const t = halfX / Math.abs(cos);
      if (Math.abs(t * sin) <= innerY + 1e-12) return t;
    }
    if (Math.abs(sin) > 1e-12) {
      const t = halfY / Math.abs(sin);
      if (Math.abs(t * cos) <= innerX + 1e-12) return t;
    }
    const cx = Math.sign(cos || 1) * innerX;
    const cy = Math.sign(sin || 1) * innerY;
    const along = cos * cx + sin * cy;
    return along + Math.sqrt(Math.max(0, along * along - (cx * cx + cy * cy) + radius * radius));
  }
  const flat = toRect(cos, sin, halfX, halfY);
  // The cut is the line through (halfX - cut, halfY) and (halfX, halfY - cut), which is |x| + |y| = the sum less
  // the cut; whichever of it and the sides is met first is the edge.
  if (cut > 1e-9) return Math.min(flat, (halfX + halfY - cut) / (Math.abs(cos) + Math.abs(sin)));
  return flat;
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

/** A direction in the first quadrant, which is where every corner is worked out before being put back in place. */
const cornerTurn = (x, y) => Math.atan2(Math.abs(y), Math.abs(x));

/** That direction, mirrored into the quadrant it belongs to. */
const inQuadrant = (quadrant, turn) =>
  quadrant === 0 ? turn : quadrant === 1 ? Math.PI - turn : quadrant === 2 ? Math.PI + turn : TAU - turn;

/** Which directions a profile has to be sampled in: its corners, and enough points along any arc. */
function profileAngles(shape, points) {
  const { halfX, halfY } = shape;
  const steps = Math.max(2, Math.round(points / 4));
  const angles = [];
  for (let quadrant = 0; quadrant < 4; quadrant++) {
    const radius = Math.max(0, Math.min(halfX, halfY, shape.radii[quadrant]));
    const cut = Math.max(0, Math.min(halfX, halfY, shape.cuts[quadrant]));
    const at = (x, y) => inQuadrant(quadrant, cornerTurn(x, y));
    if (radius > 1e-9) {
      angles.push(...arcAngles(at(halfX, halfY - radius), at(halfX - radius, halfY), steps));
    } else if (cut > 1e-9) {
      angles.push(at(halfX, halfY - cut), at(halfX - cut, halfY));
    } else {
      angles.push(at(halfX, halfY));
    }
  }
  return tidyAngles(angles);
}

/**
 * Which directions a module of this shape, with these neighbours, is sampled in.
 *
 * `points` is how finely a whole circle would be drawn; a corner's arc gets its share of that.
 */
export function moduleAngles(kind, cell, neighbours = 0, points = 24) {
  return profileAngles(profileOf(kind, cell, neighbours), points);
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
  const shape = profileOf(kind, cell, neighbours);
  const directions = angles ?? profileAngles(shape, 24);
  return radialRing((cos, sin) => edgeOf(cos, sin, shape) * fill, cx, cy, directions);
}

/** A whole cell as a ring, sampled in the same directions as the shape it surrounds. */
export const cellRing = (cx, cy, cell, angles = CELL_CORNERS) =>
  radialRing((cos, sin) => toSquare(cos, sin, cell / 2), cx, cy, angles);

/** How round each eye shape is, as a share of half the ring it is drawn on. */
const EYE_ROUNDING = { square: 0, rounded: 0.45, soft: 0.75, circle: 1 };

/**
 * The rings one of the three big eyes is drawn from: the block of cells it fills, the outside and inside of its
 * frame, and its pupil — all sampled in the same directions, so the light between any two of them is a band.
 *
 * `body` is the module shape, which is what `default` follows.
 */
export function eyeRings(frame, centre, cx, cy, cell, body = "square", points = 64) {
  const pick = (kinds, kind) => {
    const wanted = kinds.includes(kind) ? kind : "default";
    return wanted === "default" ? eyesFor(body) : wanted;
  };
  const style = pick(EYE_FRAMES, frame);
  const pupilStyle = pick(EYE_CENTRES, centre);
  const angles = tidyAngles([...arcAngles(0, TAU, points).slice(0, -1), ...CELL_CORNERS]);
  const outer = cell * 3.5;
  const inner = cell * 2.5;
  const pupil = cell * 1.5;

  const shape = (half, kind) => {
    const share = EYE_ROUNDING[kind] ?? 0;
    if (share >= 1) return radialRing(() => half, cx, cy, angles);
    if (share <= 0) return radialRing((cos, sin) => toSquare(cos, sin, half), cx, cy, angles);
    const radius = half * share;
    const profile = { halfX: half, halfY: half, radii: [radius, radius, radius, radius], cuts: [0, 0, 0, 0] };
    return radialRing((cos, sin) => edgeOf(cos, sin, profile), cx, cy, angles);
  };

  return {
    block: radialRing((cos, sin) => toSquare(cos, sin, outer), cx, cy, angles),
    frameOuter: shape(outer, style),
    frameInner: shape(inner, style),
    pupilOuter: shape(pupil, pupilStyle),
  };
}

// ---- relief ----------------------------------------------------------------------------------------------------

/**
 * How tall a module stands, where the relief varies across the code rather than within a module.
 *
 * `ripple` runs rings of height out from the middle, `terraces` steps those rings flat, `ramp` climbs from one
 * corner to the other and `saddle` falls away one way while it rises the other; the rest stand the same height
 * everywhere and are shaped at the top instead.
 */
export function reliefHeight(style, height, column, row, size) {
  const reach = Math.max(1, size / 2);
  const dx = (column - (size - 1) / 2) / reach;
  const dy = (row - (size - 1) / 2) / reach;
  if (style === "ripple") return height * (0.55 + 0.45 * Math.cos(Math.hypot(dx, dy) * Math.PI * 2.2));
  if (style === "terraces") {
    // Layered contours: the same rings as a ripple, flattened into steps a printer lays down cleanly.
    const steps = 4;
    const level = Math.min(steps - 1, Math.floor(Math.min(1, Math.hypot(dx, dy)) * steps));
    return height * (1 - (0.55 * level) / (steps - 1));
  }
  if (style === "saddle") {
    // A valley across the middle one way and a rise the other, as a saddle does.
    return height * (0.42 + 0.58 * Math.min(1, Math.max(0, (dx * dx - dy * dy + 1) / 2)));
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
