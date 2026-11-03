// Small vector and matrix sums for Studio's geometry. Matrices are 4x4, column-major, as manifold and three.js take them.

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a: Vec3): Vec3 => {
  const l = length(a);
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};
export const distance = (a: Vec3, b: Vec3): number => length(sub(a, b));

/** A unit vector square to `n`: the world's X laid onto the plane, or its Y where X is along `n`. */
export function perpendicular(n: Vec3): Vec3 {
  const x: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  return normalize(sub(x, scale(n, dot(x, n))));
}

export function applyMatrix(m: number[], [x, y, z]: Vec3): Vec3 {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

/** A direction through the matrix, without its translation. */
export function applyDirection(m: number[], [x, y, z]: Vec3): Vec3 {
  return [m[0] * x + m[4] * y + m[8] * z, m[1] * x + m[5] * y + m[9] * z, m[2] * x + m[6] * y + m[10] * z];
}

/** A surface normal through the matrix: by its inverse transpose, so a non-uniform scale keeps it square to the face. */
export function applyNormal(m: number[], n: Vec3): Vec3 {
  const inv = invertAffine(m);
  return normalize([
    inv[0] * n[0] + inv[1] * n[1] + inv[2] * n[2],
    inv[4] * n[0] + inv[5] * n[1] + inv[6] * n[2],
    inv[8] * n[0] + inv[9] * n[1] + inv[10] * n[2],
  ]);
}

/** The inverse of an affine matrix (rotation, scale and translation, no projection). */
export function invertAffine(m: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) throw new Error("A transform that flattens the body can't be undone");
  const r = [
    (e * i - f * h) / det,
    (c * h - b * i) / det,
    (b * f - c * e) / det,
    (f * g - d * i) / det,
    (a * i - c * g) / det,
    (c * d - a * f) / det,
    (d * h - e * g) / det,
    (b * g - a * h) / det,
    (a * e - b * d) / det,
  ];
  const t: Vec3 = [m[12], m[13], m[14]];
  const tx = -(r[0] * t[0] + r[1] * t[1] + r[2] * t[2]);
  const ty = -(r[3] * t[0] + r[4] * t[1] + r[5] * t[2]);
  const tz = -(r[6] * t[0] + r[7] * t[1] + r[8] * t[2]);
  return [r[0], r[3], r[6], 0, r[1], r[4], r[7], 0, r[2], r[5], r[8], 0, tx, ty, tz, 1];
}

/** The matrix that takes a frame's x, y and z to `x`, `y` and `z`, and its origin to `origin`. */
export function frameMatrix(x: Vec3, y: Vec3, z: Vec3, origin: Vec3): number[] {
  return [...x, 0, ...y, 0, ...z, 0, ...origin, 1];
}
