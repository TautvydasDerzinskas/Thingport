import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { parentPort, workerData } from "node:worker_threads";
import { ADAPT_ZIP_OPTIONS, adapt3mf, type AdaptPlan, type PrinterRecipe } from "../adapter";

// Worker entry point for one adapted copy. Posts exactly one message, then exits.

export type Adapt3mfWorkerInput = {
  srcPath: string;
  destPath: string;
  plan: AdaptPlan;
  /** The catalogue's word on the plan's printer. */
  printer?: PrinterRecipe | null;
};
export type Adapt3mfWorkerResult = { status: "ok" } | { status: "error"; error: string };

async function run(): Promise<void> {
  const { srcPath, destPath, plan, printer } = workerData as Adapt3mfWorkerInput;
  let result: Adapt3mfWorkerResult;
  try {
    // Streamed, so a large project's model is never held as one string or its zip in memory.
    const { zip } = await adapt3mf(await fs.readFile(srcPath), plan, {
      modelContent: (xml) => Readable.from(xml, { objectMode: false }),
      printer,
    });
    await pipeline(
      zip.generateNodeStream({ type: "nodebuffer", streamFiles: true, ...ADAPT_ZIP_OPTIONS }),
      createWriteStream(destPath),
    );
    result = { status: "ok" };
  } catch (err) {
    result = { status: "error", error: err instanceof Error ? (err.stack ?? err.message) : String(err) };
  }
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a worker_threads port, not window.postMessage.
  parentPort?.postMessage(result);
}

void run();
