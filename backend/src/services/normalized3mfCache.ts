import fs from "node:fs/promises";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { MODEL_PREVIEW_MAX_MEMORY_MB, NORMALIZE_3MF_TIMEOUT_SECONDS, NORMALIZED_3MFS } from "../config";
import { workerBootstrap } from "../utils/workerBootstrap";
import type { NormalizeTarget } from "./threeMfNormalizer";
import type { Normalize3mfWorkerInput, Normalize3mfWorkerResult } from "./normalize3mfWorker";

// Part of the cache filename, so bumping it rebuilds older copies on next request.
const NORMALIZE_FORMAT_VERSION = 1;

const WORKER_BOOTSTRAP = workerBootstrap(__dirname, "normalize3mfWorker");

const TARGETS: readonly NormalizeTarget[] = ["flat", "orca"];

// The flat copy keeps its original filename; the others carry their target, so one plate can hold both.
function stem(plateId: string, target: NormalizeTarget): string {
  return target === "flat" ? plateId : `${plateId}.${target}`;
}

function normalizedPath(plateId: string, target: NormalizeTarget): string {
  return path.join(NORMALIZED_3MFS, `${stem(plateId, target)}.v${NORMALIZE_FORMAT_VERSION}.3mf`);
}

// Marks a source the normalizer rejected, so each request doesn't redo the work to fail again.
function errorPath(plateId: string, target: NormalizeTarget): string {
  return path.join(NORMALIZED_3MFS, `${stem(plateId, target)}.v${NORMALIZE_FORMAT_VERSION}.error`);
}

/** Sliced .gcode.3mf plates are left alone: dropping their G-code would leave nothing to print. */
export function isNormalizable3mf(filename: string): boolean {
  const lower = filename.toLowerCase();
  return lower.endsWith(".3mf") && !lower.endsWith(".gcode.3mf");
}

async function isFresh(file: string, srcMtimeMs: number): Promise<boolean> {
  try {
    return (await fs.stat(file)).mtimeMs >= srcMtimeMs;
  } catch {
    return false;
  }
}

function normalizeInWorker(input: Normalize3mfWorkerInput): Promise<Normalize3mfWorkerResult> {
  return new Promise((resolve) => {
    const worker = new Worker(WORKER_BOOTSTRAP, {
      eval: true,
      workerData: input,
      resourceLimits: { maxOldGenerationSizeMb: MODEL_PREVIEW_MAX_MEMORY_MB },
    });
    let settled = false;
    const finish = (result: Normalize3mfWorkerResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      worker.terminate().then(
        () => resolve(result),
        () => resolve(result),
      );
    };
    const timeout = setTimeout(
      () => finish({ status: "error", error: `took longer than ${NORMALIZE_3MF_TIMEOUT_SECONDS}s` }),
      NORMALIZE_3MF_TIMEOUT_SECONDS * 1000,
    );
    worker.once("message", finish);
    worker.once("error", (err) => finish({ status: "error", error: err.stack ?? String(err) }));
    worker.once("exit", (code) => finish({ status: "error", error: `worker exited (code ${code}) without a result` }));
  });
}

async function buildNormalized(plateId: string, srcPath: string, target: NormalizeTarget): Promise<string | null> {
  const dest = normalizedPath(plateId, target);
  const tmp = `${dest}.${process.pid}.${Date.now()}.tmp`;
  await fs.mkdir(NORMALIZED_3MFS, { recursive: true });
  try {
    const result = await normalizeInWorker({ srcPath, destPath: tmp, target });
    if (result.status === "ok") {
      await fs.rename(tmp, dest);
      await fs.rm(errorPath(plateId, target), { force: true });
      return dest;
    }
    console.warn(`Normalizing 3MF for plate ${plateId} failed; serving the original:`, result.error);
    await fs.writeFile(errorPath(plateId, target), result.error);
    return null;
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
  }
}

const inFlight = new Map<string, Promise<string | null>>();
// One at a time: a large 3MF is held in memory several times over while it's rewritten.
let queue: Promise<unknown> = Promise.resolve();

// A failure is retried after this, so a timeout on a busy server doesn't block the plate for good.
const ERROR_RETRY_MS = 60 * 60 * 1000;

async function recentlyFailed(plateId: string, target: NormalizeTarget, srcMtimeMs: number): Promise<boolean> {
  try {
    const { mtimeMs } = await fs.stat(errorPath(plateId, target));
    return mtimeMs >= srcMtimeMs && Date.now() - mtimeMs < ERROR_RETRY_MS;
  } catch {
    return false;
  }
}

function startJob(plateId: string, srcPath: string, target: NormalizeTarget): Promise<string | null> {
  const key = stem(plateId, target);
  let pending = inFlight.get(key);
  if (!pending) {
    pending = queue.then(() => buildNormalized(plateId, srcPath, target));
    queue = pending.catch(() => undefined);
    inFlight.set(key, pending);
    void pending.finally(() => inFlight.delete(key)).catch(() => undefined);
  }
  return pending;
}

export type Normalize3mfStatus = "ready" | "preparing" | "failed";

/** Starts a normalize in the background when there's no usable copy yet. Never throws. */
export async function normalize3mfStatus(
  plateId: string,
  srcPath: string,
  target: NormalizeTarget = "flat",
): Promise<Normalize3mfStatus> {
  try {
    const { mtimeMs } = await fs.stat(srcPath);
    if (await isFresh(normalizedPath(plateId, target), mtimeMs)) return "ready";
    if (inFlight.has(stem(plateId, target))) return "preparing";
    if (await recentlyFailed(plateId, target, mtimeMs)) return "failed";
    void startJob(plateId, srcPath, target).catch(() => undefined);
    return "preparing";
  } catch (err) {
    console.error(`Normalizing 3MF for plate ${plateId} failed:`, err);
    return "failed";
  }
}

/** Path to a slicer-compatible copy of the plate's 3MF, waiting for one if needed, or null to serve
 *  the original. Never throws. */
export async function normalized3mfFor(
  plateId: string,
  srcPath: string,
  target: NormalizeTarget = "flat",
): Promise<string | null> {
  try {
    const { mtimeMs } = await fs.stat(srcPath);
    if (await isFresh(normalizedPath(plateId, target), mtimeMs)) return normalizedPath(plateId, target);
    if (!inFlight.has(stem(plateId, target)) && (await recentlyFailed(plateId, target, mtimeMs))) return null;
    return await startJob(plateId, srcPath, target);
  } catch (err) {
    console.error(`Normalizing 3MF for plate ${plateId} failed:`, err);
    return null;
  }
}

export async function deleteNormalized3mf(plateId: string): Promise<void> {
  for (const target of TARGETS) {
    await fs.rm(normalizedPath(plateId, target), { force: true }).catch(() => undefined);
    await fs.rm(errorPath(plateId, target), { force: true }).catch(() => undefined);
  }
}
