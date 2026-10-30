// Where everything goes, in millimetres: the plan both the solid and the picture on screen are drawn from.
//
// Keeping this apart from the meshes is what makes the flat view and the printed tile agree. The window draws
// the plan on a canvas; the geometry turns the very same plan into solids. Neither can drift from the other.

import { CELL_CORNERS, E, N, S, W, moduleAngles } from "./shapes.js";

/** The smallest fillet a corner is drawn with: a square corner leaves the mesh with edges of no length. */
export const MIN_RADIUS = 0.2;

/** How much of a module the quiet zone is, for each setting. Four is what the standard asks for. */
export const QUIET = { standard: 4, compact: 2, none: 0 };

export const DEFAULTS = {
  level: "M",
  version: "auto",
  sizeBy: "module",
  moduleMm: 2,
  plateMm: 70,
  quiet: "standard",
  baseMm: 1.6,
  modules: "raised",
  codeMm: 1.2,
  inlayMm: 0.6,
  body: "rounded",
  eyeFrame: "default",
  eyeCentre: "default",
  fill: 1,
  relief: "flat",
  shape: "tile",
  cornerMm: 3,
  border: true,
  borderMm: 3.5,
  borderHeightMm: 1.6,
  borderCornerMm: 2,
  tabMm: 14,
  holeMm: 4,
  tabSide: "top",
  tabOffset: 0,
  caption: { text: "", where: "bottom", sizeMm: 6, raiseMm: 0.8, fontId: "pt-sans" },
  patch: { shape: "none", across: 7, scale: 0.8 },
  colours: { base: "#eceff1", code: "#101418", border: "#1e88e5", caption: "#101418", patch: "#1e88e5" },
};

/** How finely a curve is drawn, given how many modules there are to draw: a big code gets plainer shapes. */
export function qualityFor(size) {
  if (size <= 29) return 20;
  if (size <= 45) return 16;
  if (size <= 65) return 12;
  return 8;
}

/**
 * The plan for a code and the settings: the size of everything, which cells are drawn and which were cleared for
 * a logo, where the eyes and the caption sit.
 */
