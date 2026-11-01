import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
import { maskQueued, type QueueOut, toImportJobOut, toQueueJobOut } from "../src/dto";
import { setUserMakerworldCookie } from "../src/providers/makerworld/session";
import { releaseSync, reserveSync } from "../src/services/collectionSyncRunner";
import { isRunnerLive, SYNC_JOB_INTERRUPTED, SYNC_JOB_WAITING, trackRunner } from "../src/services/importJobRunner";
import {
  attentionWhere,
  bulkRunState,
  clearFinishedJobs,
  deleteQueueJob,
  enqueueLinksImport,
  enqueueSingleImport,
  enqueueZipImport,
  getQueueJob,
  isAttention,
  jobActions,
  listQueueJobs,
  pauseAll,
  pauseQueueJob,
  personKey,
  positionOf,
  queueLink,
  readEveryonesQueue,
  readLine,
  readOwnQueue,
  removeQueueItem,
  retryAllFailed,
  startAllPaused,
  startQueueJob,
} from "../src/services/importQueueService";
import {
  holdImportWorker,
  importWorkerIdle,
  importWorkerTuning,
  resumeImportWorker,
  wakeImportWorker,
} from "../src/services/importWorker";
import { setProviderEnabled } from "../src/services/providerSettingsService";

const app = createApp();
const stamp = Date.now();

let alice: string;
let bob: string;
let aliceToken: string;
let adminToken: string;

async function register(label: string): Promise<{ id: string; token: string }> {
  const res = await request(app)
    .post("/api/register")
    .send({ displayName: `Line ${label}`, email: `line-${label}-${stamp}@example.com`, password: "password123" });
  if (res.status !== 200) throw new Error(`register ${label}: ${res.status} ${JSON.stringify(res.body)}`);
  return { id: res.body.user.id, token: res.body.token };
}

