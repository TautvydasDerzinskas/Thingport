import type { GrabImport } from "@prisma/client";
import { prisma } from "../../db";
import { createNotification } from "../../services/notificationService";
import { HttpError } from "../../utils/fileUtils";
import type { GrabImportOptions } from "../makeronline/grabImports";
import manifest from "./manifest.generated";
import { parseMakerworldModelUrl } from "./urls.generated";

// Imports waiting for Thingport Grab to clear MakerWorld's CAPTCHA. The instance can't solve the puzzle, but Grab can,
// with MakerWorld's own on its site: a link import the CAPTCHA stopped, for someone with a paired Grab, is parked here
// as well as failed. Grab offers them on the next makerworld.com page it sees, opens the puzzle once asked, resolves
// each one's file there and imports it; a retry here that gets through first clears it too. A model that keeps failing
// in Grab is dropped with a notification, so it isn't offered on every visit.

export const MAKERWORLD_GRAB_MAX_ATTEMPTS = 3;

/** Whose rows these are: GrabImport holds MakerOnline's and OwlCAD's too. */
const PROVIDER = manifest.id;

/** Parks a MakerWorld model for Grab. The same link again keeps one entry, with the newest options. */
export async function queueMakerworldGrabImport(
  userId: string,
  url: string,
  options: GrabImportOptions = {},
): Promise<void> {
  if (!parseMakerworldModelUrl(url)) throw new HttpError(400, `Not a ${manifest.name} model link`);
  const data = {
    scope: options.scope ?? "url",
    collectionId: options.collectionId ?? null,
    categoryId: options.categoryId ?? null,
    tags: options.tags ?? [],
    notes: options.notes ?? null,
  };
  await prisma.grabImport.upsert({
    where: { userId_url: { userId, url } },
    create: { userId, provider: PROVIDER, url, ...data },
    update: { ...data, attempts: 0, lastError: null },
  });
}

export type MakerworldGrabImportOut = {
  id: string;
  url: string;
  scope: string;
  collection_id: string | null;
  attempts: number;
};

export async function listMakerworldGrabImports(userId: string): Promise<MakerworldGrabImportOut[]> {
  const rows = await prisma.grabImport.findMany({
    where: { userId, provider: PROVIDER },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((row) => ({
    id: row.id,
    url: row.url,
    scope: row.scope,
    collection_id: row.collectionId,
    attempts: row.attempts,
  }));
}

export async function getMakerworldGrabImport(userId: string, id: string): Promise<GrabImport> {
  const row = await prisma.grabImport.findFirst({ where: { id, userId, provider: PROVIDER } });
  if (!row) throw new HttpError(404, "This waiting import is gone -- it may have been imported already");
  return row;
}

/** Imported, however it came in: nothing waits for this model any more. */
export async function clearMakerworldGrabImports(userId: string, designId: string): Promise<void> {
  const rows = await prisma.grabImport.findMany({
    where: { userId, provider: PROVIDER },
    select: { id: true, url: true },
  });
  const done = rows.filter((row) => parseMakerworldModelUrl(row.url)?.designId === designId).map((row) => row.id);
  if (done.length) await prisma.grabImport.deleteMany({ where: { id: { in: done } } });
}

/** One waiting import done, or dropped with the import it came from. */
export async function clearMakerworldGrabImport(row: GrabImport): Promise<void> {
  await prisma.grabImport.deleteMany({ where: { id: row.id, userId: row.userId } });
}

/** The links of an import deleted from the queue: Grab mustn't bring in what its owner threw away. */
export async function dropMakerworldGrabImports(userId: string, urls: string[]): Promise<void> {
  if (urls.length) await prisma.grabImport.deleteMany({ where: { userId, provider: PROVIDER, url: { in: urls } } });
}

/** A failed try in Grab. The last one drops the model and says why. */
export async function recordMakerworldGrabImportFailure(row: GrabImport, error: string): Promise<void> {
  const attempts = row.attempts + 1;
  if (attempts < MAKERWORLD_GRAB_MAX_ATTEMPTS) {
    await prisma.grabImport.update({ where: { id: row.id }, data: { attempts, lastError: error.slice(0, 1000) } });
    return;
  }
  await prisma.grabImport.delete({ where: { id: row.id } }).catch(() => undefined);
  await createNotification(row.userId, {
    type: "import",
    title: `Couldn't import a ${manifest.name} model`,
    body: `Thingport Grab tried ${attempts} times: ${error}`,
    externalUrl: row.url,
    internalPath: null,
  });
}

/** Whether `userId` has a Grab paired with this instance to hand a blocked import to. A Grab signed in with a password
 *  before pairing existed isn't known, so its imports fail as they did. */
export async function hasPairedGrab(userId: string): Promise<boolean> {
  return (await prisma.grabConnection.count({ where: { userId } })) > 0;
}

/** Grab brought a waiting link in: where it failed in an import here, that link counts as done now, and its import
 *  leaves Needs attention once nothing else of it failed. */
export async function settleHandedLinks(userId: string, url: string, alreadyInLibrary: boolean): Promise<void> {
  const items = await prisma.importJobItem.findMany({
    where: { url, status: "FAILED", job: { userId } },
    select: { id: true, jobId: true },
  });
  const byJob = new Map<string, string[]>();
  for (const item of items) byJob.set(item.jobId, [...(byJob.get(item.jobId) ?? []), item.id]);
  for (const [jobId, ids] of byJob) {
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.importJobItem.updateMany({
        where: { id: { in: ids }, status: "FAILED" },
        data: { status: "DONE", errorMessage: null },
      });
      if (!count) return;
      const job = await tx.importJob.findUnique({ where: { id: jobId }, select: { failedCount: true } });
      if (!job) return;
      await tx.importJob.update({
        where: { id: jobId },
        data: {
          failedCount: Math.max(0, job.failedCount - count),
          ...(alreadyInLibrary ? { alreadyInLibrary: { increment: count } } : { imported: { increment: count } }),
        },
      });
    });
  }
}

/** For the import queue: what the user's imports wait on Grab for, the first link to send them to. */
export async function makerworldPuzzleWaiting(userId: string): Promise<{ count: number; url: string | null }> {
  const [count, first] = await Promise.all([
    prisma.grabImport.count({ where: { userId, provider: PROVIDER } }),
    prisma.grabImport.findFirst({ where: { userId, provider: PROVIDER }, orderBy: { createdAt: "asc" } }),
  ]);
  return { count, url: first?.url ?? null };
}
