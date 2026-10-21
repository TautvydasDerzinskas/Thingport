import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { BUNDLES, DESCRIPTION_IMAGES, MODEL_PREVIEWS, PREVIEWS, THUMBS } from "../config";
import { prisma } from "../db";
import { createLogger } from "../logger";
import { createNotification } from "./notificationService";
import { isLegacyRender } from "./modelAssets";
import { getStorageTemplate, reorganizeManagedPrints } from "./printService";

// Moving every user's model files to the storage structure an admin saved. It runs in the background, followed by
// a bar at the bottom of the app; it can't be stopped, since half the files in one layout and half in another is
// what it's there to end. Its template is kept as a setting while it runs, so a restart carries on with it.
// The first start after pictures and supporting files moved in beside the model files runs one too, to bring those
// saved before over from the shared folders they were in.

const log = createLogger("storage-move");
const PENDING_KEY = "storage_move_pending";

export type StorageMoveRun = {
  running: boolean;
  startedAt: string;
  finishedAt: string | null;
  /** Models: each one's files move together. */
  total: number;
  done: number;
  /** Files moved so far. */
  moved: number;
  /** Models whose files couldn't move, and stay where they were. */
  skipped: number;
};

/** No `userId` for the move a start-up runs on its own: nobody asked, so nobody's notified. */
type Pending = { template: string; userId: string | null };

let current: StorageMoveRun | null = null;

export function currentStorageMove(): StorageMoveRun | null {
  return current;
}

/** Starts moving every model's files to `template`; null while a move is already going. */
export function startStorageMove(userId: string | null, template: string): StorageMoveRun | null {
  if (current?.running) return null;
  current = {
    running: true,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    total: 0,
    done: 0,
    moved: 0,
    skipped: 0,
  };
  void run(current, { template, userId });
  return current;
}

async function run(state: StorageMoveRun, pending: Pending): Promise<void> {
  const value = pending as unknown as Prisma.InputJsonValue;
  try {
    await prisma.setting.upsert({
      where: { key: PENDING_KEY },
      create: { key: PENDING_KEY, value },
      update: { value },
    });
    log.info("moving files", { template: pending.template });
    const { moved, skipped } = await reorganizeManagedPrints(pending.template, undefined, (progress) => {
      Object.assign(state, progress);
    });
    log.info("files moved", { moved, skipped });
    // Every model's files came over, so what's left in the old shared folders belongs to none.
    if (!skipped) await removeLegacyLeftovers();
    if (pending.userId && (moved || skipped)) await notifyDone(pending.userId, moved, skipped);
  } catch (err) {
    log.error("moving files failed", { error: err });
    if (!pending.userId) return;
    await createNotification(pending.userId, {
      type: "general",
      title: "Couldn't finish moving model files",
      body: "Some files are still in the old storage structure. Save the structure again in Administration > Storage to move the rest.",
      internalPath: "/admin-storage",
    }).catch(() => undefined);
  } finally {
    await prisma.setting.deleteMany({ where: { key: PENDING_KEY } }).catch(() => undefined);
    state.running = false;
    state.finishedAt = new Date().toISOString();
  }
}

async function notifyDone(userId: string, moved: number, skipped: number): Promise<void> {
  const parts = [`${moved} file${moved === 1 ? "" : "s"} now follow${moved === 1 ? "s" : ""} the storage structure.`];
  if (skipped) {
    parts.push(
      `${skipped} model${skipped === 1 ? "'s files" : "s' files"} couldn't be moved and stayed where they were; see the server log.`,
    );
  }
  await createNotification(userId, {
    type: "general",
    title: "Model files moved",
    body: parts.join(" "),
    internalPath: "/admin-storage",
  });
}

const LEGACY_FOLDERS = [THUMBS, PREVIEWS, DESCRIPTION_IMAGES, BUNDLES];

/** The old shared folders, and the renders among the 3D previews, once a move has brought every model's files over:
 *  whatever is still there is a model's that's gone, such as the render of a plate deleted before renders were
 *  removed with it. Otherwise it would start the move again on every start. */
async function removeLegacyLeftovers(): Promise<void> {
  for (const dir of LEGACY_FOLDERS) await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  const names = await fs.readdir(MODEL_PREVIEWS).catch(() => [] as string[]);
  for (const name of names.filter(isLegacyRender)) {
    await fs.rm(path.join(MODEL_PREVIEWS, name), { force: true }).catch(() => undefined);
  }
}

async function hasFiles(dir: string, accept: (name: string) => boolean = () => true): Promise<boolean> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (entry.isFile() && accept(entry.name)) return true;
    if (entry.isDirectory() && (await hasFiles(path.join(dir, entry.name), accept))) return true;
  }
  return false;
}

/** True while pictures or supporting files are still in the old shared folders, or a model from before them has
 *  none of its own yet. A model the last move skipped keeps it true, so the next start tries it again. */
async function legacyFilesLeft(): Promise<boolean> {
  const [unhomed, bundled] = await Promise.all([
    prisma.print.count({ where: { assetsPath: null } }),
    prisma.printFile.count({ where: { storagePath: { startsWith: "bundles/" } } }),
  ]);
  if (unhomed > 0 || bundled > 0) return true;
  for (const dir of LEGACY_FOLDERS) if (await hasFiles(dir)) return true;
  return hasFiles(MODEL_PREVIEWS, isLegacyRender);
}

/** At startup: carries on with a move the previous process didn't finish, or brings over the pictures and
 *  supporting files of models saved before they lived beside the model files. Files already moved stay put. */
export async function resumeStorageMove(): Promise<void> {
  const row = await prisma.setting.findUnique({ where: { key: PENDING_KEY } });
  const pending = row?.value as Pending | undefined;
  if (pending?.template) {
    log.info("resuming an interrupted move");
    startStorageMove(pending.userId ?? null, pending.template);
    return;
  }
  if (await legacyFilesLeft()) {
    log.info("moving pictures and supporting files in beside the model files");
    startStorageMove(null, await getStorageTemplate());
  }
}
