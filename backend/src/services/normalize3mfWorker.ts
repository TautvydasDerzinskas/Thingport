import fs from "node:fs/promises";
import { parentPort, workerData } from "node:worker_threads";
import { type NormalizeTarget, writeNormalized3mf } from "./threeMfNormalizer";

// Worker entry point for one normalize. Posts exactly one message, then exits.

export type Normalize3mfWorkerInput = { srcPath: string; destPath: string; target: NormalizeTarget };
export type Normalize3mfWorkerResult = { status: "ok" } | { status: "error"; error: string };

async function run(): Promise<void> {
  const { srcPath, destPath, target } = workerData as Normalize3mfWorkerInput;
  let result: Normalize3mfWorkerResult;
  try {
    await writeNormalized3mf(await fs.readFile(srcPath), destPath, target);
    result = { status: "ok" };
  } catch (err) {
    result = { status: "error", error: err instanceof Error ? (err.stack ?? err.message) : String(err) };
  }
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a worker_threads port, not window.postMessage.
  parentPort?.postMessage(result);
}

void run();