export function planFor(code, state) {
  const size = code.size;
  const quiet = QUIET[state.quiet] ?? QUIET.standard;
  const caption = state.caption?.text?.trim() ? state.caption : null;
  const border = state.border ? Math.max(0.4, state.borderMm) : 0;

  // The code and its quiet zone are square; everything else is measured out from them.
  const captionBand = caption ? Math.max(2, caption.sizeMm) * 1.7 : 0;
  let cell;
  if (state.sizeBy === "plate") {
    cell = Math.max(0.2, (state.plateMm - 2 * border) / (size + 2 * quiet));
  } else {
    cell = Math.max(0.2, state.moduleMm);
  }
  const gridMm = cell * size;
  const quietMm = cell * quiet;
  const inner = gridMm + 2 * quietMm;
  const plateW = inner + 2 * border;
  const plateH = plateW + captionBand;

  const plate = { x0: -plateW / 2, y0: -plateH / 2, x1: plateW / 2, y1: plateH / 2, width: plateW, height: plateH };
  // With a caption the code sits at the far end of the plate from it, so the words have the band to themselves.
  const openingTop = caption?.where === "top" ? plate.y1 - border - captionBand : plate.y1 - border;
  const opening = { x0: -inner / 2, y0: openingTop - inner, x1: inner / 2, y1: openingTop };
  const grid = { x0: -gridMm / 2, y0: opening.y0 + quietMm, width: gridMm };

  const centreOf = (column, row) => [grid.x0 + (column + 0.5) * cell, grid.y0 + gridMm - (row + 0.5) * cell];

  // The middle patch, where a logo goes: the modules under it are cleared, which is what eats into the error
  // correction, so how much was cleared is counted and reported.
  const patchShape = state.patch?.shape ?? "none";
  const across = Math.max(1, Math.min(size - 14, Math.round(state.patch?.across ?? 7)));
  const patch =
    patchShape === "none"
      ? null
      : { shape: patchShape, across, half: (across * cell) / 2, cx: 0, cy: grid.y0 + gridMm / 2 };

  const cleared = new Uint8Array(size * size);
  let clearedCount = 0;
  if (patch) {
    // Every cell the patch so much as touches is cleared, so no module is ever half under the pad. What that
    // leaves, where the pad is round, is a shallow groove round the logo — which is how a logo wants to sit.
    const reach = patch.half + cell * 0.1;
    const halfCell = cell / 2;
    for (let row = 0; row < size; row++) {
      for (let column = 0; column < size; column++) {
        const [x, y] = centreOf(column, row);
        const dx = Math.max(0, Math.abs(x - patch.cx) - halfCell);
        const dy = Math.max(0, Math.abs(y - patch.cy) - halfCell);
        const touches = patch.shape === "circle" ? Math.hypot(dx, dy) <= reach : dx <= reach && dy <= reach;
        if (touches) {
          cleared[row * size + column] = 1;
          if (code.dark(column, row)) clearedCount++;
        }
      }
    }
  }

  // The three eyes, each drawn as one piece rather than as forty-nine modules.
  const eyes = [
    { column: 3, row: 3 },
    { column: size - 4, row: 3 },
    { column: 3, row: size - 4 },
  ].map((eye) => {
    const [x, y] = centreOf(eye.column, eye.row);
    return { ...eye, x, y };
  });

  const inEye = (column, row) => eyes.some((eye) => Math.abs(column - eye.column) <= 3 && Math.abs(row - eye.row) <= 3);

  const drawn = (column, row) =>
    column >= 0 &&
    row >= 0 &&
    column < size &&
    row < size &&
    code.dark(column, row) &&
    !cleared[row * size + column] &&
    !inEye(column, row);

  /** Which of a module's four sides have a drawn neighbour, which is what rounds only the free corners. */
  const neighbours = (column, row) =>
    (drawn(column, row - 1) ? N : 0) |
    (drawn(column + 1, row) ? E : 0) |
    (drawn(column, row + 1) ? S : 0) |
    (drawn(column - 1, row) ? W : 0);

  const points = qualityFor(size);
  const angleCache = new Map();
  /**
   * Which directions a module of this shape, with these neighbours, is sampled in. Cached: a code has at most
   * sixteen kinds of neighbour, and sampling directions is the same work for every one of its modules.
   */
  const anglesFor = (mask, withCellCorners) => {
    const key = `${mask}:${withCellCorners ? 1 : 0}`;
    let angles = angleCache.get(key);
    if (!angles) {
      const own = moduleAngles(state.body, cell, mask, points);
      angles = withCellCorners ? [...new Set([...own, ...CELL_CORNERS])].sort((a, b) => a - b) : own;
      angleCache.set(key, angles);
    }
    return angles;
  };

  const thickness = {
    base: Math.max(0.4, state.baseMm),
    code: state.modules === "flush" ? Math.max(0.2, state.inlayMm) : Math.max(0.2, state.codeMm),
    border: Math.max(0.2, state.borderHeightMm),
    caption: Math.max(0.2, caption?.raiseMm ?? 0.8),
  };

  return {
    size,
    cell,
    quiet,
    quietMm,
    gridMm,
    grid,
    plate,
    opening,
    border,
    captionBand,
    caption,
    patch,
    eyes,
    cleared,
    clearedCount,
    points,
    thickness,
    flush: state.modules === "flush",
    centreOf,
    drawn,
    inEye,
    neighbours,
    anglesFor,
    /** How tall the whole thing stands. */
    get height() {
      return (
        thickness.base +
        Math.max(
          this.flush ? thickness.code : thickness.code,
          state.border ? thickness.border : 0,
          caption ? thickness.caption : 0,
        )
      );
    },
  };
}

/** Where a keyring loop can sit, in the order the window offers them. */
export const TAB_SIDES = ["top", "right", "bottom", "left"];

/**
 * The plate's outline, with the keyring loop where one was asked for, and the hole that goes in it.
 *
 * The loop is a circle standing proud of one edge, spliced into the outline where it crosses that edge: the arc
 * outside the plate stands in for the stretch of edge it covers, so the two are one piece of material with no
 * seam and no corner to catch. It is kept clear of the plate's rounded corners, so the neck always has the full
 * thickness of the edge behind it.
 */
