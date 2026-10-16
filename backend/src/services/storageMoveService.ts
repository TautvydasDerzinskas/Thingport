import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { createLogger } from "../logger";
import { createNotification } from "./notificationService";
import { reorganizeManagedPrints } from "./printService";

// Moving every user's model files to the storage structure an admin saved. It runs in the background, followed by
// a bar at the bottom of the app; it can't be stopped, since half the files in one layout and half in another is
// what it's there to end. Its template is kept as a setting while it runs, so a restart carries on with it.

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

type Pending = { template: string; userId: string };

let current: StorageMoveRun | null = null;

export function currentStorageMove(): StorageMoveRun | null {
  return current;
}

/** Starts moving every model's files to `template`; null while a move is already going. */
export function startStorageMove(userId: string, template: string): StorageMoveRun | null {
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
    if (moved || skipped) await notifyDone(pending.userId, moved, skipped);
  } catch (err) {
    log.error("moving files failed", { error: err });
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

/** At startup: carries on with a move the previous process didn't finish. Files already moved stay put. */
export async function resumeStorageMove(): Promise<void> {
  const row = await prisma.setting.findUnique({ where: { key: PENDING_KEY } });
  const pending = row?.value as Pending | undefined;
  if (!pending?.template || !pending.userId) return;
  log.info("resuming an interrupted move");
  startStorageMove(pending.userId, pending.template);
}
