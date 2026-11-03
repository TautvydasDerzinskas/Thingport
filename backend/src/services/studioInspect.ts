import { Worker } from "node:worker_threads";
import type { StudioDocument } from "../studio/document.generated";
import { workerBootstrap } from "../utils/workerBootstrap";
import type { StudioView, StudioWorkerInput, StudioWorkerResult } from "./studioWorker";

// Measures and pictures a Studio design for an assistant, in a worker thread so a heavy design can't hold up the API.
// One at a time, and a design's answer is kept until it changes, as an assistant tends to ask twice.

const WORKER_BOOTSTRAP = workerBootstrap(__dirname, "studioWorker");
const TIMEOUT_MS = 30_000;
const MEMORY_MB = 512;
const CACHE_SIZE = 32;

const cache = new Map<string, StudioWorkerResult>();
let queue: Promise<unknown> = Promise.resolve();

function inWorker(input: StudioWorkerInput): Promise<StudioWorkerResult> {
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
      () => finish({ status: "error", error: `took longer than ${TIMEOUT_MS / 1000} s` }),
      TIMEOUT_MS,
    );
    worker.once("message", (result: StudioWorkerResult) => finish(result));
    worker.once("error", (error) => finish({ status: "error", error: error.stack ?? String(error) }));
    worker.once("exit", (code) => finish({ status: "error", error: `worker exited (code ${code}) without a result` }));
  });
}

/** `key` names the design as it is now (its id and version), so an unchanged one isn't made again. */
export function inspectStudioDesign(
  key: string,
  document: StudioDocument,
  render: { views: StudioView[]; size: number; color: string } | null,
): Promise<StudioWorkerResult> {
  const cacheKey = render ? `${key}:${render.views.join(",")}:${render.size}` : key;
  const known = cache.get(cacheKey);
  if (known) return Promise.resolve(known);
  const result = queue.then(() => inWorker({ document, render }));
  queue = result.catch(() => undefined);
  return result.then((outcome) => {
    if (outcome.status !== "error") {
      cache.set(cacheKey, outcome);
      if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
    }
    return outcome;
  });
}
