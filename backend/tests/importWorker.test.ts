import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import request from "supertest";

// No pacing or DNS here. config.ts reads the pace on load, so it's hoisted.
vi.hoisted(() => {
  process.env.IMPORT_MAKERWORLD_CALL_DELAY_MS = "0";
  process.env.IMPORT_COLLECTION_DELAY_MS = "0";
});
vi.mock("node:dns/promises", () => ({
  default: {
    resolve4: async () => ["93.184.216.34"],
    resolve6: async () => {
      throw new Error("no AAAA");
    },
  },
}));

import type { ImportJob, Prisma } from "@prisma/client";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { noteCaptchaChallenge, resetCaptchaCooloffForTest } from "../src/providers/makerworld/captcha";
import { PROVIDERS } from "../src/providers/registry";
import { setUserMakerworldCookie } from "../src/providers/makerworld/session";
import { noteImportActivity } from "../src/services/importActivity";
import { isRunnerLive, SYNC_JOB_INTERRUPTED } from "../src/services/importJobRunner";
import {
  enqueueLinksImport,
  enqueueListImport,
  enqueueProfilesImport,
  enqueueSingleImport,
  enqueueZipImport,
  retryAllFailed,
  startQueueJob,
} from "../src/services/importQueueService";
import {
  holdImportWorker,
  importWorkerIdle,
  importWorkerStatus,
  importWorkerTuning,
  recoverImportJobs,
  resumeImportWorker,
  startImportWorker,
  wakeImportWorker,
} from "../src/services/importWorker";
import { setProviderEnabled } from "../src/services/providerSettingsService";

const app = createApp();
const stamp = Date.now();
const base = (stamp % 1_000_000_000) + 3000;
const originalFetch = global.fetch;
const tuning = { ...importWorkerTuning };

let alice: string;
let bob: string;

async function register(label: string): Promise<string> {
  const res = await request(app)
    .post("/api/register")
    .send({ displayName: `Worker ${label}`, email: `worker-${label}-${stamp}@example.com`, password: "password123" });
  if (res.status !== 200) throw new Error(`register ${label}: ${res.status} ${JSON.stringify(res.body)}`);
  await setUserMakerworldCookie(res.body.user.id, "token=test-bearer");
  return res.body.user.id;
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}

const DESIGNER = { uid: 1692606088, name: "Deus Cat" };
const design = (id: string) => ({
  id: Number(id),
  modelId: `US${id}`,
  title: `Phoenix ${id}`,
  summary: "<p>A phoenix.</p>",
  tags: ["phoenix"],
  designCreator: DESIGNER,
  defaultInstanceId: 2,
  instances: [
    { id: 1, profileId: 101, title: "Single-colour version", instanceCreator: DESIGNER },
    { id: 2, profileId: 102, title: "multi-colored version", instanceCreator: DESIGNER },
  ],
});

// Design ids in the order they were asked for, a gate per id that holds its fetch until released, and how many of
// these users' jobs read RUNNING whenever a provider is asked.
const started: string[] = [];
const gates = new Map<string, { held: Promise<void>; release: () => void }>();
const gone = new Set<string>();
const challenged = new Set<string>();
const cookies: (string | null)[] = [];
let zipFile: Buffer;
let maxRunning = 0;
let onDesign: () => void = () => undefined;
// What a body read throws partway through, as undici does when the connection drops.
let fileFailure: Error | null = null;
let zipFailure: Error | null = null;
const failingBody = (failure: Error) =>
  new Response(
    new ReadableStream({
      start(controller) {
        controller.error(failure);
      },
    }),
    { headers: { "content-type": "application/octet-stream" } },
  );

function mockFetch() {
  global.fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input, init) => {
    const url = String(input);
    const model = url.match(/^https:\/\/api\.bambulab\.com\/v1\/design-service\/design\/(\d+)/);
    if (model) {
      const id = model[1];
      started.push(id);
      cookies.push(new Headers(init?.headers).get("authorization"));
      maxRunning = Math.max(
        maxRunning,
        await prisma.importJob.count({ where: { userId: { in: [alice, bob] }, status: "RUNNING" } }),
      );
      onDesign();
      await gates.get(id)?.held;
      if (gone.has(id)) return new Response("gone", { status: 404 });
      if (challenged.has(id)) {
        return new Response(JSON.stringify({ captchaId: "c1", error: "confirm you are not a robot" }), {
          status: 418,
          headers: { "content-type": "application/json" },
        });
      }
      return json(design(id));
    }
    const profile = url.match(/^https:\/\/api\.bambulab\.com\/v1\/iot-service\/api\/user\/profile\/(\d+)/);
    if (profile) {
      return json({
        message: "success",
        url: `https://s3.example.com/phoenix-${profile[1]}.stl`,
        filename: `phoenix-${profile[1]}.stl`,
      });
    }
    const file = url.match(/^https:\/\/s3\.example\.com\/phoenix-(\d+)\.stl$/);
    if (file) {
      if (fileFailure) return failingBody(fileFailure);
      return new Response(`solid phoenix-${file[1]}\nendsolid\n`, {
        headers: { "content-type": "application/octet-stream" },
      });
    }
    if (url === "https://example.com/pack.zip") {
      if (zipFailure) return failingBody(zipFailure);
      return new Response(new Uint8Array(zipFile), { headers: { "content-type": "application/zip" } });
    }
    if (/\/design-service\/favorites\/\d+$/.test(url)) return json({ title: "Flock" });
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
}

function gate(id: number): () => void {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  gates.set(String(id), { held, release });
  return () => {
    gates.delete(String(id));
    release();
  };
}

