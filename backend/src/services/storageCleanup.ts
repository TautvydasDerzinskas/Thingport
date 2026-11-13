import fs from "node:fs/promises";
import { prisma } from "../db";
import { createLogger } from "../logger";
import { formatBytes } from "../utils/formatBytes";
import { galleryImageFile, assetPath, removeAsset, removeFile } from "./modelAssets";
import { compressPreviewGlb, currentPreviewGlbs, isPreviewCompressed } from "./modelPreviewCache";
import { createNotification } from "./notificationService";
import { setPhotosPerModel, type PhotoKeep } from "./settingsService";
import { photosByModel, takeInventory } from "./storageInventory";

// Administration → Storage → Free up space: the clean-ups an admin picks, one after another in the background, with
// each one's progress for the dialog to follow. Every step is one file, so stopping part-way (a restart) leaves the
// rest as it was, and running it again picks up what's left.

const log = createLogger("storage-cleanup");

/** In the order they run: older versions go before the current previews are packed, so none is packed for nothing. */
export const CLEANUP_TASKS = ["old", "compress", "slicer", "photos"] as const;
export type CleanupTaskKey = (typeof CLEANUP_TASKS)[number];

export type CleanupTask = {
  key: CleanupTaskKey;
  status: "queued" | "running" | "done" | "failed";
  /** Files done out of all it found; `failed` of them couldn't be done and were left as they were. */
  done: number;
  total: number;
  failed: number;
  freed: number;
};

export type StorageCleanupRun = {
  running: boolean;
  startedAt: string;
  finishedAt: string | null;
  tasks: CleanupTask[];
  /** How many photos each model keeps, when "photos" is one of them. */
  keepPhotos: PhotoKeep | null;
};

let current: StorageCleanupRun | null = null;

export function currentStorageCleanup(): StorageCleanupRun | null {
  return current;
}

/** Starts the clean-ups asked for; null while one is already going. `onDone` runs once it's over, whatever happened. */
export function startStorageCleanup(
  userId: string | null,
  keys: CleanupTaskKey[],
  keepPhotos: PhotoKeep | null,
  onDone?: () => void,
): StorageCleanupRun | null {
  if (current?.running) return null;
  const run: StorageCleanupRun = {
    running: true,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    tasks: CLEANUP_TASKS.filter((key) => keys.includes(key) && (key !== "photos" || keepPhotos !== null)).map(
      (key) => ({ key, status: "queued", done: 0, total: 0, failed: 0, freed: 0 }),
    ),
    keepPhotos,
  };
  current = run;
  void execute(run, userId).finally(() => onDone?.());
  return run;
}

async function execute(run: StorageCleanupRun, userId: string | null): Promise<void> {
  try {
    // Read once, before anything changes: the old versions and slicer copies there are now.
    const inventory = await takeInventory();
    for (const task of run.tasks) {
      task.status = "running";
      try {
        if (task.key === "old") await removeAll(task, inventory.oldFiles);
        else if (task.key === "slicer") await removeAll(task, inventory.slicerFiles);
        else if (task.key === "compress") await compressPreviews(task);
        else if (task.key === "photos" && run.keepPhotos !== null) await trimPhotos(task, run.keepPhotos);
        task.status = "done";
      } catch (err) {
        log.error("clean-up failed", { task: task.key, error: err });
        task.status = "failed";
      }
    }
  } catch (err) {
    log.error("couldn't look over storage", { error: err });
    for (const task of run.tasks) if (task.status !== "done") task.status = "failed";
  } finally {
    run.running = false;
    run.finishedAt = new Date().toISOString();
  }
  const freed = run.tasks.reduce((sum, task) => sum + task.freed, 0);
  log.info("clean-up finished", { freed, tasks: run.tasks.map(({ key, status }) => `${key}:${status}`) });
  if (userId) {
    await createNotification(userId, {
      type: "general",
      title: `Freed ${formatBytes(freed)} of storage`,
      message: { key: "storageFreed", values: { size: formatBytes(freed) } },
      internalPath: "/admin-storage",
    }).catch(() => undefined);
  }
}

async function removeAll(task: CleanupTask, files: string[]): Promise<void> {
  task.total = files.length;
  for (const file of files) {
    task.freed += await removeFile(file);
    task.done += 1;
  }
}

async function compressPreviews(task: CleanupTask): Promise<void> {
  const unpacked: string[] = [];
  for (const { file } of await currentPreviewGlbs()) {
    const stats = await fs.stat(file).catch(() => null);
    if (stats && (await isPreviewCompressed(file, stats)) === false) unpacked.push(file);
  }
  task.total = unpacked.length;
  for (const file of unpacked) {
    const outcome = await compressPreviewGlb(file);
    if (outcome.status === "compressed") task.freed += outcome.before - outcome.after;
    else if (outcome.status === "failed") task.failed += 1;
    task.done += 1;
  }
}

/** Every photo past the first `keep` of each model, the cover always kept; imports keep as many from now on. */
async function trimPhotos(task: CleanupTask, keep: PhotoKeep): Promise<void> {
  await setPhotosPerModel(keep);
  const byModel = [...(await photosByModel()).entries()]
    .map(([printId, images]) => ({ printId, extra: images.slice(keep).filter((image) => !image.generated) }))
    .filter(({ extra }) => extra.length > 0);
  task.total = byModel.reduce((sum, { extra }) => sum + extra.length, 0);
  for (const { printId, extra } of byModel) {
    const print = await prisma.print.findUnique({ where: { id: printId }, select: { assetsPath: true } });
    const ids = extra.map((image) => image.id);
    await prisma.previewImage.deleteMany({ where: { id: { in: ids } } });
    for (const id of ids) {
      const file = assetPath(print?.assetsPath, galleryImageFile(id));
      task.freed += (await fs.stat(file).catch(() => null))?.size ?? 0;
      await removeAsset(print?.assetsPath, galleryImageFile(id));
      task.done += 1;
    }
  }
}
