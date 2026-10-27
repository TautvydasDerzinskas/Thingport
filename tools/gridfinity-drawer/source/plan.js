// The drawer's plan: its grid of cells, the baseplate cut into tiles a printer's bed takes, the bins on it, and the
// list of parts to print. Plain data, no drawing, so it can be checked without a page.

import { CELL, HEIGHT_UNIT } from "./geometry.js";

/** Room left around a part on the bed, for a skirt or brim. */
export const BED_MARGIN = 5;
/** The baseplate's border is cut no thinner than this; less is left as a gap along the drawer's wall. */
const MIN_BORDER = 1;

export const DEFAULT_PROJECT = {
  name: "",
  drawer: { width: 400, depth: 350, height: 70 },
  bed: { x: 256, y: 256 },
  /** "gridfinity": 42 mm cells, a border fills the rest. "stretch": cells widened to fill the drawer exactly. */
  cells: "gridfinity",
  /** Space left between the baseplate and the drawer's walls, in total across each way. */
  clearance: 1,
  /** Height of new bins, in 7 mm units. */
  units: 6,
  bins: [],
};

/** Cells and borders along one side of the drawer. */
function axis(length, clearance, mode) {
  const usable = Math.max(0, length - clearance);
  const count = Math.floor(usable / CELL);
  if (count < 1) return { count: 0, pitch: CELL, before: 0, after: 0, usable };
  if (mode === "stretch") return { count, pitch: usable / count, before: 0, after: 0, usable };
  const left = usable - count * CELL;
  // Too thin a border to print is left as a gap instead.
  const half = left / 2 >= MIN_BORDER ? left / 2 : 0;
  return { count, pitch: CELL, before: half, after: half, usable };
}

/** Cuts `count` cells into as few runs as the bed allows, the ends carrying the borders; null when one won't fit. */
function split(a, bedLength) {
  const room = bedLength - 2 * BED_MARGIN;
  for (let runs = 1; runs <= a.count; runs++) {
    const base = Math.floor(a.count / runs);
    const extra = a.count % runs;
    // The longer runs in the middle, where they carry no border.
    const sizes = Array.from({ length: runs }, () => base);
    for (let i = 0; i < extra; i++) sizes[Math.floor((runs - extra) / 2) + i] += 1;
    const lengths = sizes.map((n, i) => n * a.pitch + (i === 0 ? a.before : 0) + (i === runs - 1 ? a.after : 0));
    if (lengths.every((length) => length <= room + 1e-6)) {
      let start = 0;
      return sizes.map((n, i) => {
        const run = {
          start,
          count: n,
          before: i === 0 ? a.before : 0,
          after: i === runs - 1 ? a.after : 0,
          length: lengths[i],
        };
        start += n;
        return run;
      });
    }
  }
  return null;
}

const round = (value) => Math.round(value * 10) / 10;

/** A tile's size and borders turned a quarter anticlockwise: borders [left, right, front, back]. */
const turn = ({ cols, rows, pad: [left, right, front, back] }) => ({
  cols: rows,
  rows: cols,
  pad: [back, front, left, right],
});

/** One way round for each tile, so tiles that are the same part turned (a border left or right) print from one file. */
function canonical(tile) {
  let best = tile;
  let current = tile;
  for (let i = 0; i < 3; i++) {
    current = turn(current);
    if (JSON.stringify([current.cols, current.rows, current.pad]) < JSON.stringify([best.cols, best.rows, best.pad]))
      best = current;
  }
  return best;
}

/** Whether a part of `w` × `d` mm fits the bed, either way round. */
function fitsBed(w, d, bed) {
  const x = bed.x - 2 * BED_MARGIN;
  const y = bed.y - 2 * BED_MARGIN;
  return (w <= x && d <= y) || (w <= y && d <= x);
}

export function binSize(bin, grid) {
  return { width: bin.w * grid.x.pitch - 0.5, depth: bin.d * grid.y.pitch - 0.5, height: bin.units * HEIGHT_UNIT };
}

