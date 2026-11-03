import type { MeshData, StudioDocument, Vec3 } from "../../studio/document";
import type { EvaluatedBody } from "../../studio/geometry";
import { designMeshes } from "./meshAssets";

// The page's side of the geometry worker: a design in, its bodies out, each with what picking a face or an edge needs.

export type WorkerBody = EvaluatedBody & {
  picking: {
    /** Each triangle's flat face. */
    faceOf: Int32Array;
    faces: { normal: Vec3 }[];
    /** Straight sharp edges, in the body's own frame. */
    edges: { a: Vec3; b: Vec3; convex: boolean }[];
  };
};

export type GeometryQuestion = {
  id: number;
  document: StudioDocument;
  ids?: string[];
  /** Imported meshes the worker hasn't had yet, by asset id. */
  assets: Record<string, MeshData>;
};

export type GeometryAnswer = {
  id: number;
  bodies: WorkerBody[];
  errors: { id: string; message: string }[];
  failure?: string;
};

let worker: Worker | null = null;
let next = 1;
const waiting = new Map<number, (answer: GeometryAnswer) => void>();
// What the worker already holds, so each mesh goes over once.
const sent = new Set<string>();

function hire(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./geometry.worker.ts", import.meta.url), { type: "module" });
  worker.addEventListener("message", (event: MessageEvent<GeometryAnswer>) => {
    waiting.get(event.data.id)?.(event.data);
    waiting.delete(event.data.id);
  });
  return worker;
}

/** The design's bodies (or only `ids`), made in the worker. */
export async function evaluateInWorker(
  designId: string,
  document: StudioDocument,
  ids?: string[],
): Promise<GeometryAnswer> {
  const lookup = await designMeshes(designId, document);
  const assets: Record<string, MeshData> = {};
  for (const feature of document.features) {
    if (feature.type !== "mesh" || sent.has(feature.asset_id)) continue;
    const mesh = lookup(feature.asset_id);
    if (!mesh) continue;
    // A copy goes over; the page keeps its own for exports.
    assets[feature.asset_id] = { positions: mesh.positions.slice(), indices: mesh.indices.slice() };
    sent.add(feature.asset_id);
  }
  const id = next++;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a worker, not a window.
    hire().postMessage({ id, document, ids, assets } satisfies GeometryQuestion);
  });
}
