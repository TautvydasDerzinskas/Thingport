import type { ManifoldToplevel } from "manifold-3d";
import { library } from "../../sdk/libraries";
import type { StudioDocument } from "../../studio/document";
import { evaluateDesign, worldTriangles } from "../../studio/geometry";

/** The design's visible bodies as one binary STL, in mm, Z up, as slicers expect. Null when there's nothing to export. */
export async function designStl(doc: StudioDocument): Promise<Blob | null> {
  const wasm = (await library("manifold")) as unknown as ManifoldToplevel;
  const visible = new Set(doc.features.filter((feature) => feature.visible).map((feature) => feature.id));
  const parts = evaluateDesign(wasm, doc)
    .bodies.filter((body) => visible.has(body.id))
    .map(worldTriangles);
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
      // The facet's normal, from its corners: counter-clockwise from outside.
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
  return new Blob([buffer], { type: "model/stl" });
}
