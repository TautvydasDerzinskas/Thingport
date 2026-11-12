import fs from "node:fs/promises";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { ADAPT_3MF_TIMEOUT_SECONDS, ADAPTED_3MFS, MODEL_PREVIEW_MAX_MEMORY_MB } from "../config";
import { ADAPTER_VERSION, planKey, type AdaptPlan, type PrinterRecipe } from "../adapter";
import { workerBootstrap } from "../utils/workerBootstrap";
import type { Adapt3mfWorkerInput, Adapt3mfWorkerResult } from "./adapt3mfWorker";

// One copy per plate and plan (src/adapter/plan.ts), shared by every slicer that gets the same one. The adapter's
// version is part of the name, so a new one makes its copies again on next request. A plan for a printer comes with
// the catalogue's recipe for it, whose stamp is in the plan's name.

const WORKER_BOOTSTRAP = workerBootstrap(__dirname, "adapt3mfWorker");

function copyName(plateId: string, plan: AdaptPlan): string {
  return `${plateId}.${planKey(plan)}.v${ADAPTER_VERSION}`;
}

function adaptedPath(plateId: string, plan: AdaptPlan): string {
  return path.join(ADAPTED_3MFS, `${copyName(plateId, plan)}.3mf`);
}

// Marks a source the adapter rejected, so each request doesn't redo the work to fail again.
function errorPath(plateId: string, plan: AdaptPlan): string {
  return path.join(ADAPTED_3MFS, `${copyName(plateId, plan)}.error`);
}

/** Sliced .gcode.3mf plates are left alone: dropping their G-code would leave nothing to print. */
export function isAdaptable3mf(filename: string): boolean {
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

function adaptInWorker(input: Adapt3mfWorkerInput): Promise<Adapt3mfWorkerResult> {
  return new Promise((resolve) => {
    const worker = new Worker(WORKER_BOOTSTRAP, {
      eval: true,
      workerData: input,
      resourceLimits: { maxOldGenerationSizeMb: MODEL_PREVIEW_MAX_MEMORY_MB },
    });
    let settled = false;
    const finish = (result: Adapt3mfWorkerResult) => {
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

/** A copy being made. Cancelled when its plate's copies are deleted: it then leaves nothing behind. */
type Job = { result: Promise<string | null>; cancelled: boolean };

async function sourceStamp(srcPath: string): Promise<string | null> {
  try {
    const { size, mtimeMs } = await fs.stat(srcPath);
    return `${size}:${mtimeMs}`;
  } catch {
    return null;
  }
}

// What's kept is checked against `job` after it's in place, so a deletion that came meanwhile still removes it.
async function keep(job: Job, file: string): Promise<boolean> {
  if (!job.cancelled) return true;
  await fs.rm(file, { force: true });
  return false;
}

async function buildAdapted(
  job: Job,
  plateId: string,
  srcPath: string,
  plan: AdaptPlan,
  printer: PrinterRecipe | null,
): Promise<string | null> {
  if (job.cancelled) return null;
  const dest = adaptedPath(plateId, plan);
  const tmp = `${dest}.${process.pid}.${Date.now()}.tmp`;
  await fs.mkdir(ADAPTED_3MFS, { recursive: true });
  const before = await sourceStamp(srcPath);
  try {
    const result = await adaptInWorker({ srcPath, destPath: tmp, plan, printer });
    // Made from a file that has changed since (or gone): not a copy of what's there now, nor a reason to give up on it.
    if (job.cancelled || before === null || (await sourceStamp(srcPath)) !== before) return null;
    if (result.status === "ok") {
      await fs.rename(tmp, dest);
      if (!(await keep(job, dest))) return null;
      await fs.rm(errorPath(plateId, plan), { force: true });
      return dest;
    }
    console.warn(`Adapting the 3MF of plate ${plateId} (${planKey(plan)}) failed; serving the original:`, result.error);
    await fs.writeFile(errorPath(plateId, plan), result.error);
    await keep(job, errorPath(plateId, plan));
    return null;
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
  }
}

const inFlight = new Map<string, Job>();
// One at a time: a large 3MF is held in memory several times over while it's rewritten.
let queue: Promise<unknown> = Promise.resolve();

// A failure is retried after this, so a timeout on a busy server doesn't block the plate for good.
const ERROR_RETRY_MS = 60 * 60 * 1000;

async function recentlyFailed(plateId: string, plan: AdaptPlan, srcMtimeMs: number): Promise<boolean> {
  try {
    const { mtimeMs } = await fs.stat(errorPath(plateId, plan));
    return mtimeMs >= srcMtimeMs && Date.now() - mtimeMs < ERROR_RETRY_MS;
  } catch {
    return false;
  }
}

function startJob(
  plateId: string,
  srcPath: string,
  plan: AdaptPlan,
  printer: PrinterRecipe | null,
): Promise<string | null> {
  const key = copyName(plateId, plan);
  const running = inFlight.get(key);
  if (running) return running.result;
  const job: Job = { result: Promise.resolve(null), cancelled: false };
  job.result = queue.then(() => buildAdapted(job, plateId, srcPath, plan, printer));
  queue = job.result.catch(() => undefined);
  inFlight.set(key, job);
  void job.result.finally(() => inFlight.delete(key)).catch(() => undefined);
  return job.result;
}

export type Adapt3mfStatus = "ready" | "preparing" | "failed";

/** Starts making the copy in the background when there's no usable one yet. Never throws. */
export async function adapt3mfStatus(
  plateId: string,
  srcPath: string,
  plan: AdaptPlan,
  printer: PrinterRecipe | null = null,
): Promise<Adapt3mfStatus> {
  try {
    const { mtimeMs } = await fs.stat(srcPath);
    if (await isFresh(adaptedPath(plateId, plan), mtimeMs)) return "ready";
    if (inFlight.has(copyName(plateId, plan))) return "preparing";
    if (await recentlyFailed(plateId, plan, mtimeMs)) return "failed";
    void startJob(plateId, srcPath, plan, printer).catch(() => undefined);
    return "preparing";
  } catch (err) {
    console.error(`Adapting the 3MF of plate ${plateId} failed:`, err);
    return "failed";
  }
}

/** The copy's path, waiting for one if needed, or null to serve the original. Never throws. */
export async function adapted3mfFor(
  plateId: string,
  srcPath: string,
  plan: AdaptPlan,
  printer: PrinterRecipe | null = null,
): Promise<string | null> {
  try {
    const { mtimeMs } = await fs.stat(srcPath);
    if (await isFresh(adaptedPath(plateId, plan), mtimeMs)) return adaptedPath(plateId, plan);
    if (!inFlight.has(copyName(plateId, plan)) && (await recentlyFailed(plateId, plan, mtimeMs))) return null;
    return await startJob(plateId, srcPath, plan, printer);
  } catch (err) {
    console.error(`Adapting the 3MF of plate ${plateId} failed:`, err);
    return null;
  }
}

/** Every copy of the plate's, whatever it was made for, and any still being made. */
export async function deleteAdapted3mfs(plateId: string): Promise<void> {
  const prefix = `${plateId}.`;
  for (const [key, job] of inFlight) if (key.startsWith(prefix)) job.cancelled = true;
  const names = await fs.readdir(ADAPTED_3MFS).catch(() => [] as string[]);
  await Promise.all(
    names
      .filter((name) => name.startsWith(prefix))
      .map((name) => fs.rm(path.join(ADAPTED_3MFS, name), { force: true }).catch(() => undefined)),
  );
}
