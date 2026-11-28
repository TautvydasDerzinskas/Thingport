// Checking a 3MF before it's published to a site, and the fixed copy that's uploaded in its place (check.ts). Run in a
// worker, as it reads every mesh: the same limits as the adapter's copies.

import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { ADAPT_3MF_TIMEOUT_SECONDS, MODEL_PREVIEW_MAX_MEMORY_MB } from "../../config";
import { workerBootstrap } from "../../utils/workerBootstrap";
import type { ThreeMfCheckOptions, ThreeMfCheckResult, ThreeMfRules } from "./types";
import type { ThreeMfCheckWorkerInput, ThreeMfCheckWorkerResult } from "./worker";

export type * from "./types";

const WORKER_BOOTSTRAP = workerBootstrap(__dirname, "worker");

function inWorker(input: ThreeMfCheckWorkerInput): Promise<ThreeMfCheckWorkerResult> {
  return new Promise((resolve) => {
    const worker = new Worker(WORKER_BOOTSTRAP, {
      eval: true,
      workerData: input,
      resourceLimits: { maxOldGenerationSizeMb: MODEL_PREVIEW_MAX_MEMORY_MB },
    });
    let settled = false;
    const finish = (result: ThreeMfCheckWorkerResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      worker.terminate().then(
        () => resolve(result),
        () => resolve(result),
      );
    };
    const timeout = setTimeout(
      () => finish({ status: "error", error: `took longer than ${ADAPT_3MF_TIMEOUT_SECONDS}s` }),
      ADAPT_3MF_TIMEOUT_SECONDS * 1000,
    );
    worker.once("message", finish);
    worker.once("error", (err) => finish({ status: "error", error: err.stack ?? String(err) }));
    worker.once("exit", (code) => finish({ status: "error", error: `worker exited (code ${code}) without a result` }));
  });
}

async function run(input: ThreeMfCheckWorkerInput) {
  const outcome = await inWorker(input);
  if (outcome.status === "error") throw new Error(`3MF check failed: ${outcome.error}`);
  return outcome;
}

/** What the site would refuse of the 3MF at `srcPath`, and what Thingport would change in the copy it uploads. */
export async function checkThreeMf(
  srcPath: string,
  rules: ThreeMfRules,
  options: ThreeMfCheckOptions = {},
): Promise<ThreeMfCheckResult> {
  return (await run({ srcPath, destPath: null, rules, options })).result;
}

/** The copy to upload in the file's place written to `destPath`, where it needs one Thingport can make: `written`
 *  false when the file needs nothing, or has something only the slicer can fix (an issue with no fix). `destPath`
 *  must be new: a file already there, the checked one included, fails the call rather than being written over. */
export async function fixThreeMf(
  srcPath: string,
  destPath: string,
  rules: ThreeMfRules,
  options: ThreeMfCheckOptions = {},
): Promise<ThreeMfCheckResult & { written: boolean }> {
  // The worker writes beside it under a name of its own, and the copy goes in place only once it's whole and only
  // where nothing is yet. A worker stopped part way (its time up) leaves just that file, which goes either way.
  const staging = path.join(path.dirname(destPath), `.${path.basename(destPath)}.${randomUUID()}.part`);
  try {
    const { result, written } = await run({ srcPath, destPath: staging, rules, options });
    if (written) await fs.copyFile(staging, destPath, constants.COPYFILE_EXCL);
    return { ...result, written };
  } finally {
    await fs.rm(staging, { force: true });
  }
}
