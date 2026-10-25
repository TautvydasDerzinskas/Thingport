import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "pg";

const calls = vi.hoisted(() => ({ starts: 0, profiles: 0, zip: 0, cookie: "" }));
vi.mock("../src/routes/importRequest", async (original) => ({
  ...(await original<typeof import("../src/routes/importRequest")>()),
  enabledImportUrl: async (url: string) => url,
}));
vi.mock("../src/providers/registry", async (original) => {
  const registry = await original<typeof import("../src/providers/registry")>();
  return {
    ...registry,
    withLinkAuth: async (_user: string, body: object) => ({ ...body, makerworld_cookie: "fresh-session" }),
    PROVIDERS: {
      ...registry.PROVIDERS,
      makerworld: {
        ...registry.PROVIDERS.makerworld,
        lists: {
          async start(_user: string, _url: string, body: { makerworld_cookie: string; model_ids: string[] }) {
            calls.starts++;
            calls.cookie = body.makerworld_cookie;
            if (body.model_ids.includes("failure")) throw new Error("provider preparation failed");
            return {
              async run(id: string) {
                const { prisma } = await import("../src/db");
                await prisma.importJob.update({
                  where: { id },
                  data: { status: "DONE", processed: body.model_ids.length },
                });
              },
            };
          },
        },
      },
    },
  };
});
vi.mock("../src/services/importJobRunner", async (original) => {
  const runner = await original<typeof import("../src/services/importJobRunner")>();
  const done = async (id: string) => {
    const { prisma } = await import("../src/db");
    await prisma.importJob.update({ where: { id }, data: { status: "DONE", processed: 1 } });
  };
  return {
    ...runner,
    profilesImportJob: () => async (id: string) => {
      calls.profiles++;
      await done(id);
    },
    runZipImportJob: async (id: string) => {
      calls.zip++;
      await done(id);
    },
  };
});

import { prisma } from "../src/db";
import { enqueueBatchImport, drainImportQueue, IMPORT_WORKER_LOCK } from "../src/services/importScheduler";
import { needsImmediateImport } from "../src/routes/importRequest";
import { startLinksJob, pauseLinksJob } from "../src/services/importQueueService";

let userId: string;
const url = "https://makerworld.com/en/collections/123-test";
async function lockWorker() {
  const lock = new Client({ connectionString: process.env.DATABASE_URL });
  await lock.connect();
  await lock.query("SELECT pg_advisory_lock($1)", [IMPORT_WORKER_LOCK]);
  return lock;
}

async function drainToCompletion(ids: string[]) {
  for (let attempt = 0; attempt < 100; attempt++) {
    await drainImportQueue();
    const pending = await prisma.importJob.count({ where: { id: { in: ids }, status: { in: ["QUEUED", "RUNNING"] } } });
    if (!pending) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Batch worker did not finish");
}

describe("queued batch reconstruction", () => {
  beforeAll(async () => {
    userId = (await prisma.user.create({ data: { email: `batch-${Date.now()}@example.com`, displayName: "Batch" } }))
      .id;
  });
  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
  });

  it("keeps browser-signed inputs on the immediate compatibility path", () => {
    expect(needsImmediateImport({ url: "https://cdn.example.com/a.zip?X-Amz-Signature=123" })).toBe(true);
    expect(needsImmediateImport({ url, makerworld_cookie: "browser-only" })).toBe(true);
    expect(needsImmediateImport({ url, resolved_download_url: "https://signed.example.com/file" })).toBe(true);
    expect(needsImmediateImport({ url })).toBe(false);
  });

  it("defers MakerWorld's own runner until claim, strips transient inputs and loads fresh auth", async () => {
    const lock = await lockWorker();
    let job;
    try {
      job = await enqueueBatchImport(
        userId,
        "COLLECTION",
        {
          url,
          model_ids: ["1"],
          makerworld_cookie: "never-store",
          resolved_download_url: "https://signed.invalid/file",
        },
        "makerworld",
      );
      expect(calls.starts).toBe(0);
      expect(job.payload).toEqual({ url, model_ids: ["1"], tags: [] });
      expect(job.status).toBe("QUEUED");
    } finally {
      await lock.end();
    }
    await drainToCompletion([job!.id]);
    expect(calls.starts).toBe(1);
    expect(calls.cookie).toBe("fresh-session");
    expect((await prisma.importJob.findUniqueOrThrow({ where: { id: job!.id } })).status).toBe("DONE");
  });

  it("recovers collection/profile jobs, persists preparation failures and does not replay interrupted ZIP extraction", async () => {
    const jobs = await Promise.all([
      prisma.importJob.create({
        data: {
          userId,
          type: "COLLECTION",
          status: "RUNNING",
          sourceUrl: url,
          provider: "makerworld",
          payload: { url, model_ids: ["2"] },
        },
      }),
      prisma.importJob.create({
        data: {
          userId,
          type: "PROFILES",
          status: "RUNNING",
          sourceUrl: url,
          provider: "makerworld",
          payload: { url, scope: "all" },
        },
      }),
      prisma.importJob.create({
        data: {
          userId,
          type: "COLLECTION",
          status: "QUEUED",
          sourceUrl: url,
          provider: "makerworld",
          payload: { url, model_ids: ["failure"] },
        },
      }),
      prisma.importJob.create({
        data: { userId, type: "ZIP", status: "RUNNING", sourceUrl: url, payload: { url, entries: ["a.stl"] } },
      }),
      prisma.importJob.create({
        data: { userId, type: "ZIP", status: "QUEUED", sourceUrl: url, payload: { url, entries: ["b.stl"] } },
      }),
    ]);
    await drainToCompletion(jobs.map((job) => job.id));
    const finished = await Promise.all(
      jobs.map((job) => prisma.importJob.findUniqueOrThrow({ where: { id: job.id } })),
    );
    expect(finished.map((job) => job.status)).toEqual(["DONE", "DONE", "ERROR", "ERROR", "DONE"]);
    expect(calls.profiles).toBe(1);
    expect(calls.zip).toBe(1);
    expect(finished[3].errorMessage).toMatch(/remaining entries/);
    await expect(startLinksJob(finished[3], { retryFailed: true })).rejects.toThrow(/remaining entries/);
    await expect(pauseLinksJob({ ...finished[0], status: "RUNNING" })).rejects.toThrow(/waiting batch/);
  });
});
