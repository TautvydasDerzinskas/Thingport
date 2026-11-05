import type { MeshData, PartMeasure, StudioDocument, Vec3 } from "../../studio/document";
import type { Bounds } from "../../studio/commands";
import type { EvaluatedBody, checkDesign, measureBetween } from "../../studio/geometry";
import type { PrintCheckOptions } from "../../studio/printCheck";
import { designMeshes } from "./meshAssets";

// The page's side of the geometry worker: a design in, its bodies out, each with what picking a face or an edge needs;
// or a body's loose parts, for separating them.

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
  /** A body to find the loose parts of, instead of making bodies. */
  parts?: string;
  /** Bodies to measure the extents of, instead of making bodies. */
  bounds?: string[];
  /** Checks the design for printing, instead of making bodies. */
  check?: PrintCheckOptions;
  /** Two bodies to measure the gap or overlap between, instead of making bodies. */
  between?: [string, string];
};

export type GeometryAnswer = {
  id: number;
  bodies: WorkerBody[];
  errors: { id: string; message: string }[];
  parts?: PartMeasure[];
  bounds?: Record<string, Bounds>;
  check?: ReturnType<typeof checkDesign>;
  between?: ReturnType<typeof measureBetween>;
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
export function evaluateInWorker(designId: string, document: StudioDocument, ids?: string[]): Promise<GeometryAnswer> {
  return ask(designId, document, { ids });
}

/** A body's loose parts, as separate_parts would make them: what the server finds too, from the same code. */
export async function measurePartsInWorker(designId: string, document: StudioDocument, featureId: string) {
  const answer = await ask(designId, document, { parts: featureId });
  if (answer.failure !== undefined) throw new Error(answer.failure);
  return answer.parts ?? [];
}

/** Bodies' extents in the world, as align and lay_flat measure them: what the server finds too, from the same code. */
export async function measureBoundsInWorker(designId: string, document: StudioDocument, ids: string[]) {
  const answer = await ask(designId, document, { bounds: ids });
  if (answer.failure !== undefined) throw new Error(answer.failure);
  return answer.bounds ?? {};
}

/** The design checked for printing, as studio_check_print checks it. */
export async function checkInWorker(designId: string, document: StudioDocument, options: PrintCheckOptions) {
  const answer = await ask(designId, document, { check: options });
  if (answer.failure !== undefined || !answer.check) throw new Error(answer.failure);
  return answer.check;
}

/** The gap or overlap between two bodies, as studio_measure measures it. */
export async function measureBetweenInWorker(designId: string, document: StudioDocument, a: string, b: string) {
  const answer = await ask(designId, document, { between: [a, b] });
  if (answer.failure !== undefined || !answer.between) throw new Error(answer.failure);
  return answer.between;
}

async function ask(
  designId: string,
  document: StudioDocument,
  question: Pick<GeometryQuestion, "ids" | "parts" | "bounds" | "check" | "between">,
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
    hire().postMessage({ id, document, assets, ...question } satisfies GeometryQuestion);
  });
}
