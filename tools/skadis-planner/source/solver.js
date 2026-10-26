// Works out which boards to print to fill a wall.
//
// Each axis is solved on its own and the two are crossed into a grid, because a Skadis board's slots line up on a
// fixed pitch: a column of boards has to share a width, or the slots stop matching across the seam.
//
// Everything is counted in pitch units rather than millimetres, which is what makes the arithmetic exact: a board
// with h holes is h + 1 units long, so a wall of `avail` units is covered exactly when the parts sum to `avail`,
// with no rounding anywhere.

import { MAX_HOLES, MIN_HOLES, PITCH_MM, boardExists, holesFor, needsMirror, sizeMm } from "./catalogue.js";

/** Something the wall or the bed makes impossible, with a message written for the person planning. */
export class PlanError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/* ------------------------------------------------------------ partitions */

/**
 * Every way to write `total` as `parts` numbers in [min, max], largest first. The counts here are small — a wall is
 * a handful of boards and a board at most 16 units — so they are all looked at rather than cleverly pruned.
 */
function* partitions(total, parts, min, max) {
  if (parts === 0) {
    if (total === 0) yield [];
    return;
  }
  // Nothing below this can still reach `total` with the parts left, and nothing above it can avoid overshooting.
  const highest = Math.min(max, total - (parts - 1) * min);
  const lowest = Math.max(min, Math.ceil(total / parts));
  for (let part = highest; part >= lowest; part--) {
    for (const rest of partitions(total - part, parts - 1, min, Math.min(part, max))) yield [part, ...rest];
  }
}

const sum = (values) => values.reduce((total, value) => total + value, 0);
const distinct = (values) => new Set(values).size;
const spread = (values) => values[0] - values[values.length - 1];
const mirrors = (units) => units.filter((unit) => needsMirror(unit - 1)).length;

/** Compares two scores, each a list of numbers, lowest first. */
function better(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference !== 0) return difference < 0;
  }
  return false;
}

/**
 * The best run of boards for one axis: the fewest that reach the wall, and among those the one its strategy likes
 * most. `tol` is how many units may be left uncovered, `extraK` how many more boards than the minimum to consider
 * when the strategy may need them.
 */
function search(context, { tol = 0, extraK = 0, accept, score }) {
  const { avail, minU, maxU } = context;
  const reach = Math.max(minU, avail - tol);
  const fewest = Math.max(1, Math.ceil(reach / maxU));
  for (let count = fewest; count <= fewest + extraK; count++) {
    if (count * minU > avail) break;
    let best = null;
    let bestScore = null;
    const lowest = Math.max(count * minU, avail - tol);
    for (let total = Math.min(avail, count * maxU); total >= lowest; total--) {
      for (const units of partitions(total, count, minU, maxU)) {
        if (accept && !accept(units)) continue;
        const now = score(units, avail);
        if (!best || better(now, bestScore)) {
          best = units;
          bestScore = now;
        }
      }
    }
    if (best) return best;
  }
  return null;
}

/* ------------------------------------------------------------ strategies */

export const STRATEGIES = [
  {
    id: "balanced",
    name: "Balanced",
    summary: "The fewest boards, sizes kept even, and as few mirrored as it can manage.",
    run: (context) => search(context, { score: (units) => [mirrors(units), distinct(units), spread(units)] }),
  },
  {
    id: "largest",
    name: "Largest first",
    summary: "The biggest boards that fit the bed, with one smaller board left over.",
    run: (context) =>
      search(context, { score: (units) => [mirrors(units), distinct(units), ...units.map((unit) => -unit)] }),
  },
  {
    id: "uniform",
    name: "One size",
    summary: "Every board identical, which may leave a strip of the wall open.",
    run: (context) => {
      let best = null;
      let bestScore = null;
      for (let size = context.maxU; size >= context.minU; size--) {
        const count = Math.floor(context.avail / size);
        if (count < 1) continue;
        const units = Array.from({ length: count }, () => size);
        // A smaller gap first, then fewer boards, then fewer to mirror.
        const score = [context.avail - count * size, count, mirrors(units)];
        if (!best || better(score, bestScore)) {
          best = units;
          bestScore = score;
        }
      }
      return best;
    },
  },
  {
    id: "no-mirror",
    name: "Nothing mirrored",
    summary: "Odd-hole boards only, so no file has to be flipped before slicing.",
    run: (context) =>
      search(context, {
        tol: 1,
        extraK: 2,
        accept: (units) => units.every((unit) => !needsMirror(unit - 1)),
        score: (units, avail) => [avail - sum(units), distinct(units), spread(units)],
      }),
  },
  {
    id: "gap",
    name: "Allow a gap",
    summary: "The fewest boards, leaving up to the gap you allow uncovered.",
    run: (context) =>
      search(context, {
        tol: context.gapUnits,
        score: (units, avail) => [mirrors(units), avail - sum(units), distinct(units), spread(units)],
      }),
  },
];

export const DEFAULT_STRATEGY = "balanced";
export const getStrategy = (id) => STRATEGIES.find((strategy) => strategy.id === id) ?? STRATEGIES[0];