export function plateOutline(plan, state) {
  const radius = Math.max(
    MIN_RADIUS,
    Math.min(state.cornerMm, Math.min(plan.plate.width, plan.plate.height) / 2 - 0.1),
  );
  const ring = roundedRectRing(plan.plate.x0, plan.plate.y0, plan.plate.x1, plan.plate.y1, radius, 8);
  if (state.shape !== "keychain") return { ring, holes: [] };

  const side = TAB_SIDES.includes(state.tabSide) ? state.tabSide : "top";
  const along = side === "top" || side === "bottom" ? plan.plate.width : plan.plate.height;
  const loop = Math.max(5, Math.min(state.tabMm, along * 0.8)) / 2;
  // Enough wall left round the hole to take a split ring without tearing.
  const holeRadius = Math.max(0.8, Math.min(state.holeMm / 2, loop - 1.2));
  // How far the loop's middle stands outside the edge. Less than its own radius, so the two always overlap and
  // the neck is as wide as the overlap makes it.
  const stand = loop * 0.55;
  const halfChord = Math.sqrt(Math.max(0.01, loop * loop - stand * stand));

  // How far the middle of the loop sits along the edge, kept clear of the corners at either end.
  const room = Math.max(0, along / 2 - radius - halfChord - 0.2);
  const offset = (Math.max(-100, Math.min(100, state.tabOffset ?? 0)) / 100) * room;

  // The edge the loop stands on, as a point on it and the two directions: out of the plate, and along it.
  const edges = {
    top: { at: [0, plan.plate.y1], out: [0, 1], run: [1, 0] },
    bottom: { at: [0, plan.plate.y0], out: [0, -1], run: [-1, 0] },
    right: { at: [plan.plate.x1, 0], out: [1, 0], run: [0, -1] },
    left: { at: [plan.plate.x0, 0], out: [-1, 0], run: [0, 1] },
  };
  const { at, out, run } = edges[side];
  const centre = [at[0] + out[0] * stand + run[0] * offset, at[1] + out[1] * stand + run[1] * offset];

  // The arc of the loop that stands outside the plate. The short way round the circle is the part buried in the
  // plate, so the long way is the one to walk, and it is walked the way the ring is: anticlockwise.
  const buried = Math.atan2(-out[1], -out[0]);
  const openAngle = Math.acos(Math.max(-1, Math.min(1, stand / loop)));
  const steps = 28;
  const sweep = Math.PI * 2 - 2 * openAngle;
  const outside = Array.from({ length: steps + 1 }, (_, i) => {
    const angle = buried + openAngle + (sweep * i) / steps;
    return [centre[0] + loop * Math.cos(angle), centre[1] + loop * Math.sin(angle)];
  });

  // The outline is built from its four corners, so the loop's arc simply takes the place of the edge it stands on
  // and can never be spliced in the wrong way round.
  const corners = roundedRectCorners(plan.plate.x0, plan.plate.y0, plan.plate.x1, plan.plate.y1, radius, 8);
  const after = { right: 0, top: 1, left: 2, bottom: 3 }[side];
  return {
    ring: corners.flatMap((corner, i) => (i === after ? [...corner, ...outside] : corner)),
    holes: [circleAt(centre[0], centre[1], holeRadius, 32)],
    tab: { loop, holeRadius, centre, side, stands: loop + stand },
  };
}

/**
 * A rectangle's four rounded corners, anticlockwise from the bottom right, each as its own arc.
 *
 * Kept apart because what lies between two of them is one straight edge, which is where a keyring loop goes.
 */
export function roundedRectCorners(x0, y0, x1, y1, radius, steps = 8) {
  const r = Math.max(MIN_RADIUS, Math.min(radius, (x1 - x0) / 2 - 1e-6, (y1 - y0) / 2 - 1e-6));
  return [
    [x1 - r, y0 + r, -Math.PI / 2],
    [x1 - r, y1 - r, 0],
    [x0 + r, y1 - r, Math.PI / 2],
    [x0 + r, y0 + r, Math.PI],
  ].map(([cx, cy, from]) =>
    Array.from({ length: steps + 1 }, (_, i) => {
      const angle = from + (Math.PI / 2) * (i / steps);
      return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
    }),
  );
}

/** A rectangle with rounded corners, anticlockwise, with the same number of points whatever its size. */
export const roundedRectRing = (x0, y0, x1, y1, radius, steps = 8) =>
  roundedRectCorners(x0, y0, x1, y1, radius, steps).flat();

/** A circle, anticlockwise. */
export const circleAt = (cx, cy, radius, points = 32) =>
  Array.from({ length: points }, (_, i) => {
    const angle = (i / points) * Math.PI * 2;
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
  });

/** The runs of drawn cells in a row, so a code of plain squares is a handful of boxes rather than thousands. */
export function darkRuns(plan, row) {
  const runs = [];
  let from = -1;
  for (let column = 0; column <= plan.size; column++) {
    const drawn = column < plan.size && plan.drawn(column, row);
    if (drawn && from < 0) from = column;
    if (!drawn && from >= 0) {
      runs.push([from, column - 1]);
      from = -1;
    }
  }
  return runs;
}

/** The runs of light cells in a row, as `[from, to]` pairs, so the light part of a flush code is few boxes. */
export function lightRuns(plan, row) {
  const runs = [];
  let from = -1;
  for (let column = 0; column <= plan.size; column++) {
    const light =
      column < plan.size &&
      !plan.drawn(column, row) &&
      !plan.inEye(column, row) &&
      !plan.cleared[row * plan.size + column];
    if (light && from < 0) from = column;
    if (!light && from >= 0) {
      runs.push([from, column - 1]);
      from = -1;
    }
  }
  return runs;
}
