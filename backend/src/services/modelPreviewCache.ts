import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { MODEL_PREVIEWS, STORAGE } from "../config";
import { prisma } from "../db";
import type { ModelImageOptions } from "./modelImageRender";
import { getSimplifyPreviews } from "./settingsService";
import {
  ASSET_SUBFOLDERS,
  assetExists,
  assetPath,
  assetTarget,
  legacyAssetPath,
  olderPlateFiles,
  plateAssetHome,
  plateGlbFile,
  plateRenderFile,
  removeAsset,
  COLOR_RENDER_FILE_TAG,
  PREVIEW_FORMAT_VERSION,
  RENDER_FILE_TAG,
  type AssetHome,
} from "./modelAssets";
import { isCompressedGltf } from "./glbCompression";
import { ensureAssetHome } from "./printService";
import { withStorageLock } from "../utils/storageLock";
import {
  isSmaller,
  packInWorker,
  PERMANENT_FAILURE_PREFIX,
  recentlyFailed,
  renderInWorker,
  scheduleRender,
  SIMPLIFY_TARGET_TRIANGLES,
  UNSUPPORTED_MARKER,
  type RenderOutcome,
} from "./modelPreviewJobs";

export { READER_VERSION, SIMPLIFY_TARGET_TRIANGLES } from "./modelPreviewJobs";

// Renders run in a worker thread under memory and time limits, so a pathological .3mf can't take
// down the server.

// A plate's 3D preview lives in its model's folder (`home`, the model's Print.assetsPath), with the model's other
// pictures; one the storage move hasn't brought over yet is still in the shared MODEL_PREVIEWS. Its failure and
// in-progress markers stay there for good: they're the cache's own bookkeeping, not the model's.

