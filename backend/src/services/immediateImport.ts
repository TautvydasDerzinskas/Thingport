import crypto from "node:crypto";
import { Client } from "pg";
import { prisma, getActiveDatabaseUrl } from "../db";
import type { Prisma } from "@prisma/client";
import { reserveDatabaseOperation } from "./databaseSwitchGate";
import { createJob } from "./importJobService";

/** Separate from the scheduler lock: browser sessions may run in another API process. */
export async function acquireImmediateImportLock(jobId: string): Promise<(() => Promise<void>) | null> {
  const client = new Client({ connectionString: getActiveDatabaseUrl(), keepAlive: true });
  let owned = false;
  let lost = false;
  client.on("error", (err) => {
    lost = true;
    console.error("Immediate import lock connection failed:", err);
    // Provider work cannot be cancelled. Never let a recovered job overlap this runner.
    if (owned) process.exit(1);
  });
  try {
    await client.connect();
    const { rows } = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock(174830220, hashtext($1)) AS acquired",
      [jobId],
    );
    if (!rows[0].acquired || lost) {
      await client.end();
      return null;
    }
    owned = true;
    return async () => {
      owned = false;
      await client.end();
    };
  } catch (err) {
    await client.end().catch(() => undefined);
    throw err;
  }
}

/** Acquire ownership before publishing RUNNING, so recovery cannot race job creation. */
export async function startImmediateImport(
  data: Prisma.ImportJobUncheckedCreateInput,
  run: (jobId: string) => Promise<void>,
) {
  const releaseOperation = reserveDatabaseOperation();
  const id = crypto.randomUUID();
  let releaseLock: (() => Promise<void>) | null = null;
  try {
    releaseLock = await acquireImmediateImportLock(id);
    if (!releaseLock) throw new Error("Could not acquire immediate import ownership");
    const job = await prisma.importJob.create({ data: { ...data, id } });
    void Promise.resolve()
      .then(() => run(id))
      .finally(async () => {
        try {
          await releaseLock?.();
        } finally {
          releaseOperation();
        }
      })
      .catch((err) => console.error(`Immediate import ${id} failed:`, err));
    return job;
  } catch (err) {
    try {
      await releaseLock?.();
    } finally {
      releaseOperation();
    }
    throw err;
  }
}

/** Keep the old request-bound batch runners on their database until they finish. */
export async function startDirectBatchImport(
  userId: string,
  type: "COLLECTION" | "ZIP" | "PROFILES",
  data: Parameters<typeof createJob>[2],
  run: (jobId: string) => Promise<void>,
) {
  const releaseOperation = reserveDatabaseOperation();
  try {
    const job = await createJob(userId, type, data);
    void Promise.resolve()
      .then(() => run(job.id))
      .finally(releaseOperation)
      .catch((err) => console.error(`Direct import ${job.id} failed:`, err));
    return job;
  } catch (err) {
    releaseOperation();
    throw err;
  }
}

export async function recoverImmediateImports(): Promise<void> {
  const where: Prisma.ImportJobWhereInput = {
    type: "LINKS",
    status: "RUNNING",
    payload: { path: ["immediate"], equals: true },
  };
  const jobs = await prisma.importJob.findMany({ where, select: { id: true } });
  for (const job of jobs) {
    const release = await acquireImmediateImportLock(job.id);
    if (!release) continue;
    try {
      await prisma.$transaction(async (tx) => {
        const changed = await tx.importJob.updateMany({
          where: { ...where, id: job.id },
          data: {
            status: "ERROR",
            errorMessage: "Browser import interrupted. Check your library before retrying with your saved sign-in.",
          },
        });
        if (!changed.count) return;
        await tx.importJobItem.updateMany({
          where: { jobId: job.id, status: "RUNNING" },
          data: {
            status: "FAILED",
            errorMessage: "Import interrupted; this link may already be imported. Check your library before retrying.",
          },
        });
        await tx.importJob.update({
          where: { id: job.id },
          data: { failedCount: await tx.importJobItem.count({ where: { jobId: job.id, status: "FAILED" } }) },
        });
      });
    } finally {
      await release();
    }
  }
}
