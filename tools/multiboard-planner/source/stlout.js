// A mesh as binary STL.
//
// Why not 3MF, which is smaller: writing one means building the geometry as XML and deflating it, and that is
// seconds of held thread for a plate of three hundred thousand triangles -- measured at about five seconds
// each, against twelve milliseconds for this. A wall is a dozen plates, so the choice is a minute of a locked
// window against a larger download, and the download is the cheaper of the two. The zip around these is
// stored rather than deflated for the same reason.

/** One mesh as the bytes of a binary .stl: an 80-byte header, the triangle count, then 50 bytes each. */
export function writeBinaryStl(mesh, { name = "model" } = {}) {
  const { vertices, triangles } = mesh;
  const count = triangles.length / 3;
  const out = new Uint8Array(84 + count * 50);
  const view = new DataView(out.buffer);
  // The header is free text and no reader parses it, but a name in there helps anyone looking at the bytes.
  const header = new TextEncoder().encode(`Thingport ${name}`.slice(0, 79));
  out.set(header, 0);
  view.setUint32(80, count, true);
  let at = 84;
  for (let i = 0; i < triangles.length; i += 3) {
    const a = triangles[i] * 3,
      b = triangles[i + 1] * 3,
      c = triangles[i + 2] * 3;
    const ax = vertices[a],
      ay = vertices[a + 1],
      az = vertices[a + 2];
    const bx = vertices[b],
      by = vertices[b + 1],
      bz = vertices[b + 2];
    const cx = vertices[c],
      cy = vertices[c + 1],
      cz = vertices[c + 2];
    // The facet normal, which slicers use to tell inside from outside.
    const ux = bx - ax,
      uy = by - ay,
      uz = bz - az;
    const vx = cx - ax,
      vy = cy - ay,
      vz = cz - az;
    let nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len > 0) {
      nx /= len;
      ny /= len;
      nz /= len;
    }
    view.setFloat32(at, nx, true);
    view.setFloat32(at + 4, ny, true);
    view.setFloat32(at + 8, nz, true);
    view.setFloat32(at + 12, ax, true);
    view.setFloat32(at + 16, ay, true);
    view.setFloat32(at + 20, az, true);
    view.setFloat32(at + 24, bx, true);
    view.setFloat32(at + 28, by, true);
    view.setFloat32(at + 32, bz, true);
    view.setFloat32(at + 36, cx, true);
    view.setFloat32(at + 40, cy, true);
    view.setFloat32(at + 44, cz, true);
    at += 50;
  }
  return out;
}
