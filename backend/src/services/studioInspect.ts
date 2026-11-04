import { Worker } from "node:worker_threads";
import type { StudioDocument } from "../studio/document.generated";
import type { PrintCheckOptions } from "../studio/printCheck.generated";
import type { TraceSettings } from "../studio/trace.generated";
import { workerBootstrap } from "../utils/workerBootstrap";
import type { StudioView, StudioWorkerInput, StudioWorkerResult } from "./studioWorker";

// Studio's work in a worker thread, so a heavy design or file can't hold up the API: measuring and picturing a design
// for an assistant, finding a body's parts, reading a library model into a design, and tracing a picture. One at a time; a design's
// measurements are kept until it changes, as an assistant tends to ask twice.

const WORKER_BOOTSTRAP = workerBootstrap(__dirname, "studioWorker");
const INSPECT_TIMEOUT_MS = 30_000;
// A big STEP file takes a while to read.
const IMPORT_TIMEOUT_MS = 180_000;
const MEMORY_MB = 1024;
const CACHE_SIZE = 32;

const cache = new Map<string, StudioWorkerResult>();
let queue: Promise<unknown> = Promise.resolve();

function inWorker(input: StudioWorkerInput, timeoutMs: number): Promise<StudioWorkerResult> {
  return new Promise((resolve) => {
    const worker = new Worker(WORKER_BOOTSTRAP, {
      eval: true,
      workerData: input,
      resourceLimits: { maxOldGenerationSizeMb: MEMORY_MB },
    });
    let settled = false;
    const finish = (result: StudioWorkerResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      void worker.terminate().finally(() => resolve(result));
    };
    const timeout = setTimeout(
      () => finish({ status: "error", error: `took longer than ${timeoutMs / 1000} s` }),
      timeoutMs,
    );
    worker.once("message", (result: StudioWorkerResult) => finish(result));
    worker.once("error", (error) => finish({ status: "error", error: error.stack ?? String(error) }));
    worker.once("exit", (code) => finish({ status: "error", error: `worker exited (code ${code}) without a result` }));
  });
}

function queued(input: StudioWorkerInput, timeoutMs: number): Promise<StudioWorkerResult> {
  const result = queue.then(() => inWorker(input, timeoutMs));
  queue = result.catch(() => undefined);
  return result;
}

/** `key` names the design as it is now (its id and version), so an unchanged one isn't made again. */
export function inspectStudioDesign(
  key: string,
  document: StudioDocument,
  assetDir: string,
  render: { views: StudioView[]; size: number; color: string } | null,
): Promise<StudioWorkerResult> {
  const cacheKey = render ? `${key}:${render.views.join(",")}:${render.size}` : key;
  const known = cache.get(cacheKey);
  if (known) return Promise.resolve(known);
  return queued({ kind: "inspect", document, assetDir, render }, INSPECT_TIMEOUT_MS).then((outcome) => {
    if (outcome.status !== "error") {
      cache.set(cacheKey, outcome);
      if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
    }
    return outcome;
  });
}

/** One body's flat faces and straight edges, in the world, for an assistant to name them by. */
export function describeStudioBody(
  key: string,
  document: StudioDocument,
  assetDir: string,
  featureId: string,
): Promise<StudioWorkerResult> {
  const cacheKey = `${key}:describe:${featureId}`;
  const known = cache.get(cacheKey);
  if (known) return Promise.resolve(known);
  return queued({ kind: "describe", document, assetDir, featureId }, INSPECT_TIMEOUT_MS).then((outcome) => {
    if (outcome.status !== "error") {
      cache.set(cacheKey, outcome);
      if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
    }
    return outcome;
  });
}

/** A body's loose parts, as separate_parts makes them. Not kept: the command changes the design straight after. */
export function measureStudioParts(
  document: StudioDocument,
  assetDir: string,
  featureId: string,
): Promise<StudioWorkerResult> {
  return queued({ kind: "parts", document, assetDir, featureId }, INSPECT_TIMEOUT_MS);
}

/** Reads a library model's file into `destPath`, the design's own copy of its mesh. */
export function importStudioMesh(srcPath: string, ext: string, destPath: string): Promise<StudioWorkerResult> {
  return queued({ kind: "import", srcPath, ext, destPath }, IMPORT_TIMEOUT_MS);
}

/** Traces one of a design's pictures, as trace_picture does. */
export function traceStudioPicture(picturePath: string, settings: TraceSettings): Promise<StudioWorkerResult> {
  return queued({ kind: "trace", picturePath, settings }, INSPECT_TIMEOUT_MS);
}

/** The design's visible bodies as one STL, for saving it to the library. */
export function studioStl(document: StudioDocument, assetDir: string): Promise<StudioWorkerResult> {
  return queued({ kind: "stl", document, assetDir }, IMPORT_TIMEOUT_MS);
}

/** Bodies' extents in the world, for align and lay_flat. Not kept: the command changes the design straight after. */
export function measureStudioBounds(
  document: StudioDocument,
  assetDir: string,
  ids: string[],
): Promise<StudioWorkerResult> {
  return queued({ kind: "bounds", document, assetDir, ids }, INSPECT_TIMEOUT_MS);
}

/** Whether a design will print as it's placed. Kept, as an assistant tends to ask again before changing anything. */
export function checkStudioPrint(
  key: string,
  document: StudioDocument,
  assetDir: string,
  options: PrintCheckOptions,
): Promise<StudioWorkerResult> {
  const cacheKey = `${key}:check:${JSON.stringify(options)}`;
  const known = cache.get(cacheKey);
  if (known) return Promise.resolve(known);
  return queued({ kind: "check", document, assetDir, options }, INSPECT_TIMEOUT_MS).then((outcome) => {
    if (outcome.status !== "error") {
      cache.set(cacheKey, outcome);
      if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
    }
    return outcome;
  });
}

/** How two bodies stand to each other: the gap between them or how much they overlap. */
export function measureStudioBetween(
  document: StudioDocument,
  assetDir: string,
  a: string,
  b: string,
): Promise<StudioWorkerResult> {
  return queued({ kind: "between", document, assetDir, a, b }, INSPECT_TIMEOUT_MS);
}