/** The whole plan, with what's wrong with it. */
export function planDrawer(project) {
  const { drawer, bed, cells, clearance } = project;
  const x = axis(drawer.width, clearance, cells);
  const y = axis(drawer.depth, clearance, cells);
  const grid = { x, y };
  const problems = [];
  if (!x.count || !y.count) {
    problems.push({
      kind: "small",
      text: `The drawer needs to be at least ${CELL + clearance} mm each way for one cell.`,
    });
    return { grid, tiles: [], tileRuns: { x: [], y: [] }, parts: [], bins: [], problems };
  }
  const runsX = split(x, bed.x);
  const runsY = split(y, bed.y);
  if (!runsX || !runsY) problems.push({ kind: "bed", text: "problem.cellTooBig" });

  // Tiles, and the kinds of tile, each with how many of it.
  const tiles = [];
  const kinds = new Map();
  for (const rx of runsX ?? [])
    for (const ry of runsY ?? []) {
      const shape = canonical({
        cols: rx.count,
        rows: ry.count,
        pad: [rx.before, rx.after, ry.before, ry.after].map(round),
      });
      const key = `${shape.cols}x${shape.rows}|${shape.pad.join(",")}`;
      if (!kinds.has(key)) kinds.set(key, { key, ...shape, count: 0 });
      kinds.get(key).count++;
      tiles.push({ col: rx.start, row: ry.start, cols: rx.count, rows: ry.count, key });
    }
  // Letters for the kinds, in the order a reader meets them from the front left.
  [...kinds.values()].forEach((kind, i) => (kind.letter = String.fromCharCode(65 + i)));

  // Bins: inside the grid, not overlapping, printable and short enough for the drawer.
  const taken = new Map();
  const bins = project.bins.map((b) => {
    const size = binSize(b, grid);
    const issues = [];
    if (b.x < 0 || b.y < 0 || b.x + b.w > x.count || b.y + b.d > y.count) issues.push("issue.outsideGrid");
    for (let i = b.x; i < b.x + b.w; i++)
      for (let j = b.y; j < b.y + b.d; j++) {
        const cell = `${i},${j}`;
        if (taken.has(cell) && !issues.includes("issue.overlaps")) issues.push("issue.overlaps");
        taken.set(cell, b.id);
      }
    if (!fitsBed(size.width, size.depth, bed)) issues.push("issue.tooBigForBed");
    if (size.height > drawer.height) issues.push("issue.tallerThanDrawer");
    return { ...b, size, issues };
  });
  for (const b of bins)
    // The reasons are label keys; the window joins and says them.
    if (b.issues.length)
      problems.push({ kind: "bin", id: b.id, text: "problem.bin", vars: { w: b.w, d: b.d }, issues: b.issues });

  const binKinds = new Map();
  for (const b of bins) {
    if (b.issues.length) continue;
    const key = `${b.w}x${b.d}-${b.units}u-${b.across}x${b.along}`;
    if (!binKinds.has(key))
      binKinds.set(key, { key, w: b.w, d: b.d, units: b.units, across: b.across, along: b.along, count: 0 });
    binKinds.get(key).count++;
  }

  const parts = [
    ...[...kinds.values()].map((kind) => ({
      type: "tile",
      key: kind.key,
      letter: kind.letter,
      count: kind.count,
      cols: kind.cols,
      rows: kind.rows,
      pad: kind.pad,
      name: "part.baseplateTile",
      nameVars: { letter: kind.letter, cols: kind.cols, rows: kind.rows },
      detail: borderLabel(kind.pad),
      file: `${kind.count}x-baseplate-${kind.letter.toLowerCase()}-${kind.cols}x${kind.rows}.stl`,
    })),
    ...[...binKinds.values()].map((kind) => ({
      type: "bin",
      key: kind.key,
      count: kind.count,
      w: kind.w,
      d: kind.d,
      units: kind.units,
      across: kind.across,
      along: kind.along,
      name: "part.bin",
      nameVars: { w: kind.w, d: kind.d, units: kind.units },
      detail:
        kind.across * kind.along > 1
          ? { key: "part.compartments", vars: { across: kind.across, along: kind.along } }
          : null,
      file: `${kind.count}x-bin-${kind.w}x${kind.d}-${kind.units}u${kind.across * kind.along > 1 ? `-${kind.across}x${kind.along}` : ""}.stl`,
    })),
  ];
  return { grid, tiles, tileRuns: { x: runsX ?? [], y: runsY ?? [] }, parts, bins, problems };
}

