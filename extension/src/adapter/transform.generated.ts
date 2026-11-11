// GENERATED from backend/src/adapter/transform.ts by scripts/sync-adapter.mjs. Don't edit it here:
// change backend/src/adapter/ and run npm run adapter:sync.
// 3MF transforms: twelve numbers, m00 m01 m02 m10 m11 m12 m20 m21 m22 m30 m31 m32, applied to a point as a row
// vector, (x y z 1) times the 4x4 matrix whose last column is 0 0 0 1. So x' = x*m00 + y*m10 + z*m20 + m30, and the
// translation is the last three numbers (3MF Core Specification, 3D Matrices).

export const IDENTITY = "1 0 0 0 1 0 0 0 1 0 0 0";

export function parseTransform(str: string | null | undefined): number[] {
  const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
  if (!str) return identity;
  const n = String(str)
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  return n.length !== 12 || n.some((x) => Number.isNaN(x)) ? identity : n;
}

/** The transform applying `inner` first and then `outer`, as a component's inside the object holding it. */
export function composeTransform(outer: string | null, inner: string | null): number[] {
  const O = parseTransform(outer);
  const I = parseTransform(inner);
  // Row `r` of inner's rows (the translation the fourth) times outer's 3x3, plus outer's translation for the fourth.
  return Array.from({ length: 12 }, (_, at) => {
    const r = Math.floor(at / 3);
    const c = at % 3;
    const row = I[r * 3] * O[c] + I[r * 3 + 1] * O[3 + c] + I[r * 3 + 2] * O[6 + c];
    return r === 3 ? row + O[9 + c] : row;
  });
}

export function formatNumber(n: number): string {
  if (Object.is(n, -0)) return "0";
  return String(Math.round(n * 1e7) / 1e7);
}

export function formatTransform(m: number[]): string {
  return m.map(formatNumber).join(" ");
}

/** `point` moved by `matrix` (a transform string, or one parseTransform read). */
export function transformPoint(point: number[], matrix: string | number[]): number[] {
  const M = typeof matrix === "string" ? parseTransform(matrix) : matrix;
  const [x, y, z] = point;
  return [
    x * M[0] + y * M[3] + z * M[6] + M[9],
    x * M[1] + y * M[4] + z * M[7] + M[10],
    x * M[2] + y * M[5] + z * M[8] + M[11],
  ];
}

/** Whether the transform mirrors, which turns a mesh's triangles inside out when it's baked into the vertices. */
export function mirrors(matrix: string | number[]): boolean {
  const M = typeof matrix === "string" ? parseTransform(matrix) : matrix;
  const det =
    M[0] * (M[4] * M[8] - M[5] * M[7]) - M[1] * (M[3] * M[8] - M[5] * M[6]) + M[2] * (M[3] * M[7] - M[4] * M[6]);
  return det < 0;
}
