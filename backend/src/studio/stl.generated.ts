// GENERATED from frontend/src/studio/stl.ts by scripts/sync-studio.mjs. Don't edit it here:
// change frontend/src/studio/ and run npm run studio:sync.
// A design's bodies as a binary STL, as a slicer takes it: in mm, Z up. The page downloads it, and the server saves it
// to the library, so both write the same file.

/** Triangles, nine numbers each (in the world, counter-clockwise from outside), as one binary STL; null for none. */
export function binaryStl(parts: readonly Float32Array[]): Uint8Array<ArrayBuffer> | null {
  const count = parts.reduce((sum, part) => sum + part.length / 9, 0);
  if (!count) return null;
  const buffer = new ArrayBuffer(84 + count * 50);
  const view = new DataView(buffer);
  new Uint8Array(buffer, 0, 80).set(new TextEncoder().encode("Thingport Studio"));
  view.setUint32(80, count, true);
  let offset = 84;
  for (const triangles of parts) {
    for (let i = 0; i < triangles.length; i += 9) {
      const [ax, ay, az, bx, by, bz, cx, cy, cz] = triangles.subarray(i, i + 9);
      // The facet's normal, from its corners.
      const [ux, uy, uz] = [bx - ax, by - ay, bz - az];
      const [vx, vy, vz] = [cx - ax, cy - ay, cz - az];
      const normal = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      const length = Math.hypot(...normal) || 1;
      for (const value of [...normal.map((n) => n / length), ax, ay, az, bx, by, bz, cx, cy, cz]) {
        view.setFloat32(offset, value, true);
        offset += 4;
      }
      offset += 2;
    }
  }
  return new Uint8Array(buffer);
}
