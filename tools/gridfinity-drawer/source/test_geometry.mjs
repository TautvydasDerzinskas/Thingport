// Checks every part the drawer builder makes is closed and wound outward: each edge is used once in each direction, and
// the volume comes out positive. Run with: node source/test_geometry.mjs
import { baseplateTile, bin, stl } from "./geometry.js";

const key = (p) => p.map((v) => v.toFixed(5)).join(",");

function check(name, triangles) {
  const edges = new Map();
  let volume = 0;
  let degenerate = 0;
  for (const [a, b, c] of triangles) {
    for (const [p, q] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const k = `${key(p)}>${key(q)}`;
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
    // Signed volume of the tetrahedron to the origin: positive overall when the faces point out.
    volume +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const area = Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
    if (area < 1e-9) degenerate++;
  }
  let open = 0;
  for (const [k, count] of edges) {
    const [p, q] = k.split(">");
    if (count !== 1 || edges.get(`${q}>${p}`) !== 1) open++;
  }
  const bytes = stl(triangles).byteLength;
  const ok = open === 0 && volume > 0 && degenerate === 0;
  console.log(
    `${ok ? "✓" : "✗"} ${name}: ${triangles.length} triangles, ${(volume / 1000).toFixed(1)} cm³, ${open} open edges, ${degenerate} degenerate, ${bytes} bytes`,
  );
  return ok;
}

const results = [
  check("tile 1×1", baseplateTile({ cols: 1, rows: 1 })),
  check("tile 5×4", baseplateTile({ cols: 5, rows: 4 })),
  check("tile 3×2 with borders", baseplateTile({ cols: 3, rows: 2, pad: [7.5, 0, 3, 11] })),
  check("tile stretched 4×3", baseplateTile({ cols: 4, rows: 3, pitchX: 44.6, pitchY: 43.1, pad: [0, 2, 0, 1] })),
  check("bin 1×1 3u", bin({ w: 1, d: 1, units: 3 })),
  check("bin 2×3 6u, 3×2 compartments", bin({ w: 2, d: 3, units: 6, across: 3, along: 2 })),
  check("bin stretched 2×1", bin({ w: 2, d: 1, units: 4, pitchX: 44.6, pitchY: 43.1 })),
];
if (results.includes(false)) process.exitCode = 1;
