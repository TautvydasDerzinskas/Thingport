// GENERATED from backend/src/adapter/transform.ts by scripts/sync-adapter.mjs. Don't edit it here:
// change backend/src/adapter/ and run npm run adapter:sync.
// 3MF transforms: a row-major 3x3 followed by the translation, twelve numbers in all.

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

/** out = A * B. */
export function multiplyTransform(aStr: string | null, bStr: string | null): number[] {
  const A = parseTransform(aStr);
  const B = parseTransform(bStr);
  const [a00, a01, a02, a10, a11, a12, a20, a21, a22, atx, aty, atz] = A;
  const [b00, b01, b02, b10, b11, b12, b20, b21, b22, btx, bty, btz] = B;
  return [
    a00 * b00 + a01 * b10 + a02 * b20,
    a00 * b01 + a01 * b11 + a02 * b21,
    a00 * b02 + a01 * b12 + a02 * b22,
    a10 * b00 + a11 * b10 + a12 * b20,
    a10 * b01 + a11 * b11 + a12 * b21,
    a10 * b02 + a11 * b12 + a12 * b22,
    a20 * b00 + a21 * b10 + a22 * b20,
    a20 * b01 + a21 * b11 + a22 * b21,
    a20 * b02 + a21 * b12 + a22 * b22,
    a00 * btx + a01 * bty + a02 * btz + atx,
    a10 * btx + a11 * bty + a12 * btz + aty,
    a20 * btx + a21 * bty + a22 * btz + atz,
  ];
}

export function formatNumber(n: number): string {
  if (Object.is(n, -0)) return "0";
  return String(Math.round(n * 1e7) / 1e7);
}

export function formatTransform(m: number[]): string {
  return m.map(formatNumber).join(" ");
}

export function transformPoint(point: number[], matrix: string): number[] {
  const M = parseTransform(matrix);
  const [x, y, z] = point;
  return [
    M[0] * x + M[1] * y + M[2] * z + M[9],
    M[3] * x + M[4] * y + M[5] * z + M[10],
    M[6] * x + M[7] * y + M[8] * z + M[11],
  ];
}
