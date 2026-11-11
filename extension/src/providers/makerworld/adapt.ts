// Runs the 3MF adapter in a worker so a big model doesn't freeze the tab. Where the page's CSP won't allow a blob:
// worker, it runs here instead.

import { adaptFile, type AdaptOutcome } from "../../adapting/run";
import type { WorkerReply, WorkerRequest } from "../../adapting/worker";
import workerSource from "../../adapting/worker?worker";

class WorkerUnavailable extends Error {}

function adaptInWorker(request: WorkerRequest): Promise<AdaptOutcome> {
  const url = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
  return new Promise<AdaptOutcome>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(url);
    } catch {
      reject(new WorkerUnavailable());
      return;
    }
    let started = false;
    worker.addEventListener("message", (event: MessageEvent<WorkerReply>) => {
      const message = event.data;
      if (message.type === "ready") {
        started = true;
        // Copied rather than transferred, so the fallback still has it if this fails.
        worker.postMessage(request);
        return;
      }
      worker.terminate();
      if (message.type === "done") resolve({ bytes: message.bytes, output: message.output });
      else reject(new Error(message.error));
    });
    worker.addEventListener("error", (event) => {
      worker.terminate();
      reject(started ? new Error(event.message || "Adapting failed") : new WorkerUnavailable());
    });
  }).finally(() => URL.revokeObjectURL(url));
}

/** The copy of a MakerWorld 3MF made for `slicer` (the instance's; null without one), or the file when it needs none. */
export async function adaptMakerworld3mf(input: ArrayBuffer, slicer: string | null): Promise<AdaptOutcome> {
  try {
    return await adaptInWorker({ input, slicer });
  } catch (err) {
    if (!(err instanceof WorkerUnavailable)) throw err;
  }
  // Let the "Adapting…" state paint before the main thread is busy.
  await new Promise((resolve) => setTimeout(resolve, 50));
  return adaptFile(new Uint8Array(input), slicer);
}
