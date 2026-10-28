// Measures a generated plate against one of the plates the planner fetches, so plate.scad can be checked
// rather than eyeballed. Everything here works off the mesh itself: no CAD kernel, no dependencies.
//
//   node source/fidelity.mjs <original.stl> <generated.stl>
//
// The fetched plates are not in the repository (Multiboard's licence covers them), so point the first
// argument at an installed copy, under <storage>/tools/multiboard-planner/<sha>/<key>/files/.
//
// What it reports, and why each one matters:
//   bounding box      the plate must be exactly cells x 25 mm and 6.2 mm thick, or it will not tile
//   slice area + IoU  how much of each cross-section agrees, which catches wall thickness and taper errors
//   hole lattice      every multihole and pegboard hole present, in the right place
//   bore profile      the radii and thread lead a bolt or snap actually engages with

import fs from "node:fs";

/* ---- mesh ---------------------------------------------------------------------------------------------- */

export function readStl(file) {
  const buf = fs.readFileSync(file);
  const n = buf.readUInt32LE(80);
  if (buf.length !== 84 + n * 50) throw new Error(`${file}: not a binary STL`);
  const tri = new Float32Array(n * 9);
  for (let i = 0; i < n; i++) {
    const o = 84 + i * 50 + 12;
    for (let k = 0; k < 9; k++) tri[i * 9 + k] = buf.readFloatLE(o + k * 4);
  }
  return { n, tri };
}

export function bounds({ n, tri }) {
  const mn = [Infinity, Infinity, Infinity],
    mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n * 9; i += 3)
    for (let c = 0; c < 3; c++) {
      const v = tri[i + c];
      if (v < mn[c]) mn[c] = v;
      if (v > mx[c]) mx[c] = v;
    }
  return { mn, mx, size: mx.map((v, i) => v - mn[i]) };
}

/** Segments where the mesh crosses z = k, flat as [x1,y1,x2,y2,...]. */
export function segmentsAt({ n, tri }, k) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const o = i * 9,
      z = [tri[o + 2], tri[o + 5], tri[o + 8]];
    if (!(z.some((v) => v > k) && z.some((v) => v < k))) continue;
    const hits = [];
    for (let e = 0; e < 3; e++) {
      const f = (e + 1) % 3;
      const az = z[e],
        bz = z[f];
      if ((az < k && bz < k) || (az > k && bz > k) || az === bz) continue;
      const t = (k - az) / (bz - az);
      if (t < 0 || t > 1) continue;
      hits.push([
        tri[o + e * 3] + t * (tri[o + f * 3] - tri[o + e * 3]),
        tri[o + e * 3 + 1] + t * (tri[o + f * 3 + 1] - tri[o + e * 3 + 1]),
      ]);
    }
    const u = [];
    for (const h of hits) if (!u.some((p) => Math.hypot(p[0] - h[0], p[1] - h[1]) < 1e-9)) u.push(h);
    if (u.length === 2) out.push(u[0][0], u[0][1], u[1][0], u[1][1]);
  }
  return out;
}

/** Occupancy raster of the slice at z. Scanline even-odd, so helical thread sections need no chaining. */
export function raster(mesh, z, box, cell) {
  const segs = segmentsAt(mesh, z);
  const nx = Math.ceil(box.w / cell),
    ny = Math.ceil(box.h / cell);
  const grid = new Uint8Array(nx * ny);
  const rows = new Map();
  for (let s = 0; s < segs.length; s += 4) {
    const lo = Math.max(0, Math.ceil((Math.min(segs[s + 1], segs[s + 3]) - box.y0) / cell - 0.5));
    const hi = Math.min(ny - 1, Math.floor((Math.max(segs[s + 1], segs[s + 3]) - box.y0) / cell - 0.5));
    for (let r = lo; r <= hi; r++) {
      if (!rows.has(r)) rows.set(r, []);
      rows.get(r).push(s);
    }
  }
  const xs = [];
  for (const [r, list] of rows) {
    const y = box.y0 + (r + 0.5) * cell;
    xs.length = 0;
    for (const s of list) {
      const x1 = segs[s],
        y1 = segs[s + 1],
        x2 = segs[s + 2],
        y2 = segs[s + 3];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const a = Math.max(0, Math.ceil((xs[i] - box.x0) / cell - 0.5));
      const b = Math.min(nx - 1, Math.floor((xs[i + 1] - box.x0) / cell - 0.5));
      for (let c = a; c <= b; c++) grid[r * nx + c] = 1;
    }
  }
  return { grid, nx, ny, cell };
}

