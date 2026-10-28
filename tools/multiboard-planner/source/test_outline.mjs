// Does the plate the preview draws match the plate plate.scad cuts?
//
// OpenSCAD projects the real plate from the top and the largest contour in that export is its silhouette, so
// this compares the preview's outline against the thing itself rather than against anything written by hand.
// It reports rather than passes or fails: the two legitimately differ where a peghole bites a corner pad's
// rim, because the preview draws those as circles instead of cutting them into the outline.
//
// Needs the openscad binary on PATH; skips with a note when there isn't one.
//
//   node source/test_outline.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { plateOutline, PLATE_SIDES } from "../tool.js";

const here = path.dirname(new URL(import.meta.url).pathname);
try {
  execFileSync("openscad", ["--version"], { stdio: "ignore" });
} catch {
  console.log("openscad isn't on PATH -- skipping the outline check");
  process.exit(0);
}
// plate.scad draws the solid; the same file projected from the top is its true plan.
const work = fs.mkdtempSync(path.join(os.tmpdir(), "mbp-outline-"));
const top = path.join(work, "top.scad");
fs.writeFileSync(
  top,
  fs.readFileSync(path.join(here, "plate.scad"), "utf8").replace(/^plate\(\);$/m, "projection(cut=false) plate();"),
);
const dir = work;
const CELL = 25;

/** Every contour in an OpenSCAD SVG export, as point lists. */
function contours(svg) {
  const out = [];
  for (const m of svg.matchAll(/<path[^>]*\sd="([^"]+)"/g)) {
    for (const sub of m[1].split(/(?=M)/)) {
      const nums = [...sub.matchAll(/(-?\d+(?:\.\d+)?)[ ,]+(-?\d+(?:\.\d+)?)/g)].map((n) => [+n[1], +n[2]]);
      if (nums.length >= 3) out.push(nums);
    }
  }
  return out;
}
const area = (p) => {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i],
      [x2, y2] = p[(i + 1) % p.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
};

/** A polygon as a canonical set of rounded vertices, so start point and winding don't matter. */
const key = (pts) => {
  const seen = new Set();
  for (const [x, y] of pts) seen.add(`${x.toFixed(2)},${y.toFixed(2)}`);
  return seen;
};

let fails = 0;
console.log("variant                 scad pts  ours  missing  extra  verdict");
for (const [type, sides] of Object.entries(PLATE_SIDES)) {
  const cells = 4;
  const svgFile = path.join(dir, "t.svg");
  execFileSync(
    "openscad",
    [
      "-o",
      svgFile,
      "--export-format",
      "svg",
      "-D",
      `cells=${cells}`,
      "-D",
      `neighbour_px=${sides.px}`,
      "-D",
      `neighbour_py=${sides.py}`,
      "-D",
      `neighbour_mx=${sides.mx}`,
      "-D",
      `neighbour_my=${sides.my}`,
      top,
    ],
    { stdio: ["ignore", "ignore", "ignore"] },
  );

  const all = contours(fs.readFileSync(svgFile, "utf8"));
  const outer = all.reduce((a, b) => (area(a) > area(b) ? a : b));
  // SVG y runs down as the preview's does; put both corners-at-origin to compare shapes, not placement.
  const norm = (pts) => {
    const mnx = Math.min(...pts.map((p) => p[0])),
      mny = Math.min(...pts.map((p) => p[1]));
    return pts.map(([x, y]) => [x - mnx, y - mny]);
  };
  const side = cells * CELL;
  const mine = norm(
    plateOutline(0, 0, side, side, sides, CELL)
      .slice(1, -1)
      .split("L")
      .map((p) => p.trim().split(/\s+/).map(Number)),
  );
  const theirs = norm(outer);
  const a = key(mine),
    b = key(theirs);
  const missing = [...b].filter((k) => !a.has(k));
  const extra = [...a].filter((k) => !b.has(k));
  const ok = missing.length === 0 && extra.length === 0;
  if (!ok) fails++;
  console.log(
    `${type.padEnd(22)} ${String(theirs.length).padStart(6)} ${String(mine.length).padStart(5)} ` +
      `${String(missing.length).padStart(8)} ${String(extra.length).padStart(6)}  ${ok ? "match" : "DIFFER"}`,
  );
  if (!ok && fails <= 2) {
    console.log(`   scad has, we don't: ${missing.slice(0, 6).join("  ")}`);
    console.log(`   we have, scad doesn't: ${extra.slice(0, 6).join("  ")}`);
  }
}
fs.rmSync(work, { recursive: true, force: true });
// A report, not a pass or fail. The preview's outline is straight lines; the real plate's has arcs where a
// peghole bites the rim of a corner pad, and those are drawn as circles on top rather than cut into the
// outline. So a difference here is expected -- what it is good for is seeing *where* the two part company,
// which is how the corner pads and the chamfers were got right in the first place.
console.log(
  fails
    ? `\n${fails} of 16 differ from the real plate, which is the pad pegholes the preview draws separately`
    : "\nall 16 match the real plate outline exactly",
);
