import { prisma } from "../db";
import type { ImportJob, ImportJobItem, ImportJobType, Prisma } from "@prisma/client";

export async function getActiveJob(userId: string): Promise<ImportJob | null> {
  return prisma.importJob.findFirst({
    where: { userId, status: { in: ["RUNNING", "QUEUED"] } },
    orderBy: { createdAt: "asc" },
  });
}

export async function getActiveJobs(userId: string): Promise<ImportJob[]> {
  return prisma.importJob.findMany({
    where: { userId, status: { in: ["RUNNING", "QUEUED"] } },
    orderBy: { createdAt: "asc" },
  });
}

/** Read fresh on every link, so a runner sees a pause made while it works. */
export async function getJobStatus(id: string): Promise<ImportJob["status"] | null> {
  const job = await prisma.importJob.findUnique({ where: { id }, select: { status: true } });
  return job?.status ?? null;
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

export async function createJobItems(jobId: string, urls: string[]): Promise<ImportJobItem[]> {
  return prisma.$transaction(urls.map((url) => prisma.importJobItem.create({ data: { jobId, url } })));
}

export async function listJobItems(jobId: string): Promise<ImportJobItem[]> {
  return prisma.importJobItem.findMany({ where: { jobId }, orderBy: { createdAt: "asc" } });
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
