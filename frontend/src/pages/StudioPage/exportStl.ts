import type { ManifoldToplevel } from "manifold-3d";
import { library } from "../../sdk/libraries";
import type { StudioDocument } from "../../studio/document";
import { evaluateDesign, worldTriangles } from "../../studio/geometry";
import { binaryStl } from "../../studio/stl";
import { designMeshes } from "./meshAssets";

/** The design's visible bodies as one binary STL, in mm, Z up, as slicers expect. Null when there's nothing to export. */
export async function designStl(designId: string, doc: StudioDocument): Promise<Blob | null> {
  const wasm = (await library("manifold")) as unknown as ManifoldToplevel;
  const visible = new Set(doc.features.filter((feature) => feature.visible).map((feature) => feature.id));
  const parts = evaluateDesign(wasm, doc, undefined, await designMeshes(designId, doc))
    .bodies.filter((body) => visible.has(body.id))
    .map(worldTriangles);
  const stl = binaryStl(parts);
  return stl ? new Blob([stl], { type: "model/stl" }) : null;
}