/** Enclosed empty regions: the holes, with where each sits and how big it is. */
export function holes({ grid, nx, ny, cell }, box) {
  const seen = new Uint8Array(nx * ny),
    out = [],
    stack = [];
  for (let y0 = 0; y0 < ny; y0++)
    for (let x0 = 0; x0 < nx; x0++) {
      const i0 = y0 * nx + x0;
      if (grid[i0] || seen[i0]) continue;
      stack.length = 0;
      stack.push(i0);
      seen[i0] = 1;
      let n = 0,
        sx = 0,
        sy = 0,
        edge = false;
      while (stack.length) {
        const i = stack.pop(),
          x = i % nx,
          y = (i - x) / nx;
        n++;
        sx += x;
        sy += y;
        if (x === 0 || y === 0 || x === nx - 1 || y === ny - 1) edge = true;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const X = x + dx,
            Y = y + dy;
          if (X < 0 || Y < 0 || X >= nx || Y >= ny) continue;
          const j = Y * nx + X;
          if (grid[j] || seen[j]) continue;
          seen[j] = 1;
          stack.push(j);
        }
      }
      if (!edge)
        out.push({ area: n * cell * cell, cx: box.x0 + (sx / n + 0.5) * cell, cy: box.y0 + (sy / n + 0.5) * cell });
    }
  return out;
}

/** Radius to the bore wall, by angle, at one height. */
export function bore(mesh, cx, cy, z, angles = 360, rmax = 14) {
  const segs = segmentsAt(mesh, z),
    out = [];
  for (let a = 0; a < angles; a++) {
    const th = (a / angles) * 2 * Math.PI,
      dx = Math.cos(th),
      dy = Math.sin(th);
    let best = Infinity;
    for (let s = 0; s < segs.length; s += 4) {
      const x1 = segs[s] - cx,
        y1 = segs[s + 1] - cy,
        ex = segs[s + 2] - segs[s],
        ey = segs[s + 3] - segs[s + 1];
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const u = (dx * y1 - dy * x1) / -den;
      if (u < 0 || u > 1) continue;
      const t = (x1 + u * ex) * dx + (y1 + u * ey) * dy;
      if (Math.hypot(x1 + u * ex - t * dx, y1 + u * ey - t * dy) > 1e-6) continue;
      if (t > 1e-6 && t < best && t <= rmax) best = t;
    }
    out.push(best === Infinity ? NaN : best);
  }
  return out;
}

/** Thread lead from how far the bore's narrowest point turns as it rises. */
export function lead(mesh, cx, cy, rmax, z0 = 1.2, z1 = 5.0, step = 0.2) {
  const rows = [];
  for (let z = z0; z <= z1 + 1e-9; z += step) {
    const r = bore(mesh, cx, cy, z, 360, rmax);
    const ok = r.map((v, i) => [v, i]).filter(([v]) => !Number.isNaN(v));
    if (ok.length < 180) continue;
    const rmin = Math.min(...ok.map(([v]) => v)),
      rmx = Math.max(...ok.map(([v]) => v));
    const near = ok.filter(([v]) => v <= rmin + (rmx - rmin) * 0.05).map(([, i]) => i);
    let sx = 0,
      sy = 0;
    for (const i of near) {
      sx += Math.cos((i * Math.PI) / 180);
      sy += Math.sin((i * Math.PI) / 180);
    }
    let ang = (Math.atan2(sy, sx) * 180) / Math.PI;
    if (ang < 0) ang += 360;
    rows.push({ z, rmin, rmax: rmx, ang });
  }
  if (rows.length < 4) return null;
  let acc = 0;
  const un = [rows[0].ang];
  for (let i = 1; i < rows.length; i++) {
    let d = rows[i].ang - rows[i - 1].ang;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    acc += d;
    un.push(rows[0].ang + acc);
  }
  const n = rows.length,
    mz = rows.reduce((s, r) => s + r.z, 0) / n,
    ma = un.reduce((s, v) => s + v, 0) / n;
  let num = 0,
    den = 0;
  for (let i = 0; i < n; i++) {
    num += (rows[i].z - mz) * (un[i] - ma);
    den += (rows[i].z - mz) ** 2;
  }
  const slope = num / den;
  let ss = 0,
    st = 0;
  for (let i = 0; i < n; i++) {
    const p = ma + slope * (rows[i].z - mz);
    ss += (un[i] - p) ** 2;
    st += (un[i] - ma) ** 2;
  }
  const rmins = rows.map((r) => r.rmin),
    rmaxs = rows.map((r) => r.rmax);
  return {
    pitch: Math.abs(360 / slope),
    r2: 1 - ss / st,
    rmin: rmins.reduce((s, v) => s + v, 0) / n,
    rmax: rmaxs.reduce((s, v) => s + v, 0) / n,
  };
}

/* ---- report -------------------------------------------------------------------------------------------- */

const TOL = 0.25; // Multiboard's own stated design tolerance
const Z_SLICES = [0.1, 0.6, 1.5, 2.9, 3.3, 4.7, 5.6, 6.1]; // never the 3.1 symmetry plane: the halves meet there in coplanar faces
const CELL = 0.05;

