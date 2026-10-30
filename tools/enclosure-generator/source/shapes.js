// Solids to build an enclosure from: outlines in 2D, and prisms of them standing on the floor or set in any plane.

import { polygon } from "./csg.js";

/** How many straight segments make a circle of radius `r`, at each quality. */
const EDGE = { draft: 1.6, normal: 0.8, high: 0.4 };
export function segmentsFor(r, quality = "normal") {
  return Math.max(12, Math.min(128, Math.round((2 * Math.PI * r) / (EDGE[quality] ?? EDGE.normal) / 4) * 4));
}

/** A circle's outline, anticlockwise. */
export function circle(r, segments, cx = 0, cy = 0) {
  return Array.from({ length: segments }, (_, i) => {
    const a = (2 * Math.PI * i) / segments;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
}

/** A rectangle's outline centred on the origin, its corners rounded by `r`, anticlockwise. */
export function roundedRect(w, l, r, quality = "normal") {
  const radius = Math.max(0, Math.min(r, w / 2, l / 2));
  if (radius < 0.05) {
    return [
      [-w / 2, -l / 2],
      [w / 2, -l / 2],
      [w / 2, l / 2],
      [-w / 2, l / 2],
    ];
  }
  const quarter = Math.max(2, segmentsFor(radius, quality) / 4);
  const out = [];
  const corners = [
    [w / 2 - radius, -l / 2 + radius, -Math.PI / 2],
    [w / 2 - radius, l / 2 - radius, 0],
    [-w / 2 + radius, l / 2 - radius, Math.PI / 2],
    [-w / 2 + radius, -l / 2 + radius, Math.PI],
  ];
  for (const [cx, cy, start] of corners)
    for (let i = 0; i <= quarter; i++) {
      const a = start + (Math.PI / 2) * (i / quarter);
      out.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a)]);
    }
  return out;
}

/** A slot with round ends, `w` long and `h` high, centred. */
export function stadium(w, h, quality = "normal") {
  return roundedRect(w, h, Math.min(w, h) / 2, quality);
}

/** A D-sub connector's trapezoid, wide side up. */
export function trapezoid(w, h) {
  const bottom = Math.max(0.1, w - 2 * h * Math.tan((10 * Math.PI) / 180));
  return [
    [-bottom / 2, -h / 2],
    [bottom / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ];
}

/** An outline with its two lower corners cut off by `c`, as XT60 and HDMI sockets have. */
export function chamferedBottom(w, h, c) {
  const k = Math.min(c, w / 3, h / 2);
  return [
    [-w / 2 + k, -h / 2],
    [w / 2 - k, -h / 2],
    [w / 2, -h / 2 + k],
    [w / 2, h / 2],
    [-w / 2, h / 2],
    [-w / 2, -h / 2 + k],
  ];
}

/** `outline` turned by `degrees` about the origin. */
export function rotate2(outline, degrees) {
  if (!degrees) return outline;
  const a = (degrees * Math.PI) / 180;
  const [c, s] = [Math.cos(a), Math.sin(a)];
  return outline.map(([x, y]) => [x * c - y * s, x * s + y * c]);
}

export const move2 = (outline, dx, dy) => outline.map(([x, y]) => [x + dx, y + dy]);

/**
 * A prism of a convex anticlockwise `outline`, drawn in the plane through `origin` spanned by unit vectors `a` and
 * `b`, from `d0` to `d1` along a × b.
 */
export function prismIn(points, origin, a, b, d0, d1) {
  // Points closer than a micron are one: where round ends meet, a rounded outline repeats its corner.
  const outline = points.filter((p, i) => {
    const q = points[(i + 1) % points.length];
    return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-3;
  });
  if (outline.length < 3) return [];
  const n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const at = ([x, y], d) => [0, 1, 2].map((i) => origin[i] + x * a[i] + y * b[i] + d * n[i]);
  const low = outline.map((p) => at(p, d0));
  const high = outline.map((p) => at(p, d1));
  const faces = [polygon(low.slice().reverse()), polygon(high)];
  for (let i = 0; i < outline.length; i++) {
    const j = (i + 1) % outline.length;
    faces.push(polygon([low[i], low[j], high[j], high[i]]));
  }
  return faces.filter(Boolean);
}

/** A prism of `outline` (in the XY plane) from z0 to z1. */
export const prism = (outline, z0, z1) => prismIn(outline, [0, 0, 0], [1, 0, 0], [0, 1, 0], z0, z1);

/** A box between two corners. */
export const box = (x0, y0, z0, x1, y1, z1) =>
  prism(
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ],
    z0,
    z1,
  );

/** An upright cylinder. */
export const cylinder = (cx, cy, r, z0, z1, quality) => prism(circle(r, segmentsFor(r, quality), cx, cy), z0, z1);
