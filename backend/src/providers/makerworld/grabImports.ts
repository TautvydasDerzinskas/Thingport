import type { GrabImport, ImportJobItemStatus, Prisma } from "@prisma/client";
import { prisma } from "../../db";
import { isOneModelLink } from "../../services/importJobService";
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

/** Parks a MakerWorld model for Grab. The same link again keeps one entry, with the newest options, its tries started
 *  over and its revision bumped. */
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
    update: { ...data, attempts: 0, lastError: null, revision: { increment: 1 } },
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

/** Imported, however it came in: nothing waits for this model any more, as far as `profileIds`, the print profiles
 *  its print has now, go. A link naming another profile still waits for it; one naming none is any profile's. */
export async function clearMakerworldGrabImports(
  userId: string,
  designId: string,
  profileIds: string[],
): Promise<void> {
  const rows = await prisma.grabImport.findMany({
    where: { userId, provider: PROVIDER },
    select: { id: true, url: true },
  });
  const done = rows
    .filter((row) => {
      const link = parseMakerworldModelUrl(row.url);
      return (
        link?.designId === designId && (!link.requestedInstanceId || profileIds.includes(link.requestedInstanceId))
      );
    })
    .map((row) => row.id);
  if (done.length) await prisma.grabImport.deleteMany({ where: { id: { in: done } } });
}

/** The links of link lists Grab bringing in one of `urls` finishes, by `status`: their own, or with `userId` unset,
 *  everyone's. */
async function linksGrabFinishes(
  db: Prisma.TransactionClient,
  userId: string | undefined,
  urls: string[],
  status: ImportJobItemStatus[],
) {
  const items = await db.importJobItem.findMany({
    where: { url: { in: urls }, status: { in: status }, job: { type: "LINKS", ...(userId ? { userId } : {}) } },
    select: {
      id: true,
      jobId: true,
      url: true,
      payload: true,
      job: { select: { userId: true, type: true, payload: true } },
    },
  });
  return items.filter((item) => isOneModelLink(item, item.job));
}

/** Waiting links no import wants any more, its own deleted from the queue or taken out of one: Grab mustn't bring in
 *  what its owner threw away. `userId`'s, or with it unset, everyone's. */
export async function dropUnwantedMakerworldGrabImports(userId?: string): Promise<void> {
  const rows = await prisma.grabImport.findMany({
    where: { provider: PROVIDER, ...(userId ? { userId } : {}) },
    select: { id: true, userId: true, url: true },
  });
  if (!rows.length) return;
  const links = await linksGrabFinishes(
    prisma,
    userId,
    [...new Set(rows.map((row) => row.url))],
    ["PENDING", "RUNNING", "FAILED"],
  );
  const wanted = new Set(links.map((item) => `${item.job.userId}|${item.url}`));
  const dropped = rows.filter((row) => !wanted.has(`${row.userId}|${row.url}`)).map((row) => row.id);
  if (dropped.length) await prisma.grabImport.deleteMany({ where: { id: { in: dropped } } });
}

/** A failed try in Grab at `row`'s link as it was queued then. The last one drops the model and says why. Counted on the
 *  row as it stands, so tries that fail at once each count, and only the one that drops it says so. Queued again
 *  since, the link's tries have started over: a try begun before doesn't count against it. */
export async function recordMakerworldGrabImportFailure(row: GrabImport, error: string): Promise<void> {
  const queued = { id: row.id, revision: row.revision };
  const tried = await prisma.grabImport
    .update({
      where: queued,
      data: { attempts: { increment: 1 }, lastError: error.slice(0, 1000) },
      select: { attempts: true },
    })
    .catch(() => null);
  if (!tried || tried.attempts < MAKERWORLD_GRAB_MAX_ATTEMPTS) return;
  const { count } = await prisma.grabImport.deleteMany({ where: queued });
  if (!count) return;
  await createNotification(row.userId, {
    type: "import",
    title: `Couldn't import a ${manifest.name} model`,
    body: `Thingport Grab tried ${tried.attempts} times: ${error}`,
    externalUrl: row.url,
    internalPath: null,
  });
}

/** Whether `userId` has a Grab paired with this instance to hand a blocked import to. A Grab signed in with a password
 *  before pairing existed isn't known, so its imports fail as they did. */
export async function hasPairedGrab(userId: string): Promise<boolean> {
  return (await prisma.grabConnection.count({ where: { userId } })) > 0;
}

/** Grab brought `row`'s link in: it stops waiting, and where it failed in an import here, that link counts as done now,
 *  its import leaving Needs attention once nothing else of it failed. Together, so a link that can't be counted done
 *  keeps waiting, to come in again. Only `row` as Grab was given it: queued again since, with other options, it's still
 *  to bring in, and counts its links done then. */
export async function finishMakerworldGrabImport(row: GrabImport, alreadyInLibrary: boolean): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.grabImport.deleteMany({ where: { id: row.id, revision: row.revision } });
    if (count) await settleHandedLinks(tx, row.userId, row.url, alreadyInLibrary);
  });
}

/** Only links asking for that one model: one for all of its profiles, say, isn't done by one file. */
async function settleHandedLinks(
  tx: Prisma.TransactionClient,
  userId: string,
  url: string,
  alreadyInLibrary: boolean,
): Promise<void> {
  const byJob = new Map<string, string[]>();
  for (const item of await linksGrabFinishes(tx, userId, [url], ["FAILED"])) {
    byJob.set(item.jobId, [...(byJob.get(item.jobId) ?? []), item.id]);
  }
  // Jobs in one order, as their rows are held until the end: two of these at once can't each wait on the other.
  for (const jobId of [...byJob.keys()].toSorted()) {
    const { count } = await tx.importJobItem.updateMany({
      where: { id: { in: byJob.get(jobId) }, status: "FAILED" },
      data: { status: "DONE", errorMessage: null },
    });
    if (!count) continue;
    // Added, never set, as the runner adds its own. And first, as it holds the job's row: a recount beside this one,
    // the runner's or another link's, counts after it, not over it.
    const counted = await tx.importJob.updateMany({
      where: { id: jobId },
      data: alreadyInLibrary ? { alreadyInLibrary: { increment: count } } : { imported: { increment: count } },
    });
    if (!counted.count) continue;
    const failedCount = await tx.importJobItem.count({ where: { jobId, status: "FAILED" } });
    await tx.importJob.update({ where: { id: jobId }, data: { failedCount } });
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