const url = (id: number | string) => `https://example.com/${id}.stl`;
const reload = (id: string) => prisma.importJob.findUniqueOrThrow({ where: { id } });
const itemsOf = (jobId: string) =>
  prisma.importJobItem.findMany({ where: { jobId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });

/** A row as a route or a run leaves it, on hold unless told. `items`: its links, by status. */
async function row(
  userId: string,
  data: Partial<Prisma.ImportJobUncheckedCreateInput> = {},
  items: ("PENDING" | "RUNNING" | "DONE" | "FAILED")[] = ["PENDING"],
): Promise<ImportJob> {
  const job = await prisma.importJob.create({
    data: {
      userId,
      type: "LINKS",
      status: "PAUSED",
      sourceUrl: url("first"),
      total: items.length,
      payload: { notes: null, tags: [], category_id: null, scope: "url" },
      ...data,
    },
  });
  for (const [index, status] of items.entries()) {
    await prisma.importJobItem.create({ data: { jobId: job.id, url: url(`${job.id}-${index}`), status } });
  }
  return job;
}

async function syncedCollection(userId: string): Promise<string> {
  const collection = await prisma.collection.create({
    data: { userId, name: `Synced ${stamp}`, nameNormalized: `synced ${stamp} ${Math.random()}` },
  });
  const sync = await prisma.collectionSync.create({
    data: {
      userId,
      collectionId: collection.id,
      provider: "makerworld",
      externalId: `${stamp}-${Math.random()}`,
      sourceUrl: "https://makerworld.com/en/collections/1-a",
    },
  });
  return sync.id;
}

describe("the import line", () => {
  beforeAll(async () => {
    const a = await register("alice");
    const b = await register("bob");
    const admin = await register("admin");
    alice = a.id;
    bob = b.id;
    aliceToken = a.token;
    await prisma.user.update({ where: { id: admin.id }, data: { role: "ADMIN" } });
    const login = await request(app)
      .post("/api/login")
      .send({ email: `line-admin-${stamp}@example.com`, password: "password123" });
    adminToken = login.body.token;
    await prisma.importJob.updateMany({ where: { status: "QUEUED" }, data: { status: "PAUSED" } });
  });

  // Nothing here needs a job to run: what's in line stays in line.
  beforeEach(() => {
    holdImportWorker();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await prisma.importJob.deleteMany({ where: { userId: { in: [alice, bob] } } });
    await prisma.notification.deleteMany({ where: { userId: { in: [alice, bob] } } });
    await prisma.user.updateMany({ where: { id: { in: [alice, bob] } }, data: { startGrabLinks: false } });
  });

  afterAll(async () => {
    resumeImportWorker();
    await importWorkerIdle();
    await prisma.user.deleteMany({ where: { email: { contains: `line-`, endsWith: `-${stamp}@example.com` } } });
  });

  describe("Start and Retry", () => {
    it("goes to the back of the line, whenever the job was made", async () => {
      const ahead = await enqueueSingleImport(bob, url("ahead"), {});
      const old = await row(alice, { createdAt: new Date("2019-01-01") });
      const started = await startQueueJob(old, { manual: true });
      expect(started.position).toBe(2);
      const after = await reload(old.id);
      expect(after.status).toBe("QUEUED");
      expect(after.queuedAt!.getTime()).toBeGreaterThan(ahead.job.queuedAt!.getTime());
      expect(await positionOf(ahead.job.id)).toBe(1);
    });

    it("keeps a job's place on a double click", async () => {
      const job = await row(alice);
      await enqueueSingleImport(bob, url("behind-first"), {}); // ahead of it, as it's started after
      await startQueueJob(job);
      const { queuedAt } = await reload(job.id);
      await enqueueSingleImport(bob, url("behind"), {});

      const again = await startQueueJob(await reload(job.id));
      expect(again.position).toBe(2);
      expect((await reload(job.id)).queuedAt).toEqual(queuedAt);
      // Both of a double click read it on hold, and the second finds it in line.
      const stale = { ...job, status: "PAUSED" as const };
      expect((await startQueueJob(stale)).position).toBe(2);
      expect((await reload(job.id)).queuedAt).toEqual(queuedAt);
    });

    it("keeps everyone's number from rising: only a job of their own going back moves it", async () => {
      const mine = await enqueueSingleImport(alice, url("mine"), {});
      const place = () => positionOf(mine.job.id);
      const theirs = await enqueueSingleImport(bob, url("theirs"), {});
      expect(await place()).toBe(1);
      const first = await enqueueSingleImport(bob, url("x"), {});
      expect(await place()).toBe(1);
      await pauseQueueJob(mine.job);
      await startQueueJob(await reload(mine.job.id));
      const back = await place();
      expect(back).toBe(3);

      // Others holding, deleting, failing and starting again: never up.
      await pauseQueueJob(await reload(theirs.job.id));
      expect(await place()).toBe(2);
      await startQueueJob(await reload(theirs.job.id));
      expect(await place()).toBe(2);
      await deleteQueueJob(first.job.id);
      expect(await place()).toBe(1);
    });

    it("recounts a link list's retry, keeping what came in, and clears what its last run said", async () => {
      const job = await row(
        alice,
        {
          status: "DONE",
          imported: 1,
          processed: 2,
          failedCount: 1,
          startedAt: new Date(),
          resultPrintId: "kept",
          payload: { scope: "url", failure_summary: "1 failed.", outcome: "created", notes: "Kept" },
        },
        ["DONE", "FAILED"],
      );
      await prisma.importJobItem.updateMany({
        where: { jobId: job.id, status: "FAILED" },
        data: { errorMessage: "No" },
      });
      await startQueueJob(job, { retryFailed: true, manual: true });
      const after = await reload(job.id);
      expect(after).toMatchObject({
        status: "QUEUED",
        imported: 1,
        processed: 1,
        failedCount: 0,
        errorMessage: null,
        startedAt: null,
        resultPrintId: "kept",
      });
      expect(after.payload).toEqual({ scope: "url", notes: "Kept" });
      expect((await itemsOf(job.id)).map((i) => [i.status, i.errorMessage])).toEqual([
        ["DONE", null],
        ["PENDING", null],
      ]);
      expect(isAttention(after, new Date())).toBe(false);
    });

    it("runs a saved list or profiles request again from zero; a job with none says so", async () => {
      const list = await row(
        alice,
        {
          type: "COLLECTION",
          status: "DONE",
          provider: "makerworld",
          total: 3,
          processed: 3,
          imported: 2,
          alreadyInLibrary: 1,
          failedCount: 1,
          resultPrintId: "x",
          resultCollectionId: "y",
          payload: { model_ids: ["1", "2", "3"], failure_summary: "1 failed." },
        },
        [],
      );
      await startQueueJob(list, { retryFailed: true });
      const after = await reload(list.id);
      expect(after).toMatchObject({
        status: "QUEUED",
        processed: 0,
        imported: 0,
        alreadyInLibrary: 0,
        failedCount: 0,
        resultPrintId: null,
        resultCollectionId: null,
        total: 3,
      });
      expect(after.payload).toEqual({ model_ids: ["1", "2", "3"] });

      const failed = await row(alice, { type: "PROFILES", status: "ERROR", payload: { scope: "all" } }, []);
      expect((await startQueueJob(failed, { retryFailed: true })).position).toBe(2);

      const older = await row(alice, { type: "COLLECTION", status: "ERROR", payload: undefined }, []);
      await expect(startQueueJob(older, { retryFailed: true })).rejects.toMatchObject({
        status: 400,
        message: "This older import has no saved request",
      });
      expect((await reload(older.id)).status).toBe("ERROR");

      const clean = await row(alice, { type: "COLLECTION", status: "DONE", payload: { model_ids: ["1"] } }, []);
      await expect(startQueueJob(clean, { retryFailed: true })).rejects.toMatchObject({ status: 400 });
      const running = await row(alice, { type: "COLLECTION", status: "RUNNING", payload: { model_ids: ["1"] } }, []);
      await expect(startQueueJob(running, { retryFailed: true })).rejects.toMatchObject({ status: 409 });
      await prisma.importJob.update({ where: { id: running.id }, data: { status: "DONE" } });
    });

    it("never retries a zip, but lets a held one start", async () => {
      const payload = { entries: ["a.stl"] };
      const held = await row(alice, { type: "ZIP", payload }, []);
      expect((await startQueueJob(held)).position).toBe(1);
      for (const status of ["DONE", "ERROR"] as const) {
        const finished = await row(alice, { type: "ZIP", status, failedCount: 1, payload }, []);
        await expect(startQueueJob(finished, { retryFailed: true })).rejects.toMatchObject({ status: 400 });
        await expect(startQueueJob(finished)).rejects.toMatchObject({ status: 400 });
      }
    });

    it("waits for a finished job's runner, and gives up on a paused one's", async () => {
      const finishing = await row(alice, { status: "DONE", failedCount: 1 }, ["FAILED"]);
      let finish!: () => void;
      void trackRunner(finishing.id, new Promise<void>((resolve) => (finish = resolve)));
      const retried = startQueueJob(finishing, { retryFailed: true });
      expect((await reload(finishing.id)).status).toBe("DONE");
      finish();
      expect((await retried).position).toBe(1);

      const pausing = await row(alice);
      let done!: () => void;
      const run = trackRunner(pausing.id, new Promise<void>((resolve) => (done = resolve)));
      await expect(startQueueJob(pausing)).rejects.toMatchObject({ status: 409 });
      expect((await reload(pausing.id)).status).toBe("PAUSED");
      done();
      await run;
    });

    it("gives up on a runner that doesn't finish, and leaves the job as it was", async () => {
      const waitMs = importWorkerTuning.runnerWaitMs;
      importWorkerTuning.runnerWaitMs = 50;
      const stuck = await row(alice, { status: "ERROR", errorMessage: "Stopped responding" }, ["FAILED"]);
      let finish!: () => void;
      const run = trackRunner(stuck.id, new Promise<void>((resolve) => (finish = resolve)));
      try {
        await expect(startQueueJob(stuck, { retryFailed: true })).rejects.toMatchObject({ status: 409 });
        await expect(startQueueJob(stuck)).rejects.toMatchObject({ status: 409 });
        await expect(deleteQueueJob(stuck.id)).rejects.toMatchObject({ status: 409 });
        expect(await reload(stuck.id)).toMatchObject({ status: "ERROR", errorMessage: "Stopped responding" });
        expect((await itemsOf(stuck.id)).map((i) => i.status)).toEqual(["FAILED"]);
      } finally {
        importWorkerTuning.runnerWaitMs = waitMs;
        finish();
        await run;
      }
      expect((await startQueueJob(stuck, { retryFailed: true })).position).toBe(1);
    });

    it("keeps a sync's job out of the line", async () => {
      const job = await row(alice, { collectionSyncId: await syncedCollection(alice) }, ["DONE"]);
      await expect(startQueueJob(job)).rejects.toMatchObject({ status: 400 });
      expect(await positionOf(job.id)).toBeNull();
      expect((await reload(job.id)).status).not.toBe("QUEUED");
    });
  });

  describe("Hold, Pause and delete", () => {
    it("holds a waiting job of any type, and everyone behind it moves up", async () => {
      const zip = await enqueueZipImport(alice, url("zip"), { entries: ["a.stl"] });
      const next = await enqueueSingleImport(bob, url("next"), {});
      expect(await positionOf(next.job.id)).toBe(2);
      await pauseQueueJob(zip.job);
      expect((await reload(zip.job.id)).status).toBe("PAUSED");
      expect(await positionOf(next.job.id)).toBe(1);
    });

    it("refuses a stale Hold and what can't stop mid-way", async () => {
      const claimed = await row(alice, { status: "RUNNING", type: "ZIP" }, []);
      await expect(pauseQueueJob({ ...claimed, status: "QUEUED" })).rejects.toMatchObject({ status: 409 });
      expect((await reload(claimed.id)).status).toBe("RUNNING");
      await expect(pauseQueueJob(claimed)).rejects.toMatchObject({ status: 400 });
      await prisma.importJob.update({ where: { id: claimed.id }, data: { status: "DONE" } });

      const single = await row(alice, { status: "RUNNING", payload: { single: true } });
      await expect(pauseQueueJob(single)).rejects.toMatchObject({ status: 400 });
      await prisma.importJob.update({ where: { id: single.id }, data: { status: "DONE" } });
    });

    it("takes a sync job waiting for its lane off by losing its mark, keeping what it brought in", async () => {
      const payload = { sync_new: ["p1"], item_delay_ms: 60_000 };
      const job = await row(alice, {
        collectionSyncId: await syncedCollection(alice),
        errorMessage: SYNC_JOB_WAITING,
        payload,
      });
      await pauseQueueJob(job);
      const held = await reload(job.id);
      expect(held).toMatchObject({ status: "PAUSED", errorMessage: null });
      expect(held.payload).toEqual(payload);
    });

    it("deletes only what it read: a job claimed meanwhile stays", async () => {
      const waiting = await enqueueSingleImport(alice, url("claimed"), {});
      const deleteMany = prisma.importJob.deleteMany.bind(prisma.importJob);
      vi.spyOn(prisma.importJob, "deleteMany").mockImplementationOnce((async (args: Prisma.ImportJobDeleteManyArgs) => {
        await prisma.importJob.update({ where: { id: waiting.job.id }, data: { status: "RUNNING" } });
        return deleteMany(args);
      }) as never);
      await expect(deleteQueueJob(waiting.job.id)).rejects.toMatchObject({ status: 409 });
      await prisma.importJob.update({ where: { id: waiting.job.id }, data: { status: "DONE" } });
    });

    it("treats someone else's job as if it weren't there", async () => {
      const theirs = await row(bob);
      const [item] = await itemsOf(theirs.id);
      await expect(getQueueJob(theirs.id, alice)).rejects.toMatchObject({ status: 404 });
      await expect(deleteQueueJob(theirs.id, alice)).rejects.toMatchObject({ status: 404 });
      await expect(removeQueueItem(item.id, alice)).rejects.toMatchObject({ status: 404 });
      expect(await reload(theirs.id)).toBeTruthy();
      expect(await getQueueJob(theirs.id, bob)).toMatchObject({ id: theirs.id });
      expect(await removeQueueItem(item.id, bob)).toEqual({ jobDeleted: true });
    });

    it("removes a link from a job in line, and the job with its last one", async () => {
      const { job } = await enqueueLinksImport(alice, [url("a"), url("b")], {});
      const next = await enqueueSingleImport(bob, url("c"), {});
      const [first, second] = await itemsOf(job.id);
      expect(await removeQueueItem(first.id)).toEqual({ jobDeleted: false });
      expect((await reload(job.id)).total).toBe(1);
      expect(await removeQueueItem(second.id)).toEqual({ jobDeleted: true });
      expect(await positionOf(next.job.id)).toBe(1);
    });

    it("moves a list's source to its next link when that link is removed, and only then", async () => {
      const { job } = await enqueueLinksImport(alice, [url("a"), url("b"), url("c"), url("d")], {});
      const [first, second, third] = await itemsOf(job.id);
      await removeQueueItem(second.id);
      expect((await reload(job.id)).sourceUrl).toBe(url("a"));
      await removeQueueItem(first.id);
      expect((await reload(job.id)).sourceUrl).toBe(url("c"));
      await removeQueueItem(third.id);
      expect(await reload(job.id)).toMatchObject({ sourceUrl: url("d"), total: 1 });

      // A sync's job goes by its collection, whichever links it has.
      const sync = await row(alice, { sourceUrl: "https://example.com/collection" }, ["PENDING", "PENDING"]);
      await removeQueueItem((await itemsOf(sync.id))[0].id);
      expect((await reload(sync.id)).sourceUrl).toBe("https://example.com/collection");
    });

    it("finishes a held batch left with nothing to start or retry", async () => {
      const job = await row(alice, { imported: 1, processed: 1 }, ["DONE", "PENDING", "PENDING"]);
      const [second, third] = (await itemsOf(job.id)).filter((item) => item.status === "PENDING");
      expect(await removeQueueItem(second.id)).toEqual({ jobDeleted: false });
      expect(await reload(job.id)).toMatchObject({ status: "PAUSED", total: 2, processed: 1 });

      expect(await removeQueueItem(third.id)).toEqual({ jobDeleted: false });
      expect(await reload(job.id)).toMatchObject({
        status: "DONE",
        errorMessage: null,
        total: 1,
        processed: 1,
        imported: 1,
        failedCount: 0,
      });
      const { jobs, finishedTotal } = await readOwnQueue(alice);
      expect(jobs.find((card) => card.id === job.id)).toMatchObject({ attention: false, position: null });
      expect(finishedTotal).toBe(1);
    });

    const removeFirstPending = async (jobId: string) => {
      const pending = (await itemsOf(jobId)).find((item) => item.status === "PENDING");
      await removeQueueItem(pending!.id);
    };

    it("keeps a held batch on hold while it has a link to retry or run", async () => {
      const failed = await row(alice, {}, ["DONE", "FAILED", "PENDING"]);
      await removeFirstPending(failed.id);
      expect(await reload(failed.id)).toMatchObject({ status: "PAUSED", processed: 2, failedCount: 1 });

      const waiting = await row(alice, {}, ["DONE", "PENDING", "PENDING"]);
      await removeFirstPending(waiting.id);
      expect((await reload(waiting.id)).status).toBe("PAUSED");
    });

    it("leaves a sync's job as it is, whose end says what it brought in", async () => {
      const collectionSyncId = await syncedCollection(alice);
      const held = await row(alice, { collectionSyncId, payload: { sync_new: ["print1"] } }, ["DONE", "PENDING"]);
      await removeFirstPending(held.id);
      expect(await reload(held.id)).toMatchObject({ status: "PAUSED", payload: { sync_new: ["print1"] } });
    });

    it("leaves a batch in line to run to its own end", async () => {
      const inLine = await row(alice, { status: "QUEUED", queuedAt: new Date() }, ["DONE", "PENDING"]);
      await removeFirstPending(inLine.id);
      expect((await reload(inLine.id)).status).toBe("QUEUED");
    });

    it("makes a Delete wait for a Grab link on its way into that job, so neither fails", async () => {
      const first = await queueLink(alice, url("one"), {});
      const read = prisma.importJobItem.findFirst.bind(prisma.importJobItem);
      let deleting: Promise<void> | undefined;
      // queueLink has found its job, and would be left adding to nothing.
      vi.spyOn(prisma.importJobItem, "findFirst").mockImplementationOnce((async (
        args: Prisma.ImportJobItemFindFirstArgs,
      ) => {
        deleting = deleteQueueJob(first.job.id, alice);
        await new Promise((resolve) => setTimeout(resolve, 50));
        return read(args);
      }) as never);

      const second = await queueLink(alice, url("two"), {});
      expect(second).toMatchObject({ duplicate: false, waiting: 2 });
      expect(second.job.id).toBe(first.job.id);
      await deleting;
      expect(await prisma.importJob.findUnique({ where: { id: first.job.id } })).toBeNull();
    });

    it("lets the next Grab link make a new job once a Delete has landed", async () => {
      const first = await queueLink(alice, url("one"), {});
      await deleteQueueJob(first.job.id, alice);
      const second = await queueLink(alice, url("two"), {});
      expect(second.job.id).not.toBe(first.job.id);
      expect(second).toMatchObject({ duplicate: false, waiting: 1 });
    });
  });

  describe("links from Grab", () => {
    const grab = (userId: string, id: string) => queueLink(userId, url(id), {});

    it("collects them on hold, in the job made for them and no other", async () => {
      const pasted = await row(alice, { payload: { notes: "Mine", tags: ["x"], scope: "url" } });
      const orphan = await row(alice, { sourceLabel: "Sync: Gone", payload: { item_delay_ms: 60_000 } });
      const first = await grab(alice, "one");
      expect(first).toMatchObject({ duplicate: false, waiting: 1, started: false, position: null });
      expect([pasted.id, orphan.id]).not.toContain(first.job.id);
      expect(first.job.status).toBe("PAUSED");
      const second = await grab(alice, "two");
      expect(second.job.id).toBe(first.job.id);
      expect(second.waiting).toBe(2);
      expect(await prisma.notification.count({ where: { userId: alice, type: "queue" } })).toBe(1);
      const told = await prisma.notification.findFirstOrThrow({ where: { userId: alice, type: "queue" } });
      expect(told.body).toBe("Paused until you start it from the import queue.");
      expect(told.internalPath).toBe("/admin-queue?import-queue=wait");
    });

    it("goes around a job whose runner has already read its links", async () => {
      const first = await grab(alice, "one");
      let finish!: () => void;
      const run = trackRunner(first.job.id, new Promise<void>((resolve) => (finish = resolve)));
      const second = await grab(alice, "two");
      expect(second.job.id).not.toBe(first.job.id);
      finish();
      await run;
    });

    it("joins the line by itself for someone who asked for that, and never a running job", async () => {
      await prisma.user.update({ where: { id: alice }, data: { startGrabLinks: true } });
      await enqueueSingleImport(bob, url("ahead"), {});
      const first = await grab(alice, "one");
      expect(first).toMatchObject({ started: true, position: 2, duplicate: false, waiting: 1 });
      expect(first.job).toMatchObject({ status: "QUEUED" });
      expect(first.job.queuedAt).not.toBeNull();
      expect(await prisma.notification.count({ where: { userId: alice, type: "queue" } })).toBe(0);

      const second = await grab(alice, "two");
      expect(second.job.id).toBe(first.job.id);
      expect(second).toMatchObject({ waiting: 2, position: 2 });
      expect((await reload(first.job.id)).total).toBe(2);
      expect((await grab(alice, "two")).duplicate).toBe(true);

      await prisma.importJob.update({ where: { id: first.job.id }, data: { status: "RUNNING" } });
      const third = await grab(alice, "three");
      expect(third.job.id).not.toBe(first.job.id);
      await prisma.importJob.update({ where: { id: first.job.id }, data: { status: "DONE" } });

      // Someone else's setting is theirs alone.
      expect((await grab(bob, "four")).started).toBe(false);
    });
  });

  describe("what shows where", () => {
    const now = new Date();
    const longAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    it("agrees on what's asking for attention, in a query and on a row", async () => {
      const cases: Partial<Prisma.ImportJobUncheckedCreateInput>[] = [];
      for (const type of ["LINKS", "ZIP", "COLLECTION", "PROFILES"] as const) {
        for (const status of ["RUNNING", "QUEUED", "PAUSED", "DONE", "ERROR"] as const) {
          for (const failedCount of [0, 1]) {
            for (const queuedAt of [null, longAgo]) {
              for (const updatedAt of [now, longAgo]) {
                cases.push({ type, status, failedCount, queuedAt, updatedAt });
              }
            }
          }
        }
      }
      const rows = await prisma.importJob.createManyAndReturn({
        data: cases.map(
          (c) => Object.assign(c, { userId: alice, sourceUrl: url("x") }) as Prisma.ImportJobCreateManyInput,
        ),
      });
      const queried = await prisma.importJob.findMany({
        where: { userId: alice, ...attentionWhere(now) },
        select: { id: true },
      });
      const expected = rows.filter((job) => isAttention(job, now));
      expect(queried.map((job) => job.id).toSorted()).toEqual(expected.map((job) => job.id).toSorted());
      expect(expected.length).toBeGreaterThan(0);
    });

    it("leaves old failures in Finished, and a partly failed zip, but not one from the line", async () => {
      const job = { sourceUrl: "", userId: "", type: "LINKS" as const };
      const attention = (data: Partial<ImportJob>) =>
        isAttention(
          { ...job, status: "DONE", failedCount: 0, queuedAt: null, updatedAt: now, ...data } as ImportJob,
          now,
        );
      expect(attention({ status: "ERROR" })).toBe(true);
      expect(attention({ status: "ERROR", updatedAt: longAgo })).toBe(false);
      expect(attention({ status: "ERROR", updatedAt: longAgo, queuedAt: longAgo })).toBe(true);
      expect(attention({ failedCount: 1 })).toBe(true);
      expect(attention({ failedCount: 1, type: "ZIP" })).toBe(false);
      expect(attention({ status: "ERROR", type: "ZIP" })).toBe(true);
      expect(attention({})).toBe(false);
      for (const status of ["RUNNING", "QUEUED", "PAUSED"] as const) {
        expect(attention({ status, failedCount: 1 })).toBe(false);
      }
    });

    const counts = (pending = 0, running = 0, done = 0, failed = 0) => ({ pending, running, done, failed });
    const links = { type: "LINKS", failedCount: 0, payload: {}, collectionSyncId: null, errorMessage: null } as const;

    it.each([
      ["held links", { ...links, status: "PAUSED" }, counts(1), false, { canStart: true, canDelete: true }],
      ["held with nothing left", { ...links, status: "PAUSED" }, counts(), false, { canDelete: true }],
      ["pausing", { ...links, status: "PAUSED" }, counts(1), true, {}],
      ["in line", { ...links, status: "QUEUED" }, counts(1), false, { canPause: true, canDelete: true }],
      ["running links", { ...links, status: "RUNNING" }, counts(0, 1), true, { canPause: true }],
      ["running single", { ...links, status: "RUNNING", payload: { single: true } }, counts(0, 1), true, {}],
      [
        "failed links",
        { ...links, status: "DONE", failedCount: 1 },
        counts(0, 0, 1, 1),
        false,
        { canRetry: true, canDelete: true },
      ],
      ["its runner still writing", { ...links, status: "DONE", failedCount: 1 }, counts(0, 0, 0, 1), true, {}],
      ["done", { ...links, status: "DONE" }, counts(0, 0, 1), false, { canDelete: true }],
      [
        "cut off, none failed",
        { ...links, status: "ERROR" },
        counts(1),
        false,
        { canStart: true, canRetry: true, canDelete: true },
      ],
      [
        "cut off with a failure",
        { ...links, status: "ERROR" },
        counts(1, 0, 0, 1),
        false,
        { canRetry: true, canDelete: true },
      ],
      [
        "paused with a failure",
        { ...links, status: "PAUSED" },
        counts(1, 0, 0, 1),
        false,
        { canStart: true, canRetry: true, canDelete: true },
      ],
      [
        "held zip",
        { ...links, type: "ZIP", status: "PAUSED", payload: { entries: ["a"] } },
        counts(),
        false,
        { canStart: true, canDelete: true },
      ],
      [
        "old held zip",
        { ...links, type: "ZIP", status: "PAUSED", payload: null },
        counts(),
        false,
        { canDelete: true },
      ],
      [
        "failed zip",
        { ...links, type: "ZIP", status: "ERROR", payload: { entries: ["a"] } },
        counts(),
        false,
        { canDelete: true },
      ],
      [
        "list that failed",
        { ...links, type: "COLLECTION", status: "ERROR", payload: { model_ids: ["1"] } },
        counts(),
        false,
        { canRetry: true, canDelete: true },
      ],
      [
        "list partly failed",
        { ...links, type: "COLLECTION", status: "DONE", failedCount: 1, payload: { model_ids: ["1"] } },
        counts(),
        false,
        { canRetry: true, canDelete: true },
      ],
      [
        "old list that failed",
        { ...links, type: "COLLECTION", status: "ERROR", payload: null },
        counts(),
        false,
        { canDelete: true },
      ],
      [
        "list in full",
        { ...links, type: "COLLECTION", status: "DONE", payload: { model_ids: ["1"] } },
        counts(),
        false,
        { canDelete: true },
      ],
      [
        "sync waiting",
        { ...links, status: "PAUSED", collectionSyncId: "s", errorMessage: SYNC_JOB_INTERRUPTED },
        counts(1),
        false,
        { canPause: true, canDelete: true },
      ],
      [
        "sync held",
        { ...links, status: "PAUSED", collectionSyncId: "s", errorMessage: "Rate limited" },
        counts(1),
        false,
        { canStart: true, canDelete: true },
      ],
    ] as const)("offers what fits: %s", (_label, job, itemCounts, live, offered) => {
      expect(jobActions(job as Parameters<typeof jobActions>[0], itemCounts, live)).toEqual({
        canStart: false,
        canPause: false,
        canRetry: false,
        canDelete: false,
        ...offered,
      });
    });

    it("shows someone's own list: all that's open and asking for attention, the newest of the rest", async () => {
      const longFailed = await row(alice, { status: "ERROR", updatedAt: longAgo, errorMessage: "Old" }, []);
      const failed = await row(alice, { status: "ERROR", errorMessage: "Recent" }, []);
      const held = await row(alice);
      const inLine = await enqueueSingleImport(alice, url("line"), {});
      await prisma.importJob.createMany({
        data: Array.from({ length: 60 }, () => ({
          userId: alice,
          type: "LINKS" as const,
          status: "DONE" as const,
          sourceUrl: url("d"),
        })),
      });
      const theirs = await row(bob, { status: "ERROR", errorMessage: "Theirs" }, []);

      const own = await readOwnQueue(alice);
      const ids = own.jobs.map((job) => job.id);
      expect(ids).toEqual(expect.arrayContaining([failed.id, held.id, inLine.job.id]));
      expect(ids).not.toContain(theirs.id);
      expect(own.finishedTotal).toBe(61);
      expect(ids).toHaveLength(3 + 50);
      expect(own.jobs.find((job) => job.id === inLine.job.id)).toMatchObject({ position: 1, attention: false });
      expect(own.jobs.find((job) => job.id === failed.id)).toMatchObject({ position: null, attention: true });
      expect(ids).not.toContain(longFailed.id);

      // Exactly the Finished section.
      expect(await clearFinishedJobs({ ownerId: alice, line: true })).toBe(61);
      expect(await prisma.importJob.findUnique({ where: { id: failed.id } })).not.toBeNull();
      expect(await prisma.importJob.findUnique({ where: { id: longFailed.id } })).toBeNull();
      expect((await reload(theirs.id)).status).toBe("ERROR");
    });

    it("keeps an admin's list complete past its limit only when asked", async () => {
      const oldest = await row(alice, { createdAt: new Date("2019-01-01") });
      await prisma.importJob.createMany({
        data: Array.from({ length: 210 }, () => ({
          userId: alice,
          type: "LINKS" as const,
          status: "DONE" as const,
          sourceUrl: url("d"),
        })),
      });
      expect((await listQueueJobs()).some((job) => job.id === oldest.id)).toBe(false);
      expect((await readEveryonesQueue()).jobs.some((job) => job.id === oldest.id)).toBe(true);
    });

    it("shows other people's places in the line and nothing about them", async () => {
      const first = await enqueueSingleImport(bob, url("private-bob-one"), { title: "Private title" });
      const mine = await enqueueSingleImport(alice, url("mine"), {});
      const after = await enqueueSingleImport(bob, url("private-bob-two"), {});
      const line = await readLine(alice);
      expect(line.length).toBe(3);
      expect(line.now).toBeNull();
      // Up to their last job, nothing behind it.
      expect(line.rows).toEqual([
        { position: 1, mine: false, person: personKey(bob), job_id: null },
        { position: 2, mine: true, person: personKey(alice), job_id: mine.job.id },
      ]);
      const seen = JSON.stringify(line);
      for (const secret of [bob, first.job.id, after.job.id, "private", `line-bob-${stamp}`]) {
        expect(seen).not.toContain(secret);
      }
      expect((await readLine(`nobody-${stamp}`)).rows).toEqual([]);
      expect(personKey(bob)).toMatch(/^[0-9a-f]{12}$/);
      expect(personKey(bob)).not.toBe(personKey(alice));
    });
  });

  describe("everything at once", () => {
    it("starts what's on hold: all of it by the old meaning, what can start by the new", async () => {
      const links = await row(alice, { createdAt: new Date("2020-01-01") });
      const zip = await row(alice, { type: "ZIP", payload: { entries: ["a"] } }, []);
      const empty = await row(alice, {}, []);
      const stopped = await row(
        alice,
        { collectionSyncId: await syncedCollection(alice), errorMessage: "Rate limited" },
        ["DONE"],
      );
      const waiting = await row(alice, {
        collectionSyncId: await syncedCollection(alice),
        errorMessage: SYNC_JOB_WAITING,
      });
      const theirs = await row(bob);

      expect(await startAllPaused({ ownerId: alice, line: true })).toBe(2);
      expect((await reload(links.id)).status).toBe("QUEUED");
      expect((await reload(zip.id)).status).toBe("QUEUED");
      for (const job of [empty, stopped, waiting, theirs]) expect((await reload(job.id)).status).toBe("PAUSED");
      // Joined in the order they were made.
      expect(await positionOf(links.id)).toBe(1);
      expect(await positionOf(zip.id)).toBe(2);
      // A second press finds nothing more.
      expect(await startAllPaused({ ownerId: alice, line: true })).toBe(0);

      const other = await row(bob, { type: "ZIP", payload: { entries: ["a"] } }, []);
      expect(await startAllPaused({ ownerId: bob })).toBe(1);
      expect((await reload(theirs.id)).status).toBe("QUEUED");
      expect((await reload(other.id)).status).toBe("PAUSED");
    });

    it("retries what's asking for attention by the new meaning, every failed link list by the old", async () => {
      const longAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const recent = await row(alice, { status: "DONE", failedCount: 1 }, ["FAILED"]);
      const old = await row(alice, { status: "DONE", failedCount: 1, updatedAt: longAgo }, ["FAILED"]);
      const zip = await row(alice, { type: "ZIP", status: "ERROR", payload: { entries: ["a"] } }, []);
      const list = await row(alice, { type: "COLLECTION", status: "ERROR", payload: { model_ids: ["1"] } }, []);

      expect(await retryAllFailed({ ownerId: alice, line: true })).toBe(2);
      expect((await reload(recent.id)).status).toBe("QUEUED");
      expect((await reload(list.id)).status).toBe("QUEUED");
      expect((await reload(old.id)).status).toBe("DONE");
      expect((await reload(zip.id)).status).toBe("ERROR");

      expect(await retryAllFailed({ ownerId: alice })).toBe(1);
      expect((await reload(old.id)).status).toBe("QUEUED");
    });

    it("pauses running link lists and nobody's place by the new meaning; holds the line too by the old", async () => {
      const running = await row(alice, { status: "RUNNING" });
      const single = await row(alice, { status: "RUNNING", payload: { single: true } });
      const waiting = await enqueueSingleImport(alice, url("waiting"), {});
      const theirs = await row(bob, { status: "RUNNING" });

      expect(await pauseAll({ ownerId: alice, line: true })).toBe(1);
      expect((await reload(running.id)).status).toBe("PAUSED");
      expect((await reload(single.id)).status).toBe("RUNNING");
      expect((await reload(waiting.job.id)).status).toBe("QUEUED");
      expect((await reload(theirs.id)).status).toBe("RUNNING");

      await prisma.importJob.update({ where: { id: running.id }, data: { status: "RUNNING" } });
      expect(await pauseAll({ ownerId: alice })).toBe(2);
      expect((await reload(waiting.job.id)).status).toBe("PAUSED");
      expect((await reload(theirs.id)).status).toBe("RUNNING");
      await prisma.importJob.update({ where: { id: theirs.id }, data: { status: "DONE" } });
    });

    it("says the line is going from the worker and the rows it has left", async () => {
      expect(await bulkRunState()).toMatchObject({ running: false, currentJobId: null });
      await enqueueSingleImport(alice, url("a"), {});
      const state = await bulkRunState();
      expect(state.running).toBe(true);
      expect(state.remaining).toBeGreaterThanOrEqual(1);
      expect(state.currentJobId).toBeNull();
    });

    it("clears by the old meaning only what finished clean, a live one aside", async () => {
      const clean = await row(alice, { status: "DONE" }, []);
      const failed = await row(alice, { status: "DONE", failedCount: 1 }, []);
      const oldError = await row(alice, { status: "ERROR", updatedAt: new Date("2020-01-01") }, []);
      const finishing = await row(alice, { status: "DONE" }, []);
      let finish!: () => void;
      const run = trackRunner(finishing.id, new Promise<void>((resolve) => (finish = resolve)));
      expect(await clearFinishedJobs({ ownerId: alice })).toBe(1);
      expect(await prisma.importJob.findUnique({ where: { id: clean.id } })).toBeNull();
      for (const job of [failed, oldError, finishing]) expect(await reload(job.id)).toBeTruthy();
      finish();
      await run;
    });
  });

  describe("old clients", () => {
    it("reads a waiting job as RUNNING unless asked, through the routes they use", async () => {
      const { job } = await enqueueSingleImport(alice, url("waiting"), {});
      const auth = { Authorization: `Bearer ${aliceToken}` };
      const read = await request(app).get(`/api/import/jobs/${job.id}`).set(auth);
      expect(read.body.status).toBe("RUNNING");

      const admin = await request(app)
        .get("/api/admin/import-queue")
        .set({ Authorization: `Bearer ${adminToken}` });
      const seen = admin.body.jobs.find((j: { id: string }) => j.id === job.id);
      // Not "running with no runner", which a stale page would call stalled.
      expect(seen).toMatchObject({ status: "RUNNING", runner_live: true });
      expect(admin.body.bulk.running).toBe(true);
    });

    it("keeps a job's own message for the row and hides a mark that isn't a failure", async () => {
      const waiting = await row(alice, {
        collectionSyncId: await syncedCollection(alice),
        errorMessage: SYNC_JOB_INTERRUPTED,
      });
      const failedSameText = await row(alice, { status: "ERROR", errorMessage: SYNC_JOB_INTERRUPTED }, []);
      const summed = await row(alice, { status: "DONE", failedCount: 1, payload: { failure_summary: "1 failed." } }, [
        "FAILED",
      ]);
      const itemised = await row(alice, { status: "DONE", failedCount: 1 }, ["FAILED"]);
      await prisma.importJobItem.updateMany({ where: { jobId: itemised.id }, data: { errorMessage: "Not found" } });

      const { jobs } = await readOwnQueue(alice);
      const out = (id: string) => toQueueJobOut(jobs.find((job) => job.id === id)!);
      expect(out(waiting.id)).toMatchObject({
        error_message: null,
        failure_reason: null,
        sync_waiting: true,
        status: "PAUSED",
        can_start: false,
      });
      expect(out(failedSameText.id)).toMatchObject({
        error_message: SYNC_JOB_INTERRUPTED,
        failure_reason: SYNC_JOB_INTERRUPTED,
        attention: true,
        sync_waiting: false,
      });
      expect(out(summed.id).failure_reason).toBe("1 failed.");
      expect(out(itemised.id).failure_reason).toBe("Not found");
    });

    it("has a real status for whoever asked, and a closed set for everyone else", async () => {
      const { job } = await enqueueSingleImport(alice, url("waiting"), {});
      const real = toImportJobOut(await reload(job.id));
      expect(real.status).toBe("QUEUED");
      expect(maskQueued(real).status).toBe("RUNNING");
      const done = await row(alice, { status: "DONE" }, []);
      expect(maskQueued(toImportJobOut(done)).status).toBe("DONE");
    });
  });
});

// The owner's rules, as people meet them: through the routes, with the worker really running.
describe("the line from outside", () => {
  type Person = { id: string; token: string; email: string; name: string };
  type Card = QueueOut["jobs"][number];

  const base = (stamp % 1_000_000_000) + 40_000;
  const originalFetch = global.fetch;
  const tuning = { ...importWorkerTuning };
  const LIST_URL = "https://makerworld.com/en/collections/987-flock";
  const ZIP_URL = "https://example.com/pack.zip";
  const DESIGNER = { uid: 1692606088, name: "Deus Cat" };
  const SOMEONE = { uid: 555, name: "Someone Else" };

  let ann: Person;
  let ben: Person;
  let cat: Person;
  let boss: Person;
  let lastId = 0;
  const newId = () => base + ++lastId;
  const modelUrl = (id: number | string) => `https://makerworld.com/en/models/${id}-phoenix`;

  async function person(label: string, role: "ADMIN" | "MEMBER" = "MEMBER"): Promise<Person> {
    const email = `outside-${label}-${stamp}@example.com`;
    const name = `Outsider ${label} ${stamp}`;
    const res = await request(app).post("/api/register").send({ displayName: name, email, password: "password123" });
    if (res.status !== 200) throw new Error(`register ${label}: ${res.status} ${JSON.stringify(res.body)}`);
    const { id } = res.body.user;
    await prisma.user.update({ where: { id }, data: { role } });
    await setUserMakerworldCookie(id, "token=saved-bearer");
    const login = await request(app).post("/api/login").send({ email, password: "password123" });
    return { id, token: login.body.token, email, name };
  }

  const auth = (who: Person) => ({ Authorization: `Bearer ${who.token}` });
  const get = (who: Person, path: string) => request(app).get(`/api${path}`).set(auth(who));
  const post = (who: Person, path: string, body: object = {}) =>
    request(app).post(`/api${path}`).set(auth(who)).send(body);
  const put = (who: Person, path: string, body: object) => request(app).put(`/api${path}`).set(auth(who)).send(body);
  const del = (who: Person, path: string) => request(app).delete(`/api${path}`).set(auth(who));

  const queueOf = async (who: Person): Promise<QueueOut> => (await get(who, "/import/queue").expect(200)).body;
  const cardOf = async (who: Person, id: string): Promise<Card> => {
    const card = (await queueOf(who)).jobs.find((job) => job.id === id);
    if (!card) throw new Error(`no card for ${id}`);
    return card;
  };
  /** Into the line by a route; the job's id. */
  const join = async (who: Person, path: string, body: object): Promise<string> => {
    const res = await post(who, path, body);
    if (res.status !== 202) throw new Error(`${path}: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.job_id;
  };
  const joinSingle = (who: Person, id: number | string, body: object = {}) =>
    join(who, "/import?queue=1", { url: modelUrl(id), ...body });

  const until = (check: () => boolean | Promise<boolean>) =>
    vi.waitFor(async () => expect(await check()).toBe(true), { timeout: 15_000, interval: 10 });
  const runLine = async () => {
    resumeImportWorker();
    await importWorkerIdle();
  };
  const printsOf = (who: Person) => prisma.print.findMany({ where: { userId: who.id }, include: { plates: true } });
  const savedPayload = (job: ImportJob) => job.payload as Record<string, unknown>;

  // What was asked of the provider, a gate per design id, and what's gone from it.
  const asked: string[] = [];
  const bearers: (string | null)[] = [];
  const fetched: string[] = [];
  const gates = new Map<string, { held: Promise<void>; release: () => void }>();
  const gone = new Set<string>();
  const goneProfiles = new Set<string>();
  let peak = 0;
  let zipFile: Buffer;

  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

  function stubFetch() {
    global.fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input, init) => {
      const target = String(input);
      fetched.push(target);
      const model = target.match(/^https:\/\/api\.bambulab\.com\/v1\/design-service\/design\/(\d+)/);
      if (model) {
        const id = model[1];
        asked.push(id);
        bearers.push(new Headers(init?.headers).get("authorization"));
        // Whatever's in line, or a job from it, but not a row a test wrote by hand.
        const running = await prisma.importJob.count({
          where: { status: "RUNNING", queuedAt: { not: null }, userId: { in: [ann.id, ben.id, cat.id] } },
        });
        peak = Math.max(peak, running);
        await gates.get(id)?.held;
        if (gone.has(id)) return new Response("gone", { status: 404 });
        return json({
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
            { id: 3, profileId: 103, title: "Someone's remix", instanceCreator: SOMEONE },
          ],
        });
      }
      const profile = target.match(/^https:\/\/api\.bambulab\.com\/v1\/iot-service\/api\/user\/profile\/(\d+)/);
      if (profile) {
        if (goneProfiles.has(profile[1])) return new Response("gone", { status: 404 });
        return json({
          message: "success",
          url: `https://s3.example.com/phoenix-${profile[1]}.stl`,
          filename: `phoenix-${profile[1]}.stl`,
        });
      }
      const file = target.match(/^https:\/\/s3\.example\.com\/phoenix-(\d+)\.stl$/);
      if (file) {
        return new Response(`solid phoenix-${file[1]}\nendsolid\n`, {
          headers: { "content-type": "application/octet-stream" },
        });
      }
      if (target === ZIP_URL) {
        return new Response(new Uint8Array(zipFile), { headers: { "content-type": "application/zip" } });
      }
      if (/\/design-service\/favorites\/\d+$/.test(target)) return json({ title: "Flock" });
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

  beforeAll(async () => {
    ann = await person("ann");
    ben = await person("ben");
    cat = await person("cat");
    boss = await person("boss", "ADMIN");
    const zip = new JSZip();
    zip.file("hull.stl", "solid hull endsolid");
    zip.file("mast.stl", "solid mast endsolid");
    zip.file("sail.stl", "solid sail endsolid");
    zipFile = await zip.generateAsync({ type: "nodebuffer" });
    await prisma.importJob.updateMany({ where: { status: "QUEUED" }, data: { status: "PAUSED" } });
    stubFetch();
  });

  // What's in line stays in line, until a test runs it.
  beforeEach(() => {
    holdImportWorker();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    Object.assign(importWorkerTuning, tuning);
    await prisma.importJob.updateMany({ where: { status: "QUEUED" }, data: { status: "PAUSED" } });
    resumeImportWorker();
    for (const { release } of gates.values()) release();
    gates.clear();
    await importWorkerIdle();
    const everyone = { in: [ann.id, ben.id, cat.id, boss.id] };
    await until(async () => {
      const left = await prisma.importJob.findMany({ where: { userId: everyone }, select: { id: true } });
      return !left.some((job) => isRunnerLive(job.id));
    });
    await prisma.importJob.deleteMany({ where: { userId: everyone } });
    await prisma.print.deleteMany({ where: { userId: everyone } });
    await prisma.collection.deleteMany({ where: { userId: everyone } });
    await prisma.notification.deleteMany({ where: { userId: everyone } });
    await prisma.user.updateMany({ where: { id: everyone }, data: { startGrabLinks: false } });
    global.fetch = originalFetch;
    stubFetch();
    asked.length = 0;
    bearers.length = 0;
    fetched.length = 0;
    gone.clear();
    goneProfiles.clear();
    peak = 0;
  });

  afterAll(async () => {
    global.fetch = originalFetch;
    await prisma.user.deleteMany({ where: { id: { in: [ann.id, ben.id, cat.id, boss.id] } } });
  });

  describe("places", () => {
    it("numbers everyone's waiting jobs 1 to n across types, and the worker goes by the numbers", async () => {
      const held = await row(ann.id);
      const direct = await row(ben.id, { status: "RUNNING" });
      const syncWaiting = await row(ann.id, {
        collectionSyncId: await syncedCollection(ann.id),
        errorMessage: SYNC_JOB_WAITING,
      });
      const joins: [Person, string, object][] = [
        [ann, "/import?queue=1", { url: modelUrl(newId()) }],
        [ben, "/import/links?queue=1", { urls: [modelUrl(newId()), modelUrl(newId())] }],
        [cat, "/import/zip?queue=1", { url: ZIP_URL, entries: ["hull.stl"] }],
        [ann, "/import/makerworld/list?queue=1", { url: LIST_URL, model_ids: [String(newId())] }],
        [ben, "/import/makerworld/profiles?queue=1", { url: modelUrl(newId()), scope: "all" }],
        [ann, "/import/links?queue=1", { urls: [modelUrl(newId())] }],
      ];
      const ids: string[] = [];
      for (const [index, [who, path, body]] of joins.entries()) {
        const res = await post(who, path, body);
        expect(res.status).toBe(202);
        expect(res.body).toEqual({ job_id: expect.any(String), status: "QUEUED", position: index + 1 });
        ids.push(res.body.job_id);
      }

      for (const who of [ann, ben, cat]) {
        const { jobs, line } = await queueOf(who);
        const own = joins.flatMap(([owner], index) => (owner === who ? [index] : []));
        expect(line.length).toBe(ids.length);
        expect(line.rows.map((seat) => seat.position)).toEqual(ids.slice(0, Math.max(...own) + 1).map((_, i) => i + 1));
        expect(line.rows.filter((seat) => seat.mine).map((seat) => seat.job_id)).toEqual(own.map((i) => ids[i]));
        for (const index of own) expect(jobs.find((job) => job.id === ids[index])?.position).toBe(index + 1);
      }
      const { jobs: everyones } = (await get(boss, "/admin/import-queue?queue=1").expect(200)).body as { jobs: Card[] };
      for (const [index, id] of ids.entries()) {
        expect(everyones.find((job) => job.id === id)?.position).toBe(index + 1);
      }
      for (const outside of [held, direct, syncWaiting]) {
        expect(everyones.find((job) => job.id === outside.id)?.position).toBeNull();
      }

      await runLine();
      const ran = await Promise.all(ids.map(reload));
      expect(ran.map((job) => job.status)).toEqual(ids.map(() => "DONE"));
      const starts = ran.map((job) => job.startedAt!.getTime());
      expect(starts).toEqual(starts.toSorted((a, b) => a - b));
      expect(peak).toBe(1);
      // Nothing outside the line went anywhere.
      expect((await reload(held.id)).status).toBe("PAUSED");
      expect((await reload(syncWaiting.id)).errorMessage).toBe(SYNC_JOB_WAITING);
    });

    it("sends an admin's Start on someone's job to the back too, to run as its owner", async () => {
      const id = newId();
      const held = await row(ann.id, {}, []);
      await prisma.importJobItem.create({ data: { jobId: held.id, url: modelUrl(id) } });
      const ahead = await joinSingle(ben, newId());
      await post(boss, `/admin/import-queue/jobs/${held.id}/start`).expect(202);
      expect(await positionOf(ahead)).toBe(1);
      expect(await positionOf(held.id)).toBe(2);
      await setUserMakerworldCookie(ann.id, "token=anns-own");
      await setUserMakerworldCookie(boss.id, "token=the-admins");
      try {
        await runLine();
      } finally {
        await setUserMakerworldCookie(ann.id, "token=saved-bearer");
      }
      expect(bearers.at(-1)).toBe("Bearer anns-own");
      expect((await prisma.print.findFirstOrThrow({ where: { sourceExternalId: String(id) } })).userId).toBe(ann.id);
    });

    it("counts a long line in full, ties and all, in the worker's order", async () => {
      const queuedAt = new Date(Date.now() - 60_000);
      await prisma.importJob.createMany({
        data: Array.from({ length: 205 }, () => ({
          userId: ben.id,
          type: "LINKS" as const,
          status: "QUEUED" as const,
          sourceUrl: url("private-long-line"),
          queuedAt,
          payload: {},
        })),
      });
      const ahead = await prisma.importJob.findMany({
        where: { userId: ben.id, status: "QUEUED" },
        orderBy: [{ queuedAt: "asc" }, { id: "asc" }],
        select: { id: true },
      });
      const mine = await joinSingle(ann, newId());
      const { jobs, line } = await queueOf(ann);
      expect(jobs.find((job) => job.id === mine)?.position).toBe(206);
      expect(line.length).toBe(206);
      expect(line.rows).toHaveLength(206);
      expect(line.rows.at(-1)).toMatchObject({ position: 206, mine: true, job_id: mine });
      expect(line.rows.filter((seat) => seat.mine)).toHaveLength(1);
      expect((await queueOf(ben)).jobs.filter((job) => job.position === 1).map((job) => job.id)).toEqual([ahead[0].id]);
      await prisma.importJob.deleteMany({ where: { userId: ben.id } });
    });

    it("takes the same few from a second press of a bulk button: none", async () => {
      const held = await row(ann.id);
      const failed = await row(ann.id, { status: "DONE", failedCount: 1 }, ["FAILED"]);
      expect((await post(ann, "/import/queue/start-all").expect(202)).body).toEqual({ queued: 1 });
      const { queuedAt } = await reload(held.id);
      expect((await post(ann, "/import/queue/start-all").expect(202)).body).toEqual({ queued: 0 });
      expect((await reload(held.id)).queuedAt).toEqual(queuedAt);
      expect((await post(ann, "/import/queue/retry-failed").expect(202)).body).toEqual({ queued: 1 });
      const again = await reload(failed.id);
      expect((await post(ann, "/import/queue/retry-failed").expect(202)).body).toEqual({ queued: 0 });
      expect((await reload(failed.id)).queuedAt).toEqual(again.queuedAt);
      expect(await positionOf(held.id)).toBe(1);
      expect(await positionOf(failed.id)).toBe(2);
    });

    /** Small and repeatable: a failure says which run to look at. */
    const randomFrom = (seed: number) => () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    it.each([1, 2, 3])("never raises a number, whatever anyone else does: run %i", async (seed) => {
      const random = randomFrom(seed);
      const pick = <T>(list: T[]): T | undefined => list[Math.floor(random() * list.length)];
      const line = () =>
        prisma.importJob.findMany({
          where: { status: "QUEUED" },
          orderBy: [{ queuedAt: "asc" }, { id: "asc" }],
          select: { id: true },
        });
      let places = new Map<string, number>();

      const addFor = async (who: Person) => {
        const type = pick(["single", "links", "zip", "list", "profiles"]);
        if (type === "single") return joinSingle(who, newId());
        if (type === "links")
          return join(who, "/import/links?queue=1", { urls: [modelUrl(newId()), modelUrl(newId())] });
        if (type === "zip") return join(who, "/import/zip?queue=1", { url: ZIP_URL, entries: ["hull.stl"] });
        if (type === "list") return join(who, "/import/makerworld/list?queue=1", { url: LIST_URL, model_ids: ["1"] });
        return join(who, "/import/makerworld/profiles?queue=1", { url: modelUrl(newId()), scope: "all" });
      };

      /** After a step: nobody's number rose, but a job that just went to the back on its owner's say. */
      const check = async (toTheBack?: string) => {
        const order = await line();
        const now = new Map(order.map((job, index) => [job.id, index + 1]));
        const wrong = [...now].filter(([id, place]) =>
          id === toTheBack ? place !== order.length : place > (places.get(id) ?? place),
        );
        expect(wrong).toEqual([]);
        places = now;
        // And what Ann is told is what the worker will do.
        const { jobs, line: view } = await queueOf(ann);
        expect(view.length).toBe(order.length);
        expect(jobs.map((job) => job.position)).toEqual(jobs.map((job) => now.get(job.id) ?? null));
        const seats = view.rows.filter((seat) => seat.job_id);
        expect(seats.map((seat) => seat.position)).toEqual(seats.map((seat) => now.get(seat.job_id!)));
      };

      await addFor(ann);
      await addFor(ann);
      await check();
      for (let step = 0; step < 40; step++) {
        const who = pick([ben, cat])!;
        const cards = (await queueOf(who)).jobs;
        const card = (test: (job: Card) => boolean) => pick(cards.filter(test));
        let toTheBack: string | undefined;
        switch (pick(["add", "add", "hold", "start", "again", "retry", "remove", "delete", "fail"])) {
          case "add":
            await addFor(who);
            break;
          case "hold": {
            const job = card((c) => c.status === "QUEUED");
            if (job) await post(who, `/import/queue/jobs/${job.id}/pause`).expect(200);
            break;
          }
          case "start": {
            const job = card((c) => c.can_start);
            if (job) {
              await post(who, `/import/queue/jobs/${job.id}/start`).expect(202);
              toTheBack = job.id;
            }
            break;
          }
          case "again": {
            const job = card((c) => c.status === "QUEUED");
            if (job) await post(who, `/import/queue/jobs/${job.id}/start`).expect(202);
            break;
          }
          case "retry": {
            const job = card((c) => c.can_retry);
            if (job) {
              await post(who, `/import/queue/jobs/${job.id}/retry`).expect(202);
              toTheBack = job.id;
            }
            break;
          }
          case "remove": {
            const job = card((c) => c.status === "QUEUED" && c.type === "LINKS");
            const item = job && (await itemsOf(job.id))[0];
            if (item) await del(who, `/import/queue/items/${item.id}`).expect(200);
            break;
          }
          case "delete": {
            const job = card((c) => c.can_delete);
            if (job) await del(who, `/import/queue/jobs/${job.id}`).expect(200);
            break;
          }
          default: {
            // Whoever's first, as a run that went wrong leaves it.
            const [first] = await line();
            if (first) {
              await prisma.importJobItem.updateMany({
                where: { jobId: first.id },
                data: { status: "FAILED", errorMessage: "It's gone" },
              });
              await prisma.importJob.update({
                where: { id: first.id },
                data: { status: "ERROR", errorMessage: "It failed" },
              });
            }
          }
        }
        await check(toTheBack);
        if (!(await queueOf(ann)).line.rows.some((seat) => seat.mine)) await addFor(ann);
        await check();
      }
    });

    it("moves someone up as people ahead hold, delete or fail, the line really running", async () => {
      const [first, failing, held, deleted, annsFirst, annsNext] = [1, 2, 3, 4, 5, 6].map(() => newId());
      const releaseFirst = gate(first);
      gone.add(String(failing));
      const running = await joinSingle(ben, first);
      resumeImportWorker();
      await until(() => asked.includes(String(first)));

      await joinSingle(ben, failing);
      const catsHeld = await joinSingle(cat, held);
      const bensDeleted = await joinSingle(ben, deleted);
      const mine = await joinSingle(ann, annsFirst);
      const myNext = await joinSingle(ann, annsNext);
      const place = async (id: string) => (await cardOf(ann, id)).position;
      expect(await place(mine)).toBe(4);
      expect((await queueOf(ann)).line.now).toEqual({ mine: false, person: personKey(ben.id), job_id: null });

      await post(cat, `/import/queue/jobs/${catsHeld}/pause`).expect(200);
      expect(await place(mine)).toBe(3);
      await del(ben, `/import/queue/jobs/${bensDeleted}`).expect(200);
      expect(await place(mine)).toBe(2);
      expect(await place(myNext)).toBe(3);

      const releaseMine = gate(annsFirst);
      releaseFirst();
      await until(() => asked.includes(String(annsFirst)));
      expect((await reload(running)).status).toBe("DONE");

      const queue = await queueOf(ann);
      expect(queue.line.now).toEqual({ mine: true, person: personKey(ann.id), job_id: mine });
      expect(queue.jobs.find((job) => job.id === mine)).toMatchObject({ status: "RUNNING", position: null });
      expect(queue.jobs.find((job) => job.id === mine)?.started_at).toEqual(expect.any(String));
      expect(queue.jobs.find((job) => job.id === myNext)?.position).toBe(1);
      expect(queue.line.rows.map((seat) => seat.job_id)).toEqual([myNext]);
      expect((await queueOf(ben)).line.now).toEqual({ mine: false, person: personKey(ann.id), job_id: null });

      releaseMine();
      await importWorkerIdle();
      expect((await queueOf(ann)).line).toEqual({ now: null, rows: [], length: 0 });
      expect(peak).toBe(1);
      expect(asked).not.toContain(String(held));
    });

    it("stays on a job that's pausing until its link is done", async () => {
      const [first, second] = [newId(), newId()];
      const release = gate(first);
      const job = await join(ann, "/import/links?queue=1", { urls: [modelUrl(first), modelUrl(second)] });
      resumeImportWorker();
      await until(() => asked.includes(String(first)));
      await post(ann, `/import/queue/jobs/${job}/pause`).expect(200);

      const pausing = await queueOf(ann);
      expect(pausing.jobs.find((card) => card.id === job)).toMatchObject({ status: "PAUSED", runner_live: true });
      expect(pausing.line.now).toEqual({ mine: true, person: personKey(ann.id), job_id: job });
      expect((await queueOf(ben)).line.now).toEqual({ mine: false, person: personKey(ann.id), job_id: null });

      release();
      await until(async () => !(await cardOf(ann, job)).runner_live);
      expect((await queueOf(ann)).line.now).toBeNull();
    });
  });

  describe("other people", () => {
    it("say nothing in the whole answer, whether running, waiting, held or failed", async () => {
      const running = newId();
      const release = gate(running);
      const hidden = (slug: string) => `https://makerworld.com/en/models/${newId()}-hiddenbob-${slug}`;
      const category = await prisma.category.create({ data: { userId: ben.id, name: `hiddenbob ${stamp}` } });
      const theirs = [await joinSingle(ben, running, { title: "hiddenbob running", notes: "hiddenbob note" })];
      resumeImportWorker();
      await until(() => asked.includes(String(running)));

      const add = async (path: string, body: object) => theirs.push(await join(ben, path, body));
      await add("/import?queue=1", {
        url: hidden("one"),
        title: "hiddenbob title",
        filename: "hiddenbob.stl",
        notes: "hiddenbob note",
        tags: ["hiddenbob"],
        category_id: category.id,
      });
      await add("/import/links?queue=1", { urls: [hidden("two"), hidden("three")], notes: "hiddenbob note" });
      await add("/import/zip?queue=1", { url: "https://hiddenbob.example.com/pack.zip", entries: ["hiddenbob.stl"] });
      await add("/import/makerworld/list?queue=1", {
        url: "https://makerworld.com/en/collections/1-hiddenbob",
        model_ids: ["1"],
        collection_title: "hiddenbob collection",
      });
      await add("/import/makerworld/profiles?queue=1", { url: hidden("four"), scope: "all", notes: "hiddenbob note" });
      const mine = await join(ann, "/import/zip?queue=1", { url: ZIP_URL, entries: ["hull.stl"] });
      await add("/import?queue=1", { url: hidden("behind"), title: "hiddenbob behind" });

      const failed = await row(
        ben.id,
        { status: "ERROR", errorMessage: "hiddenbob failed", sourceLabel: "hiddenbob label", provider: "printables" },
        ["FAILED"],
      );
      const syncId = await syncedCollection(ben.id);
      const syncJob = await row(ben.id, {
        collectionSyncId: syncId,
        errorMessage: SYNC_JOB_WAITING,
        sourceLabel: "Sync: hiddenbob",
      });
      theirs.push(failed.id, syncJob.id);
      const items = await prisma.importJobItem.findMany({ where: { jobId: { in: theirs } }, select: { id: true } });
      const sync = await prisma.collectionSync.findUniqueOrThrow({ where: { id: syncId } });
      const secrets = [
        ben.id,
        ben.email,
        ben.name,
        "hiddenbob",
        "makerworld",
        "bambu",
        "printables",
        "phoenix",
        category.id,
        syncId,
        sync.collectionId,
        ...theirs,
        ...items.map((item) => item.id),
      ];

      const answer = await queueOf(ann);
      const seen = JSON.stringify(answer).toLowerCase();
      for (const secret of secrets) expect(seen).not.toContain(secret.toLowerCase());
      expect(Object.keys(answer).toSorted()).toEqual(["finished_total", "jobs", "line", "settings"]);
      expect(answer.jobs.map((job) => job.id)).toEqual([mine]);
      expect(answer.finished_total).toBe(0);

      const someone = personKey(ben.id);
      expect(answer.line).toEqual({
        now: { mine: false, person: someone, job_id: null },
        rows: [
          ...theirs
            .slice(1, 6)
            .map((_, index) => ({ position: index + 1, mine: false, person: someone, job_id: null })),
          { position: 6, mine: true, person: personKey(ann.id), job_id: mine },
        ],
        length: 7,
      });

      // Nothing in line: still nothing to read, and no rows at all. Being an admin changes nothing here.
      for (const who of [cat, boss]) {
        const bystander = await queueOf(who);
        const stillSeen = JSON.stringify(bystander).toLowerCase();
        for (const secret of secrets) expect(stillSeen).not.toContain(secret.toLowerCase());
        expect(bystander.line).toEqual({ now: { mine: false, person: someone, job_id: null }, rows: [], length: 7 });
        expect(bystander.jobs).toEqual([]);
      }
      release();
    });

    it("have one key each, the same however and whoever looks, and nothing to go on", async () => {
      const bens = await joinSingle(ben, newId());
      await joinSingle(cat, newId());
      const bensNext = await joinSingle(ben, newId());
      await joinSingle(ann, newId());
      await joinSingle(cat, newId());

      const rowsFor = async (who: Person) => (await queueOf(who)).line.rows.map((seat) => seat.person);
      const asAnn = await rowsFor(ann);
      expect(asAnn).toHaveLength(4);
      const [benKey, catKey, , annKey] = asAnn;
      expect(asAnn).toEqual([benKey, catKey, benKey, annKey]);
      expect(new Set([benKey, catKey, annKey]).size).toBe(3);
      // Across polls, whoever's looking, the person themselves too.
      expect(await rowsFor(ann)).toEqual(asAnn);
      expect((await rowsFor(cat)).slice(0, 4)).toEqual(asAnn);
      expect(await rowsFor(ben)).toEqual(asAnn.slice(0, 3));

      // It belongs to the person, not the job or its place.
      await post(ben, `/import/queue/jobs/${bens}/pause`).expect(200);
      await post(ben, `/import/queue/jobs/${bens}/start`).expect(202);
      expect(await rowsFor(ben)).toEqual([catKey, benKey, annKey, catKey, benKey]);
      await del(ben, `/import/queue/jobs/${bensNext}`).expect(200);
      expect(await rowsFor(ben)).toEqual([catKey, annKey, catKey, benKey]);

      for (const [who, key] of [
        [ann, annKey],
        [ben, benKey],
        [cat, catKey],
      ] as const) {
        expect(key).toMatch(/^[0-9a-f]{12}$/);
        expect(who.id).not.toContain(key);
        for (const algorithm of ["md5", "sha1", "sha256"]) {
          for (const known of [who.id, who.email, who.name]) {
            expect(createHash(algorithm).update(known).digest("hex")).not.toContain(key);
          }
        }
      }
    });
  });

  describe("what's stored is all a job has", () => {
    it("shows a zip waiting by the file name it was sent with", async () => {
      const job = await join(ann, "/import/zip?queue=1", { url: ZIP_URL, entries: ["hull.stl"], filename: "pack.zip" });
      expect((await cardOf(ann, job)).source_label).toBe("pack.zip");
    });

    /** A new row from what's stored, the old one gone: nothing held in memory for a request can reach it. */
    async function asIfRestarted(jobId: string): Promise<string> {
      const stored = await reload(jobId);
      const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...kept } = stored;
      const payload: Prisma.InputJsonValue = JSON.parse(JSON.stringify(stored.payload));
      await prisma.importJob.delete({ where: { id: jobId } });
      const { id } = await prisma.importJob.create({
        data: { ...kept, payload } as Prisma.ImportJobUncheckedCreateInput,
      });
      return id;
    }

    it("runs a zip: just the files picked, with everything asked for them", async () => {
      const category = await prisma.category.create({ data: { userId: ann.id, name: `Boats ${stamp}` } });
      const id = await asIfRestarted(
        await join(ann, "/import/zip?queue=1", {
          url: ZIP_URL,
          entries: ["hull.stl", "mast.stl"],
          notes: "Keep it dry",
          tags: ["boat"],
          category_id: category.id,
        }),
      );
      expect(fetched).toEqual([]);
      await runLine();
      expect(await reload(id)).toMatchObject({ status: "DONE", imported: 2, total: 2, failedCount: 0 });
      const prints = await printsOf(ann);
      expect(prints).toHaveLength(2);
      for (const print of prints) {
        expect(print).toMatchObject({ notes: "Keep it dry", tags: ["Boat"], categoryId: category.id });
      }
      expect(prints.map((print) => print.name).toSorted()).toEqual(["hull", "mast"]);
    });

    it("runs a list: just the models picked, into their collection", async () => {
      const [first, second] = [newId(), newId()];
      const id = await asIfRestarted(
        await join(ann, "/import/makerworld/list?queue=1", {
          url: LIST_URL,
          model_ids: [String(first), String(second)],
          collection_title: "Named by the client",
          notes: "From the flock",
          tags: ["flock"],
        }),
      );
      expect(fetched).toEqual([]);
      await runLine();
      const job = await reload(id);
      expect(job).toMatchObject({ status: "DONE", imported: 2, total: 2, failedCount: 0 });
      expect(asked.toSorted()).toEqual([String(first), String(second)]);
      const prints = await printsOf(ann);
      expect(prints.map((print) => print.sourceExternalId).toSorted()).toEqual([String(first), String(second)]);
      for (const print of prints) expect(print.notes).toBe("From the flock");
      expect(job.resultCollectionId).not.toBeNull();
      expect(await prisma.collectionItem.count({ where: { collectionId: job.resultCollectionId! } })).toBe(2);
    });

    it.each([
      ["designer", 2],
      ["all", 3],
    ] as const)("runs a model's print profiles: %s", async (scope, plates) => {
      const id = await asIfRestarted(
        await join(ann, "/import/makerworld/profiles?queue=1", {
          url: modelUrl(newId()),
          scope,
          notes: "Every way to print it",
          tags: ["phoenix"],
        }),
      );
      expect(fetched).toEqual([]);
      await runLine();
      const job = await reload(id);
      expect(job).toMatchObject({ status: "DONE", imported: plates, total: plates, failedCount: 0 });
      const [print] = await printsOf(ann);
      expect(print.id).toBe(job.resultPrintId);
      expect(print.plates).toHaveLength(plates);
      expect(print.notes).toBe("Every way to print it");
    });
  });

  describe("a run's last word", () => {
    /** The first step's progress taking longer to write than the rest of the run. Waits for it, once it's over. */
    function slowFirstStep(): () => Promise<unknown> {
      const update = prisma.importJob.update;
      let late: Promise<unknown> = Promise.resolve();
      vi.spyOn(prisma.importJob, "update").mockImplementation(((args: Prisma.ImportJobUpdateArgs) => {
        if (args.data.processed !== 1 || args.data.status) return update(args);
        late = new Promise((resolve) => setTimeout(resolve, 100)).then(() => update(args));
        return late;
      }) as never);
      return () => late;
    }

    it("stays a zip's final counts, however late its progress lands", async () => {
      const landed = slowFirstStep();
      const id = await join(ann, "/import/zip?queue=1", { url: ZIP_URL, entries: ["hull.stl", "lost.stl"] });
      await runLine();
      await landed();
      expect(await reload(id)).toMatchObject({ status: "DONE", processed: 2, imported: 1, failedCount: 1 });
    });

    it("stays print profiles' final counts, however late their progress lands", async () => {
      const landed = slowFirstStep();
      goneProfiles.add("102");
      const id = await join(ann, "/import/makerworld/profiles?queue=1", { url: modelUrl(newId()), scope: "designer" });
      await runLine();
      await landed();
      expect(await reload(id)).toMatchObject({ status: "DONE", processed: 2, imported: 1, failedCount: 1 });
    });
  });

  describe("at its turn, a job goes by how things are now", () => {
    const submit = {
      "a zip": async (who: Person, extra: object = {}) =>
        join(who, "/import/zip?queue=1", { url: modelUrl(newId()), entries: ["hull.stl"], ...extra }),
      "a list": async (who: Person, extra: object = {}) =>
        join(who, "/import/makerworld/list?queue=1", { url: LIST_URL, model_ids: [String(newId())], ...extra }),
      profiles: async (who: Person, extra: object = {}) =>
        join(who, "/import/makerworld/profiles?queue=1", { url: modelUrl(newId()), scope: "all", ...extra }),
    };

    it.each(["a zip", "a list", "profiles"] as const)(
      "fails %s if its provider was turned off, asking it nothing, and the line goes on",
      async (kind) => {
        const id = await submit[kind](ann);
        const next = await join(ben, "/import/zip?queue=1", { url: ZIP_URL, entries: ["hull.stl"] });
        await setProviderEnabled("makerworld", false);
        try {
          await runLine();
          const job = await reload(id);
          expect(job.status).toBe("ERROR");
          expect(job.errorMessage).toMatch(/turned off/i);
          expect(fetched.filter((target) => target !== ZIP_URL)).toEqual([]);
          expect(await reload(next)).toMatchObject({ status: "DONE", imported: 1 });
          const card = await cardOf(ann, id);
          expect(card).toMatchObject({ attention: true, failure_reason: job.errorMessage });
          const told = await prisma.notification.findFirstOrThrow({ where: { userId: ann.id } });
          expect(told.internalPath).toBe("/admin-queue?import-queue=att");
        } finally {
          await setProviderEnabled("makerworld", true);
        }
      },
    );

    it("runs a job as usual if its provider was off only for a while", async () => {
      const id = await submit["a list"](ann);
      await setProviderEnabled("makerworld", false);
      await setProviderEnabled("makerworld", true);
      await runLine();
      expect(await reload(id)).toMatchObject({ status: "DONE", imported: 1 });
    });

    it.each(["a list", "profiles"] as const)(
      "gets %s back from what it saved, once its provider is on again",
      async (kind) => {
        const id = await submit[kind](ann);
        await setProviderEnabled("makerworld", false);
        try {
          await runLine();
        } finally {
          await setProviderEnabled("makerworld", true);
        }
        expect(await cardOf(ann, id)).toMatchObject({ status: "ERROR", can_retry: true });
        await post(ann, `/import/queue/jobs/${id}/retry`).expect(202);
        await importWorkerIdle();
        expect(await reload(id)).toMatchObject({ status: "DONE", errorMessage: null, failedCount: 0 });
        expect(await printsOf(ann)).toHaveLength(1);
      },
    );

    it("brings in a zip without a category deleted while it waited", async () => {
      const category = await prisma.category.create({ data: { userId: ann.id, name: `Gone zip ${stamp}` } });
      const id = await join(ann, "/import/zip?queue=1", {
        url: ZIP_URL,
        entries: ["hull.stl"],
        category_id: category.id,
      });
      await prisma.category.delete({ where: { id: category.id } });
      await runLine();
      expect(await reload(id)).toMatchObject({ status: "DONE", imported: 1 });
      expect((await printsOf(ann))[0].categoryId).toBeNull();
    });

    it.each(["a list", "profiles"] as const)(
      "brings in %s without a category deleted while it waited",
      async (kind) => {
        const category = await prisma.category.create({ data: { userId: ann.id, name: `Gone ${kind} ${stamp}` } });
        const id = await submit[kind](ann, { category_id: category.id });
        await prisma.category.delete({ where: { id: category.id } });
        await runLine();
        expect((await reload(id)).status).toBe("DONE");
        const [print] = await printsOf(ann);
        expect(print.categoryId).toBeNull();
      },
    );

    it("files nothing under someone else's category, whatever the request said", async () => {
      const category = await prisma.category.create({ data: { userId: ben.id, name: `Bens ${stamp}` } });
      const id = await join(ann, "/import/links?queue=1", { urls: [modelUrl(newId())], category_id: category.id });
      await runLine();
      expect((await reload(id)).status).toBe("DONE");
      expect((await printsOf(ann))[0].categoryId).toBeNull();
    });

    it.each(["a list", "profiles"] as const)("asks for %s with the sign-in its owner has now", async (kind) => {
      const id = await submit[kind](ann);
      await setUserMakerworldCookie(ann.id, "token=fresh-bearer");
      try {
        await runLine();
      } finally {
        await setUserMakerworldCookie(ann.id, "token=saved-bearer");
      }
      expect((await reload(id)).status).toBe("DONE");
      expect(bearers.length).toBeGreaterThan(0);
      expect(new Set(bearers)).toEqual(new Set(["Bearer fresh-bearer"]));
    });

    it.each(["a list", "profiles"] as const)("uses no sign-in for %s once its owner has none", async (kind) => {
      await submit[kind](ann);
      await setUserMakerworldCookie(ann.id, null);
      try {
        await runLine();
      } finally {
        await setUserMakerworldCookie(ann.id, "token=saved-bearer");
      }
      expect(bearers).not.toContain("Bearer saved-bearer");
    });
  });

  describe("Retry, by type", () => {
    const retry = (who: Person, id: string) => post(who, `/import/queue/jobs/${id}/retry`);

    it.each(["start", "retry"] as const)("joins once when %s is clicked twice at once", async (action) => {
      const job =
        action === "start"
          ? await row(ann.id)
          : await row(ann.id, { status: "DONE", failedCount: 1 }, ["DONE", "FAILED"]);
      const ahead = await joinSingle(ben, newId());
      const path = `/import/queue/jobs/${job.id}/${action}`;
      const answers = await Promise.all([post(ann, path), post(ann, path)]);
      expect(answers.map((res) => [res.status, res.body.status, res.body.position])).toEqual([
        [202, "QUEUED", 2],
        [202, "QUEUED", 2],
      ]);
      const { queuedAt } = await reload(job.id);
      await post(ann, path).expect(202);
      expect((await reload(job.id)).queuedAt).toEqual(queuedAt);
      expect(await positionOf(ahead)).toBe(1);
      expect((await queueOf(ann)).line.length).toBe(2);
    });

    it("reruns a link list's failed link alone, and adds to what came in", async () => {
      const [ok, also, missing] = [newId(), newId(), newId()];
      gone.add(String(missing));
      const id = await join(ann, "/import/links?queue=1", { urls: [modelUrl(ok), modelUrl(missing), modelUrl(also)] });
      await runLine();
      const failedRun = await reload(id);
      expect(failedRun).toMatchObject({ status: "DONE", imported: 2, processed: 3, failedCount: 1 });
      expect(savedPayload(failedRun).failure_summary).toEqual(expect.any(String));
      expect(await cardOf(ann, id)).toMatchObject({ attention: true, can_retry: true, failed_items_count: 1 });

      gone.delete(String(missing));
      holdImportWorker();
      asked.length = 0;
      expect((await retry(ann, id).expect(202)).body).toEqual({
        job_id: id,
        status: "QUEUED",
        position: 1,
        sync_waiting: false,
      });
      const waiting = await reload(id);
      expect(waiting).toMatchObject({ status: "QUEUED", imported: 2, processed: 2, failedCount: 0, startedAt: null });
      expect(savedPayload(waiting)).not.toHaveProperty("failure_summary");
      expect(await cardOf(ann, id)).toMatchObject({ attention: false, failure_reason: null, pending_count: 1 });

      await runLine();
      expect(asked).toEqual([String(missing)]);
      const after = await reload(id);
      expect(after).toMatchObject({ status: "DONE", imported: 3, processed: 3, failedCount: 0, total: 3 });
      expect(await cardOf(ann, id)).toMatchObject({ attention: false, can_retry: false, failure_reason: null });
      expect(await printsOf(ann)).toHaveLength(3);
    });

    it("reruns one link, which then tells and opens as if it had worked first time", async () => {
      const id = newId();
      gone.add(String(id));
      const job = await joinSingle(ann, id);
      await runLine();
      expect(await cardOf(ann, job)).toMatchObject({
        status: "DONE",
        single: true,
        attention: true,
        can_retry: true,
        result_print_id: null,
      });
      gone.delete(String(id));
      await retry(ann, job).expect(202);
      await importWorkerIdle();
      const card = await cardOf(ann, job);
      expect(card).toMatchObject({
        status: "DONE",
        attention: false,
        outcome: "created",
        imported: 1,
        failed_count: 0,
        source_label: `Phoenix ${id}`,
      });
      const [print] = await printsOf(ann);
      expect(card.result_print_id).toBe(print.id);
      const told = await prisma.notification.findMany({
        where: { userId: ann.id },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      expect(told.map((notification) => notification.title)).toEqual([
        "Couldn't import a model",
        `Imported "Phoenix ${id}"`,
      ]);
    });

    it("runs a whole list again from zero, and only what's missing comes in", async () => {
      const [ok, missing] = [newId(), newId()];
      gone.add(String(missing));
      const id = await join(ann, "/import/makerworld/list?queue=1", {
        url: LIST_URL,
        model_ids: [String(ok), String(missing)],
        tags: ["flock"],
      });
      await runLine();
      const failedRun = await reload(id);
      expect(failedRun).toMatchObject({ status: "DONE", imported: 1, failedCount: 1, processed: 2 });
      expect(await cardOf(ann, id)).toMatchObject({ attention: true, can_retry: true });
      expect(savedPayload(failedRun).failure_summary).toEqual(expect.any(String));

      gone.delete(String(missing));
      holdImportWorker();
      await retry(ann, id).expect(202);
      const waiting = await reload(id);
      expect(waiting).toMatchObject({
        status: "QUEUED",
        imported: 0,
        alreadyInLibrary: 0,
        failedCount: 0,
        processed: 0,
        resultCollectionId: null,
        resultPrintId: null,
        errorMessage: null,
        startedAt: null,
      });
      expect(savedPayload(waiting).model_ids).toEqual([String(ok), String(missing)]);
      expect(savedPayload(waiting)).not.toHaveProperty("failure_summary");
      expect(await cardOf(ann, id)).toMatchObject({ attention: false, failure_reason: null, position: 1 });

      await runLine();
      const after = await reload(id);
      expect(after).toMatchObject({ status: "DONE", imported: 1, alreadyInLibrary: 1, failedCount: 0, total: 2 });
      expect(after.resultCollectionId).toBe(failedRun.resultCollectionId);
      expect(savedPayload(after)).not.toHaveProperty("failure_summary");
      expect((await printsOf(ann)).map((print) => print.sourceExternalId).toSorted()).toEqual(
        [String(ok), String(missing)].toSorted(),
      );
      expect(await prisma.collectionItem.count({ where: { collectionId: after.resultCollectionId! } })).toBe(2);
      expect(await prisma.collection.count({ where: { userId: ann.id } })).toBe(1);
      expect(await cardOf(ann, id)).toMatchObject({ attention: false, can_retry: false });
    });

    it("runs print profiles again: a failed run from zero, and no plate twice", async () => {
      const modelId = newId();
      gone.add(String(modelId));
      const id = await join(ann, "/import/makerworld/profiles?queue=1", { url: modelUrl(modelId), scope: "designer" });
      await runLine();
      const failedRun = await reload(id);
      expect(failedRun.status).toBe("ERROR");
      expect(failedRun.errorMessage).toEqual(expect.any(String));
      expect(await cardOf(ann, id)).toMatchObject({ attention: true, can_retry: true, can_start: false });

      gone.delete(String(modelId));
      goneProfiles.add("101");
      await retry(ann, id).expect(202);
      await importWorkerIdle();
      const partly = await reload(id);
      expect(partly).toMatchObject({ status: "DONE", errorMessage: null, failedCount: 1, total: 2 });
      expect(await cardOf(ann, id)).toMatchObject({ attention: true, can_retry: true });

      goneProfiles.clear();
      await retry(ann, id).expect(202);
      await importWorkerIdle();
      const whole = await reload(id);
      expect(whole).toMatchObject({ status: "DONE", errorMessage: null, failedCount: 0, total: 2 });
      expect(await cardOf(ann, id)).toMatchObject({ attention: false, can_retry: false, failure_reason: null });
      const prints = await printsOf(ann);
      expect(prints).toHaveLength(1);
      expect(prints[0].plates).toHaveLength(2);
      expect(whole.resultPrintId).toBe(prints[0].id);
    });

    it("never reruns a zip, whichever way it ended, and leaves it as it was", async () => {
      const held = await join(ann, "/import/zip?queue=1", { url: ZIP_URL, entries: ["hull.stl", "lost.stl"] });
      await post(ann, `/import/queue/jobs/${held}/pause`).expect(200);
      await retry(ann, held).expect(400);
      expect((await reload(held)).status).toBe("PAUSED");

      await post(ann, `/import/queue/jobs/${held}/start`).expect(202);
      await runLine();
      const finished = await reload(held);
      expect(finished).toMatchObject({ status: "DONE", imported: 1, failedCount: 1 });
      expect(await cardOf(ann, held)).toMatchObject({ attention: false, can_retry: false, can_start: false });
      await retry(ann, held).expect(400);
      expect(await reload(held)).toEqual(finished);
      expect(await printsOf(ann)).toHaveLength(1);
    });
  });

  describe("one link's trail", () => {
    /** A notification as anyone reads it, whatever the models were called. */
    const told = async (who: Person, ids: number[]) => {
      const names = new Map(ids.map((id, index) => [String(id), `model${index}`]));
      const swap = (text: string | null) => text?.replace(/\d{5,}/g, (id) => names.get(id) ?? id) ?? null;
      const rows = await prisma.notification.findMany({
        where: { userId: who.id },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      return rows.map((notification) => ({
        type: notification.type,
        title: swap(notification.title),
        body: swap(notification.body),
        externalUrl: swap(notification.externalUrl),
        internalPath: notification.internalPath?.replace(/^\/models\/.+$/, "/models/<id>") ?? null,
        grouped: (notification.group as { items?: unknown[] } | null)?.items?.length ?? null,
      }));
    };

    /** The same steps by either path: two new, one that fails, one new, one already here, another profile of one. */
    const steps = (ids: number[]) => [
      modelUrl(ids[0]),
      modelUrl(ids[1]),
      modelUrl(ids[2]),
      modelUrl(ids[3]),
      modelUrl(ids[0]),
      `${modelUrl(ids[1])}#profileId-1`,
    ];

    it("tells people what a direct import tells them, folding the same ones", async () => {
      const directIds = [newId(), newId(), newId(), newId()];
      const lineIds = [newId(), newId(), newId(), newId()];
      gone.add(String(directIds[2]));
      gone.add(String(lineIds[2]));

      for (const link of steps(directIds)) await post(ann, "/import", { url: link });
      for (const link of steps(lineIds)) {
        await joinSingle(ben, "x", { url: link });
        await runLine();
        holdImportWorker();
      }

      const direct = await told(ann, directIds);
      const line = await told(ben, lineIds);
      // The one difference: only a job in the line has a card for its failure to open.
      const failedIn = (notices: typeof direct) =>
        notices.find((notification) => notification.title === "Couldn't import a model");
      expect(failedIn(direct)?.internalPath).toBeNull();
      expect(failedIn(line)?.internalPath).toBe("/admin-queue?import-queue=att");
      Object.assign(failedIn(line) ?? {}, { internalPath: null });
      expect(line).toEqual(direct);
      // And that's the folding it has always done.
      expect(direct.map((notification) => [notification.title, notification.grouped])).toEqual([
        ["Imported 2 models", 2],
        ["Couldn't import a model", null],
        ['Imported "Phoenix model3"', 1],
        ['"Phoenix model0" is already in your library', null],
        ['Added another print profile to "Phoenix model1"', 1],
      ]);
    });

    it("folds links that run one after the other, whoever queued them", async () => {
      const [first, second] = [newId(), newId()];
      await joinSingle(ann, first);
      await joinSingle(ann, second);
      await runLine();
      const rows = await prisma.notification.findMany({ where: { userId: ann.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ title: "Imported 2 models", internalPath: "/models" });
    });

    it("doesn't fold into a notification that's been read", async () => {
      await joinSingle(ann, newId());
      await runLine();
      await prisma.notification.updateMany({ where: { userId: ann.id }, data: { readAt: new Date() } });
      await joinSingle(ann, newId());
      await importWorkerIdle();
      expect(await prisma.notification.count({ where: { userId: ann.id } })).toBe(2);
    });

    it("opens the model it found, on the card and on every read of the job", async () => {
      const id = newId();
      const first = await joinSingle(ann, id);
      await runLine();
      const print = (await reload(first)).resultPrintId;
      expect(print).not.toBeNull();

      const again = await joinSingle(ann, id);
      await importWorkerIdle();
      expect(await cardOf(ann, again)).toMatchObject({
        status: "DONE",
        single: true,
        outcome: "already_imported",
        result_print_id: print,
        source_label: `Phoenix ${id}`,
        imported: 0,
        already_in_library: 1,
        attention: false,
        can_retry: false,
        can_delete: true,
      });
      for (const read of [`/import/jobs/${again}`, `/import/jobs/${again}?queue=1`]) {
        expect((await get(ann, read).expect(200)).body.result_print_id).toBe(print);
      }
      await until(
        async () =>
          (await prisma.log.count({ where: { userId: ann.id, action: "model_imported", targetId: print } })) === 2,
      );
    });

    it("says it added a profile, opening the model it added it to", async () => {
      const id = newId();
      const first = await joinSingle(ann, id);
      await runLine();
      const print = (await reload(first)).resultPrintId;
      const added = await join(ann, "/import?queue=1", { url: `${modelUrl(id)}#profileId-1` });
      await importWorkerIdle();
      expect(await cardOf(ann, added)).toMatchObject({ outcome: "profile_added", result_print_id: print });
    });
  });

  describe("links from Grab", () => {
    const send = (who: Person, id: number) => post(who, "/import/queue", { url: modelUrl(id) });
    const automatically = (who: Person, on = true) =>
      put(who, "/import/queue/settings", { start_grab_links: on }).expect(200);

    it("joins only a job on hold with the marker when off, only one in line with it when on", async () => {
      const held = (await send(ann, newId())).body.job_id;
      expect((await reload(held)).status).toBe("PAUSED");

      // What's on hold stays there when someone switches it on.
      await automatically(ann);
      const inLine = (await send(ann, newId())).body;
      expect(inLine.job_id).not.toBe(held);
      expect(inLine).toMatchObject({ started: true, position: 1 });
      expect((await reload(held)).status).toBe("PAUSED");
      expect((await send(ann, newId())).body.job_id).toBe(inLine.job_id);

      // Holding it stops it taking more; a new one goes in line.
      await post(ann, `/import/queue/jobs/${inLine.job_id}/pause`).expect(200);
      const next = (await send(ann, newId())).body;
      expect(next.job_id).not.toBe(inLine.job_id);
      expect(next.started).toBe(true);

      // And off again, what's in line takes nothing, and links go on hold.
      await automatically(ann, false);
      const later = (await send(ann, newId())).body;
      expect(later.started).toBe(false);
      expect(later.position).toBeNull();
      expect(later.job_id).not.toBe(next.job_id);
      expect((await reload(later.job_id)).status).toBe("PAUSED");
      expect((await reload(next.job_id)).total).toBe(1);

      // Someone else's setting is theirs.
      expect((await send(ben, newId())).body).toMatchObject({ started: false, position: null });
    });

    it.each(["the link first", "the Start first"])("never strands a link racing a Start: %s", async (order) => {
      for (let round = 0; round < 8; round++) {
        const first = (await send(ann, newId())).body.job_id;
        const link = () => send(ann, newId());
        const start = () => post(ann, `/import/queue/jobs/${first}/start`);
        const [sent, started] =
          order === "the link first"
            ? await Promise.all([link(), start()])
            : (await Promise.all([start(), link()])).toReversed();
        expect(started.status).toBe(202);
        expect(sent.status).toBe(201);
        const job = await reload(first);
        expect(job.status).toBe("QUEUED");
        // In the job that started, counted, or in one of its own on hold: never anywhere it won't be seen to.
        const inIt = sent.body.job_id === first;
        expect(job.total).toBe(inIt ? 2 : 1);
        expect(await itemsOf(first)).toHaveLength(inIt ? 2 : 1);
        expect(await reload(sent.body.job_id)).toMatchObject({
          status: inIt ? "QUEUED" : "PAUSED",
          total: inIt ? 2 : 1,
        });
        await prisma.importJob.deleteMany({ where: { userId: ann.id } });
      }
    });

    it("brings in every link sent as the worker takes them, each once", async () => {
      await automatically(ann);
      resumeImportWorker();
      const ids = Array.from({ length: 12 }, () => newId());
      const sent = await Promise.all(ids.map((id) => send(ann, id)));
      for (const res of sent) expect(res.status).toBe(201);
      await until(async () => {
        const open = await prisma.importJob.count({
          where: { userId: ann.id, status: { in: ["QUEUED", "RUNNING", "PAUSED"] } },
        });
        return open === 0;
      });
      await importWorkerIdle();
      const items = await prisma.importJobItem.findMany({ where: { job: { userId: ann.id } } });
      expect(items.map((item) => item.status)).toEqual(ids.map(() => "DONE"));
      expect(asked.toSorted()).toEqual(ids.map(String).toSorted());
      for (const job of await prisma.importJob.findMany({ where: { userId: ann.id } })) {
        const own = items.filter((item) => item.jobId === job.id);
        expect(job).toMatchObject({ status: "DONE", total: own.length, imported: own.length });
      }
      expect(await printsOf(ann)).toHaveLength(12);
      expect(peak).toBe(1);
    });

    it("goes around a job pausing on its current link, and nothing's left behind", async () => {
      const [first, second, third, fourth] = [newId(), newId(), newId(), newId()];
      const release = gate(first);
      await automatically(ann);
      const job = (await send(ann, first)).body.job_id;
      expect((await send(ann, second)).body.job_id).toBe(job);
      resumeImportWorker();
      await until(() => asked.includes(String(first)));

      // Running: a link can't join what's read its links already.
      const next = (await send(ann, third)).body;
      expect(next.job_id).not.toBe(job);

      await post(ann, `/import/queue/jobs/${job}/pause`).expect(200);
      expect(await cardOf(ann, job)).toMatchObject({ status: "PAUSED", runner_live: true, can_start: false });
      // Nor can one join it while it's pausing, even looking for something on hold.
      await automatically(ann, false);
      const onHold = (await send(ann, fourth)).body;
      expect([job, next.job_id]).not.toContain(onHold.job_id);

      release();
      await until(async () => (await cardOf(ann, job)).runner_live === false);
      await importWorkerIdle();
      expect(await reload(job)).toMatchObject({ status: "PAUSED", imported: 1 });
      expect(await reload(next.job_id)).toMatchObject({ status: "DONE", imported: 1 });
      expect(await reload(onHold.job_id)).toMatchObject({ status: "PAUSED", total: 1 });

      await post(ann, `/import/queue/jobs/${job}/start`).expect(202);
      await post(ann, `/import/queue/jobs/${onHold.job_id}/start`).expect(202);
      await importWorkerIdle();
      const items = await prisma.importJobItem.findMany({ where: { job: { userId: ann.id } } });
      expect(items.map((item) => item.status)).toEqual(items.map(() => "DONE"));
      expect(asked.toSorted()).toEqual([first, second, third, fourth].map(String).toSorted());
      expect(peak).toBe(1);
    });
  });

  describe("a job being made", () => {
    /** Runs `look` just before a job joins the line, by whichever write it uses. */
    function beforeJoining(look: (jobId: string) => Promise<void>) {
      const updateMany = prisma.importJob.updateMany;
      const update = prisma.importJob.update;
      vi.spyOn(prisma.importJob, "updateMany").mockImplementation((async (args: Prisma.ImportJobUpdateManyArgs) => {
        if (args.data.status === "QUEUED" && typeof args.where?.id === "string") await look(args.where.id);
        return updateMany(args);
      }) as never);
      vi.spyOn(prisma.importJob, "update").mockImplementation((async (args: Prisma.ImportJobUpdateArgs) => {
        if (args.data.status === "QUEUED" && typeof args.where.id === "string") await look(args.where.id);
        return update(args);
      }) as never);
    }

    it.each([
      ["a link", "/import?queue=1", { url: modelUrl(`${base}1`) }, 1],
      ["a list of links", "/import/links?queue=1", { urls: [1, 2, 3].map((n) => modelUrl(`${base}${n}`)) }, 3],
      ["a zip", "/import/zip?queue=1", { url: ZIP_URL, entries: ["hull.stl"] }, 0],
      ["a provider's list", "/import/makerworld/list?queue=1", { url: LIST_URL, model_ids: ["1"] }, 0],
      ["print profiles", "/import/makerworld/profiles?queue=1", { url: modelUrl(`${base}4`), scope: "all" }, 0],
      ["Grab's link, starting by itself", "/import/queue", { url: modelUrl(`${base}5`) }, 1],
    ] as const)("isn't in reach of the worker until it's whole: %s", async (_label, path, body, links) => {
      await prisma.user.update({ where: { id: ann.id }, data: { startGrabLinks: true } });
      resumeImportWorker();
      const looks: unknown[] = [];
      beforeJoining(async (jobId) => {
        wakeImportWorker();
        await importWorkerIdle();
        const queue = await queueOf(ann);
        looks.push({
          job: await prisma.importJob.findUniqueOrThrow({
            where: { id: jobId },
            select: { status: true, queuedAt: true, startedAt: true },
          }),
          links: await prisma.importJobItem.count({ where: { jobId } }),
          place: await positionOf(jobId),
          length: queue.line.length,
          now: queue.line.now,
        });
      });

      const res = await post(ann, path, body);
      expect(res.status).toBeLessThan(300);
      expect(looks).toEqual([
        { job: { status: "PAUSED", queuedAt: null, startedAt: null }, links, place: null, length: 0, now: null },
      ]);
    });

    it("stays on hold and out of the line when its links can't be written", async () => {
      resumeImportWorker();
      vi.spyOn(prisma.importJobItem, "create").mockImplementationOnce(() => {
        throw new Error("database gone");
      });
      const res = await post(ann, "/import/links?queue=1", { urls: [modelUrl(newId()), modelUrl(newId())] });
      expect(res.status).toBe(500);
      wakeImportWorker();
      await importWorkerIdle();
      expect(fetched).toEqual([]);
      const [left] = await prisma.importJob.findMany({ where: { userId: ann.id } });
      expect(left).toMatchObject({ status: "PAUSED", queuedAt: null });
      // Nothing to start, and it can go.
      expect(await cardOf(ann, left.id)).toMatchObject({ can_start: false, can_delete: true, position: null });
      await del(ann, `/import/queue/jobs/${left.id}`).expect(200);
    });
  });

  describe("sections", () => {
    const now = () => new Date();
    const longAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    it("lists every job asking for attention past the cap, however old, and the newest of the rest", async () => {
      const failed = await prisma.importJob.createManyAndReturn({
        data: Array.from({ length: 55 }, (_, index) => ({
          userId: ann.id,
          type: "LINKS" as const,
          status: "ERROR" as const,
          sourceUrl: url(`failed-${index}`),
          errorMessage: "It failed",
          queuedAt: longAgo,
          createdAt: new Date(longAgo.getTime() + index),
          updatedAt: new Date(longAgo.getTime() + index),
        })),
      });
      const finished = await prisma.importJob.createManyAndReturn({
        data: Array.from({ length: 55 }, (_, index) => ({
          userId: ann.id,
          type: "LINKS" as const,
          status: "DONE" as const,
          sourceUrl: url(`done-${index}`),
          createdAt: new Date(now().getTime() - 1000 + index),
          updatedAt: new Date(now().getTime() - 1000 + index),
        })),
      });
      const held = await row(ann.id, { createdAt: longAgo });
      const { jobs, finished_total } = await queueOf(ann);
      const ids = new Set(jobs.map((job) => job.id));
      for (const job of failed) expect(ids.has(job.id)).toBe(true);
      expect(ids.has(held.id)).toBe(true);
      expect(finished_total).toBe(55);
      expect(jobs).toHaveLength(55 + 1 + 50);
      expect(jobs.filter((job) => job.attention)).toHaveLength(55);
      // The newest of the rest, by when they finished.
      const shown = finished.filter((job) => ids.has(job.id)).map((job) => job.sourceUrl);
      expect(shown).toHaveLength(50);
      expect(shown).not.toContain(url("done-0"));
      expect(shown).toContain(url("done-54"));
    });

    it("clears exactly what Finished shows, the number it said, and leaves the rest", async () => {
      const recent = { updatedAt: new Date() };
      const old = { updatedAt: longAgo };
      const fromLine = { queuedAt: longAgo };
      const zip = { type: "ZIP" as const, payload: { entries: ["a"] } };
      const list = { type: "COLLECTION" as const, payload: { model_ids: ["1"] } };
      const table: [boolean, string, Partial<Prisma.ImportJobUncheckedCreateInput>][] = [
        [true, "clean", { status: "DONE", ...recent }],
        [true, "clean, long ago", { status: "DONE", ...old }],
        [true, "clean, from the line", { status: "DONE", ...fromLine, ...recent }],
        [true, "clean zip", { status: "DONE", ...zip, ...recent }],
        [true, "partly failed zip", { status: "DONE", failedCount: 1, ...zip, ...recent }],
        [true, "partly failed zip from the line", { status: "DONE", failedCount: 1, ...zip, ...fromLine }],
        [true, "old failure", { status: "ERROR", errorMessage: "x", ...old }],
        [true, "old partial", { status: "DONE", failedCount: 1, ...old }],
        [true, "old failed zip", { status: "ERROR", errorMessage: "x", ...zip, ...old }],
        [false, "failure", { status: "ERROR", errorMessage: "x", ...recent }],
        [false, "partial", { status: "DONE", failedCount: 1, ...recent }],
        [false, "partial list", { status: "DONE", failedCount: 1, ...list, ...recent }],
        [false, "failed zip", { status: "ERROR", errorMessage: "x", ...zip, ...recent }],
        [false, "failure from the line, long ago", { status: "ERROR", errorMessage: "x", ...fromLine, ...old }],
        [false, "partial from the line, long ago", { status: "DONE", failedCount: 1, ...fromLine, ...old }],
        [false, "on hold", { status: "PAUSED" }],
        [false, "in line", { status: "QUEUED", queuedAt: new Date() }],
        [false, "running", { status: "RUNNING" }],
      ];
      const rows = await Promise.all(
        table.map(async ([finished, label, data]) => {
          const job = await prisma.importJob.create({
            data: {
              userId: ann.id,
              type: "LINKS",
              sourceUrl: url(label.replaceAll(" ", "-")),
              payload: {},
              ...data,
            } as Prisma.ImportJobUncheckedCreateInput,
          });
          return { id: job.id, finished, label };
        }),
      );
      const theirs = await row(ben.id, { status: "DONE" }, []);

      const { jobs, finished_total } = await queueOf(ann);
      const section = jobs
        .filter((job) => (job.status === "DONE" || job.status === "ERROR") && !job.attention)
        .map((job) => job.id)
        .toSorted();
      const expected = rows.filter((job) => job.finished);
      expect(section).toEqual(expected.map((job) => job.id).toSorted());
      expect(finished_total).toBe(expected.length);

      expect((await post(ann, "/import/queue/clear-finished").expect(200)).body).toEqual({ deleted: expected.length });
      const left = await prisma.importJob.findMany({ where: { userId: ann.id }, select: { id: true } });
      expect(left.map((job) => job.id).toSorted()).toEqual(
        rows
          .filter((job) => !job.finished)
          .map((job) => job.id)
          .toSorted(),
      );
      expect((await reload(theirs.id)).status).toBe("DONE");
      expect((await queueOf(ann)).finished_total).toBe(0);
      expect((await post(ann, "/import/queue/clear-finished").expect(200)).body).toEqual({ deleted: 0 });
    });

    it("leaves a finished job whose runner is still writing, until it's done", async () => {
      const job = await row(ann.id, { status: "DONE" }, ["DONE"]);
      let finish!: () => void;
      const run = trackRunner(job.id, new Promise<void>((resolve) => (finish = resolve)));
      expect(await cardOf(ann, job.id)).toMatchObject({ runner_live: true, can_delete: false, attention: false });
      expect((await post(ann, "/import/queue/clear-finished").expect(200)).body).toEqual({ deleted: 0 });
      expect((await reload(job.id)).status).toBe("DONE");
      finish();
      await run;
      expect((await post(ann, "/import/queue/clear-finished").expect(200)).body).toEqual({ deleted: 1 });
    });

    it("draws the line for attention at the same moment in a query and on a row", async () => {
      const at = new Date();
      const week = 7 * 24 * 60 * 60 * 1000;
      const edges = [week - 1, week, week + 1].map((age) => new Date(at.getTime() - age));
      const statuses: [ImportJob["status"], number][] = [
        ["ERROR", 0],
        ["DONE", 1],
      ];
      const made = await prisma.importJob.createManyAndReturn({
        data: edges.flatMap((updatedAt) =>
          statuses.map(([status, failedCount]) => ({
            status,
            failedCount,
            userId: ann.id,
            type: "LINKS" as const,
            sourceUrl: url("x"),
            updatedAt,
          })),
        ),
      });
      const queried = await prisma.importJob.findMany({
        where: { userId: ann.id, ...attentionWhere(at) },
        select: { id: true },
      });
      expect(queried.map((job) => job.id).toSorted()).toEqual(
        made
          .filter((job) => isAttention(job, at))
          .map((job) => job.id)
          .toSorted(),
      );
      // Exactly a week old still counts; a millisecond more doesn't.
      expect(made.map((job) => isAttention(job, at))).toEqual([true, true, true, true, false, false]);
    });
  });

  describe("what a card offers is what the routes take", () => {
    type Action = "start" | "pause" | "retry" | "delete";
    type ItemState = "PENDING" | "RUNNING" | "DONE" | "FAILED";
    type State = {
      label: string;
      type: ImportJob["type"];
      status: ImportJob["status"];
      items: ItemState[];
      /** From the design's can_*, not the code's. */
      offers: Action[];
      /** Answered 202 and nothing moves: a double click on what's already waiting. */
      noOp?: Action[];
      failedCount?: number;
      payload?: Prisma.InputJsonValue | null;
      errorMessage?: string;
      live?: boolean;
      sync?: boolean;
    };

    const ACTIONS: Action[] = ["start", "pause", "retry", "delete"];
    const LINKS_PAYLOAD = { notes: null, tags: [], category_id: null, scope: "url" };
    const SINGLE_PAYLOAD = { ...LINKS_PAYLOAD, single: true };
    const offers = (text: string) => (text ? (text.split(" ") as Action[]) : []);
    const waiting: Action[] = ["start", "retry"];

    const links = (
      label: string,
      status: ImportJob["status"],
      items: ItemState[],
      offered: string,
      more: Partial<State> = {},
    ): State => ({
      label: `links, ${label}`,
      type: "LINKS",
      status,
      items,
      offers: offers(offered),
      failedCount: items.filter((item) => item === "FAILED").length,
      ...more,
    });

    /** Everything a job with no links of its own can be in, with its request and without. */
    const batch = (type: "COLLECTION" | "PROFILES", payload: Prisma.InputJsonValue): State[] => {
      const state = (
        label: string,
        status: ImportJob["status"],
        offered: string,
        more: Partial<State> = {},
      ): State => ({
        label: `${type}, ${label}`,
        type,
        status,
        items: [],
        offers: offers(offered),
        payload,
        ...more,
      });
      return [
        state("held", "PAUSED", "start delete"),
        state("held, no saved request", "PAUSED", "delete", { payload: null }),
        state("in line", "QUEUED", "pause delete", { noOp: waiting }),
        state("running", "RUNNING", "", { live: true }),
        state("running, its runner gone", "RUNNING", ""),
        state("finished", "DONE", "delete"),
        state("partly failed", "DONE", "retry delete", { failedCount: 1 }),
        state("partly failed, no saved request", "DONE", "delete", { failedCount: 1, payload: null }),
        state("partly failed, runner writing", "DONE", "", { failedCount: 1, live: true }),
        state("failed", "ERROR", "retry delete", { errorMessage: "It failed" }),
        state("failed, no saved request", "ERROR", "delete", { errorMessage: "It failed", payload: null }),
      ];
    };

    const zip = (label: string, status: ImportJob["status"], offered: string, more: Partial<State> = {}): State => ({
      label: `zip, ${label}`,
      type: "ZIP",
      status,
      items: [],
      offers: offers(offered),
      payload: { entries: ["hull.stl"] },
      ...more,
    });

    const STATES: State[] = [
      links("held, a link waiting", "PAUSED", ["PENDING"], "start delete"),
      links("held, nothing waiting", "PAUSED", ["DONE"], "delete"),
      links("held, failed and waiting", "PAUSED", ["PENDING", "FAILED"], "start retry delete"),
      links("held, only failed", "PAUSED", ["FAILED"], "retry delete"),
      links("held, a link stuck", "PAUSED", ["RUNNING"], "start delete"),
      links("pausing", "PAUSED", ["RUNNING", "PENDING"], "", { live: true }),
      links("in line", "QUEUED", ["PENDING"], "pause delete", { noOp: waiting }),
      links("running", "RUNNING", ["RUNNING", "PENDING"], "pause", { live: true }),
      links("running, its runner gone", "RUNNING", ["RUNNING", "FAILED"], "pause"),
      links("finished", "DONE", ["DONE"], "delete"),
      links("partly failed", "DONE", ["DONE", "FAILED"], "retry delete"),
      links("finished with links left", "DONE", ["DONE", "PENDING"], "retry delete"),
      links("partly failed, runner writing", "DONE", ["DONE", "FAILED"], "", { live: true }),
      links("cut off", "ERROR", ["DONE", "PENDING"], "start retry delete", { errorMessage: "Cut off" }),
      links("cut off on a link", "ERROR", ["RUNNING"], "start retry delete", { errorMessage: "Cut off" }),
      links("cut off, some failed", "ERROR", ["PENDING", "FAILED"], "retry delete", { errorMessage: "Cut off" }),
      links("failed", "ERROR", ["FAILED"], "retry delete", { errorMessage: "It failed" }),
      links("failed, all done", "ERROR", ["DONE"], "delete", { errorMessage: "It failed" }),
      links("failed, no links", "ERROR", [], "delete", { errorMessage: "It failed" }),
      links("one held", "PAUSED", ["PENDING"], "start delete", { payload: SINGLE_PAYLOAD }),
      links("one in line", "QUEUED", ["PENDING"], "pause delete", { payload: SINGLE_PAYLOAD, noOp: waiting }),
      links("one running", "RUNNING", ["RUNNING"], "", { payload: SINGLE_PAYLOAD, live: true }),
      links("one failed", "DONE", ["FAILED"], "retry delete", { payload: SINGLE_PAYLOAD }),
      links("one cut off", "ERROR", ["PENDING"], "start retry delete", {
        payload: SINGLE_PAYLOAD,
        errorMessage: "Cut",
      }),
      links("sync waiting", "PAUSED", ["PENDING"], "pause delete", {
        sync: true,
        errorMessage: SYNC_JOB_WAITING,
        noOp: waiting,
      }),
      links("sync cut off", "PAUSED", ["PENDING"], "pause delete", {
        sync: true,
        errorMessage: SYNC_JOB_INTERRUPTED,
        noOp: waiting,
      }),
      links("sync waiting, some failed", "PAUSED", ["PENDING", "FAILED"], "pause delete", {
        sync: true,
        errorMessage: SYNC_JOB_WAITING,
        noOp: waiting,
      }),
      links("sync parking", "PAUSED", ["PENDING"], "", { sync: true, errorMessage: SYNC_JOB_WAITING, live: true }),
      links("sync held", "PAUSED", ["PENDING"], "start delete", { sync: true }),
      links("sync stopped", "PAUSED", ["PENDING"], "start delete", { sync: true, errorMessage: "Rate limited" }),
      links("sync partly failed", "DONE", ["DONE", "FAILED"], "retry delete", { sync: true }),
      links("sync running", "RUNNING", ["RUNNING"], "pause", { sync: true, live: true }),
      ...batch("COLLECTION", { model_ids: ["1"] }),
      ...batch("PROFILES", { scope: "all" }),
      zip("held", "PAUSED", "start delete"),
      zip("held, no saved request", "PAUSED", "delete", { payload: null }),
      zip("in line", "QUEUED", "pause delete", { noOp: waiting }),
      zip("running", "RUNNING", "", { live: true }),
      zip("finished", "DONE", "delete"),
      zip("partly failed", "DONE", "delete", { failedCount: 1 }),
      zip("failed", "ERROR", "delete", { errorMessage: "It failed" }),
    ];

    const offeredOn = (card: Card): Action[] =>
      ACTIONS.filter(
        (action) =>
          ({
            start: card.can_start,
            pause: card.can_pause,
            retry: card.can_retry,
            delete: card.can_delete,
          })[action],
      );

    const lookAt = async (id: string) => ({
      job: await prisma.importJob.findUnique({ where: { id } }),
      items: await prisma.importJobItem.findMany({ where: { jobId: id }, orderBy: { id: "asc" } }),
    });

    /** A fresh job in that state, each action having to find it as it was. `after` lets go of what holds it there. */
    async function build(state: State, after: (() => void)[]): Promise<ImportJob> {
      const collectionSyncId = state.sync ? await syncedCollection(ann.id) : null;
      // Its place taken, so a nudge can't run the job while it's looked at.
      if (collectionSyncId) {
        reserveSync(collectionSyncId);
        after.push(() => releaseSync(collectionSyncId));
      }
      const job = await row(
        ann.id,
        {
          type: state.type,
          status: state.status,
          failedCount: state.failedCount ?? 0,
          errorMessage: state.errorMessage ?? null,
          queuedAt: state.status === "QUEUED" ? new Date() : null,
          collectionSyncId,
          payload: state.payload === null ? undefined : (state.payload ?? LINKS_PAYLOAD),
        },
        state.items,
      );
      if (state.live) {
        let finish!: () => void;
        void trackRunner(job.id, new Promise<void>((resolve) => (finish = resolve)));
        after.push(finish);
      }
      return job;
    }

    it("takes all an admin is offered on someone's job too, by the older routes", async () => {
      for (const state of STATES) {
        for (const action of state.offers) {
          const after: (() => void)[] = [];
          const job = await build(state, after);
          const { jobs } = (await get(boss, "/admin/import-queue?queue=1").expect(200)).body as { jobs: Card[] };
          expect(offeredOn(jobs.find((listed) => listed.id === job.id)!), `on ${state.label}`).toEqual(
            ACTIONS.filter((offered) => state.offers.includes(offered)),
          );
          const path = `/admin/import-queue/jobs/${job.id}`;
          const res = action === "delete" ? await del(boss, path) : await post(boss, `${path}/${action}`);
          expect(res.status, `${state.label}, ${action}: ${JSON.stringify(res.body)}`).toBeLessThan(300);
          for (const run of after) run();
          await until(() => !isRunnerLive(job.id));
          await prisma.importJob.deleteMany({ where: { id: job.id } });
        }
      }
    });

    it.each(STATES)("$label", async (state) => {
      importWorkerTuning.runnerWaitMs = 5;
      const after: (() => void)[] = [];
      try {
        for (const action of ACTIONS) {
          const job = await build(state, after);

          const card = await cardOf(ann, job.id);
          expect(offeredOn(card), "what the card offers").toEqual(ACTIONS.filter((a) => state.offers.includes(a)));

          const before = await lookAt(job.id);
          const res =
            action === "delete"
              ? await del(ann, `/import/queue/jobs/${job.id}`)
              : await post(ann, `/import/queue/jobs/${job.id}/${action}`);
          const seen = await lookAt(job.id);
          const offered = state.offers.includes(action);
          const answer = res.status < 300 ? "taken" : res.status < 500 ? "refused" : "broke";
          expect(
            { answer, moved: JSON.stringify(seen) !== JSON.stringify(before) },
            `${action}: ${res.status} ${JSON.stringify(res.body)}`,
          ).toEqual({ answer: offered || state.noOp?.includes(action) ? "taken" : "refused", moved: offered });
          for (const run of after.splice(0)) run();
          await until(() => !isRunnerLive(job.id));
          await prisma.importJob.deleteMany({ where: { id: job.id } });
        }
      } finally {
        for (const run of after) run();
      }
    });
  });
});