const modelUrl = (id: number) => `https://makerworld.com/en/models/${id}-phoenix`;
const reload = (id: string) => prisma.importJob.findUniqueOrThrow({ where: { id } });
const itemsOf = (jobId: string) =>
  prisma.importJobItem.findMany({ where: { jobId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
const until = (check: () => boolean | Promise<boolean>) =>
  vi.waitFor(async () => expect(await check()).toBe(true), { timeout: 15_000, interval: 10 });

/** A row as enqueue leaves it: `items`, or the one link. */
async function lineJob(
  userId: string,
  id: number,
  data: Partial<Prisma.ImportJobUncheckedCreateInput> = {},
  items: { url: string; status?: "PENDING" | "RUNNING" | "DONE" | "FAILED" }[] = [{ url: modelUrl(id) }],
): Promise<ImportJob> {
  const job = await prisma.importJob.create({
    data: {
      userId,
      type: "LINKS",
      status: "QUEUED",
      queuedAt: new Date(),
      sourceUrl: modelUrl(id),
      total: items.length,
      payload: { notes: null, tags: [], category_id: null, scope: "url" },
      ...data,
    },
  });
  await prisma.importJobItem.createMany({ data: items.map((item) => ({ jobId: job.id, ...item })) });
  return job;
}

describe("the import worker", () => {
  beforeAll(async () => {
    alice = await register("alice");
    bob = await register("bob");
    const zip = new JSZip();
    zip.file("hull.stl", "solid hull endsolid");
    zip.file("mast.stl", "solid mast endsolid");
    zipFile = await zip.generateAsync({ type: "nodebuffer" });
    // Another file's leftovers mustn't run under this file's fetch.
    await prisma.importJob.updateMany({ where: { status: "QUEUED" }, data: { status: "PAUSED" } });
    mockFetch();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    Object.assign(importWorkerTuning, tuning);
    await prisma.importJob.updateMany({ where: { status: "QUEUED" }, data: { status: "PAUSED" } });
    resumeImportWorker();
    for (const { release } of gates.values()) release();
    gates.clear();
    await importWorkerIdle();
    await until(async () => {
      const left = await prisma.importJob.findMany({ where: { userId: { in: [alice, bob] } }, select: { id: true } });
      return !left.some((job) => isRunnerLive(job.id));
    });
    await prisma.importJob.deleteMany({ where: { userId: { in: [alice, bob] } } });
    await prisma.notification.deleteMany({ where: { userId: { in: [alice, bob] } } });
    global.fetch = originalFetch;
    mockFetch();
    started.length = 0;
    cookies.length = 0;
    gone.clear();
    challenged.clear();
    fileFailure = null;
    zipFailure = null;
    resetCaptchaCooloffForTest();
    maxRunning = 0;
    onDesign = () => undefined;
  });

  afterAll(async () => {
    global.fetch = originalFetch;
    await prisma.user.deleteMany({ where: { id: { in: [alice, bob] } } });
  });

  describe("the order of the line", () => {
    it("goes by when a job joined the line, whenever it was created", async () => {
      holdImportWorker();
      const old = new Date("2019-01-01T00:00:00Z");
      const joinedLast = await lineJob(alice, base + 1, { createdAt: old, queuedAt: new Date(Date.now() + 2000) });
      const joinedFirst = await lineJob(bob, base + 2, { queuedAt: new Date(Date.now() - 2000) });
      const joinedNext = await lineJob(alice, base + 3, { queuedAt: new Date() });
      resumeImportWorker();
      await importWorkerIdle();
      expect(started).toEqual([String(base + 2), String(base + 3), String(base + 1)]);
      for (const job of [joinedLast, joinedFirst, joinedNext]) expect((await reload(job.id)).status).toBe("DONE");
    });

    it("breaks a tie by id, as positions do", async () => {
      holdImportWorker();
      const queuedAt = new Date();
      await lineJob(alice, base + 4, { id: `tie-b-${stamp}`, queuedAt });
      await lineJob(alice, base + 5, { id: `tie-a-${stamp}`, queuedAt });
      resumeImportWorker();
      await importWorkerIdle();
      expect(started).toEqual([String(base + 5), String(base + 4)]);
    });

    it("runs one job at a time across users and every type, each from what it stored", async () => {
      const printablesStart = vi.spyOn(PROVIDERS.printables.lists!, "start");
      const listUrl = "https://www.printables.com/@someone/collections/123";
      const single = await enqueueSingleImport(alice, modelUrl(base + 10), { title: "Called this", tags: ["mine"] });
      const links = await enqueueLinksImport(bob, [modelUrl(base + 11), modelUrl(base + 12)], { notes: "Note" });
      const zip = await enqueueZipImport(alice, "https://example.com/pack.zip", { entries: ["hull.stl", "mast.stl"] });
      const collection = await enqueueListImport(bob, "makerworld", "https://makerworld.com/en/collections/987-flock", {
        model_ids: [String(base + 13)],
        tags: ["flock"],
      });
      const list = await enqueueListImport(alice, "printables", listUrl, {
        model_ids: ["555"],
        collection_title: "Named by Grab",
      });
      const profiles = await enqueueProfilesImport(alice, "makerworld", modelUrl(base + 14), { scope: "all" });
      expect(single.position).toBeLessThanOrEqual(1);
      expect(profiles.position).toBeGreaterThan(1);
      // The network read a list's provider does before its job has moved to the job's turn.
      expect(printablesStart).not.toHaveBeenCalled();

      await importWorkerIdle();
      expect(maxRunning).toBe(1);

      const done = await reload(single.job.id);
      expect(done).toMatchObject({ status: "DONE", imported: 1, failedCount: 0 });
      expect(done.startedAt).not.toBeNull();
      const print = await prisma.print.findFirstOrThrow({ where: { id: done.resultPrintId! } });
      expect(print).toMatchObject({ title: "Called this" });
      expect(print.tags).toEqual(["Mine"]);

      expect(await reload(links.job.id)).toMatchObject({ status: "DONE", imported: 2 });
      expect(
        (await prisma.print.findFirstOrThrow({ where: { userId: bob, sourceExternalId: String(base + 11) } })).notes,
      ).toBe("Note");

      expect(await reload(zip.job.id)).toMatchObject({ status: "DONE", imported: 2, sourceLabel: "pack.zip" });

      const fromCollection = await reload(collection.job.id);
      expect(fromCollection).toMatchObject({ status: "DONE", imported: 1, sourceLabel: "Flock" });
      expect(fromCollection.resultCollectionId).not.toBeNull();
      const member = await prisma.print.findFirstOrThrow({
        where: { userId: bob, sourceExternalId: String(base + 13) },
      });
      expect(member.tags).toEqual(["Flock"]);

      expect(printablesStart).toHaveBeenCalledTimes(1);
      expect(printablesStart.mock.calls[0][2]).toMatchObject({ model_ids: ["555"], collection_title: "Named by Grab" });
      const fromList = await reload(list.job.id);
      expect(fromList).toMatchObject({ status: "DONE", sourceLabel: "Named by Grab", failedCount: 1 });
      expect((fromList.payload as Record<string, unknown>).failure_summary).toMatch(/^1 /);

      const fromProfiles = await reload(profiles.job.id);
      expect(fromProfiles).toMatchObject({
        status: "DONE",
        imported: 2,
        total: 2,
        sourceLabel: `Phoenix ${base + 14}`,
      });
      const withPlates = await prisma.print.findFirstOrThrow({
        where: { id: fromProfiles.resultPrintId! },
        include: { plates: true },
      });
      expect(withPlates.plates).toHaveLength(2);
    });

    it("is one claim however many wakes", async () => {
      holdImportWorker();
      const job = await lineJob(alice, base + 20);
      resumeImportWorker();
      wakeImportWorker();
      wakeImportWorker();
      await importWorkerIdle();
      expect(started).toEqual([String(base + 20)]);
      expect((await reload(job.id)).status).toBe("DONE");
    });

    it("doesn't lose a wake that comes while it's finishing", async () => {
      const release = gate(base + 21);
      const first = await enqueueSingleImport(alice, modelUrl(base + 21), {});
      await until(() => started.includes(String(base + 21)));
      const second = await enqueueSingleImport(alice, modelUrl(base + 22), {});
      release();
      await importWorkerIdle();
      expect((await reload(first.job.id)).status).toBe("DONE");
      expect((await reload(second.job.id)).status).toBe("DONE");
    });

    it("doesn't lose a wake that comes between its last look at the line and its stopping", async () => {
      const read = prisma.importJob.findFirst.bind(prisma.importJob);
      let late: Promise<{ job: ImportJob }> | undefined;
      vi.spyOn(prisma.importJob, "findFirst").mockImplementationOnce((async (args: Prisma.ImportJobFindFirstArgs) => {
        const nothing = await read(args);
        late = enqueueSingleImport(alice, modelUrl(base + 23), {});
        await late;
        return nothing;
      }) as never);
      wakeImportWorker();
      await importWorkerIdle();
      const { job } = await late!;
      expect((await reload(job.id)).status).toBe("DONE");
      expect(started).toEqual([String(base + 23)]);
    });
  });

  describe("claiming", () => {
    it.each([
      ["LINKS", base + 300],
      ["ZIP", base + 310],
    ] as const)("skips a %s job held or deleted after it was read", async (type, id) => {
      holdImportWorker();
      const data = type === "ZIP" ? { type, payload: { entries: ["hull.stl"] } } : {};
      const held = await lineJob(alice, id, { ...data, queuedAt: new Date(Date.now() - 5000) }, []);
      const next = await lineJob(alice, id + 1, { queuedAt: new Date(Date.now() - 1000) });
      const read = prisma.importJob.findFirst.bind(prisma.importJob);
      vi.spyOn(prisma.importJob, "findFirst").mockImplementationOnce((async (args: Prisma.ImportJobFindFirstArgs) => {
        const job = await read(args);
        await prisma.importJob.update({ where: { id: held.id }, data: { status: "PAUSED" } });
        return job;
      }) as never);
      resumeImportWorker();
      await importWorkerIdle();
      expect(await reload(held.id)).toMatchObject({ status: "PAUSED", startedAt: null });
      expect(started).toEqual([String(id + 1)]);
      expect((await reload(next.id)).status).toBe("DONE");
    });

    it("carries on after a job that fails, and after one whose owner is gone", async () => {
      gone.add(String(base + 32));
      const failing = await enqueueSingleImport(alice, modelUrl(base + 32), {});
      const release = gate(base + 33);
      const carol = await register(`carol${base}`);
      const orphaned = await enqueueSingleImport(carol, modelUrl(base + 33), {});
      const next = await enqueueSingleImport(bob, modelUrl(base + 34), {});
      await until(() => started.includes(String(base + 33)));
      await prisma.user.delete({ where: { id: carol } });
      release();
      await importWorkerIdle();
      expect(await reload(failing.job.id)).toMatchObject({ status: "DONE", failedCount: 1 });
      expect(await prisma.importJob.findUnique({ where: { id: orphaned.job.id } })).toBeNull();
      expect((await reload(next.job.id)).status).toBe("DONE");
    });

    it("fails a job whose provider was turned off while it waited, asking it nothing", async () => {
      holdImportWorker();
      const zip = await enqueueZipImport(alice, modelUrl(base + 35), { entries: ["a.stl"] });
      const next = await enqueueSingleImport(bob, modelUrl(base + 36), {});
      await setProviderEnabled("makerworld", false);
      try {
        resumeImportWorker();
        await importWorkerIdle();
      } finally {
        await setProviderEnabled("makerworld", true);
      }
      const failed = await reload(zip.job.id);
      expect(failed.status).toBe("ERROR");
      expect(failed.errorMessage).toMatch(/turned off/i);
      expect(started).toEqual([]);
      // A link job's provider is checked per link, as it always was: it goes through and fails.
      expect(await reload(next.job.id)).toMatchObject({ status: "DONE", failedCount: 1 });
      const told = await prisma.notification.findFirstOrThrow({ where: { userId: alice } });
      expect(told.internalPath).toBe("/admin-queue?import-queue=att");
    });

    it("drops a category deleted while the job waited, and uses the sign-in the owner has now", async () => {
      holdImportWorker();
      const category = await prisma.category.create({ data: { userId: alice, name: `Gone ${stamp}` } });
      const job = await enqueueSingleImport(alice, modelUrl(base + 37), { category_id: category.id });
      await prisma.category.delete({ where: { id: category.id } });
      await setUserMakerworldCookie(alice, "token=fresh-bearer");
      try {
        resumeImportWorker();
        await importWorkerIdle();
      } finally {
        await setUserMakerworldCookie(alice, "token=test-bearer");
      }
      expect(await reload(job.job.id)).toMatchObject({ status: "DONE", imported: 1, failedCount: 0 });
      expect(cookies).toEqual(["Bearer fresh-bearer"]);
    });

    it("says an older batch has no saved request, and moves on", async () => {
      holdImportWorker();
      const old = await lineJob(alice, base + 38, { type: "ZIP", payload: undefined }, []);
      resumeImportWorker();
      await importWorkerIdle();
      expect(await reload(old.id)).toMatchObject({
        status: "ERROR",
        errorMessage: "This older import has no saved request",
      });
    });

    it("lifts a provider's pause when a person's job gets its turn, not at the click", async () => {
      const release = gate(base + 42);
      await enqueueSingleImport(bob, modelUrl(base + 42), {});
      await until(() => started.includes(String(base + 42)));
      const failed = await lineJob(alice, base + 43, { status: "DONE", failedCount: 1, queuedAt: null }, [
        { url: modelUrl(base + 43), status: "FAILED" },
      ]);
      await startQueueJob(failed, { retryFailed: true, manual: true });
      // The CAPTCHA someone else's job meets while this one waits.
      noteCaptchaChallenge();
      release();
      await importWorkerIdle();
      expect(started).toContain(String(base + 43));
      expect(await reload(failed.id)).toMatchObject({ status: "DONE", imported: 1, failedCount: 0 });
    });

    it("lets only the first job of a bulk action probe a provider's pause: the rest fail fast", async () => {
      holdImportWorker();
      const failedLink = (id: number) =>
        lineJob(alice, id, { status: "DONE", failedCount: 1, queuedAt: null }, [
          { url: modelUrl(id), status: "FAILED" },
        ]);
      const first = await failedLink(base + 44);
      const second = await failedLink(base + 45);
      challenged.add(String(base + 44));
      noteCaptchaChallenge();
      expect(await retryAllFailed({ ownerId: alice })).toBe(2);
      resumeImportWorker();
      await importWorkerIdle();
      expect(started).toContain(String(base + 44));
      expect(started).not.toContain(String(base + 45));
      expect(await reload(first.id)).toMatchObject({ status: "DONE", failedCount: 1 });
      expect(await reload(second.id)).toMatchObject({ status: "DONE", failedCount: 1 });
    });

    it("keeps no cookie or anything from the browser in what it stores", async () => {
      holdImportWorker();
      const secret = {
        makerworld_cookie: "token=secret",
        resolved_download_url: "https://secret.example.com/file",
        resolved_instance_id: "secret",
        resolved_files: [{ url: "https://secret.example.com/file", name: "secret.stl" }],
        makerworld_design: { secret: true },
        captcha_token: "secret",
        captcha_answer: "secret",
      };
      const jobs = [
        await enqueueSingleImport(alice, modelUrl(base + 39), secret),
        await enqueueLinksImport(alice, [modelUrl(base + 40)], secret),
        await enqueueZipImport(alice, "https://example.com/pack.zip", { ...secret, entries: ["hull.stl"] }),
        await enqueueListImport(alice, "makerworld", "https://makerworld.com/en/collections/1-a", {
          ...secret,
          model_ids: ["1"],
        }),
        await enqueueProfilesImport(alice, "makerworld", modelUrl(base + 41), { ...secret, scope: "all" }),
      ];
      for (const { job } of jobs) {
        const stored = JSON.stringify(await reload(job.id));
        expect(stored).not.toContain("secret");
      }
    });
  });

  describe("the gate", () => {
    it("claims nothing while it's shut, and everything once it opens", async () => {
      holdImportWorker();
      const job = await enqueueSingleImport(alice, modelUrl(base + 50), {});
      wakeImportWorker();
      await importWorkerIdle();
      expect(importWorkerStatus().currentJobId).toBeNull();
      expect(await reload(job.job.id)).toMatchObject({ status: "QUEUED" });
      expect(started).toEqual([]);

      resumeImportWorker();
      await importWorkerIdle();
      expect((await reload(job.job.id)).status).toBe("DONE");
    });

    it("lets the job it's on finish, and stops there", async () => {
      const release = gate(base + 51);
      const first = await enqueueSingleImport(alice, modelUrl(base + 51), {});
      const second = await enqueueSingleImport(bob, modelUrl(base + 52), {});
      await until(() => importWorkerStatus().currentJobId === first.job.id && started.length === 1);
      holdImportWorker();
      release();
      await importWorkerIdle();
      expect((await reload(first.job.id)).status).toBe("DONE");
      expect((await reload(second.job.id)).status).toBe("QUEUED");
      expect(importWorkerStatus().currentJobId).toBeNull();
    });

    it("opens for good at boot, and claims what's waiting", async () => {
      holdImportWorker();
      const job = await lineJob(alice, base + 54);
      startImportWorker();
      await importWorkerIdle();
      expect((await reload(job.id)).status).toBe("DONE");
    });

    it("doesn't claim a job read just before it shut", async () => {
      holdImportWorker();
      const job = await lineJob(alice, base + 53);
      const read = prisma.importJob.findFirst.bind(prisma.importJob);
      vi.spyOn(prisma.importJob, "findFirst").mockImplementationOnce((async (args: Prisma.ImportJobFindFirstArgs) => {
        const row = await read(args);
        holdImportWorker();
        return row;
      }) as never);
      resumeImportWorker();
      await importWorkerIdle();
      expect((await reload(job.id)).status).toBe("QUEUED");
      expect(started).toEqual([]);
    });
  });

  describe("recovery", () => {
    let synced = 0;
    async function syncedCollection() {
      const name = `Synced ${stamp} ${++synced}`;
      const collection = await prisma.collection.create({
        data: { userId: alice, name, nameNormalized: name.toLowerCase() },
      });
      return prisma.collectionSync.create({
        data: {
          userId: alice,
          collectionId: collection.id,
          provider: "makerworld",
          externalId: name,
          sourceUrl: "https://makerworld.com/en/collections/1-a",
        },
      });
    }

    /** One row of every state a stopped process can leave, as written before `before`. */
    async function everyRow() {
      const sync = await syncedCollection();
      const running = { status: "RUNNING" as const };
      const never = { queuedAt: null };
      const queuedAt = new Date(Date.now() - 60_000);
      return {
        sync: await lineJob(alice, base + 60, { ...running, ...never, collectionSyncId: sync.id }, [
          { url: modelUrl(base + 60), status: "RUNNING" },
        ]),
        line: await lineJob(alice, base + 61, { ...running, queuedAt }, [
          { url: modelUrl(base + 61), status: "DONE" },
          { url: modelUrl(base + 62), status: "RUNNING" },
          { url: modelUrl(base + 63), status: "PENDING" },
        ]),
        oneLink: await lineJob(alice, base + 64, { ...running, queuedAt, payload: { scope: "url", single: true } }, [
          { url: modelUrl(base + 64), status: "RUNNING" },
        ]),
        zip: await lineJob(alice, base + 65, { ...running, type: "ZIP", queuedAt, payload: { entries: ["a"] } }, []),
        list: await lineJob(
          alice,
          base + 66,
          { ...running, type: "COLLECTION", queuedAt, payload: { model_ids: ["1"] } },
          [],
        ),
        legacyLinks: await lineJob(alice, base + 67, { ...running, ...never }, [
          { url: modelUrl(base + 67), status: "RUNNING" },
        ]),
        legacyBatch: await lineJob(alice, base + 68, { ...running, ...never, type: "ZIP", payload: undefined }, []),
        waiting: await lineJob(alice, base + 69, { queuedAt }),
        grab: await lineJob(alice, base + 70, { status: "PAUSED", ...never, sourceLabel: "Sent from Thingport Grab" }),
        stopped: await lineJob(alice, base + 71, {
          status: "PAUSED",
          ...never,
          errorMessage: "MakerWorld's daily download limit was reached",
        }),
        interrupted: await lineJob(alice, base + 72, {
          status: "PAUSED",
          ...never,
          errorMessage: SYNC_JOB_INTERRUPTED,
        }),
        failed: await lineJob(alice, base + 73, { status: "ERROR", ...never, errorMessage: "Old failure" }, [
          { url: modelUrl(base + 73), status: "RUNNING" },
        ]),
        done: await lineJob(alice, base + 74, { status: "DONE", ...never }, [
          { url: modelUrl(base + 74), status: "DONE" },
        ]),
      };
    }

    it("settles what a stopped process left, and leaves everything else alone", async () => {
      holdImportWorker();
      const rows = await everyRow();
      const before = new Date();
      await recoverImportJobs(before);

      const read = async (job: ImportJob) => {
        const { status, errorMessage, queuedAt } = await reload(job.id);
        return { status, errorMessage, queuedAt };
      };
      expect(await read(rows.sync)).toMatchObject({ status: "PAUSED", errorMessage: SYNC_JOB_INTERRUPTED });
      expect(await read(rows.line)).toEqual({ status: "QUEUED", errorMessage: null, queuedAt: rows.line.queuedAt });
      expect((await itemsOf(rows.line.id)).map((i) => [i.status, i.errorMessage])).toEqual([
        ["DONE", null],
        ["FAILED", "Import interrupted; this model may be incomplete in your library. Delete it before retrying."],
        ["PENDING", null],
      ]);
      const batchInterrupted = {
        status: "ERROR",
        errorMessage: "Import interrupted. Some models or files may already be in your library; check before retrying.",
      };
      expect(await read(rows.zip)).toMatchObject(batchInterrupted);
      expect(await read(rows.list)).toMatchObject(batchInterrupted);
      const legacy = { status: "ERROR", errorMessage: "Interrupted by server restart" };
      expect(await read(rows.legacyLinks)).toMatchObject(legacy);
      expect(await read(rows.legacyBatch)).toMatchObject(legacy);
      // Exactly as before there was a line: their links stay as they were.
      expect((await itemsOf(rows.legacyLinks.id))[0].status).toBe("RUNNING");
      expect((await itemsOf(rows.sync.id))[0].status).toBe("RUNNING");

      expect(await read(rows.waiting)).toEqual({
        status: "QUEUED",
        errorMessage: null,
        queuedAt: rows.waiting.queuedAt,
      });
      for (const untouched of [rows.grab, rows.stopped, rows.interrupted, rows.failed, rows.done]) {
        expect(await read(untouched)).toEqual({
          status: untouched.status,
          errorMessage: untouched.errorMessage,
          queuedAt: untouched.queuedAt,
        });
      }
      expect((await itemsOf(rows.failed.id))[0].status).toBe("RUNNING");

      // Only the batches, which have nothing left to run to its end and say so: never one from before the line.
      const told = await prisma.notification.findMany({ where: { userId: alice } });
      expect(told).toHaveLength(2);
      for (const notification of told) {
        expect(notification).toMatchObject({
          type: "import",
          title: "Couldn't finish an import",
          body: batchInterrupted.errorMessage,
          internalPath: "/admin-queue?import-queue=att",
        });
      }
      expect(told.map((notification) => notification.externalUrl).toSorted()).toEqual(
        [rows.zip.sourceUrl, rows.list.sourceUrl].toSorted(),
      );

      // Again changes nothing, and tells nobody twice.
      const after = await prisma.importJob.findMany({ where: { userId: alice }, orderBy: { id: "asc" } });
      await recoverImportJobs(before);
      expect(await prisma.importJob.findMany({ where: { userId: alice }, orderBy: { id: "asc" } })).toEqual(after);
      expect(await prisma.notification.count({ where: { userId: alice } })).toBe(2);
    });

    it("names a batch it cut off, when it has a name", async () => {
      holdImportWorker();
      const queuedAt = new Date(Date.now() - 60_000);
      await lineJob(
        alice,
        base + 84,
        { status: "RUNNING", type: "ZIP", queuedAt, sourceLabel: "Boat", payload: { entries: ["a"] } },
        [],
      );
      await recoverImportJobs();
      const told = await prisma.notification.findFirstOrThrow({ where: { userId: alice } });
      expect(told.title).toBe('Couldn\'t finish importing "Boat"');
    });

    it("tells nobody about a batch that left RUNNING just as it was read", async () => {
      holdImportWorker();
      const queuedAt = new Date(Date.now() - 60_000);
      const job = await lineJob(
        alice,
        base + 87,
        { status: "RUNNING", type: "ZIP", queuedAt, payload: { entries: ["a"] } },
        [],
      );
      const read = prisma.importJob.findMany.bind(prisma.importJob);
      vi.spyOn(prisma.importJob, "findMany").mockImplementation((async (args: Prisma.ImportJobFindManyArgs) => {
        const rows = await read(args);
        if (!args.where?.type) await prisma.importJob.update({ where: { id: job.id }, data: { status: "DONE" } });
        return rows;
      }) as never);
      await recoverImportJobs();
      expect((await reload(job.id)).status).toBe("DONE");
      expect(await prisma.notification.count({ where: { userId: alice } })).toBe(0);
    });

    it("settles a batch whose notification can't be written, and rejects nothing, or the gate would stay shut", async () => {
      holdImportWorker();
      const queuedAt = new Date(Date.now() - 60_000);
      const data = { status: "RUNNING" as const, type: "ZIP" as const, queuedAt, payload: { entries: ["a"] } };
      const first = await lineJob(alice, base + 85, data, []);
      const second = await lineJob(alice, base + 86, data, []);
      vi.spyOn(prisma.notification, "create").mockRejectedValueOnce(new Error("database blip"));
      await expect(recoverImportJobs()).resolves.toBeUndefined();
      expect((await reload(first.id)).status).toBe("ERROR");
      expect((await reload(second.id)).status).toBe("ERROR");
      expect(await prisma.notification.count({ where: { userId: alice } })).toBe(1);
    });

    it("can't touch work started since when it tries again, however late", async () => {
      holdImportWorker();
      const before = new Date(Date.now() - 60_000);
      const since = await lineJob(alice, base + 75, { status: "RUNNING", queuedAt: new Date() });
      const direct = await lineJob(alice, base + 76, { status: "RUNNING", queuedAt: null });
      const sync = await lineJob(alice, base + 82, {
        status: "RUNNING",
        queuedAt: null,
        collectionSyncId: (await syncedCollection()).id,
      });
      await recoverImportJobs(before);
      for (const job of [since, direct, sync]) expect((await reload(job.id)).status).toBe("RUNNING");
      const ids = [since.id, direct.id, sync.id];
      await prisma.importJob.updateMany({ where: { id: { in: ids } }, data: { status: "DONE" } });
    });

    it("takes what a machine booting behind its own clock left, on the first try", async () => {
      holdImportWorker();
      const ahead = new Date(Date.now() + 60 * 60 * 1000);
      const job = await lineJob(alice, base + 83, { status: "RUNNING", queuedAt: null, updatedAt: ahead });
      await recoverImportJobs();
      expect((await reload(job.id)).status).toBe("ERROR");
    });

    it("finishes a cut-off job's other links, and reports a one-link job's interruption by running it to its end", async () => {
      holdImportWorker();
      const queuedAt = new Date(Date.now() - 60_000);
      const line = await lineJob(alice, base + 77, { status: "RUNNING", queuedAt, imported: 1, processed: 1 }, [
        { url: modelUrl(base + 77), status: "DONE" },
        { url: modelUrl(base + 78), status: "RUNNING" },
        { url: modelUrl(base + 79), status: "PENDING" },
      ]);
      const oneLink = await lineJob(
        bob,
        base + 80,
        { status: "RUNNING", queuedAt, payload: { scope: "url", single: true } },
        [{ url: modelUrl(base + 80), status: "RUNNING" }],
      );
      await recoverImportJobs();
      resumeImportWorker();
      await importWorkerIdle();

      // Never replayed: it may be half in the library.
      expect(started).toEqual([String(base + 79)]);
      expect(await reload(line.id)).toMatchObject({ status: "DONE", imported: 2, processed: 3, failedCount: 1 });
      expect(await reload(oneLink.id)).toMatchObject({ status: "DONE", imported: 0, processed: 1, failedCount: 1 });
      const told = await prisma.notification.findFirstOrThrow({ where: { userId: bob } });
      expect(told.title).toBe("Couldn't import a model");
      expect(told.body).toMatch(/may be incomplete in your library/);
    });

    it("leaves a paused job's stuck link for whoever starts it, who gets the rerun it always was", async () => {
      holdImportWorker();
      const paused = await lineJob(alice, base + 81, { status: "PAUSED", queuedAt: new Date() }, [
        { url: modelUrl(base + 81), status: "RUNNING" },
      ]);
      await recoverImportJobs();
      expect((await itemsOf(paused.id))[0].status).toBe("RUNNING");

      await startQueueJob(await reload(paused.id));
      resumeImportWorker();
      await importWorkerIdle();
      expect(started).toEqual([String(base + 81)]);
      expect(await reload(paused.id)).toMatchObject({ status: "DONE", imported: 1 });
    });
  });

  describe("a job that stops responding", () => {
    const STALLED = "This import stopped responding, so the line moved on. If Retry isn't offered, restart the server.";

    it("moves the line on and says so, though its runner may still be stuck", async () => {
      Object.assign(importWorkerTuning, { stallLimitMs: 200, stallCheckMs: 20 });
      const release = gate(base + 90);
      const stuck = await enqueueSingleImport(alice, modelUrl(base + 90), {});
      const next = await enqueueSingleImport(bob, modelUrl(base + 91), {});
      await importWorkerIdle();

      expect(await reload(stuck.job.id)).toMatchObject({
        status: "ERROR",
        errorMessage:
          "This import stopped responding, so the line moved on. If Retry isn't offered, restart the server.",
      });
      expect((await reload(next.job.id)).status).toBe("DONE");
      // Nothing may start it again beside the stuck read.
      expect(isRunnerLive(stuck.job.id)).toBe(true);
      const told = await prisma.notification.findFirstOrThrow({ where: { userId: alice } });
      expect(told.internalPath).toBe("/admin-queue?import-queue=att");
      release();
    });

    it("doesn't take a job for stuck while it shows signs of life", async () => {
      Object.assign(importWorkerTuning, { stallLimitMs: 200, stallCheckMs: 20 });
      const release = gate(base + 92);
      let beats: NodeJS.Timeout | undefined;
      // In the job's own async context, as the read loops and rawFetch are.
      onDesign = () => {
        onDesign = () => undefined;
        beats = setInterval(noteImportActivity, 20).unref();
      };
      const busy = await enqueueSingleImport(alice, modelUrl(base + 92), {});
      const next = await enqueueSingleImport(bob, modelUrl(base + 93), {});
      await until(() => started.includes(String(base + 92)));
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect((await reload(busy.job.id)).status).toBe("RUNNING");
      expect((await reload(next.job.id)).status).toBe("QUEUED");

      // And once the beats stop, it is.
      clearInterval(beats);
      await until(async () => (await reload(busy.job.id)).status === "ERROR");
      release();
      await importWorkerIdle();
      expect((await reload(next.job.id)).status).toBe("DONE");
    });

    it("counts what a job writes as a sign of life too", async () => {
      Object.assign(importWorkerTuning, { stallLimitMs: 200, stallCheckMs: 20 });
      const release = gate(base + 94);
      const busy = await enqueueLinksImport(alice, [modelUrl(base + 94)], {});
      await until(() => started.includes(String(base + 94)));
      for (let i = 0; i < 6; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        await prisma.importJobItem.updateMany({ where: { jobId: busy.job.id }, data: { attempts: i } });
      }
      expect((await reload(busy.job.id)).status).toBe("RUNNING");
      release();
      await importWorkerIdle();
      expect((await reload(busy.job.id)).status).toBe("DONE");
    });

    it("doesn't let a paused job's stuck link hold the line either, and leaves it paused", async () => {
      Object.assign(importWorkerTuning, { stallLimitMs: 200, stallCheckMs: 20 });
      const release = gate(base + 95);
      const stuck = await enqueueLinksImport(alice, [modelUrl(base + 95), modelUrl(base + 96)], {});
      const next = await enqueueSingleImport(bob, modelUrl(base + 97), {});
      await until(() => started.includes(String(base + 95)));
      await prisma.importJob.update({ where: { id: stuck.job.id }, data: { status: "PAUSED" } });
      await importWorkerIdle();
      expect((await reload(stuck.job.id)).status).toBe("PAUSED");
      expect((await reload(next.job.id)).status).toBe("DONE");
      release();
      await until(() => !isRunnerLive(stuck.job.id));
      // Its link finished in the end; the next one waits for someone to start it.
      expect((await itemsOf(stuck.job.id)).map((i) => i.status)).toEqual(["DONE", "PENDING"]);
    });

    it("stops a job the watchdog gave up on at its next link", async () => {
      Object.assign(importWorkerTuning, { stallLimitMs: 200, stallCheckMs: 20 });
      const release = gate(base + 98);
      const stuck = await enqueueLinksImport(alice, [modelUrl(base + 98), modelUrl(base + 99)], {});
      await importWorkerIdle();
      expect((await reload(stuck.job.id)).status).toBe("ERROR");
      release();
      await until(() => !isRunnerLive(stuck.job.id));
      expect(started).toEqual([String(base + 98)]);
      expect((await reload(stuck.job.id)).status).toBe("ERROR");
    });

    it("stops a collection the watchdog gave up on at its next model, leaving it to be retried", async () => {
      Object.assign(importWorkerTuning, { stallLimitMs: 200, stallCheckMs: 20 });
      const [first, second] = [base + 120, base + 121];
      const release = gate(first);
      const { job } = await enqueueListImport(alice, "makerworld", "https://makerworld.com/en/collections/987-flock", {
        model_ids: [String(first), String(second)],
      });
      await importWorkerIdle();
      expect(await reload(job.id)).toMatchObject({ status: "ERROR", errorMessage: STALLED });
      release();
      await until(() => !isRunnerLive(job.id));

      expect(started).toEqual([String(first)]);
      const stopped = await reload(job.id);
      expect(stopped).toMatchObject({ status: "ERROR", errorMessage: STALLED, processed: 1, imported: 1 });
      expect(stopped.resultCollectionId).toBeNull();
      const told = await prisma.notification.findMany({ where: { userId: alice } });
      expect(told.map((notification) => notification.title)).toEqual(["Couldn't finish an import"]);

      // The whole request again: what came in is filed with the rest.
      Object.assign(importWorkerTuning, tuning);
      await startQueueJob(stopped, { retryFailed: true, manual: true });
      await importWorkerIdle();
      const retried = await reload(job.id);
      expect(retried).toMatchObject({ status: "DONE", errorMessage: null, imported: 1, alreadyInLibrary: 1 });
      const filed = await prisma.collectionItem.findMany({
        where: { collectionId: retried.resultCollectionId! },
        select: { print: { select: { sourceExternalId: true } } },
      });
      expect(filed.map((item) => item.print.sourceExternalId)).toEqual(
        expect.arrayContaining([String(first), String(second)]),
      );
    });

    it("stops print profiles the watchdog gave up on before the next one", async () => {
      Object.assign(importWorkerTuning, { stallLimitMs: 200, stallCheckMs: 20 });
      const id = base + 122;
      const release = gate(id);
      const { job } = await enqueueProfilesImport(alice, "makerworld", modelUrl(id), { scope: "all" });
      await importWorkerIdle();
      release();
      await until(() => !isRunnerLive(job.id));

      expect(await reload(job.id)).toMatchObject({ status: "ERROR", errorMessage: STALLED, processed: 0, imported: 0 });
      expect(await prisma.print.count({ where: { userId: alice, sourceExternalId: String(id) } })).toBe(0);
      const told = await prisma.notification.findMany({ where: { userId: alice } });
      expect(told.map((notification) => notification.title)).toEqual(["Couldn't finish an import"]);
    });

    it("reads as done, with nothing about stopping, when it finishes after all", async () => {
      Object.assign(importWorkerTuning, { stallLimitMs: 200, stallCheckMs: 20 });
      const release = gate(base + 123);
      const { job } = await enqueueSingleImport(alice, modelUrl(base + 123), {});
      await importWorkerIdle();
      expect(await reload(job.id)).toMatchObject({ status: "ERROR", errorMessage: STALLED });
      release();
      await until(() => !isRunnerLive(job.id));
      expect(await reload(job.id)).toMatchObject({ status: "DONE", errorMessage: null, imported: 1 });
    });

    describe("given up on just as its last step lands", () => {
      const LIST_URL = "https://makerworld.com/en/collections/987-flock";
      const OTHER_LIST_URL = "https://www.printables.com/@someone/collections/123";

      it.each([
        ["a link list", 1, () => enqueueLinksImport(alice, [modelUrl(base + 130)], {})],
        [
          "a MakerWorld list",
          1,
          () => enqueueListImport(alice, "makerworld", LIST_URL, { model_ids: [String(base + 131)] }),
        ],
        [
          "another site's list",
          1,
          () =>
            enqueueListImport(alice, "printables", OTHER_LIST_URL, { model_ids: ["555"], collection_title: "Named" }),
        ],
        ["print profiles", 2, () => enqueueProfilesImport(alice, "makerworld", modelUrl(base + 132), { scope: "all" })],
        ["a zip", 1, () => enqueueZipImport(alice, "https://example.com/pack.zip", { entries: ["hull.stl"] })],
      ] as const)("%s still ends with no stall message", async (_label, steps, enqueue) => {
        holdImportWorker();
        const { job } = await enqueue();
        const update = prisma.importJob.update.bind(prisma.importJob);
        vi.spyOn(prisma.importJob, "update").mockImplementation((async (args: Prisma.ImportJobUpdateArgs) => {
          const written = await update(args);
          if (args.where.id === job.id && args.data.processed === steps && !args.data.status) {
            await prisma.importJob.updateMany({
              where: { id: job.id, status: "RUNNING" },
              data: { status: "ERROR", errorMessage: STALLED },
            });
          }
          return written;
        }) as never);
        resumeImportWorker();
        await importWorkerIdle();
        expect(await reload(job.id)).toMatchObject({ status: "DONE", errorMessage: null });
      });
    });
  });

  describe("a database that fails", () => {
    it("doesn't reject when the line can't be read, and comes back by itself", async () => {
      holdImportWorker();
      const job = await enqueueSingleImport(alice, modelUrl(base + 100), {});
      vi.spyOn(prisma.importJob, "findFirst").mockRejectedValueOnce(new Error("database down"));
      resumeImportWorker();
      await importWorkerIdle();
      expect((await reload(job.job.id)).status).toBe("QUEUED");
      // The backoff, unprompted.
      await vi.waitFor(async () => expect((await reload(job.job.id)).status).toBe("DONE"), {
        timeout: 15_000,
        interval: 100,
      });
    });

    it("sets a job that couldn't write its own end, and tells its owner", async () => {
      const update = prisma.importJob.update.bind(prisma.importJob);
      vi.spyOn(prisma.importJob, "update").mockImplementation(((args: Prisma.ImportJobUpdateArgs) =>
        args.data.status ? Promise.reject(new Error("database blip")) : update(args)) as never);
      const job = await enqueueLinksImport(alice, [modelUrl(base + 101)], {});
      await importWorkerIdle();
      expect((await reload(job.job.id)).status).toBe("ERROR");
      expect((await reload(job.job.id)).errorMessage).toMatch(/Import interrupted/);
      expect(await prisma.notification.count({ where: { userId: alice, type: "import" } })).toBeGreaterThan(0);
    });

    it("settles it on the next good poll when that write fails too", async () => {
      const update = prisma.importJob.update.bind(prisma.importJob);
      const updateMany = prisma.importJob.updateMany.bind(prisma.importJob);
      const down = { on: true };
      vi.spyOn(prisma.importJob, "update").mockImplementation(((args: Prisma.ImportJobUpdateArgs) =>
        args.data.status ? Promise.reject(new Error("database blip")) : update(args)) as never);
      vi.spyOn(prisma.importJob, "updateMany").mockImplementation(((args: Prisma.ImportJobUpdateManyArgs) =>
        down.on && args.data.status === "ERROR"
          ? Promise.reject(new Error("database blip"))
          : updateMany(args)) as never);
      const job = await enqueueLinksImport(alice, [modelUrl(base + 102)], {});
      await importWorkerIdle();
      expect((await reload(job.job.id)).status).toBe("RUNNING");

      down.on = false;
      wakeImportWorker();
      await importWorkerIdle();
      expect((await reload(job.job.id)).status).toBe("ERROR");
    });
  });

  describe("one link", () => {
    it("leaves the trail any import of one link does, with the model's name on the job", async () => {
      const { job } = await enqueueSingleImport(alice, modelUrl(base + 110), {});
      expect(job.status).toBe("QUEUED");
      expect((job.payload as Record<string, unknown>).single).toBe(true);
      await importWorkerIdle();
      const done = await reload(job.id);
      expect(done).toMatchObject({ status: "DONE", sourceLabel: `Phoenix ${base + 110}`, imported: 1 });
      expect((done.payload as Record<string, unknown>).outcome).toBe("created");
      expect(done.resultPrintId).not.toBeNull();
      const told = await prisma.notification.findMany({ where: { userId: alice } });
      expect(told).toHaveLength(1);
      expect(told[0]).toMatchObject({
        title: `Imported "Phoenix ${base + 110}"`,
        internalPath: `/models/${done.resultPrintId}`,
      });
      const logs = { userId: alice, targetId: done.resultPrintId };
      await until(async () => (await prisma.log.count({ where: { ...logs, action: "model_imported" } })) === 1);
      expect(await prisma.log.count({ where: { ...logs, action: "import_completed" } })).toBe(0);
    });

    it("still opens a model that was already in the library", async () => {
      const first = await enqueueSingleImport(alice, modelUrl(base + 111), {});
      await importWorkerIdle();
      const firstPrint = (await reload(first.job.id)).resultPrintId;
      await prisma.notification.deleteMany({ where: { userId: alice } });

      const again = await enqueueSingleImport(alice, modelUrl(base + 111), {});
      await importWorkerIdle();
      const done = await reload(again.job.id);
      expect(done).toMatchObject({ status: "DONE", imported: 0, alreadyInLibrary: 1, resultPrintId: firstPrint });
      expect((done.payload as Record<string, unknown>).outcome).toBe("already_imported");
      const told = await prisma.notification.findFirstOrThrow({ where: { userId: alice } });
      expect(told.title).toBe(`"Phoenix ${base + 111}" is already in your library`);
      expect(told.internalPath).toBe(`/models/${firstPrint}`);
    });

    it("says why it failed, as a single import does", async () => {
      gone.add(String(base + 112));
      const { job } = await enqueueSingleImport(alice, modelUrl(base + 112), {});
      await importWorkerIdle();
      const done = await reload(job.id);
      expect(done).toMatchObject({ status: "DONE", failedCount: 1, resultPrintId: null });
      const told = await prisma.notification.findFirstOrThrow({ where: { userId: alice } });
      expect(told.title).toBe("Couldn't import a model");
      expect(told.body).toBeTruthy();
      expect(told.internalPath).toBe("/admin-queue?import-queue=att");
    });

    it("says a download was cut off, on the link and in the notification", async () => {
      fileFailure = new TypeError("terminated");
      const { job } = await enqueueSingleImport(alice, modelUrl(base + 116), {});
      await importWorkerIdle();
      expect(await reload(job.id)).toMatchObject({ status: "DONE", failedCount: 1 });
      expect((await itemsOf(job.id)).map((item) => item.errorMessage)).toEqual(["The download was cut off."]);
      const told = await prisma.notification.findFirstOrThrow({ where: { userId: alice } });
      expect(told.body).toBe("The download was cut off.");
    });

    it.each([
      ["a download cut off, in words", new TypeError("terminated"), "The download was cut off."],
      ["anything else, as it always has", new TypeError("fetch failed"), "fetch failed"],
    ])("fails a job that has no links with %s", async (_what, failure, message) => {
      zipFailure = failure;
      const { job } = await enqueueZipImport(alice, "https://example.com/pack.zip", {
        entries: ["hull.stl"],
        tags: [],
      });
      await importWorkerIdle();
      expect(await reload(job.id)).toMatchObject({ status: "ERROR", errorMessage: message });
    });

    it("names a zip by the file it was sent with while it waits, and goes by the URL without one", async () => {
      holdImportWorker();
      const named = await enqueueZipImport(alice, "https://example.com/get?id=1", {
        entries: ["hull.stl"],
        tags: [],
        filename: " pack.zip ",
      });
      expect((await reload(named.job.id)).sourceLabel).toBe("pack.zip");
      const unnamed = await enqueueZipImport(alice, "https://example.com/get?id=2", {
        entries: ["hull.stl"],
        tags: [],
      });
      expect((await reload(unnamed.job.id)).sourceLabel).toBeNull();
    });

    it("answers with the job already waiting for the same link", async () => {
      holdImportWorker();
      const first = await enqueueSingleImport(alice, modelUrl(base + 113), {});
      const second = await enqueueSingleImport(alice, modelUrl(base + 113), {});
      expect(second.job.id).toBe(first.job.id);
      const theirs = await enqueueSingleImport(bob, modelUrl(base + 113), {});
      expect(theirs.job.id).not.toBe(first.job.id);
      expect(await prisma.importJob.count({ where: { userId: alice } })).toBe(1);
    });

    it("keeps a batch's words for its card, out of the message old clients read", async () => {
      gone.add(String(base + 115));
      const { job } = await enqueueLinksImport(alice, [modelUrl(base + 114), modelUrl(base + 115)], {});
      await importWorkerIdle();
      const done = await reload(job.id);
      expect(done).toMatchObject({ status: "DONE", errorMessage: null, failedCount: 1 });
      expect((done.payload as Record<string, unknown>).failure_summary).toBe(
        "1 failed — retry them from the import queue.",
      );
      const told = await prisma.notification.findFirstOrThrow({ where: { userId: alice } });
      expect(told.internalPath).toBe("/admin-queue?import-queue=att");
    });
  });
});
