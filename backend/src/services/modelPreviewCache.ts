import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { MODEL_PREVIEWS, MODEL_PREVIEW_MAX_MEMORY_MB, MODEL_PREVIEW_TIMEOUT_SECONDS, STORAGE } from "../config";
import { prisma } from "../db";
import type { ModelImageOptions } from "./modelImageRender";
import type { ModelPreviewWorkerInput, ModelPreviewWorkerResult } from "./modelPreviewWorker";
import type { QualityReport } from "./meshQuality";
import { getSimplifyPreviews } from "./settingsService";
import {
  assetExists,
  assetPath,
  assetTarget,
  plateAssetHome,
  plateRenderFile,
  removeAsset,
  COLOR_RENDER_FILE_TAG,
  RENDER_FILE_TAG,
  type AssetHome,
} from "./modelAssets";
import { ensureAssetHome } from "./printService";
import { workerBootstrap } from "../utils/workerBootstrap";

// Renders run in a worker thread under memory and time limits, so a pathological .3mf can't take
// down the server.

// Part of the cache filename, so bumping it regenerates older GLBs on next view. Failure markers
// carry it too, so a file an older renderer refused gets another attempt.
const PREVIEW_FORMAT_VERSION = 4;

export function modelPreviewGlbPath(plateId: string): string {
  return path.join(MODEL_PREVIEWS, `${plateId}.v${PREVIEW_FORMAT_VERSION}.glb`);
}

function legacyModelPreviewGlbPath(plateId: string): string {
  return path.join(MODEL_PREVIEWS, `${plateId}.glb`);
}

function modelPreviewErrorPath(plateId: string): string {
  return path.join(MODEL_PREVIEWS, `${plateId}.v${PREVIEW_FORMAT_VERSION}.error`);
}

function legacyModelPreviewErrorPath(plateId: string): string {
  return path.join(MODEL_PREVIEWS, `${plateId}.error`);
}

/** Left behind when the process died mid-render (e.g. OOM), so that plate isn't retried
 * automatically. Delete it to allow another attempt. */
function modelPreviewPendingPath(plateId: string): string {
  return path.join(MODEL_PREVIEWS, `${plateId}.pending`);
}

export function modelPreviewGlbExists(plateId: string): boolean {
  return fsSync.existsSync(modelPreviewGlbPath(plateId));
}

const ERROR_RETRY_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
// Failures that would just repeat (too complex, killed for limits) are never retried
// automatically. Delete the .error file to force a retry.
const PERMANENT_FAILURE_PREFIX = "permanent: ";
const UNSUPPORTED_MARKER = `${PERMANENT_FAILURE_PREFIX}unsupported`;

