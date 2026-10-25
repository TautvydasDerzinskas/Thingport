// Worker entry for normalizing off the page's main thread (see providers/makerworld/normalize.ts).
// Says "ready" first, so the page can tell a worker that never started from a failed conversion.

import { normalize3mf } from "./threeMfNormalizer";

export type WorkerReply = { type: "ready" } | { type: "done"; bytes: Uint8Array } | { type: "error"; error: string };

const reply = (message: WorkerReply, transfer: Transferable[] = []) => postMessage(message, { transfer });

self.addEventListener("message", async (event: MessageEvent<ArrayBuffer>) => {
  try {
    const { bytes } = await normalize3mf(new Uint8Array(event.data));
    reply({ type: "done", bytes }, [bytes.buffer]);
  } catch (err) {
    reply({ type: "error", error: err instanceof Error ? err.message : String(err) });
  }
});

reply({ type: "ready" });
