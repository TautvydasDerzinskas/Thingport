// What holds the wall up, and where it goes.
//
// The boards make a lattice. Where four boards meet is a junction; a point on the outside where two meet is an edge
// node; the four points where one board sits alone are the outer corners. One mount covers each, which is why a
// wall of 16 boards needs far fewer mounts than it has board corners.

import { sizeMm } from "./catalogue.js";

/** How many of each kind of point a grid of boards has. */
export function countNodes(columns, rows) {
  const c = Math.max(0, columns);
  const r = Math.max(0, rows);
  if (!c || !r) return { board: 0, junction: 0, edgeNode: 0, outerCorner: 0 };
  return {
    board: c * r,
    junction: (c - 1) * (r - 1),
    edgeNode: 2 * (c - 1) + 2 * (r - 1),
    outerCorner: 4,
  };
}

/** The hardware a plan needs with that system: every item with how many of it, printed ones and bought ones. */
export function hardwareFor(plan, system) {
  const nodes = countNodes(plan.columns.length, plan.rows.length);
  return system.items
    .map((item) => ({
      name: item.name,
      print: item.print,
      from: item.from ?? null,
      count: Object.entries(item.per).reduce((total, [kind, each]) => total + each * (nodes[kind] ?? 0), 0),
    }))
    .filter((item) => item.count > 0);
}

/** Running sums of a list of sizes, starting at 0 and ending at the total. */
const edges = (sizes) => {
  const out = [0];
  for (const size of sizes) out.push(out[out.length - 1] + size);
  return out;
};

/**
 * Where each piece of hardware sits, in mm from the top-left of the wall.
 *
 * At a junction all four boards meet, so the mount's screw sits right on the lattice point. Anywhere on the outside
 * there is no board beyond on at least one side, so on that side the mount uses the board's own screw hole, set in
 * from the edge — one axis in for an edge node, both for an outer corner.
 */
export function hardwareMarkers(plan, system) {
  const columns = plan.columns.length;
  const rows = plan.rows.length;
  if (!columns || !rows) return [];
  const xs = edges(plan.columns.map(sizeMm));
  const ys = edges(plan.rows.map(sizeMm));
  const inset = system.insetMm ?? 0;
  const markers = [];

  if (system.markers === "boardCorners") {
    for (const board of plan.boards) {
      for (const [dx, dy] of [
        [inset, inset],
        [board.widthMm - inset, inset],
        [inset, board.heightMm - inset],
        [board.widthMm - inset, board.heightMm - inset],
      ]) {
        markers.push({ x: board.xMm + dx, y: board.yMm + dy, role: "boardCorner" });
      }
    }
    return markers;
  }

  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= columns; i++) {
      const insideX = i > 0 && i < columns;
      const insideY = j > 0 && j < rows;
      const role = insideX && insideY ? "junction" : insideX !== insideY ? "edgeNode" : "outerCorner";
      markers.push({
        x: insideX ? xs[i] : xs[i] + (i === 0 ? inset : -inset),
        y: insideY ? ys[j] : ys[j] + (j === 0 ? inset : -inset),
        role,
      });
    }
  }
  return markers;
}