/**
 * A tile's borders, by how many sides and how wide: it's turned to fit, so which side is left to the layout.
 * Comes back as a label and what fills it in, so the window can say it in the user's own words.
 */
function borderLabel(pad) {
  const sides = pad.filter((p) => p > 0);
  if (!sides.length) return null;
  const widths = [...new Set(sides)];
  const across = pad[0] > 0 && pad[1] > 0;
  const along = pad[2] > 0 && pad[3] > 0;
  if (widths.length > 1) return { key: "border.several", vars: { widths: widths.join(", ") } };
  if (sides.length > 2) return { key: "border.sides", vars: { mm: widths[0], sides: sides.length } };
  const where = sides.length === 1 ? "border.oneSide" : across || along ? "border.opposite" : "border.corner";
  return { key: where, vars: { mm: widths[0] } };
}

/** Where each tile goes, as letters on the drawer's grid of tiles, back row first as one looks down into it. */
export function tileMap(plan) {
  const letters = new Map(plan.parts.filter((p) => p.type === "tile").map((p) => [p.key, p.letter]));
  const rows = [];
  for (const ry of [...plan.tileRuns.y].reverse()) {
    rows.push(
      plan.tileRuns.x
        .map((rx) => letters.get(plan.tiles.find((t) => t.col === rx.start && t.row === ry.start)?.key) ?? "?")
        .join(" "),
    );
  }
  return rows.join("\n");
}

/** The model's description: what it's for, what to print and how many, and how it goes together. */
export function description(project, plan, t) {
  const { drawer, bed } = project;
  const { x, y } = plan.grid;
  const tiles = plan.parts.filter((p) => p.type === "tile");
  const bins = plan.parts.filter((p) => p.type === "bin");
  const count = (list) => list.reduce((sum, p) => sum + p.count, 0);
  const cellText =
    project.cells === "stretch"
      ? t("plan.cellsStretched", { across: x.count, along: y.count, pitchX: round(x.pitch), pitchY: round(y.pitch) })
      : t("plan.cellsStandard", { across: x.count, along: y.count });
  const lines = [
    t("plan.intro", { width: drawer.width, depth: drawer.depth, height: drawer.height, bedX: bed.x, bedY: bed.y }),
    "",
    `${cellText}. ` +
      t("plan.clearance", { mm: project.clearance }) +
      (project.cells === "gridfinity" && (x.before > 0 || y.before > 0) ? t("plan.andBorder") : "") +
      ".",
    "",
    `## ${t("plan.whatToPrint")}`,
    "",
    `| ${t("plan.colPart")} | ${t("plan.colPrint")} | ${t("plan.colFile")} |`,
    "| --- | ---: | --- |",
    ...plan.parts.map(
      (p) =>
        `| ${t(p.name, p.nameVars)}${p.detail ? ` (${t(p.detail.key, p.detail.vars)})` : ""} | ${p.count} | \`${p.file}\` |`,
    ),
    "",
    t("plan.inAll", {
      tiles: t(count(tiles) === 1 ? "plan.tile.one" : "plan.tile.many", { count: count(tiles) }),
      bins: bins.length
        ? t("plan.andBins", { bins: t(count(bins) === 1 ? "plan.bin.one" : "plan.bin.many", { count: count(bins) }) })
        : "",
    }),
    "",
    `## ${t("plan.puttingTogether")}`,
    "",
    t("plan.layTiles"),
    "",
    "```",
    tileMap(plan),
    "```",
  ];
  if (bins.length) {
    lines.push("", t("plan.dropBins"));
  }
  lines.push("", bins.length ? t("plan.binsWithUnit", { unit: HEIGHT_UNIT }) : t("plan.binsPlain"));
  return lines.join("\n");
}
