import { spawn } from "node:child_process";
import { once } from "node:events";
import { expect, it, vi } from "vitest";

const finishing = vi.hoisted(() => ({ hold: Promise.resolve() }));
vi.mock("../src/services/importJobExecution", () => ({
  executeQueuedImport: async (job: { id: string }) => {
    const { prisma } = await import("../src/db");
    // The last link has settled, but the runner still owns its final status write.
    await prisma.importJobItem.updateMany({ where: { jobId: job.id }, data: { status: "FAILED" } });
    await prisma.importJob.update({ where: { id: job.id }, data: { status: "PAUSED", failedCount: 1 } });
    await finishing.hold;
    await prisma.importJob.update({ where: { id: job.id }, data: { status: "DONE" } });
  },
}));

import { prisma } from "../src/db";
import { drainImportQueue, withImportSchedulerStopped } from "../src/services/importScheduler";
import { startLinksJob } from "../src/services/importQueueService";

it("blocks a remote retry until the old runner finishes its final writes", async () => {
  const user = await prisma.user.create({
    data: { email: `finalization-${Date.now()}@example.com`, displayName: "Finalization" },
  });
  const job = await prisma.importJob.create({
    data: {
      userId: user.id,
      type: "LINKS",
      status: "QUEUED",
      sourceUrl: "https://example.com/finalization",
      payload: {},
      items: { create: [{ url: "https://example.com/finalization" }] },
    },
  });
  let finish!: () => void;
  finishing.hold = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const draining = drainImportQueue();
  try {
    await vi.waitFor(async () => {
      expect((await prisma.importJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("PAUSED");
    });
    const child = spawn(process.execPath, ["--import", "tsx", "tests/fixtures/retryImportWorker.ts", job.id], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    expect((await once(child, "exit"))[0]).toBe(0);
    expect(output.trim()).toBe("409");
    expect((await prisma.importJobItem.findFirstOrThrow({ where: { jobId: job.id } })).status).toBe("FAILED");
    finish();
    await draining;
    await withImportSchedulerStopped(async () => {
      await startLinksJob(await prisma.importJob.findUniqueOrThrow({ where: { id: job.id } }), { retryFailed: true });
      expect((await prisma.importJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("QUEUED");
      expect((await prisma.importJobItem.findFirstOrThrow({ where: { jobId: job.id } })).status).toBe("PENDING");
      await prisma.importJob.delete({ where: { id: job.id } });
    });
  } finally {
    finish();
    await draining;
    await prisma.user.delete({ where: { id: user.id } });
  }
});
