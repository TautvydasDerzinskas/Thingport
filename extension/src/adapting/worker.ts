// Worker entry for adapting off the page's main thread (see providers/makerworld/adapt.ts).
// Says "ready" first, so the page can tell a worker that never started from a failed conversion.

import { adaptFile, type AdaptOutcome } from "./run";

export type WorkerRequest = { input: ArrayBuffer; slicer: string | null };
export type WorkerReply = { type: "ready" } | ({ type: "done" } & AdaptOutcome) | { type: "error"; error: string };

const reply = (message: WorkerReply, transfer: Transferable[] = []) => postMessage(message, { transfer });

self.addEventListener("message", async (event: MessageEvent<WorkerRequest>) => {
  try {
    const { bytes, output } = await adaptFile(new Uint8Array(event.data.input), event.data.slicer);
    reply({ type: "done", bytes, output }, [bytes.buffer]);
  } catch (err) {
    reply({ type: "error", error: err instanceof Error ? err.message : String(err) });
  }
});

reply({ type: "ready" });
