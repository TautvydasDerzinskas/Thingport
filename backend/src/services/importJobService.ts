import { IMPORT_STALL_LIMIT_MINUTES } from "../config";
import { prisma } from "../db";
import type { ImportJob, ImportJobItem, ImportJobType, Prisma } from "@prisma/client";
import { detectProvider } from "../providers/index.generated";

// Where a notification opens the import queue, by section. An older frontend still knows the path.
export const QUEUE_WAITING_PATH = "/admin-queue?import-queue=wait";
export const QUEUE_ATTENTION_PATH = "/admin-queue?import-queue=att";

/** The same one on every read, when several run side by side: what the user started before a sync's, oldest first. */
export async function getActiveJob(userId: string): Promise<ImportJob | null> {
  return prisma.importJob.findFirst({
    where: { userId, status: "RUNNING" },
    orderBy: [{ collectionSyncId: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }, { id: "asc" }],
  });
}

/** Whether an import outside the sync lane is on this provider now: a link list by the link it's on, anything else by
 *  its own provider or source. Syncs give way to it, since they all reach the provider from the same IP. A row nothing
 *  has written to for the stall limit is no reason to wait: it may have no runner behind it. `exceptJobId`: the job
 *  asking, which reads as outside the lane if its sync is deleted under it. */
export async function isImportingFrom(provider: string, exceptJobId?: string): Promise<boolean> {
  const jobs = await prisma.importJob.findMany({
    where: {
      id: { not: exceptJobId },
      status: "RUNNING",
      collectionSyncId: null,
      updatedAt: { gte: new Date(Date.now() - IMPORT_STALL_LIMIT_MINUTES * 60_000) },
    },
    select: {
      provider: true,
      sourceUrl: true,
      items: { where: { status: "RUNNING" }, select: { url: true }, take: 1 },
    },
  });
  return jobs.some(
    (job) =>
      (job.items[0] ? detectProvider(job.items[0].url) : (job.provider ?? detectProvider(job.sourceUrl))) === provider,
  );
}

/** Read fresh on every link, so a runner sees a pause made while it works. */
export async function getJobStatus(id: string): Promise<ImportJob["status"] | null> {
  const job = await prisma.importJob.findUnique({ where: { id }, select: { status: true } });
  return job?.status ?? null;
}

/** Whether something took a batch from its runner: the watchdog, or its owner's account going with it. The rest of it
 *  would run beside the line. A failed read says nothing, and a database blip mustn't fail the batch. */
export async function jobTakenFromRunner(id: string): Promise<boolean> {
  return (await getJobStatus(id).catch(() => "RUNNING")) !== "RUNNING";
}

export async function getJob(id: string, userId: string): Promise<ImportJob | null> {
  return prisma.importJob.findFirst({ where: { id, userId } });
}

export async function createJob(
  userId: string,
  type: ImportJobType,
  data: {
    sourceUrl: string;
    sourceLabel?: string | null;
    provider?: string | null;
    total?: number;
    payload?: Prisma.InputJsonValue;
  },
): Promise<ImportJob> {
  return prisma.importJob.create({
    data: {
      userId,
      type,
      sourceUrl: data.sourceUrl,
      sourceLabel: data.sourceLabel ?? null,
      provider: data.provider ?? null,
      total: data.total ?? 0,
      payload: data.payload ?? undefined,
    },
  });
}

export async function updateJob(id: string, data: Prisma.ImportJobUpdateInput): Promise<void> {
  await prisma.importJob.update({ where: { id }, data });
}

/** A run's progress, which nobody waits for, written in order. Await `settled` before the job's last word: a progress
 *  write landing after it would overwrite its final counts. One that fails is only progress lost. */
export function jobProgress(id: string): {
  write: (data: Prisma.ImportJobUpdateInput) => void;
  settled: () => Promise<void>;
} {
  let last: Promise<void> = Promise.resolve();
  return {
    write(data) {
      last = last.then(() => updateJob(id, data)).catch(() => undefined);
    },
    settled: () => last,
  };
}

export async function createJobItems(jobId: string, urls: string[]): Promise<ImportJobItem[]> {
  return prisma.$transaction(urls.map((url) => prisma.importJobItem.create({ data: { jobId, url } })));
}

export async function listJobItems(jobId: string): Promise<ImportJobItem[]> {
  // Links created together can share a timestamp; ids keep them in the order they were created.
  return prisma.importJobItem.findMany({ where: { jobId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
}

export async function updateJobItem(id: string, data: Prisma.ImportJobItemUpdateInput): Promise<void> {
  await prisma.importJobItem.update({ where: { id }, data });
}

/** How a retry reruns a LINKS job: only the links that failed last time go back to PENDING. */
export async function resetFailedItems(jobId: string): Promise<number> {
  const { count } = await prisma.importJobItem.updateMany({
    where: { jobId, status: "FAILED" },
    data: { status: "PENDING", errorMessage: null },
  });
  return count;
}

export async function countJobItems(jobId: string, status: Prisma.ImportJobItemWhereInput["status"]): Promise<number> {
  return prisma.importJobItem.count({ where: { jobId, status } });
}

/** A LINKS job's counts, as its links stand. */
export async function linkTotals(jobId: string): Promise<{ processed: number; failedCount: number }> {
  const failedCount = await countJobItems(jobId, "FAILED");
  return { processed: (await countJobItems(jobId, "DONE")) + failedCount, failedCount };
}

/** A job's stored JSON: what it runs from, and what its run has to say about itself. Null on old rows. */
export function jobPayload(job: Pick<ImportJob, "payload">): Record<string, unknown> {
  const { payload } = job;
  return payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
}

/** Whether a job other than a LINKS one kept what it takes to run again: rows from before the line didn't. */
export function hasSavedRequest(job: Pick<ImportJob, "type" | "payload">): boolean {
  const payload = jobPayload(job);
  if (job.type === "COLLECTION") return Array.isArray(payload.model_ids) && payload.model_ids.length > 0;
  if (job.type === "ZIP") return Array.isArray(payload.entries) && payload.entries.length > 0;
  if (job.type === "PROFILES") return payload.scope === "designer" || payload.scope === "all";
  return true;
}

/** A provider's stop words kept on a batch job for its card, beside what's there; never in errorMessage, which old
 *  clients read. */
export async function saveFailureSummary(jobId: string, summary: string): Promise<void> {
  const job = await prisma.importJob.findUnique({ where: { id: jobId }, select: { payload: true } });
  if (!job) return;
  await updateJob(jobId, { payload: { ...jobPayload(job), failure_summary: summary } as Prisma.InputJsonValue });
}
