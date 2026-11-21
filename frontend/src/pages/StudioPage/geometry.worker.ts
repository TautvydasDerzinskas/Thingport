/// <reference lib="webworker" />
import Module, { type ManifoldToplevel } from "manifold-3d";
import wasm from "manifold-3d/manifold.wasm?url";
import type { MeshData } from "../../studio/document";
import { checkDesign, evaluateDesign, measureBetween, measureBounds, measureParts } from "../../studio/geometry";
import { analyze } from "../../studio/topology";
import type { GeometryAnswer, GeometryQuestion, WorkerBody } from "./geometryClient";
import { loadFontsFor } from "./studioFonts";

// Makes a design's bodies off the page's thread, so a fillet or a shell that takes a second or two doesn't freeze the
// view, and works out each body's flat faces and straight edges for picking them; and measures, for separating, placing
// and checking a design.

let manifold: Promise<ManifoldToplevel> | null = null;
const reply = (answer: GeometryAnswer, transfer: Transferable[] = []) =>
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a worker's port, not window.postMessage.
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(answer, transfer);
const meshes = new Map<string, MeshData>();
const assetBuffers = new WeakSet<ArrayBufferLike>();
// Large imported meshes can be drawn directly. Build their picking topology when a tool asks for it.
const EAGER_PICKING_TRIANGLES = 200_000;

self.addEventListener("message", async (event: MessageEvent<GeometryQuestion>) => {
  const { id, document, ids, detailedIds, assets, parts, bounds, check, between } = event.data;
  const lookup = (assetId: string) => meshes.get(assetId);
  for (const [assetId, mesh] of Object.entries(assets)) {
    meshes.set(assetId, mesh);
    assetBuffers.add(mesh.positions.buffer);
    assetBuffers.add(mesh.indices.buffer);
  }
  try {
    manifold ??= Module({ locateFile: () => wasm }).then((module) => {
      module.setup();
      return module;
    });
    // The design's text needs its fonts here too.
    await loadFontsFor(document);
    if (check)
      return reply({ id, bodies: [], errors: [], check: checkDesign(await manifold, document, check, lookup) });
    if (between) {
      const measured = measureBetween(await manifold, document, between[0], between[1], lookup);
      return reply({ id, bodies: [], errors: [], between: measured });
    }
    if (bounds)
      return reply({ id, bodies: [], errors: [], bounds: measureBounds(await manifold, document, bounds, lookup) });
    if (parts)
      return reply({ id, bodies: [], errors: [], parts: measureParts(await manifold, document, parts, lookup) });
    const evaluation = evaluateDesign(await manifold, document, ids, lookup);
    const bodies: WorkerBody[] = evaluation.bodies.map((body) => {
      // An open body can return the asset itself. Keep its cached buffers when replying with transferable geometry.
      const { positions, indices } = body.mesh;
      const mesh = {
        positions: assetBuffers.has(positions.buffer) ? positions.slice() : positions,
        indices: assetBuffers.has(indices.buffer) ? indices.slice() : indices,
      };
      const dense = body.triangles > EAGER_PICKING_TRIANGLES;
      if (dense && !detailedIds?.includes(body.id))
        return { ...body, mesh, dense, picking: { faceOf: new Int32Array(), faces: [], edges: [] } };
      const top = analyze(mesh);
      return {
        ...body,
        mesh,
        dense,
        picking: {
          faceOf: top.faceOf,
          faces: top.faces.map((face) => ({ normal: face.normal })),
          edges: top.edges.map((edge) => ({ a: edge.a, b: edge.b, convex: edge.convex })),
        },
      };
    });
    const transfer = bodies.flatMap((body) => [
      body.mesh.positions.buffer,
      body.mesh.indices.buffer,
      body.picking.faceOf.buffer,
    ]);
    reply({ id, bodies, errors: evaluation.errors }, transfer);
  } catch (error) {
    reply({ id, bodies: [], errors: [], failure: error instanceof Error ? error.message : String(error) });
  }
});
