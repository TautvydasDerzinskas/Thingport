// Runs the 3MF adapter in a worker so a big model doesn't freeze the tab. Where the page's CSP won't allow a blob:
// worker, it runs here instead.

import { t } from "../shared/i18n";
import { adaptFile, type AdaptOutcome, type AdaptPrinterTarget } from "./run";
import type { WorkerReply, WorkerRequest } from "./worker";
import workerSource from "./worker?worker";

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
      reject(started ? new Error(event.message || t("adaptSite.adaptingFailed")) : new WorkerUnavailable());
    });
  }).finally(() => URL.revokeObjectURL(url));
}

/** The copy of a model's 3MF made for `slicer` (and `printer`), or the file itself when it needs none. */
export async function adaptBytes(
  input: ArrayBuffer,
  slicer: string | null,
  printer: AdaptPrinterTarget | null,
): Promise<AdaptOutcome> {
  try {
    return await adaptInWorker({ input, slicer, printer });
  } catch (err) {
    if (!(err instanceof WorkerUnavailable)) throw err;
  }
  // Let the "Adapting…" state paint before the main thread is busy.
  await new Promise((resolve) => setTimeout(resolve, 50));
  return adaptFile(new Uint8Array(input), slicer, printer);
}
