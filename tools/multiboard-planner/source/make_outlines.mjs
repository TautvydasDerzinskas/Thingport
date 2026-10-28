// The joints as they look from above, taken from the models the tool carries.
//
// A snap drawn by hand is a guess; this projects the real STL from the top, the way plate.scad's own plan is
// taken, and keeps the outline. The meshes are tessellated, so the contour comes back with hundreds of points
// for what is really a few straight runs and arcs -- simplified to a tenth of a millimetre it is a few dozen,
// small enough to carry in the tool and still true to the part at any size a wall is drawn at.
//
// Needs the openscad binary. Run it after changing models/, and commit what it writes:
//   node source/make_outlines.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const tool = path.join(here, "..");
const TOLERANCE = 0.1; // mm

/** Ramer-Douglas-Peucker: the fewest points that stay within `eps` of the contour. */
function simplify(points, eps) {
  if (points.length < 3) return points;
  const [ax, ay] = points[0];
  const [bx, by] = points[points.length - 1];
  const dx = bx - ax,
    dy = by - ay;
  const n = Math.hypot(dx, dy) || 1;
  let worst = 0,
    at = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = Math.abs(dx * (ay - points[i][1]) - (ax - points[i][0]) * dy) / n;
    if (d > worst) [worst, at] = [d, i];
  }
  if (worst <= eps) return [points[0], points[points.length - 1]];
  return simplify(points.slice(0, at + 1), eps)
    .slice(0, -1)
    .concat(simplify(points.slice(at), eps));
}

/** A binary STL's extents, to find which way the part was laid down to print. */
function extents(file) {
  const b = fs.readFileSync(file);
  const n = b.readUInt32LE(80);
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++)
    for (let v = 0; v < 3; v++)
      for (let a = 0; a < 3; a++) {
        const t = b.readFloatLE(84 + i * 50 + 12 + v * 12 + a * 4);
        if (t < mn[a]) mn[a] = t;
        if (t > mx[a]) mx[a] = t;
      }
  return [0, 1, 2].map((a) => mx[a] - mn[a]);
}

/**
 * Which way to look at the part to get its plan.
 *
 * The models are laid down to print, not as they are fitted: a raised snap prints flat and its plan is already
 * the view from above, while an offset snap prints on its side and that view is its profile. These are all
 * fittings that lie against the board, so the way through is the thinnest one -- look down that and the holes
 * the part drops into come out as the octagons they are.
 */
function planView(file) {
  const d = extents(file);
  const thin = d.indexOf(Math.min(...d));
  return thin === 2 ? "[0,0,0]" : thin === 0 ? "[0,90,0]" : "[90,0,0]";
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), "mbp-outline-"));
const out = {};
for (const key of fs.readdirSync(path.join(tool, "models")).sort()) {
  const dir = path.join(tool, "models", key);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const file of fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".stl"))
    .sort()) {
    const scad = path.join(work, "one.scad");
    const svg = path.join(work, "one.svg");
    fs.rmSync(svg, { force: true });
    const rot = planView(path.join(dir, file));
    fs.writeFileSync(scad, `projection(cut=false) rotate(${rot}) import(${JSON.stringify(path.join(dir, file))});\n`);
    execFileSync("openscad", ["-o", svg, "--export-format", "svg", scad], { stdio: ["ignore", "ignore", "ignore"] });
    const text = fs.readFileSync(svg, "utf8");
    // Every contour, not just the outer one: these fittings are rings, and the holes they drop over are as
    // much a part of the drawing as the rim.
    const rings = [];
    for (const m of text.matchAll(/<path[^>]*\sd="([^"]+)"/g))
      for (const sub of m[1].split(/(?=M)/)) {
        const pts = [...sub.matchAll(/(-?\d+(?:\.\d+)?)[ ,]+(-?\d+(?:\.\d+)?)/g)].map((q) => [+q[1], +q[2]]);
        if (pts.length >= 3) rings.push(simplify(pts, TOLERANCE));
      }
    if (!rings.length) continue;
    const all = rings.flat();
    const xs = all.map((q) => q[0]),
      ys = all.map((q) => q[1]);
    const mnx = Math.min(...xs),
      mxx = Math.max(...xs),
      mny = Math.min(...ys),
      mxy = Math.max(...ys);
    // The holes a fitting drops over are what has to line up with the board, not its outline, so the part is
    // centred on them: the offset snaps carry their holes a couple of millimetres off their own middle.
    const holes = rings.slice(1).map((ring) => {
      const rx = ring.map((q) => q[0]),
        ry = ring.map((q) => q[1]);
      return [(Math.min(...rx) + Math.max(...rx)) / 2, (Math.min(...ry) + Math.max(...ry)) / 2];
    });
    const cx = holes.length ? holes.reduce((a, q) => a + q[0], 0) / holes.length : (mnx + mxx) / 2,
      cy = holes.length ? holes.reduce((a, q) => a + q[1], 0) / holes.length : (mny + mxy) / 2;
    // Centred on its own middle, so the drawing only has to say where the joint goes.
    const d = rings
      .map((ring) => `M${ring.map(([x, y]) => `${(x - cx).toFixed(2)} ${(y - cy).toFixed(2)}`).join("L")}Z`)
      .join("");
    // Which way the fitting runs. Holes on one line mean a bar, and its angle is what has to be aimed at the
    // seam it crosses; holes spread over two directions mean a cluster like the quad snap, which is already
    // square to the grid and must not be turned at all.
    let axis = null;
    if (holes.length >= 2) {
      let far = [holes[0], holes[1]],
        best = -1;
      for (const a of holes)
        for (const b of holes) {
          const d2 = Math.hypot(a[0] - b[0], a[1] - b[1]);
          if (d2 > best) [best, far] = [d2, [a, b]];
        }
      const [ax, ay] = far[0],
        [bx, by] = far[1];
      const nx = bx - ax,
        ny = by - ay;
      const len = Math.hypot(nx, ny) || 1;
      const off = Math.max(...holes.map((q) => Math.abs(nx * (ay - q[1]) - (ax - q[0]) * ny) / len));
      if (off < 1) axis = +((Math.atan2(ny, nx) * 180) / Math.PI).toFixed(1);
    }
    const entry = {
      d,
      w: +(mxx - mnx).toFixed(2),
      h: +(mxy - mny).toFixed(2),
      holes: holes.length,
      axis,
    };
    const name = file.replace(/\.stl$/i, "");
    (out[key] ??= {})[name] = entry;
    const points = rings.reduce((a, r) => a + r.length, 0);
    console.log(
      `${key}/${name}: ${rings.length} rings, ${points} points, ${entry.w} x ${entry.h} mm, looking down ${rot}`,
    );
  }
}
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(path.join(here, "data"), { recursive: true });
fs.writeFileSync(path.join(here, "data", "outlines.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`\nwrote source/data/outlines.json (${Object.keys(out).length} models)`);
