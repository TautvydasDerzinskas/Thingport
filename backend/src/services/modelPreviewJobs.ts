import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { MODEL_PREVIEW_MAX_MEMORY_MB, MODEL_PREVIEW_TIMEOUT_SECONDS } from "../config";
import { workerBootstrap } from "../utils/workerBootstrap";
import type { ModelPreviewWorkerInput, ModelPreviewWorkerResult } from "./modelPreviewWorker";

const ERROR_RETRY_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
// Failures that would just repeat (too complex, killed for limits) are never retried
// automatically. Delete the .error file to force a retry.
export const PERMANENT_FAILURE_PREFIX = "permanent: ";
const UNSUPPORTED_PREFIX = `${PERMANENT_FAILURE_PREFIX}unsupported`;
/** Kept with a file the readers refused as unsupported. Bump it when they learn to read more, and every file they
 *  refused gets another try: its 3D preview, its picture and its print check. */
export const READER_VERSION = 2;
export const UNSUPPORTED_MARKER = `${UNSUPPORTED_PREFIX} (reader ${READER_VERSION})`;

export function recentlyFailed(errorPath: string): boolean {
  try {
    const marker = fsSync.readFileSync(errorPath, "utf-8");
    if (marker.startsWith(UNSUPPORTED_PREFIX) && marker !== UNSUPPORTED_MARKER) return false;
    if (Date.now() - fsSync.statSync(errorPath).mtimeMs < ERROR_RETRY_COOLDOWN_MS) return true;
    return marker.startsWith(PERMANENT_FAILURE_PREFIX);
  } catch {
    return false;
  }
}

const WORKER_BOOTSTRAP = workerBootstrap(__dirname, "modelPreviewWorker");

const MEMORY_POLL_MS = 250;

// The CAD kernel a STEP file needs (services/stepLoader.ts) claims around 300 MB of wasm heap however small the
// file is, so a STEP render needs headroom the mesh formats don't: on a small host the watchdog below would
// otherwise kill every one of them for the kernel's fixed cost alone, and no STEP model would get a picture.
const STEP_MEMORY_FLOOR_MB = 640;
const STEP_EXTS = new Set([".step", ".stp"]);

function memoryLimitMb(input: ModelPreviewWorkerInput): number {
  // A GLB render reads 3MF only, so it never reaches the kernel and carries no extension to check.
  const step = "ext" in input && STEP_EXTS.has(input.ext);
  return step ? Math.max(MODEL_PREVIEW_MAX_MEMORY_MB, STEP_MEMORY_FLOOR_MB) : MODEL_PREVIEW_MAX_MEMORY_MB;
}

// Models rarely look different above 1M triangles on screen. Defined here so the server thread
// never loads the renderer.
export const SIMPLIFY_TARGET_TRIANGLES = 1_000_000;

export type RenderOutcome = ModelPreviewWorkerResult | { status: "limit"; reason: string };

/** Resolves once the thread is gone, so its memory is freed before the next render. Never
 * rejects. Mesh data lives outside the V8 heap cap, so a watchdog also polls process RSS. */
export function renderInWorker(
  input: ModelPreviewWorkerInput,
  timeoutSeconds = MODEL_PREVIEW_TIMEOUT_SECONDS,
): Promise<RenderOutcome> {
  return new Promise((resolve) => {
    const limitMb = memoryLimitMb(input);
    const maxGrowthBytes = limitMb * 1024 * 1024;
    const baselineRss = process.memoryUsage.rss();
    const worker = new Worker(WORKER_BOOTSTRAP, {
      eval: true,
      workerData: input,
      resourceLimits: { maxOldGenerationSizeMb: limitMb },
    });

    let settled = false;
    const finish = (outcome: RenderOutcome) => {
      if (settled) return;
      settled = true;
      clearInterval(watchdog);
      clearTimeout(timeout);
      worker.terminate().then(
        () => resolve(outcome),
        () => resolve(outcome),
      );
    };

    const watchdog = setInterval(() => {
      const grown = process.memoryUsage.rss() - baselineRss;
      if (grown > maxGrowthBytes) {
        finish({
          status: "limit",
          reason: `memory grew by ${Math.round(grown / 1024 / 1024)} MB (limit ${limitMb} MB)`,
        });
      }
    }, MEMORY_POLL_MS);
    const timeout = setTimeout(
      () => finish({ status: "limit", reason: `took longer than ${timeoutSeconds}s` }),
      timeoutSeconds * 1000,
    );

    worker.once("message", (result: ModelPreviewWorkerResult) => finish(result));
    worker.once("error", (err: NodeJS.ErrnoException) => {
      finish(
        err.code === "ERR_WORKER_OUT_OF_MEMORY"
          ? { status: "limit", reason: `worker heap exceeded ${limitMb} MB` }
          : { status: "error", error: err.stack ?? String(err) },
      );
    });
    worker.once("exit", (code) => finish({ status: "error", error: `worker exited (code ${code}) without a result` }));
  });
}

// One render at a time: parallel renders would multiply peak memory past the limit. A GLB someone is
// waiting on in the 3D viewer goes ahead of any dashboard picture, however many of those are queued.
type RenderJob = () => Promise<void>;
const glbJobs: RenderJob[] = [];
const imageJobs: RenderJob[] = [];
let rendering = false;

export function scheduleRender<T>(kind: "glb" | "image", job: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    (kind === "glb" ? glbJobs : imageJobs).push(async () => {
      try {
        resolve(await job());
      } catch (error) {
        reject(error);
      }
    });
    void drainRenders();
  });
}

async function drainRenders(): Promise<void> {
  if (rendering) return;
  rendering = true;
  try {
    for (let job = glbJobs.shift() ?? imageJobs.shift(); job; job = glbJobs.shift() ?? imageJobs.shift()) {
      await job();
    }
  } finally {
    rendering = false;
  }
}

/** Whether a packed preview came out smaller than the one it was packed from: a tiny one can grow. */
export async function isSmaller(packed: string, drawn: string): Promise<boolean> {
  const [after, before] = await Promise.all([fs.stat(packed), fs.stat(drawn)]);
  return after.size < before.size;
}

/** Packs a GLB smaller into `dest` in a worker of its own, after the render's has gone; false when it couldn't. */
export async function packInWorker(src: string, dest: string): Promise<boolean> {
  const outcome = await renderInWorker({ kind: "compress", srcPath: src, destPath: dest });
  if (outcome.status !== "ok") console.warn(`Couldn't pack the 3D preview ${path.basename(src)} smaller`, outcome);
  return outcome.status === "ok";
}
