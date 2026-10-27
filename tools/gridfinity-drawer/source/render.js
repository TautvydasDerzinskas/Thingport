// A small renderer for the parts' previews: the triangles turned to a view, sorted back to front and filled with flat
// shading on a canvas. Enough to see a part's shape without a 3D library.

const span = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function parseColor(color) {
  const hex = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16));
  const rgb = /rgba?\(([^)]+)\)/.exec(color);
  if (rgb)
    return rgb[1]
      .split(",")
      .slice(0, 3)
      .map((v) => Number(v));
  return [90, 150, 90];
}

/**
 * Draws `triangles` on `canvas`, seen from `azimuth` degrees round and `elevation` degrees up (90 is straight down),
 * filling the canvas with the part.
 */
export function renderMesh(canvas, triangles, { azimuth = -35, elevation = 32, color = "#4caf50", padding = 6 } = {}) {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || canvas.width;
  const height = canvas.clientHeight || canvas.height;
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (!triangles.length) return;

  const a = (azimuth * Math.PI) / 180;
  const e = (elevation * Math.PI) / 180;
  const [ca, sa, ce, se] = [Math.cos(a), Math.sin(a), Math.cos(e), Math.sin(e)];
  // To the view: x across the screen, y up it, z towards the viewer.
  const view = ([x, y, z]) => {
    const rx = x * ca - y * sa;
    const ry = x * sa + y * ca;
    return [rx, z * ce + ry * se, -ry * ce + z * se];
  };
  const projected = triangles.map((t) => t.map(view));
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const t of projected)
    for (const [x, y] of t) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  const scale = Math.min((width - 2 * padding) / (maxX - minX || 1), (height - 2 * padding) / (maxY - minY || 1));
  const ox = (width - (maxX - minX) * scale) / 2;
  const oy = (height - (maxY - minY) * scale) / 2;
  const base = parseColor(color);
  const light = [-0.45, 0.6, 0.66];

  // Sorting by a face's middle goes wrong where a big face (a bin's floor) lies beside small ones (its dividers), so big
  // faces are cut into pieces no longer than this before they're sorted.
  const longest = Math.max(maxX - minX, maxY - minY) / 12;
  const faces = [];
  const add = (p, q, r, shade, depth = 0) => {
    const edges = [
      [p, q, r],
      [q, r, p],
      [r, p, q],
    ];
    const [a, b, c] = edges.reduce((worst, edge) => (span(edge[0], edge[1]) > span(worst[0], worst[1]) ? edge : worst));
    if (depth < 6 && span(a, b) > longest) {
      const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
      add(a, m, c, shade, depth + 1);
      add(m, b, c, shade, depth + 1);
      return;
    }
    faces.push({ points: [p, q, r], depth: (p[2] + q[2] + r[2]) / 3, shade });
  };
  for (const [p, q, r] of projected) {
    const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    const v = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const length = Math.hypot(n[0], n[1], n[2]);
    // Facing away: hidden behind the faces that face the viewer.
    if (!length || n[2] <= 0) continue;
    add(p, q, r, 0.38 + 0.62 * Math.max(0, (n[0] * light[0] + n[1] * light[1] + n[2] * light[2]) / length));
  }
  faces.sort((f, g) => f.depth - g.depth);
  for (const { points, shade } of faces) {
    ctx.beginPath();
    points.forEach(([x, y], i) => {
      const sx = ox + (x - minX) * scale;
      const sy = height - (oy + (y - minY) * scale);
      if (i) ctx.lineTo(sx, sy);
      else ctx.moveTo(sx, sy);
    });
    ctx.closePath();
    const fill = `rgb(${base.map((c) => Math.round(Math.min(255, c * shade))).join(",")})`;
    ctx.fillStyle = fill;
    // A hairline of the same colour hides the seams between neighbouring triangles.
    ctx.strokeStyle = fill;
    ctx.lineWidth = 0.6;
    ctx.fill();
    ctx.stroke();
  }
}
