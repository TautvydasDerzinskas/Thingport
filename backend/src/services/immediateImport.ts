import crypto from "node:crypto";
import { Client } from "pg";
import { prisma, getActiveDatabaseUrl } from "../db";
import type { Prisma } from "@prisma/client";

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
  const id = crypto.randomUUID();
  const release = await acquireImmediateImportLock(id);
  if (!release) throw new Error("Could not acquire immediate import ownership");
  try {
    const job = await prisma.importJob.create({ data: { ...data, id } });
    void Promise.resolve()
      .then(() => run(id))
      .finally(release)
      .catch((err) => console.error(`Immediate import ${id} failed:`, err));
    return job;
  } catch (err) {
    await release();
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
