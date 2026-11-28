import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { parentPort, workerData } from "node:worker_threads";
import type JSZip from "jszip";
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

/** The copy written to a new file at `destPath`, never over one already there, least of all the one checked. A write
 *  that fails takes away what it made, so the same path can be tried again. */
async function writeNew(zip: JSZip, destPath: string) {
  const out = createWriteStream(destPath, { flags: "wx" });
  let made = false;
  out.once("open", () => {
    made = true;
  });
  try {
    await pipeline(zip.generateNodeStream({ type: "nodebuffer", streamFiles: true, ...ADAPT_ZIP_OPTIONS }), out);
  } catch (err) {
    if (made) await fs.rm(destPath, { force: true }).catch(() => {});
    throw err;
  }
}

async function run(): Promise<void> {
  const { srcPath, destPath, rules, options } = workerData as ThreeMfCheckWorkerInput;
  let message: ThreeMfCheckWorkerResult;
  try {
    const { result, zip } = await runThreeMfCheck(await fs.readFile(srcPath), rules, options);
    if (destPath && zip) await writeNew(zip, destPath);
    message = { status: "ok", result, written: Boolean(destPath && zip) };
  } catch (err) {
    message = { status: "error", error: err instanceof Error ? (err.stack ?? err.message) : String(err) };
  }
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a worker_threads port, not window.postMessage.
  parentPort?.postMessage(message);
}

void run();
