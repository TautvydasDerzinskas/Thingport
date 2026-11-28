import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { parentPort, workerData } from "node:worker_threads";
import { ADAPT_ZIP_OPTIONS } from "../../adapter";
import { runThreeMfCheck } from "./check";
import type { ThreeMfCheckOptions, ThreeMfCheckResult, ThreeMfRules } from "./types";

// Worker entry point for one check, and the copy it makes when asked. Posts exactly one message, then exits.

export type ThreeMfCheckWorkerInput = {
  srcPath: string;
  /** Where the copy goes, a path no file has yet; null to only check. */
  destPath: string | null;
  rules: ThreeMfRules;
  options: ThreeMfCheckOptions;
};
export type ThreeMfCheckWorkerResult =
  { status: "ok"; result: ThreeMfCheckResult; written: boolean } | { status: "error"; error: string };

async function run(): Promise<void> {
  const { srcPath, destPath, rules, options } = workerData as ThreeMfCheckWorkerInput;
  let message: ThreeMfCheckWorkerResult;
  try {
    const { result, zip } = await runThreeMfCheck(await fs.readFile(srcPath), rules, options);
    if (destPath && zip)
      await pipeline(
        zip.generateNodeStream({ type: "nodebuffer", streamFiles: true, ...ADAPT_ZIP_OPTIONS }),
        // Made new, never over a file already there: least of all the one checked.
        createWriteStream(destPath, { flags: "wx" }),
      );
    message = { status: "ok", result, written: Boolean(destPath && zip) };
  } catch (err) {
    message = { status: "error", error: err instanceof Error ? (err.stack ?? err.message) : String(err) };
  }
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a worker_threads port, not window.postMessage.
  parentPort?.postMessage(message);
}

void run();
