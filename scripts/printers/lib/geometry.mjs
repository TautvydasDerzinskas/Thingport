// A printer's bed as slicers write it ("0x0,256x0,256x256,0x256"), read into a shape Thingport can draw and measure.

const round = (n) => Math.round(n * 1000) / 1000;

/** "0x0,256x0" (or a list of such strings) as [[x, y], ...]. */
export function parsePoints(value) {
  const items = Array.isArray(value) ? value : value == null ? [] : [value];
  const points = [];
  for (const item of items) {
    for (const part of String(item).split(",")) {
      const [a, b] = part.trim().split("x");
      if (b === undefined) continue;
      const x = Number(a);
      const y = Number(b);
      if (Number.isFinite(x) && Number.isFinite(y)) points.push([x, y]);
    }
  }
  return points;
}

/** The bed's bounding box and shape: a rectangle, a circle (a delta's) or another polygon, whose points are kept. */
export function bedGeometry(points) {
  if (!points.length) return null;
  const unique = [...new Map(points.map((p) => [p.join(","), p])).values()];
  const xs = unique.map((p) => p[0]);
  const ys = unique.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const width = Math.max(...xs) - minX;
  const depth = Math.max(...ys) - minY;
  let shape = "polygon";
  if (unique.length === 4 && new Set(xs).size === 2 && new Set(ys).size === 2) shape = "rectangle";
  else if (unique.length >= 8) {
    const cx = xs.reduce((s, x) => s + x, 0) / xs.length;
    const cy = ys.reduce((s, y) => s + y, 0) / ys.length;
    const r = unique.map(([x, y]) => Math.hypot(x - cx, y - cy));
    const max = Math.max(...r);
    if (max > 0 && (max - Math.min(...r)) / max < 0.02) shape = "circle";
  }
  const bed = { shape, x: round(width), y: round(depth), origin: [round(minX), round(minY)] };
  if (shape === "circle") bed.diameter = round(Math.max(width, depth));
  if (shape === "polygon") bed.points = unique.map(([x, y]) => [round(x), round(y)]);
  return bed;
}

/** "0.4" for 0.4, "0.25" for 0.25: how slicers name a nozzle. */
export function nozzleName(value) {
  const m = /(\d+(?:\.\d+)?)/.exec(String(value ?? ""));
  if (!m) return null;
  return String(Math.round(Number(m[1]) * 100) / 100);
}