/** Where the plate's 3D preview is, or would be. */
export function modelPreviewGlbPath(plateId: string, home: AssetHome = null): string {
  return assetPath(home, plateGlbFile(plateId));
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

export function modelPreviewGlbExists(plateId: string, home: AssetHome = null): boolean {
  return assetExists(home, plateGlbFile(plateId));
}

const inFlight = new Set<string>();
const crashWarned = new Set<string>();

/** Never throws. Concurrent calls for the same plate no-op. `home` is looked up when not given. */
export async function generateModelPreviewGlb(plateId: string, srcPath: string, home?: AssetHome): Promise<void> {
  const where = home === undefined ? await plateAssetHome(plateId).catch(() => null) : home;
  if (modelPreviewGlbExists(plateId, where) || inFlight.has(plateId) || recentlyFailed(modelPreviewErrorPath(plateId)))
    return;
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

export function modelPreviewState(plateId: string, home: AssetHome = null): ModelPreviewState {
  if (modelPreviewGlbExists(plateId, home)) return "ready";
  if (inFlight.has(plateId)) return "generating";
  if (recentlyFailed(modelPreviewErrorPath(plateId))) {
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

/** Where a plate's new 3D preview goes: its model's folder, chosen now as the model may have moved while it was
 *  drawn. The shared folder for a plate that can't be looked up (no database, as in some tests; or deleted
 *  meanwhile, where the next clean-up or start-up move takes it away). */
async function newPreviewHome(plateId: string): Promise<string | null> {
  try {
    const plate = await prisma.plate.findUnique({ where: { id: plateId }, select: { printId: true } });
    return plate ? await ensureAssetHome(plate.printId) : null;
  } catch {
    return null;
  }
}

/** The plate's 3D previews of earlier formats, their failure markers, and a copy of the current one still in the
 *  shared folder when the new one went into the model's. */
async function removeOlderPreviews(plateId: string, home: string | null): Promise<void> {
  for (const file of olderPlateFiles(plateId).filter((older) => older.kind === "preview"))
    await removeAsset(home, file);
  if (home) await fs.rm(legacyAssetPath(plateGlbFile(plateId)), { force: true });
  await fs.rm(legacyModelPreviewErrorPath(plateId), { force: true });
  for (let version = 1; version < PREVIEW_FORMAT_VERSION; version++) {
    await fs.rm(path.join(MODEL_PREVIEWS, `${plateId}.v${version}.error`), { force: true });
  }
}

async function runGeneration(plateId: string, srcPath: string): Promise<void> {
  const pendingPath = modelPreviewPendingPath(plateId);
  const errorPath = modelPreviewErrorPath(plateId);
  // Drawn beside the markers, and only then put in the model's folder: the model may move while it waits.
  const tmp = path.join(MODEL_PREVIEWS, `${plateId}.v${PREVIEW_FORMAT_VERSION}.${process.pid}.${Date.now()}.tmp`);
  const packedTmp = `${tmp}.packed.tmp`;
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
      case "ok": {
        // Packed smaller before anyone downloads it, which takes a fraction of the drawing; one that can't be
        // packed (too big for the memory limit, say), or that packing doesn't make smaller, is served as drawn.
        const ready = (await packInWorker(tmp, packedTmp)) && (await isSmaller(packedTmp, tmp)) ? packedTmp : tmp;
        // Under the lock a move of files takes, so the model can't move between choosing its folder and the rename.
        const home = await withStorageLock(async () => {
          const chosen = await newPreviewHome(plateId);
          const dest = chosen ? assetTarget(chosen, plateGlbFile(plateId)) : legacyAssetPath(plateGlbFile(plateId));
          await fs.mkdir(path.dirname(dest), { recursive: true });
          await fs.rename(ready, dest);
          return chosen;
        });
        await fs.rm(errorPath, { force: true });
        await removeOlderPreviews(plateId, home);
        break;
      }
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
    await fs.rm(packedTmp, { force: true }).catch(() => undefined);
    await fs.rm(pendingPath, { force: true }).catch(() => undefined);
    inFlight.delete(plateId);
  }
}

export type CompressOutcome =
  { status: "compressed"; before: number; after: number } | { status: "skipped" | "failed" };

/**
 * Packs a 3D preview drawn before previews were packed (glbCompression.ts) in the render worker, after the renders
 * already waiting, and puts it back where it was. One already packed, gone, or replaced while it was being packed is left
 * as it is, as is one packing wouldn't make smaller, or that the worker couldn't pack (too big for its memory limit,
 * say): that one still shows, only larger. Never throws.
 */
export function compressPreviewGlb(file: string): Promise<CompressOutcome> {
  return scheduleRender("image", async () => {
    const tmp = `${file}.${process.pid}.${Date.now()}.packed.tmp`;
    try {
      const before = await fs.stat(file).catch(() => null);
      if (!before || (await readGlbSummary(file))?.compressed !== false) return { status: "skipped" };
      if (!(await packInWorker(file, tmp))) return { status: "failed" };
      const after = (await fs.stat(tmp)).size;
      if (after >= before.size) return { status: "skipped" };
      // Under the lock a move of files takes, so the model can't move between the check and the rename.
      const replaced = await withStorageLock(async () => {
        // Drawn again, moved or deleted while it was packed: what's there now isn't what was packed.
        const now = await fs.stat(file).catch(() => null);
        if (!now || now.mtimeMs !== before.mtimeMs || now.size !== before.size) return false;
        await fs.rename(tmp, file);
        return true;
      });
      return replaced ? { status: "compressed", before: before.size, after } : { status: "skipped" };
    } catch (err) {
      console.warn(`Couldn't pack the 3D preview ${path.basename(file)} smaller`, err);
      return { status: "failed" };
    } finally {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
    }
  });
}

export type QualityCheckOutcome = RenderOutcome;

/** The printability check (meshQuality.ts) in the render worker, under the same limits. It waits in the GLB queue
 * rather than behind pictures: someone has the model open and is watching it run. */
export function checkPlateQuality(plateId: string, srcPath: string, ext: string): Promise<QualityCheckOutcome> {
  return scheduleRender("glb", () =>
    renderPlateFile(plateId, srcPath, (from) => renderInWorker({ kind: "quality", srcPath: from, ext })),
  ).catch((err: unknown): RenderOutcome => ({ status: "error", error: String(err) }));
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
export const MODEL_IMAGE_EXTS = new Set([".stl", ".obj", ".3mf", ".step", ".stp", ".glb"]);
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
  if (fsSync.existsSync(cachedPath) || recentlyFailed(errorPath)) {
    if (!fsSync.existsSync(cachedPath)) {
      imagesInFlight.delete(key);
      return;
    }
    // Still run onReady, so a step that failed after an earlier render gets another go. Claimed meanwhile, as a
    // drawing is, so a second call doesn't run it twice at once.
    try {
      await onReady?.(cachedPath, modelColorImagePath(plateId, home), false);
    } catch (err) {
      console.error(`Model picture post-processing failed for plate ${plateId}:`, err);
    } finally {
      imagesInFlight.delete(key);
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
          await removeAsset(null, colorFile);
        }
        // Renders of an earlier look, which nothing shows any more.
        for (const older of olderPlateFiles(plateId).filter((candidate) => candidate.kind === "render")) {
          await removeAsset(assetsPath, older);
        }
        await fs.rm(errorPath, { force: true });
        await onReady?.(dest, colorDest, true);
      } else {
        const reason =
          outcome.status === "error" ? outcome.error : outcome.status === "limit" ? outcome.reason : outcome.status;
        if (outcome.status === "error") console.error(`Model picture failed for plate ${plateId}:`, reason);
        // Only an unexpected error is worth another try later; the rest would just repeat.
        await fs.writeFile(
          errorPath,
          outcome.status === "error"
            ? reason
            : outcome.status === "unsupported"
              ? UNSUPPORTED_MARKER
              : `${PERMANENT_FAILURE_PREFIX}${reason}`,
        );
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
  if (!recentlyFailed(errorPath)) return "generating";
  try {
    return fsSync.readFileSync(errorPath, "utf-8") === UNSUPPORTED_MARKER ? "unsupported" : "failed";
  } catch {
    return "failed";
  }
}

type GlbSummary = { triangles: number; simplified: boolean; compressed: boolean };

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
      extensionsUsed?: string[];
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
    return { triangles, simplified, compressed: isCompressedGltf(gltf) };
  } finally {
    await handle.close();
  }
}

// The answer for a file that hasn't changed since it was last read, so measuring storage again doesn't read every
// preview again.
const packedByFile = new Map<string, { key: string; compressed: boolean }>();

/** Whether a 3D preview is packed smaller already; null for one that isn't this renderer's or can't be read. */
export async function isPreviewCompressed(
  file: string,
  stats: { size: number; mtimeMs: number },
): Promise<boolean | null> {
  const key = `${stats.size}:${stats.mtimeMs}`;
  const known = packedByFile.get(file);
  if (known?.key === key) return known.compressed;
  const summary = await readGlbSummary(file).catch(() => null);
  if (!summary) return null;
  packedByFile.set(file, { key, compressed: summary.compressed });
  return summary.compressed;
}

/** Every 3D preview of the current format, in the models' folders and the old shared one, with the plate it's of. */
export async function currentPreviewGlbs(): Promise<{ plateId: string; file: string }[]> {
  const suffix = `.v${PREVIEW_FORMAT_VERSION}.glb`;
  const homes = await prisma.print.findMany({ where: { assetsPath: { not: null } }, select: { assetsPath: true } });
  const dirs = [
    MODEL_PREVIEWS,
    ...new Set(homes.map((print) => path.join(STORAGE, print.assetsPath!, ASSET_SUBFOLDERS.preview))),
  ];
  const found: { plateId: string; file: string }[] = [];
  for (const dir of dirs) {
    const names = await fs.readdir(dir).catch(() => [] as string[]);
    for (const name of names) {
      if (name.endsWith(suffix)) found.push({ plateId: name.slice(0, -suffix.length), file: path.join(dir, name) });
    }
  }
  return found;
}

/** Removes the cached previews the new setting would change, so they're rebuilt on next view. */
export async function dropPreviewsAffectedBySimplification(simplify: boolean): Promise<number> {
  let removed = 0;
  for (const { file } of await currentPreviewGlbs()) {
    const name = path.basename(file);
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