function main() {
  const [a, b] = process.argv.slice(2);
  if (!a || !b) {
    console.error("usage: node source/fidelity.mjs <original.stl> <generated.stl>");
    process.exit(2);
  }
  const A = readStl(a),
    B = readStl(b);
  const ba = bounds(A),
    bb = bounds(B);
  const fail = [];
  console.log(`original  ${a.split("/").pop()}   ${A.n.toLocaleString()} tris`);
  console.log(`generated ${b.split("/").pop()}   ${B.n.toLocaleString()} tris   (${(B.n / A.n).toFixed(2)}x)\n`);

  console.log(`bounding box (mm)`);
  for (let c = 0; c < 3; c++) {
    const d = bb.size[c] - ba.size[c],
      ok = Math.abs(d) <= TOL;
    if (!ok) fail.push(`${"XYZ"[c]} size off by ${d.toFixed(3)} mm`);
    console.log(
      `  ${"XYZ"[c]}  original ${ba.size[c].toFixed(3)}   generated ${bb.size[c].toFixed(3)}   diff ${d >= 0 ? "+" : ""}${d.toFixed(3)}  ${ok ? "ok" : "FAIL"}`,
    );
  }

  const box = {
    x0: Math.min(ba.mn[0], bb.mn[0]) - 0.5,
    y0: Math.min(ba.mn[1], bb.mn[1]) - 0.5,
    w: Math.max(ba.size[0], bb.size[0]) + 1,
    h: Math.max(ba.size[1], bb.size[1]) + 1,
  };
  console.log(`\ncross-sections (${CELL} mm raster)`);
  console.log(`     z    solid mm2 orig / gen      IoU    holes orig / gen`);
  for (const z of Z_SLICES) {
    const ra = raster(A, z, box, CELL),
      rb = raster(B, z, box, CELL);
    let inter = 0,
      uni = 0,
      na = 0,
      nb = 0;
    for (let i = 0; i < ra.grid.length; i++) {
      const p = ra.grid[i],
        q = rb.grid[i];
      na += p;
      nb += q;
      if (p & q) inter++;
      if (p | q) uni++;
    }
    const iou = uni ? inter / uni : 1;
    const ha = holes(ra, box).filter((h) => h.area > 0.5).length,
      hb = holes(rb, box).filter((h) => h.area > 0.5).length;
    const ok = iou >= 0.9 && ha === hb;
    if (!ok) fail.push(`slice z=${z}: IoU ${iou.toFixed(3)}, holes ${ha} vs ${hb}`);
    console.log(
      `  ${z.toFixed(2)}   ${(na * CELL * CELL).toFixed(1).padStart(8)} / ${(nb * CELL * CELL).toFixed(1).padStart(8)}   ${iou.toFixed(3)}    ${String(ha).padStart(3)} / ${String(hb).padStart(3)}   ${ok ? "ok" : "FAIL"}`,
    );
  }

  console.log(`\nbores (radius mm, thread lead mm/turn)`);
  const cx = (ba.mn[0] + ba.mx[0]) / 2,
    cy = (ba.mn[1] + ba.mx[1]) / 2;
  for (const [px, py, rmax, label] of [
    [cx, cy, 6, "pegboard hole (wall junction)"],
    [cx + 12.5, cy + 12.5, 14, "multihole (cell centre)"],
  ]) {
    const la = lead(A, px, py, rmax),
      lb = lead(B, px, py, rmax);
    if (!la || !lb) {
      console.log(`  ${label}: not measurable (orig ${!!la}, gen ${!!lb})`);
      fail.push(`${label} not measurable`);
      continue;
    }
    console.log(`  ${label}`);
    for (const [k, unit] of [
      ["rmin", "mm"],
      ["rmax", "mm"],
      ["pitch", "mm/turn"],
    ]) {
      const d = lb[k] - la[k],
        ok = Math.abs(d) <= TOL;
      if (!ok) fail.push(`${label} ${k} off by ${d.toFixed(3)} ${unit}`);
      console.log(
        `     ${k.padEnd(6)} original ${la[k].toFixed(3)}   generated ${lb[k].toFixed(3)}   diff ${d >= 0 ? "+" : ""}${d.toFixed(3)}  ${ok ? "ok" : "FAIL"}`,
      );
    }
    console.log(`     helix fit R2  original ${la.r2.toFixed(3)}   generated ${lb.r2.toFixed(3)}`);
  }

  console.log(
    `\n${fail.length ? `FAIL -- ${fail.length} check(s) outside ${TOL} mm:\n  ` + fail.join("\n  ") : `PASS -- every check within ${TOL} mm`}`,
  );
  process.exit(fail.length ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
