// Runs the 3MF normalizer in a worker so a big model doesn't freeze the tab. Where the page's CSP
// won't allow a blob: worker, it runs here instead.

import { normalize3mf } from "../../normalizer/threeMfNormalizer";
import type { WorkerReply } from "../../normalizer/worker";
import workerSource from "../../normalizer/worker?worker";

class WorkerUnavailable extends Error {}

function normalizeInWorker(input: ArrayBuffer): Promise<Uint8Array> {
  const url = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
  return new Promise<Uint8Array>((resolve, reject) => {
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
        worker.postMessage(input);
        return;
      }
      worker.terminate();
      if (message.type === "done") resolve(message.bytes);
      else reject(new Error(message.error));
    });
    worker.addEventListener("error", (event) => {
      worker.terminate();
      reject(started ? new Error(event.message || "Normalizing failed") : new WorkerUnavailable());
    });
  }).finally(() => URL.revokeObjectURL(url));
}

export async function normalizeBambu3mf(input: ArrayBuffer): Promise<Uint8Array> {
  try {
    return await normalizeInWorker(input);
  } catch (err) {
    if (!(err instanceof WorkerUnavailable)) throw err;
  }
  // Let the "Normalizing…" state paint before the main thread is busy.
  await new Promise((resolve) => setTimeout(resolve, 50));
  return (await normalize3mf(new Uint8Array(input))).bytes;
}