function recentlyFailed(plateId: string, errorPath = modelPreviewErrorPath(plateId)): boolean {
  try {
    const stat = fsSync.statSync(errorPath);
    if (Date.now() - stat.mtimeMs < ERROR_RETRY_COOLDOWN_MS) return true;
    return fsSync.readFileSync(errorPath, "utf-8").startsWith(PERMANENT_FAILURE_PREFIX);
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

type RenderOutcome =
  | { status: "ok"; colored?: boolean }
  | { status: "checked"; report: QualityReport }
  | { status: "too-complex" }
  | { status: "unsupported" }
  | { status: "limit"; reason: string }
  | { status: "error"; error: string };

/** Resolves once the thread is gone, so its memory is freed before the next render. Never
 * rejects. Mesh data lives outside the V8 heap cap, so a watchdog also polls process RSS. */
function renderInWorker(
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

const inFlight = new Set<string>();
const crashWarned = new Set<string>();

// One render at a time: parallel renders would multiply peak memory past the limit. A GLB someone is
// waiting on in the 3D viewer goes ahead of any dashboard picture, however many of those are queued.
type RenderJob = () => Promise<void>;
const glbJobs: RenderJob[] = [];
const imageJobs: RenderJob[] = [];
let rendering = false;

function scheduleRender(kind: "glb" | "image", job: RenderJob): Promise<void> {
  return new Promise((resolve) => {
    (kind === "glb" ? glbJobs : imageJobs).push(() => job().finally(resolve));
    void drainRenders();
  });
}

async function drainRenders(): Promise<void> {
  if (rendering) return;
  rendering = true;
  try {
    for (let job = glbJobs.shift() ?? imageJobs.shift(); job; job = glbJobs.shift() ?? imageJobs.shift()) {
      // A job settles its own promise; one failing mustn't stop the rest.
      await job().catch(() => undefined);
    }
  } finally {
    rendering = false;
  }
}

/** Never throws. Concurrent calls for the same plate no-op. */
export async function generateModelPreviewGlb(plateId: string, srcPath: string): Promise<void> {
  if (modelPreviewGlbExists(plateId) || inFlight.has(plateId) || recentlyFailed(plateId)) return;
  if (fsSync.existsSync(modelPreviewPendingPath(plateId))) {
    if (!crashWarned.has(plateId)) {
      crashWarned.add(plateId);
      console.warn(
        `Model preview for plate ${plateId} was interrupted by a previous crash; not retrying. ` +
          `Delete ${modelPreviewPendingPath(plateId)} to allow another attempt.`,
      );
    }
    return;
  }
  inFlight.add(plateId);
  await scheduleRender("glb", () => runGeneration(plateId, srcPath));
}

/** "failed" won't retry soon; "unsupported" is left to the browser's loaders. */
export type ModelPreviewState = "ready" | "generating" | "failed" | "unsupported";

export function modelPreviewState(plateId: string): ModelPreviewState {
  if (modelPreviewGlbExists(plateId)) return "ready";
  if (inFlight.has(plateId)) return "generating";
  if (recentlyFailed(plateId)) {
    try {
      return fsSync.readFileSync(modelPreviewErrorPath(plateId), "utf-8") === UNSUPPORTED_MARKER
        ? "unsupported"
        : "failed";
    } catch {
      return "failed";
    }
  }
  if (fsSync.existsSync(modelPreviewPendingPath(plateId))) return "failed";
  return "generating";
}

async function runGeneration(plateId: string, srcPath: string): Promise<void> {
  const pendingPath = modelPreviewPendingPath(plateId);
  const errorPath = modelPreviewErrorPath(plateId);
  const dest = modelPreviewGlbPath(plateId);
  const tmp = `${dest}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(pendingPath, new Date().toISOString());
    const simplify = await getSimplifyPreviews();
    const outcome = await renderPlateFile(plateId, srcPath, (from) =>
      renderInWorker({
        kind: "glb",
        srcPath: from,
        destPath: tmp,
        options: { simplifyTo: simplify ? SIMPLIFY_TARGET_TRIANGLES : null },
      }),
    );
    switch (outcome.status) {
      case "ok":
        await fs.rename(tmp, dest);
        await fs.rm(errorPath, { force: true });
        await fs.rm(legacyModelPreviewGlbPath(plateId), { force: true });
        await fs.rm(legacyModelPreviewErrorPath(plateId), { force: true });
        break;
      case "too-complex":
        await fs.writeFile(errorPath, `${PERMANENT_FAILURE_PREFIX}too-complex`);
        break;
      case "unsupported":
        await fs.writeFile(errorPath, UNSUPPORTED_MARKER);
        break;
      case "limit":
        console.warn(`Model preview for plate ${plateId} stopped: ${outcome.reason}`);
        await fs.writeFile(errorPath, `${PERMANENT_FAILURE_PREFIX}${outcome.reason}`);
        break;
      case "error":
        console.error(`Model preview generation failed for plate ${plateId}:`, outcome.error);
        await fs.writeFile(errorPath, outcome.error);
        break;
    }
  } catch (err) {
    console.error(`Model preview generation failed for plate ${plateId}:`, err);
    await fs.writeFile(errorPath, String(err)).catch(() => undefined);
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    await fs.rm(pendingPath, { force: true }).catch(() => undefined);
    inFlight.delete(plateId);
  }
}

export type QualityCheckOutcome = RenderOutcome;

/** The printability check (meshQuality.ts) in the render worker, under the same limits. It waits in the GLB queue
 * rather than behind pictures: someone has the model open and is watching it run. */
export function checkPlateQuality(plateId: string, srcPath: string, ext: string): Promise<QualityCheckOutcome> {
  return new Promise((resolve) => {
    void scheduleRender("glb", async () => {
      const outcome = await renderPlateFile(plateId, srcPath, (from) =>
        renderInWorker({ kind: "quality", srcPath: from, ext }),
      ).catch((err: unknown): RenderOutcome => ({ status: "error", error: String(err) }));
      resolve(outcome);
    });
  });
}

/** The plate's file where it is when its render starts: renders wait in a queue, and the file may have been renamed
 *  (and so moved) since, as when a newly imported print profile is named apart from another. */
async function currentPlatePath(plateId: string, queuedPath: string): Promise<string> {
  if (fsSync.existsSync(queuedPath)) return queuedPath;
  const plate = await prisma.plate
    .findUnique({ where: { id: plateId }, select: { storagePath: true, sourcePath: true } })
    .catch(() => null);
  const managed = plate ? path.join(STORAGE, plate.storagePath) : null;
  if (managed && fsSync.existsSync(managed)) return managed;
  return plate?.sourcePath && fsSync.existsSync(plate.sourcePath) ? plate.sourcePath : queuedPath;
}

/** Renders from the plate's current file, and once more from where it went if it was moved away mid-render. */
async function renderPlateFile<T extends { status: string }>(
  plateId: string,
  queuedPath: string,
  render: (srcPath: string) => Promise<T>,
): Promise<T> {
  const srcPath = await currentPlatePath(plateId, queuedPath);
  const outcome = await render(srcPath);
  if (outcome.status !== "error" || fsSync.existsSync(srcPath)) return outcome;
  const moved = await currentPlatePath(plateId, srcPath);
  return moved !== srcPath && fsSync.existsSync(moved) ? render(moved) : outcome;
}

// Pictures of a model, drawn on the server on transparent: a "render" for model cards, the dashboard lists and
// tag mosaics, in one colour the browser tints, and -- for a model that carries colours of its own -- a second
// one in those, which the model's page shows as its cover. Both come out of one render, since the cost is
// loading the model rather than drawing it. They share the GLB queue and memory limit, so they wait behind GLBs.

/** Server-side picture formats; a STEP file goes through the CAD kernel first (services/stepLoader.ts). */
export const MODEL_IMAGE_EXTS = new Set([".stl", ".obj", ".3mf", ".step", ".stp"]);
export type ModelImageKind = "render";
type ModelImageKindDef = {
  /** Part of the filename, with a version, so changing a look regenerates older pictures on next request. */
  file: string;
  options: ModelImageOptions;
  timeoutSeconds: number;
};
// A card's render is the model's main picture, so a heavy model gets a while.
const MODEL_IMAGE_KINDS: Record<ModelImageKind, ModelImageKindDef> = {
  // Grey shading the browser tints with the render colour, so one picture serves every theme and colour.
  render: {
    file: RENDER_FILE_TAG,
    options: { size: 512, color: "#ffffff", view: "threeQuarter", ambient: 0.35, fill: 0.2 },
    timeoutSeconds: 60,
  },
};

/** In the model's pictures folder (`home`, its Print.assetsPath); the failure markers stay with the GLB cache. */
export function modelImagePath(plateId: string, home: AssetHome, kind: ModelImageKind = "render"): string {
  return assetPath(home, plateRenderFile(plateId, MODEL_IMAGE_KINDS[kind].file));
}
function modelImageErrorPath(plateId: string, kind: ModelImageKind): string {
  return path.join(MODEL_PREVIEWS, `${plateId}.${MODEL_IMAGE_KINDS[kind].file}.error`);
}

export function canRenderModelImage(filename: string): boolean {
  return MODEL_IMAGE_EXTS.has(path.extname(filename).toLowerCase());
}

const imagesInFlight = new Set<string>();

/** The picture of a model in its own colours, where it had any to draw; null for one that didn't. */
export function modelColorImagePath(plateId: string, home: AssetHome): string | null {
  const file = plateRenderFile(plateId, COLOR_RENDER_FILE_TAG);
  return assetExists(home, file) ? assetPath(home, file) : null;
}

/** Never throws. Concurrent calls for the same picture no-op; a failure isn't retried for a while. `onReady` runs
 *  with the finished picture's path, the colour one beside it where the model carried colours, and whether this
 *  call is what drew them -- a step that should happen once per render, rather than on every view, asks that. */
export async function generateModelImage(
  plateId: string,
  srcPath: string,
  filename: string,
  kind: ModelImageKind = "render",
  onReady?: (imagePath: string, colorPath: string | null, drawn: boolean) => Promise<void>,
): Promise<void> {
  const errorPath = modelImageErrorPath(plateId, kind);
  const key = `${kind}:${plateId}`;
  if (!canRenderModelImage(filename) || imagesInFlight.has(key)) return;
  // Claimed before looking up where the picture is, so a second call meanwhile doesn't draw it again.
  imagesInFlight.add(key);
  const file = plateRenderFile(plateId, MODEL_IMAGE_KINDS[kind].file);
  const colorFile = plateRenderFile(plateId, COLOR_RENDER_FILE_TAG);
  const home = await plateAssetHome(plateId).catch(() => null);
  const cachedPath = assetPath(home, file);
  if (fsSync.existsSync(cachedPath) || recentlyFailed(plateId, errorPath)) {
    imagesInFlight.delete(key);
    if (!fsSync.existsSync(cachedPath)) return;
    // Still run onReady, so a step that failed after an earlier render gets another go.
    try {
      await onReady?.(cachedPath, modelColorImagePath(plateId, home), false);
    } catch (err) {
      console.error(`Model picture post-processing failed for plate ${plateId}:`, err);
    }
    return;
  }
  await scheduleRender("image", async () => {
    // Drawn beside the GLBs, and only then put in the model's folder: the model may move while it waits.
    const stem = path.join(MODEL_PREVIEWS, `${plateId}.${MODEL_IMAGE_KINDS[kind].file}.${process.pid}.${Date.now()}`);
    const tmp = `${stem}.tmp`;
    const colorTmp = `${stem}.color.tmp`;
    try {
      const outcome = await renderPlateFile(plateId, srcPath, (from) =>
        renderInWorker(
          {
            kind: "image",
            srcPath: from,
            destPath: tmp,
            colorDestPath: colorTmp,
            ext: path.extname(filename).toLowerCase(),
            image: MODEL_IMAGE_KINDS[kind].options,
          },
          MODEL_IMAGE_KINDS[kind].timeoutSeconds,
        ),
      );
      if (outcome.status === "ok") {
        const plate = await prisma.plate.findUnique({ where: { id: plateId }, select: { printId: true } });
        // Deleted while it was drawn.
        if (!plate) return;
        const assetsPath = await ensureAssetHome(plate.printId);
        const dest = assetTarget(assetsPath, file);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.rename(tmp, dest);
        await removeAsset(null, file);
        let colorDest: string | null = null;
        if (outcome.colored) {
          colorDest = assetTarget(assetsPath, colorFile);
          await fs.rename(colorTmp, colorDest);
        }
        await fs.rm(errorPath, { force: true });
        await onReady?.(dest, colorDest, true);
      } else {
        const reason =
          outcome.status === "error" ? outcome.error : outcome.status === "limit" ? outcome.reason : outcome.status;
        if (outcome.status === "error") console.error(`Model picture failed for plate ${plateId}:`, reason);
        // Only an unexpected error is worth another try later; the rest would just repeat.
        await fs.writeFile(errorPath, outcome.status === "error" ? reason : `${PERMANENT_FAILURE_PREFIX}${reason}`);
      }
    } catch (err) {
      console.error(`Model picture failed for plate ${plateId}:`, err);
      await fs.writeFile(errorPath, String(err)).catch(() => undefined);
    } finally {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      await fs.rm(colorTmp, { force: true }).catch(() => undefined);
      imagesInFlight.delete(key);
    }
  });
}

/** "unsupported" is a file the renderer read but couldn't draw, e.g. a 3MF layout it doesn't know. */
export function modelImageState(
  plateId: string,
  home: AssetHome,
  kind: ModelImageKind = "render",
): "ready" | "generating" | "failed" | "unsupported" {
  if (assetExists(home, plateRenderFile(plateId, MODEL_IMAGE_KINDS[kind].file))) return "ready";
  if (imagesInFlight.has(`${kind}:${plateId}`)) return "generating";
  const errorPath = modelImageErrorPath(plateId, kind);
  if (!recentlyFailed(plateId, errorPath)) return "generating";
  try {
    return fsSync.readFileSync(errorPath, "utf-8") === UNSUPPORTED_MARKER ? "unsupported" : "failed";
  } catch {
    return "failed";
  }
}

type GlbSummary = { triangles: number; simplified: boolean };

/** Reads only a cached GLB's JSON chunk. Null for a file this renderer didn't write. */
async function readGlbSummary(file: string): Promise<GlbSummary | null> {
  const handle = await fs.open(file, "r");
  try {
    const header = Buffer.alloc(20);
    await handle.read(header, 0, 20, 0);
    if (header.readUInt32LE(0) !== 0x46546c67 || header.readUInt32LE(16) !== 0x4e4f534a) return null;
    const json = Buffer.alloc(header.readUInt32LE(12));
    await handle.read(json, 0, json.length, 20);
    const gltf = JSON.parse(json.toString("utf-8")) as {
      accessors?: { count: number }[];
      meshes?: { primitives: { indices?: number }[] }[];
      nodes?: { extras?: { thingportPreview?: string } }[];
    };
    let triangles = 0;
    for (const mesh of gltf.meshes ?? []) {
      for (const primitive of mesh.primitives) {
        if (primitive.indices !== undefined) triangles += (gltf.accessors?.[primitive.indices]?.count ?? 0) / 3;
      }
    }
    const meta = gltf.nodes?.find((node) => typeof node.extras?.thingportPreview === "string")?.extras
      ?.thingportPreview;
    const simplified = meta ? Boolean((JSON.parse(meta) as { simplified?: unknown }).simplified) : false;
    return { triangles, simplified };
  } finally {
    await handle.close();
  }
}

/** Removes the cached previews the new setting would change, so they're rebuilt on next view. */
export async function dropPreviewsAffectedBySimplification(simplify: boolean): Promise<number> {
  const suffix = `.v${PREVIEW_FORMAT_VERSION}.glb`;
  let removed = 0;
  let names: string[];
  try {
    names = await fs.readdir(MODEL_PREVIEWS);
  } catch {
    return 0;
  }
  for (const name of names) {
    if (!name.endsWith(suffix)) continue;
    const file = path.join(MODEL_PREVIEWS, name);
    try {
      const summary = await readGlbSummary(file);
      if (!summary) continue;
      const affected = simplify
        ? !summary.simplified && summary.triangles > SIMPLIFY_TARGET_TRIANGLES
        : summary.simplified;
      if (affected) {
        await fs.rm(file, { force: true });
        removed++;
      }
    } catch (err) {
      console.warn(`Couldn't check cached preview ${name} after a simplification change`, err);
    }
  }
  return removed;
}