/* ----------------------------------------------------------------- axes */

/** Splits one side of the wall into boards that fit the bed. */
export function splitAxis(lengthMm, bedMm, { strategy = getStrategy(DEFAULT_STRATEGY), maxGapMm = 0 } = {}) {
  const bedHoles = holesFor(bedMm);
  const maxHoles = Math.min(MAX_HOLES, bedHoles);
  if (maxHoles < MIN_HOLES) {
    throw new PlanError(
      "bed-too-small",
      `A ${Math.round(bedMm)} mm bed can't fit the smallest board there is, which is ${sizeMm(MIN_HOLES)} mm.`,
    );
  }
  const avail = Math.floor(lengthMm / PITCH_MM);
  const minU = MIN_HOLES + 1;
  const maxU = maxHoles + 1;
  if (avail < minU) {
    throw new PlanError(
      "wall-too-small",
      `${Math.round(lengthMm)} mm is less than the smallest board, which is ${sizeMm(MIN_HOLES)} mm.`,
    );
  }

  const context = {
    avail,
    minU,
    maxU,
    gapUnits: Math.min(Math.max(0, Math.floor(maxGapMm / PITCH_MM)), maxU - 1),
  };
  // A strategy that can't cover this wall falls back to the balanced one rather than failing: a plan with a note on
  // it is more use than an error.
  const units = strategy.run(context) ?? getStrategy("balanced").run(context);
  if (!units) throw new PlanError("no-layout", "No run of boards fits this wall on that bed.");
  return { holes: units.map((unit) => unit - 1), leftoverMm: lengthMm - sum(units) * PITCH_MM };
}

/**
 * Which boards along a line are mirrored.
 *
 * A board with an even number of holes has to be flipped for its slot pattern to carry on into its neighbour —
 * AU3D's own instruction for these boards — so every other one of them is. An odd board reads the same either way
 * round and never needs it.
 */
export function mirrorFlags(holes) {
  let flip = false;
  return holes.map((count) => {
    if (!needsMirror(count)) return false;
    const mirrored = flip;
    flip = !flip;
    return mirrored;
  });
}

/* ----------------------------------------------------------------- plan */

/** The wall, as boards to print and where each one goes. */
export function planWall({ widthMm, heightMm, printer, strategyId = DEFAULT_STRATEGY, maxGapMm = 40 }) {
  const strategy = getStrategy(strategyId);
  const across = splitAxis(widthMm, printer.x, { strategy, maxGapMm });
  const down = splitAxis(heightMm, printer.y, { strategy, maxGapMm });

  const widths = across.holes.map(sizeMm);
  const heights = down.holes.map(sizeMm);
  const xs = running(widths);
  const ys = running(heights);
  const mirrorX = mirrorFlags(across.holes);
  const mirrorY = mirrorFlags(down.holes);

  const boards = [];
  for (let row = 0; row < down.holes.length; row++) {
    for (let col = 0; col < across.holes.length; col++) {
      boards.push({
        col,
        row,
        cols: across.holes[col],
        rows: down.holes[row],
        xMm: xs[col],
        yMm: ys[row],
        widthMm: widths[col],
        heightMm: heights[row],
        mirrorX: mirrorX[col],
        mirrorY: mirrorY[row],
      });
    }
  }

  const groups = groupBoards(boards);
  return {
    columns: across.holes,
    rows: down.holes,
    boards,
    groups,
    widthMm,
    heightMm,
    coveredWidthMm: widthMm - across.leftoverMm,
    coveredHeightMm: heightMm - down.leftoverMm,
    leftoverWidthMm: across.leftoverMm,
    leftoverHeightMm: down.leftoverMm,
    strategyId: strategy.id,
    /** Sizes nobody publishes a file for, if the wall happened to need one. */
    missing: groups.filter((group) => !boardExists(group.cols, group.rows)),
  };
}

/** [0, a, a + b, …], one entry per size, without the total. */
function running(sizes) {
  const out = [];
  let at = 0;
  for (const size of sizes) {
    out.push(at);
    at += size;
  }
  return out;
}

/** The boards gathered into what you actually print: a size, a mirroring, and how many. */
function groupBoards(boards) {
  const groups = new Map();
  for (const board of boards) {
    const key = `${board.cols}x${board.rows}:${board.mirrorX}:${board.mirrorY}`;
    const found = groups.get(key);
    if (found) found.count += 1;
    else {
      groups.set(key, {
        cols: board.cols,
        rows: board.rows,
        mirrorX: board.mirrorX,
        mirrorY: board.mirrorY,
        widthMm: board.widthMm,
        heightMm: board.heightMm,
        count: 1,
      });
    }
  }
  // Biggest first, and within a size the plain board before the mirrored one: that is the order to print them in.
  return [...groups.values()].sort((a, b) => {
    const area = b.widthMm * b.heightMm - a.widthMm * a.heightMm;
    if (area !== 0) return area;
    const flips = (group) => (group.mirrorY ? 2 : 0) + (group.mirrorX ? 1 : 0);
    return flips(a) - flips(b);
  });
}
