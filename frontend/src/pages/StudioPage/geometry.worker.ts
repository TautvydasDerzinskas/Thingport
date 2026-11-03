/// <reference lib="webworker" />
import Module, { type ManifoldToplevel } from "manifold-3d";
import wasm from "manifold-3d/manifold.wasm?url";
import type { MeshData, StudioDocument } from "../../studio/document";
import { evaluateDesign } from "../../studio/geometry";
import { analyze } from "../../studio/topology";
import type { GeometryAnswer, GeometryQuestion, WorkerBody } from "./geometryClient";

// Makes a design's bodies off the page's thread, so a fillet or a shell that takes a second or two doesn't freeze the
// view, and works out each body's flat faces and straight edges for picking them.

let manifold: Promise<ManifoldToplevel> | null = null;
const reply = (answer: GeometryAnswer, transfer: Transferable[] = []) =>
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a worker's port, not window.postMessage.
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(answer, transfer);
const meshes = new Map<string, MeshData>();

self.addEventListener("message", async (event: MessageEvent<GeometryQuestion>) => {
  const { id, document, ids, assets } = event.data;
  for (const [assetId, mesh] of Object.entries(assets)) meshes.set(assetId, mesh);
  try {
    manifold ??= Module({ locateFile: () => wasm }).then((module) => {
      module.setup();
      return module;
    });
    const evaluation = evaluateDesign(await manifold, document as StudioDocument, ids, (assetId) =>
      meshes.get(assetId),
    );
    const bodies: WorkerBody[] = evaluation.bodies.map((body) => {
      const top = analyze(body.mesh);
      return {
        ...body,
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
