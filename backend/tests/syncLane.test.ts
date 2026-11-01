import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

// No pacing or DNS here. config.ts reads the delays on load, so it's hoisted.
const schedule = vi.hoisted(() => {
  process.env.IMPORT_MAKERWORLD_CALL_DELAY_MS = "0";
  process.env.IMPORT_COLLECTION_DELAY_MS = "0";
  process.env.COLLECTION_SYNC_ITEM_DELAY_MS = "0";
  return { on: true };
});
vi.mock("node:dns/promises", () => ({
  default: {
    resolve4: async () => ["93.184.216.34"],
    resolve6: async () => {
      throw new Error("no AAAA");
    },
  },
}));
vi.mock("../src/services/collectionSyncSchedule", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/services/collectionSyncSchedule")>()),
  syncSchedulerEnabled: () => schedule.on,
}));

import type { CollectionSync, ImportJobItem, Prisma } from "@prisma/client";
import { createApp } from "../src/app";
import { IMPORT_STALL_LIMIT_MINUTES } from "../src/config";
import { prisma } from "../src/db";
import { detectProvider, PROVIDER_IDS, URLS } from "../src/providers/index.generated";
import { setUserMakerworldCookie } from "../src/providers/makerworld/session";
import {
  releaseSync,
  reserveSync,
  runManualSync,
  runSyncRound,
  startCollectionSyncScheduler,
  syncCollection,
} from "../src/services/collectionSyncRunner";
import { nextSyncAt } from "../src/services/collectionSyncSchedule";
import { SYNC_JOB_INTERRUPTED, SYNC_JOB_WAITING, SYNC_RESUME_MARKS } from "../src/services/importJobRunner";
import { isImportingFrom } from "../src/services/importJobService";
import {
  enqueueLinksImport,
  enqueueSingleImport,
  pauseAll,
  pauseQueueJob,
  startAllPaused,
  startQueueJob,
} from "../src/services/importQueueService";
import {
  holdImportWorker,
  importWorkerIdle,
  importWorkerTuning,
  linksJobBody,
  resumeImportWorker,
} from "../src/services/importWorker";

const app = createApp();
const stamp = Date.now();
const originalFetch = global.fetch;

type Account = { id: string; token: string };
let alice: Account;
let bob: Account;
const auth = (account: Account) => ({ Authorization: `Bearer ${account.token}` });

let nextId = (stamp % 1_000_000_000) * 10;
const newId = () => String(nextId++);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const DESIGNER = { uid: 1692606088, name: "Deus Cat" };
function design(designId: string) {
  return {
    id: Number(designId),
    modelId: `US${designId}`,
    title: `Phoenix ${designId}`,
    summary: "<p>A phoenix.</p>",
    tags: ["phoenix"],
    designCreator: DESIGNER,
    defaultInstanceId: 2,
    instances: [
      { id: 1, profileId: Number(`1${designId}`), title: "Single-colour version", instanceCreator: DESIGNER },
      { id: 2, profileId: Number(`2${designId}`), title: "multi-colored version", instanceCreator: DESIGNER },
    ],
  };
}

/** What each MakerWorld collection lists. */
const collections = new Map<string, string[]>();
/** Which listings were read and which designs were imported, in order. */
const listed: string[] = [];
const started: string[] = [];
/** What holds a design's import, or with `list-` a collection's listing, until released. */
const gates = new Map<string, Promise<void>>();
const releases = new Set<() => void>();
let inFlight = 0;
let maxInFlight = 0;

function gate(...keys: string[]): () => void {
  let open!: () => void;
  const held = new Promise<void>((resolve) => {
    open = resolve;
  });
  for (const key of keys) gates.set(key, held);
  const release = () => {
    for (const key of keys) gates.delete(key);
    releases.delete(release);
    open();
  };
  releases.add(release);
  return release;
}

const fakeFetch = async (input: RequestInfo | URL): Promise<Response> => {
  const url = String(input);
  // Printables' API, for a collection that lists nothing.
  if (url.startsWith("https://api.printables.com/graphql")) {
    return json({ data: { collection: { name: "Printed" }, moreCollectionModels: { items: [], cursor: "" } } });
  }
  const listing = url.match(/^https:\/\/makerworld\.com\/api\/v1\/design-service\/favorites\/(\d+)\/designs/);
  if (listing) {
    listed.push(listing[1]);
    await gates.get(`list-${listing[1]}`);
    const ids = collections.get(listing[1]) ?? [];
    const offset = Number(new URL(url).searchParams.get("offset") ?? 0);
    return json({
      total: ids.length,
      hits: ids.slice(offset, offset + 20).map((id) => ({ id: Number(id), title: `Phoenix ${id}` })),
    });
  }
  const head = url.match(/^https:\/\/makerworld\.com\/api\/v1\/design-service\/favorites\/(\d+)$/);
  if (head) return json({ id: Number(head[1]), title: "Phoenix flock" });
  const model = url.match(/^https:\/\/api\.bambulab\.com\/v1\/design-service\/design\/(\d+)/);
  if (model) {
    if (!started.includes(model[1])) started.push(model[1]);
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      await gates.get(model[1]);
      await new Promise((resolve) => setTimeout(resolve, 20));
    } finally {
      inFlight--;
    }
    return json(design(model[1]));
  }
  const profile = url.match(/^https:\/\/api\.bambulab\.com\/v1\/iot-service\/api\/user\/profile\/(\d+)/);
  if (profile) {
    return json({ message: "success", url: `https://s3.example.com/phoenix-${profile[1]}.stl`, filename: "p.stl" });
  }
  const file = url.match(/^https:\/\/s3\.example\.com\/phoenix-(\d+)\.stl$/);
  if (file) {
    return new Response(`solid phoenix-${file[1]}\nendsolid\n`, {
      headers: { "content-type": "application/octet-stream" },
    });
  }
  return new Response("not found", { status: 404 });
};

async function register(label: string): Promise<Account> {
  const res = await request(app)
    .post("/api/register")
    .send({ displayName: `Lane ${label}`, email: `lane-${label}-${stamp}@example.com`, password: "password123" });
  if (res.status !== 200) throw new Error(`register ${label}: ${res.status} ${JSON.stringify(res.body)}`);
  await setUserMakerworldCookie(res.body.user.id, "token=test-bearer");
  return { id: res.body.user.id, token: res.body.token };
}

const modelLink = (id: string) => `https://makerworld.com/en/models/${id}`;
const PRINTABLES_MODEL = "https://www.printables.com/model/1-a-hook";

type SyncOptions = { provider?: string; listing?: string[]; lastCheckedAt?: Date | null };

async function makeSync(ownerId: string, options: SyncOptions = {}): Promise<CollectionSync> {
  const externalId = newId();
  const provider = options.provider ?? "makerworld";
  collections.set(externalId, options.listing ?? []);
  const name = `Flock ${externalId}`;
  const collection = await prisma.collection.create({
    data: { userId: ownerId, name, nameNormalized: name.toLowerCase() },
  });
  return prisma.collectionSync.create({
    data: {
      userId: ownerId,
      collectionId: collection.id,
      provider,
      externalId,
      sourceUrl:
        provider === "makerworld"
          ? `https://makerworld.com/en/collections/${externalId}`
          : `https://www.printables.com/@maker/collections/${externalId}`,
      lastCheckedAt: options.lastCheckedAt ?? null,
    },
  });
}

const SYNC_PAYLOAD = { notes: null, tags: [], category_id: null, scope: "url", item_delay_ms: 0, sync_filed: 0 };

/** A sync's job as a run leaves it, on hold unless told. `items`: its links' states, all waiting unless told. */
async function syncJob(
  sync: CollectionSync,
  ids: string[],
  data: Partial<Prisma.ImportJobUncheckedCreateInput> = {},
  items: ImportJobItem["status"][] = ids.map(() => "PENDING"),
) {
  const job = await prisma.importJob.create({
    data: {
      userId: sync.userId,
      type: "LINKS",
      status: "PAUSED",
      sourceUrl: sync.sourceUrl,
      sourceLabel: "Sync: Flock",
      provider: sync.provider,
      total: ids.length,
      collectionSyncId: sync.id,
      payload: SYNC_PAYLOAD,
      ...data,
    },
  });
  for (const [index, id] of ids.entries()) {
    await prisma.importJobItem.create({
      data: {
        jobId: job.id,
        url: modelLink(id),
        status: items[index],
        payload: { collection_id: sync.collectionId, scope: "url", title: null },
      },
    });
  }
  return job;
}

/** An import outside the lane, as far as anything reading the rows can tell. */
const importing = (ownerId: string, sourceUrl = modelLink(newId())) =>
  prisma.importJob.create({ data: { userId: ownerId, type: "LINKS", status: "RUNNING", sourceUrl } });

const finish = (job: { id: string }) => prisma.importJob.delete({ where: { id: job.id } });

const reload = (id: string) => prisma.importJob.findUniqueOrThrow({ where: { id } });
const itemStates = async (jobId: string) =>
  (
    await prisma.importJobItem.findMany({
      where: { jobId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { status: true },
    })
  ).map((item) => item.status);
const payloadOf = async (id: string) => (await reload(id)).payload as Record<string, unknown>;

const eventually = (check: () => unknown) => vi.waitFor(check, { timeout: 10_000, interval: 20 });
const finished = (jobId: string) => eventually(async () => expect((await reload(jobId)).status).toBe("DONE"));

/** A look at the lane only returns after everything already in it. */
const laneIdle = () => syncCollection("no-such-sync");

const synced = (ownerId: string, sync: CollectionSync, what: string) =>
  prisma.notification.findFirst({
    where: { userId: ownerId, title: `${what} synced into "Flock ${sync.externalId}"` },
  });

async function ownJob(owner: Account, jobId: string) {
  const res = await request(app).get("/api/import/queue").set(auth(owner));
  expect(res.status).toBe(200);
  return (res.body.jobs as { id: string }[]).find((job) => job.id === jobId);
}

const syncNow = (owner: Account, sync: CollectionSync) =>
  request(app).post(`/api/collection/${sync.collectionId}/sync/run`).set(auth(owner));

describe("the sync lane", () => {
  beforeAll(async () => {
    global.fetch = fakeFetch as typeof fetch;
    importWorkerTuning.syncGiveWayMs = 20;
    alice = await register("alice");
    bob = await register("bob");
    // Other files' leftovers: nothing here is about them, and a round looks at every sync there is.
    await prisma.importJob.updateMany({ where: { status: "QUEUED" }, data: { status: "PAUSED" } });
    await prisma.importJob.updateMany({ where: { status: "RUNNING" }, data: { status: "ERROR" } });
    await prisma.importJob.updateMany({
      where: { status: "PAUSED", errorMessage: { in: SYNC_RESUME_MARKS } },
      data: { errorMessage: null },
    });
    await prisma.collectionSync.updateMany({ data: { lastCheckedAt: new Date(), intervalHours: 24 } });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    schedule.on = true;
    for (const release of releases) release();
    await laneIdle();
    await importWorkerIdle();
    const mine = { userId: { in: [alice.id, bob.id] } };
    await prisma.importJob.deleteMany({ where: mine });
    await prisma.notification.deleteMany({ where: mine });
    await prisma.collectionSync.deleteMany({ where: mine });
    resumeImportWorker();
    await importWorkerIdle();
    started.length = 0;
    listed.length = 0;
    maxInFlight = 0;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe("one at a time", () => {
    it("runs two syncs one after the other, across users", async () => {
      const [a, b] = [newId(), newId()];
      const first = await makeSync(alice.id, { listing: [a] });
      const second = await makeSync(bob.id, { listing: [b] });
      const release = gate(a, b);

      const runs = [syncCollection(first.id), syncCollection(second.id)];
      await eventually(() => expect(started).toEqual([a]));
      expect(await prisma.importJob.count({ where: { collectionSyncId: second.id } })).toBe(0);

      release();
      expect(await Promise.all(runs)).toEqual(["queued", "queued"]);
      expect(started).toEqual([a, b]);
      expect(maxInFlight).toBe(1);
    });

    it("keeps to that when people start them", async () => {
      const [a, b] = [newId(), newId()];
      const first = await syncJob(await makeSync(alice.id), [a]);
      const second = await syncJob(await makeSync(bob.id), [b]);
      const release = gate(a, b);

      await startQueueJob(first, { manual: true });
      await startQueueJob(second, { manual: true });
      await eventually(() => expect(started).toEqual([a]));
      expect(await reload(first.id)).toMatchObject({ status: "RUNNING", errorMessage: null });
      expect(await reload(second.id)).toMatchObject({ status: "PAUSED", errorMessage: SYNC_JOB_WAITING });

      release();
      await finished(first.id);
      await finished(second.id);
      expect(started).toEqual([a, b]);
      expect(maxInFlight).toBe(1);
    });
  });

  describe("a person's Start and Retry", () => {
    it("go through the lane and never the line, which carries on beside it", async () => {
      const busy = newId();
      const other = await makeSync(bob.id, { listing: [busy] });
      const release = gate(busy);
      const inLane = syncCollection(other.id);
      await eventually(() => expect(started).toEqual([busy]));

      const added = newId();
      const job = await syncJob(await makeSync(alice.id, { lastCheckedAt: new Date() }), [added]);
      const res = await request(app).post(`/api/import/queue/jobs/${job.id}/start`).set(auth(alice));
      expect(res.status).toBe(202);
      expect(res.body).toEqual({ job_id: job.id, status: "PAUSED", position: null, sync_waiting: true });

      const row = await reload(job.id);
      expect(row).toMatchObject({ status: "PAUSED", errorMessage: SYNC_JOB_WAITING, queuedAt: null });
      expect(started).not.toContain(added);
      const queue = await request(app).get("/api/import/queue").set(auth(alice));
      expect(queue.body.line.length).toBe(0);
      expect(queue.body.jobs.find((j: { id: string }) => j.id === job.id)).toMatchObject({
        status: "PAUSED",
        sync_waiting: true,
        position: null,
        error_message: null,
        failure_reason: null,
        can_start: false,
        can_pause: true,
        can_retry: false,
        can_delete: true,
      });

      // A double click is no harm, and the line doesn't wait for any of this.
      expect(await startQueueJob(row)).toMatchObject({ position: null, syncWaiting: true });
      const line = await enqueueLinksImport(bob.id, ["https://example.com/gone.stl"], {});
      await eventually(async () => expect((await reload(line.job.id)).status).toBe("DONE"));
      expect(started).toEqual([busy]);

      release();
      expect(await inLane).toBe("queued");
      await finished(job.id);
      expect((await reload(job.id)).queuedAt).toBeNull();
      expect(started).toEqual([busy, added]);
    });

    it("rerun only what failed, and don't tell what was told already", async () => {
      const [done, failed] = [newId(), newId()];
      const sync = await makeSync(alice.id, { lastCheckedAt: new Date() });
      const job = await syncJob(
        sync,
        [done, failed],
        { status: "DONE", failedCount: 1, processed: 2, payload: { ...SYNC_PAYLOAD, sync_new: ["told"] } },
        ["DONE", "FAILED"],
      );

      const answer = await startQueueJob(job, { retryFailed: true, manual: true });
      expect(answer).toMatchObject({ job: { status: "PAUSED" }, position: null, syncWaiting: true });
      await finished(job.id);

      expect(started).toEqual([failed]);
      expect(await reload(job.id)).toMatchObject({ failedCount: 0, processed: 2, errorMessage: null });
      expect(await payloadOf(job.id)).not.toHaveProperty("sync_new", ["told"]);
      expect(await synced(alice.id, sync, "1 new model")).not.toBeNull();
    });

    it("start a job a stop left on hold, what that stop told going with it", async () => {
      const added = newId();
      const job = await syncJob(await makeSync(alice.id, { lastCheckedAt: new Date() }), [added], {
        errorMessage: "MakerWorld is rate-limiting imports",
        payload: { ...SYNC_PAYLOAD, sync_new: ["told"] },
      });
      const release = gate(added);
      await startQueueJob(job, { manual: true });
      await eventually(() => expect(started).toEqual([added]));
      expect(await payloadOf(job.id)).not.toHaveProperty("sync_new");
      release();
      await finished(job.id);
    });

    it("wait for a later look when the collection has its place already", async () => {
      const added = newId();
      const sync = await makeSync(alice.id, { lastCheckedAt: new Date() });
      const job = await syncJob(sync, [added]);
      expect(reserveSync(sync.id)).toBe(true);
      await startQueueJob(job, { manual: true });
      await laneIdle();
      expect(await reload(job.id)).toMatchObject({ status: "PAUSED", errorMessage: SYNC_JOB_WAITING });
      releaseSync(sync.id);

      await runSyncRound();
      expect((await reload(job.id)).status).toBe("DONE");
    });
  });

  describe("Hold", () => {
    it("on a waiting job stays held, keeping what it brought in", async () => {
      const busy = newId();
      const other = await makeSync(bob.id, { listing: [busy] });
      const release = gate(busy);
      const inLane = syncCollection(other.id);
      await eventually(() => expect(started).toEqual([busy]));

      const added = newId();
      const sync = await makeSync(alice.id, { lastCheckedAt: new Date() });
      const job = await syncJob(sync, [added], { payload: { ...SYNC_PAYLOAD, sync_new: ["brought-in"] } });
      await startQueueJob(job, { manual: true });
      const res = await request(app).post(`/api/import/queue/jobs/${job.id}/pause`).set(auth(alice));
      expect(res.status).toBe(200);
      expect(await reload(job.id)).toMatchObject({ status: "PAUSED", errorMessage: null });

      release();
      expect(await inLane).toBe("queued");
      await laneIdle();
      await runSyncRound();
      expect(await reload(job.id)).toMatchObject({ status: "PAUSED", errorMessage: null });
      expect(await itemStates(job.id)).toEqual(["PENDING"]);
      expect(started).not.toContain(added);
      expect(listed).not.toContain(sync.externalId);
      expect(await payloadOf(job.id)).toMatchObject({ sync_new: ["brought-in"] });
      expect(await ownJob(alice, job.id)).toMatchObject({ sync_waiting: false, can_start: true, can_pause: false });
    });

    it("made just as the lane gets to the job still holds it", async () => {
      const added = newId();
      const sync = await makeSync(alice.id, { lastCheckedAt: new Date() });
      const job = await syncJob(sync, [added], { errorMessage: SYNC_JOB_WAITING });
      const count = prisma.importJobItem.count;
      const spy = vi.spyOn(prisma.importJobItem, "count").mockImplementationOnce((async (args: never) => {
        spy.mockRestore();
        await pauseQueueJob(job);
        return count(args);
      }) as never);

      expect(await syncCollection(sync.id)).toBe("busy");
      expect(await reload(job.id)).toMatchObject({ status: "PAUSED", errorMessage: null });
      expect(started).toEqual([]);
    });

    it("by the old Pause all takes what's waiting for the lane too; the new one only running lists", async () => {
      const marked = await syncJob(await makeSync(alice.id), [newId()], { errorMessage: SYNC_JOB_WAITING });
      const theirs = await syncJob(await makeSync(bob.id), [newId()], { errorMessage: SYNC_JOB_INTERRUPTED });

      expect(await pauseAll({ ownerId: alice.id, line: true })).toBe(0);
      expect((await reload(marked.id)).errorMessage).toBe(SYNC_JOB_WAITING);

      expect(await pauseAll({ ownerId: alice.id })).toBe(0);
      expect((await reload(marked.id)).errorMessage).toBeNull();
      expect((await reload(theirs.id)).errorMessage).toBe(SYNC_JOB_INTERRUPTED);
    });
  });

  describe("giving way", () => {
    it("parks between links when the line reaches its provider, and comes back by itself after", async () => {
      const [a, b, inLine] = [newId(), newId(), newId()];
      const sync = await makeSync(alice.id, { listing: [a, b] });
      const printed = await makeSync(bob.id, { provider: "printables" });
      const releaseLane = gate(a, b);
      const run = syncCollection(sync.id);
      await eventually(() => expect(started).toHaveLength(1));
      const firstLink = started[0];

      const releaseLine = gate(inLine);
      const line = await enqueueSingleImport(bob.id, modelLink(inLine), {});
      await eventually(() => expect(started).toContain(inLine));

      releaseLane();
      expect(await run).toBe("queued");
      const job = await prisma.importJob.findFirstOrThrow({ where: { collectionSyncId: sync.id } });
      expect(job).toMatchObject({ status: "PAUSED", errorMessage: SYNC_JOB_WAITING, imported: 1, processed: 1 });
      expect((await itemStates(job.id)).toSorted()).toEqual(["DONE", "PENDING"]);
      expect(started).toEqual([firstLink, inLine]);
      expect(await synced(alice.id, sync, "1 new model")).toBeNull();
      expect(await ownJob(alice, job.id)).toMatchObject({ sync_waiting: true, position: null, can_pause: true });

      // The lane is free meanwhile, for other providers, and it doesn't come back too soon.
      expect(await syncCollection(printed.id)).toBe("unchanged");
      await runSyncRound();
      expect((await reload(job.id)).status).toBe("PAUSED");

      releaseLine();
      await eventually(async () => expect((await reload(line.job.id)).status).toBe("DONE"));
      await runSyncRound();
      expect(await reload(job.id)).toMatchObject({ status: "DONE", imported: 2, processed: 2, errorMessage: null });
      expect(await itemStates(job.id)).toEqual(["DONE", "DONE"]);
      const told = await synced(alice.id, sync, "2 new models");
      expect(told?.body).toContain(`"Phoenix ${a}"`);
      expect(told?.body).toContain(`"Phoenix ${b}"`);
    });

    it("keeps a listing it has read, and gives way at the first link", async () => {
      const added = newId();
      const sync = await makeSync(alice.id, { listing: [added] });
      const release = gate(`list-${sync.externalId}`);
      const run = syncCollection(sync.id);
      await eventually(() => expect(listed).toContain(sync.externalId));
      const blocking = await importing(bob.id);
      release();

      expect(await run).toBe("queued");
      const job = await prisma.importJob.findFirstOrThrow({ where: { collectionSyncId: sync.id } });
      expect(job).toMatchObject({ status: "PAUSED", errorMessage: SYNC_JOB_WAITING });
      expect(await itemStates(job.id)).toEqual(["PENDING"]);
      expect(started).toEqual([]);
      expect((await prisma.collectionSync.findUniqueOrThrow({ where: { id: sync.id } })).knownIds).toEqual([added]);

      expect(await syncCollection(sync.id)).toBe("busy");
      await finish(blocking);
      expect(await syncCollection(sync.id)).toBe("resumed");
      expect((await reload(job.id)).status).toBe("DONE");
      expect(listed.filter((id) => id === sync.externalId)).toHaveLength(1);
    });

    it("tells every model at the end, through giving way, a Hold and a person's Pause", async () => {
      const owned = newId();
      const direct = await request(app)
        .post("/api/import")
        .set(auth(alice))
        .send({ url: modelLink(owned), makerworld_cookie: "token=test-bearer" });
      expect(direct.status).toBe(200);
      started.length = 0;

      const [b, c, d] = [newId(), newId(), newId()];
      const sync = await makeSync(alice.id, { lastCheckedAt: new Date() });
      const job = await syncJob(sync, [owned, b, c, d], {
        errorMessage: SYNC_JOB_WAITING,
        payload: { ...SYNC_PAYLOAD, sync_filed: 1 },
      });

      // Gives way after two links.
      const releaseB = gate(b);
      const run = syncCollection(sync.id);
      await eventually(() => expect(started).toEqual(expect.arrayContaining([b])));
      const blocking = await importing(bob.id);
      releaseB();
      expect(await run).toBe("resumed");
      const parked = await reload(job.id);
      expect(parked).toMatchObject({
        status: "PAUSED",
        errorMessage: SYNC_JOB_WAITING,
        imported: 1,
        alreadyInLibrary: 1,
        processed: 2,
      });
      const afterOne = (await payloadOf(job.id)) as { sync_new: string[]; sync_filed: number; item_delay_ms: number };
      expect(afterOne.sync_new).toHaveLength(1);
      expect(afterOne).toMatchObject({ sync_filed: 2, item_delay_ms: 0 });
      await finish(blocking);

      // A Hold and a Start lose nothing, and a Pause mid-run neither.
      await pauseQueueJob(parked);
      expect(await payloadOf(job.id)).toEqual(afterOne);
      const releaseC = gate(c);
      await startQueueJob(await reload(job.id), { manual: true });
      await eventually(() => expect(started).toContain(c));
      expect(await payloadOf(job.id)).toEqual(afterOne);
      await pauseQueueJob(await reload(job.id));
      releaseC();
      await laneIdle();
      expect(await reload(job.id)).toMatchObject({ status: "PAUSED", errorMessage: null, imported: 2 });
      expect(await itemStates(job.id)).toEqual(["DONE", "DONE", "DONE", "PENDING"]);
      expect(((await payloadOf(job.id)) as { sync_new: string[] }).sync_new).toHaveLength(2);

      await startQueueJob(await reload(job.id), { manual: true });
      await finished(job.id);
      expect(await reload(job.id)).toMatchObject({ imported: 3, alreadyInLibrary: 1 });
      const told = await synced(alice.id, sync, "3 new models");
      expect(told?.body).toContain("2 models that were already in your library were added to it too.");
      expect(await prisma.notification.count({ where: { userId: alice.id, type: "sync" } })).toBe(1);
    });

    it("a person's Pause, just made, stays a pause", async () => {
      const [a, b] = [newId(), newId()];
      const sync = await makeSync(alice.id, { lastCheckedAt: new Date() });
      const job = await syncJob(sync, [a, b], { errorMessage: SYNC_JOB_WAITING });
      const release = gate(a);
      const run = syncCollection(sync.id);
      await eventually(() => expect(started).toEqual([a]));
      await importing(bob.id);
      await pauseQueueJob(await reload(job.id));
      release();
      await run;
      expect(await reload(job.id)).toMatchObject({ status: "PAUSED", errorMessage: null });
    });

    it("doesn't give way to another provider, to its own job, or to what isn't running", async () => {
      const printing = await importing(bob.id, PRINTABLES_MODEL);
      const [a, b] = [newId(), newId()];
      const sync = await makeSync(alice.id, { listing: [a, b] });
      expect(await syncCollection(sync.id)).toBe("queued");
      const job = await prisma.importJob.findFirstOrThrow({ where: { collectionSyncId: sync.id } });
      expect(job.status).toBe("DONE");
      await finish(printing);

      holdImportWorker();
      await enqueueSingleImport(bob.id, modelLink(newId()), {});
      const next = newId();
      const later = await makeSync(alice.id, { listing: [next] });
      expect(await syncCollection(later.id)).toBe("queued");
      expect(await synced(alice.id, later, "1 new model")).not.toBeNull();
    });

    it("holds only this provider's syncs back, without marking anything seen", async () => {
      const blocking = await importing(bob.id);
      const added = newId();
      const held = await makeSync(alice.id, { listing: [added] });
      const printed = await makeSync(alice.id, { provider: "printables" });

      expect(await syncCollection(held.id)).toBe("busy");
      expect(listed).not.toContain(held.externalId);
      expect((await prisma.collectionSync.findUniqueOrThrow({ where: { id: held.id } })).knownIds).toEqual([]);
      expect(await syncCollection(printed.id)).toBe("unchanged");

      await finish(blocking);
      expect(await syncCollection(held.id)).toBe("queued");
    });

    it("reads what's importing from a provider", async () => {
      holdImportWorker();
      expect(await isImportingFrom("makerworld")).toBe(false);

      // Anyone's. Its source says so when it has no link running.
      const anyones = await importing(bob.id);
      expect(await isImportingFrom("makerworld")).toBe(true);
      expect(await isImportingFrom("printables")).toBe(false);
      // A row nothing has touched for that long can't hold a provider's syncs for good.
      const stale = new Date(Date.now() - (IMPORT_STALL_LIMIT_MINUTES + 1) * 60_000);
      await prisma.importJob.update({ where: { id: anyones.id }, data: { updatedAt: stale } });
      expect(await isImportingFrom("makerworld")).toBe(false);
      await finish(anyones);

      // Its own provider first.
      const named = await prisma.importJob.create({
        data: {
          userId: bob.id,
          type: "COLLECTION",
          status: "RUNNING",
          provider: "thingiverse",
          sourceUrl: "https://example.com/list",
        },
      });
      expect(await isImportingFrom("thingiverse")).toBe(true);
      await finish(named);

      // A mixed list by the link it's on.
      const mixed = await importing(bob.id, PRINTABLES_MODEL);
      const link = await prisma.importJobItem.create({
        data: { jobId: mixed.id, url: modelLink(newId()), status: "RUNNING" },
      });
      expect(await isImportingFrom("makerworld")).toBe(true);
      expect(await isImportingFrom("printables")).toBe(false);
      await prisma.importJobItem.update({ where: { id: link.id }, data: { status: "DONE" } });
      expect(await isImportingFrom("makerworld")).toBe(false);
      expect(await isImportingFrom("printables")).toBe(true);
      await finish(mixed);

      // A sync's own job, what isn't running, and a link of no provider don't count.
      const sync = await makeSync(alice.id);
      await syncJob(sync, [newId()], { status: "RUNNING" });
      await prisma.importJob.create({
        data: { userId: bob.id, type: "LINKS", status: "QUEUED", queuedAt: new Date(), sourceUrl: modelLink(newId()) },
      });
      await prisma.importJob.create({
        data: { userId: bob.id, type: "LINKS", status: "PAUSED", sourceUrl: modelLink(newId()) },
      });
      await importing(bob.id, "https://example.com/model.stl");
      expect(await isImportingFrom("makerworld")).toBe(false);
    });

    it.each([...PROVIDER_IDS])("reads a sync's links as %s's own", (id) => {
      expect(detectProvider(URLS[id].modelUrl("12345"))).toBe(id);
    });
  });

  describe("Sync now", () => {
    it("gives way to the same provider outside the lane, and then runs", async () => {
      const added = newId();
      const sync = await makeSync(alice.id, { listing: [added] });
      const printed = await makeSync(bob.id, { provider: "printables" });
      const blocking = await importing(alice.id);

      expect((await syncNow(alice, sync)).status).toBe(202);
      // Its place stays taken, and the lane stays free.
      expect((await syncNow(alice, sync)).status).toBe(409);
      expect(await syncCollection(sync.id)).toBe("busy");
      expect(await syncCollection(printed.id)).toBe("unchanged");
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(listed).not.toContain(sync.externalId);

      await finish(blocking);
      await eventually(async () => expect(await synced(alice.id, sync, "1 new model")).not.toBeNull());
      expect(started).toEqual([added]);
    });

    it("isn't refused by a running import, and doesn't wait for another provider's or for the line", async () => {
      const added = newId();
      const sync = await makeSync(alice.id, { listing: [added] });
      await importing(alice.id, PRINTABLES_MODEL);
      holdImportWorker();
      await enqueueSingleImport(alice.id, modelLink(newId()), {});

      expect((await syncNow(alice, sync)).status).toBe(202);
      await eventually(async () => expect(await synced(alice.id, sync, "1 new model")).not.toBeNull());
    });

    it("picks up its job waiting for the lane", async () => {
      const added = newId();
      const sync = await makeSync(alice.id);
      const job = await syncJob(sync, [added], { errorMessage: SYNC_JOB_WAITING });
      expect((await syncNow(alice, sync)).status).toBe(202);
      await finished(job.id);
    });

    it("says why when it found a place taken", async () => {
      const sync = await makeSync(alice.id);
      reserveSync(sync.id);
      expect(await runManualSync(sync.id)).toBe("busy");
      releaseSync(sync.id);
      const note = await prisma.notification.findFirstOrThrow({
        where: { userId: alice.id, title: `Couldn't sync "Flock ${sync.externalId}" yet` },
      });
      expect(note.body).toBe("An import from MakerWorld is running. Try Sync now again once it's done.");
    });
  });

  describe("the round", () => {
    it("picks up jobs waiting for the lane whether their sync is due or not, without checking anything", async () => {
      const checked = new Date();
      const waitingSync = await makeSync(alice.id, { lastCheckedAt: checked });
      const waiting = await syncJob(waitingSync, [newId()], { errorMessage: SYNC_JOB_WAITING });
      const cutOffSync = await makeSync(bob.id, { lastCheckedAt: checked });
      const cutOff = await syncJob(cutOffSync, [newId()], { errorMessage: SYNC_JOB_INTERRUPTED });
      const heldSync = await makeSync(alice.id, { lastCheckedAt: checked });
      const held = await syncJob(heldSync, [newId()]);

      await runSyncRound();

      expect((await reload(waiting.id)).status).toBe("DONE");
      expect((await reload(cutOff.id)).status).toBe("DONE");
      expect(await reload(held.id)).toMatchObject({ status: "PAUSED", errorMessage: null });
      expect(listed).toEqual([]);
      expect(
        (await prisma.collectionSync.findUniqueOrThrow({ where: { id: waitingSync.id } })).lastCheckedAt?.getTime(),
      ).toBe(checked.getTime());
    });

    it("puts a waiting job before one on hold, which stays on hold and takes what's new", async () => {
      const [waitingLink, heldLink] = [newId(), newId()];
      const sync = await makeSync(alice.id, { lastCheckedAt: new Date() });
      const held = await syncJob(sync, [heldLink], { createdAt: new Date(Date.now() - 60_000) });
      const waiting = await syncJob(sync, [waitingLink], { errorMessage: SYNC_JOB_WAITING });

      expect(await syncCollection(sync.id)).toBe("resumed");
      expect((await reload(waiting.id)).status).toBe("DONE");
      expect(await reload(held.id)).toMatchObject({ status: "PAUSED", errorMessage: null });
      expect(started).toEqual([waitingLink]);

      collections.set(sync.externalId, [newId()]);
      expect(await syncCollection(sync.id)).toBe("queued");
      expect(await itemStates(held.id)).toEqual(["PENDING", "PENDING"]);
    });

    it("ends a job cut off after its last link: quietly, or telling what it had brought in", async () => {
      const quietSync = await makeSync(alice.id, { lastCheckedAt: new Date() });
      const quiet = await syncJob(quietSync, [newId()], { errorMessage: SYNC_JOB_INTERRUPTED }, ["DONE"]);
      expect(await syncCollection(quietSync.id)).toBe("unchanged");
      expect(await reload(quiet.id)).toMatchObject({ status: "DONE", errorMessage: null });
      expect(await prisma.notification.count({ where: { userId: alice.id } })).toBe(0);

      const toldSync = await makeSync(alice.id, { lastCheckedAt: new Date() });
      const told = await syncJob(
        toldSync,
        [newId()],
        { errorMessage: SYNC_JOB_INTERRUPTED, payload: { ...SYNC_PAYLOAD, sync_new: ["brought-in"] } },
        ["DONE"],
      );
      expect(await syncCollection(toldSync.id)).toBe("resumed");
      expect((await reload(told.id)).status).toBe("DONE");
      expect(await synced(alice.id, toldSync, "1 new model")).not.toBeNull();
    });
  });

  describe("with scheduled sync off", () => {
    it("still runs what a person started or what gave way, and nothing else", async () => {
      schedule.on = false;
      const checked = new Date();
      const waiting = await syncJob(await makeSync(alice.id, { lastCheckedAt: checked }), [newId()], {
        errorMessage: SYNC_JOB_WAITING,
      });
      const cutOffSync = await makeSync(alice.id, { lastCheckedAt: checked });
      const cutOff = await syncJob(cutOffSync, [newId()], { errorMessage: SYNC_JOB_INTERRUPTED });
      const due = await makeSync(alice.id, { listing: [newId()] });

      await runSyncRound();

      expect((await reload(waiting.id)).status).toBe("DONE");
      expect(await reload(cutOff.id)).toMatchObject({ status: "PAUSED", errorMessage: SYNC_JOB_INTERRUPTED });
      expect(listed).toEqual([]);
      expect((await prisma.collectionSync.findUniqueOrThrow({ where: { id: due.id } })).lastCheckedAt).toBeNull();

      // Nothing comes round to a job a restart cut off, so it offers Start, which sends it on its way.
      expect(await ownJob(alice, cutOff.id)).toMatchObject({
        sync_waiting: false,
        error_message: null,
        can_start: true,
        can_pause: false,
      });
      await startQueueJob(await reload(cutOff.id), { manual: true });
      await finished(cutOff.id);
    });

    it("checks nothing for a job held before the lane got to it", async () => {
      schedule.on = false;
      const busy = newId();
      const other = await makeSync(bob.id, { listing: [busy], lastCheckedAt: new Date() });
      const release = gate(busy);
      const inLane = syncCollection(other.id);
      await eventually(() => expect(started).toEqual([busy]));

      const sync = await makeSync(alice.id, { listing: [newId()] });
      const job = await syncJob(sync, [newId()], { errorMessage: SYNC_JOB_WAITING });
      const round = runSyncRound();
      await eventually(() => {
        const free = reserveSync(sync.id);
        if (free) releaseSync(sync.id);
        expect(free).toBe(false);
      });
      await pauseQueueJob(job);
      release();
      await Promise.all([inLane, round]);

      expect(await reload(job.id)).toMatchObject({ status: "PAUSED", errorMessage: null });
      expect(listed).not.toContain(sync.externalId);
      expect((await prisma.collectionSync.findUniqueOrThrow({ where: { id: sync.id } })).lastCheckedAt).toBeNull();
    });

    it("lets Sync now pick up a job a restart cut off, as it always has", async () => {
      schedule.on = false;
      const sync = await makeSync(alice.id, { lastCheckedAt: new Date() });
      const job = await syncJob(sync, [newId()], { errorMessage: SYNC_JOB_INTERRUPTED });
      expect(await syncCollection(sync.id)).toBe("resumed");
      expect((await reload(job.id)).status).toBe("DONE");
    });

    it("keeps its tick, and gives no collection a next check", () => {
      schedule.on = false;
      vi.useFakeTimers({ toFake: ["setTimeout", "setInterval"] });
      try {
        startCollectionSyncScheduler();
        expect(vi.getTimerCount()).toBe(1);
      } finally {
        vi.clearAllTimers();
        vi.useRealTimers();
      }
      expect(nextSyncAt({ lastCheckedAt: null, intervalHours: 1 })).toBeNull();
    });
  });

  describe("a job its sync left behind", () => {
    it("carries on to its end if that happens as it runs, without giving way to itself", async () => {
      const [a, b] = [newId(), newId()];
      const sync = await makeSync(alice.id, { listing: [a, b] });
      const release = gate(a, b);
      const run = syncCollection(sync.id);
      await eventually(() => expect(started).toHaveLength(1));
      const job = await prisma.importJob.findFirstOrThrow({ where: { collectionSyncId: sync.id } });
      await prisma.collectionSync.delete({ where: { id: sync.id } });

      release();
      expect(await run).toBe("queued");
      expect(await reload(job.id)).toMatchObject({ status: "DONE", collectionSyncId: null, imported: 2 });
      expect(
        await prisma.notification.findFirst({ where: { userId: alice.id, title: "Imported 2 of 2 models" } }),
      ).not.toBeNull();
    });

    it("is a plain job on hold, whose Start joins the back of the line with no pace", async () => {
      const sync = await makeSync(alice.id, { lastCheckedAt: new Date() });
      const [a, b] = [newId(), newId()];
      const job = await syncJob(sync, [a, b], {
        errorMessage: SYNC_JOB_WAITING,
        payload: { ...SYNC_PAYLOAD, item_delay_ms: 60_000, sync_new: ["brought-in"] },
      });
      await prisma.collectionSync.delete({ where: { id: sync.id } });

      await runSyncRound();
      const left = await reload(job.id);
      expect(left).toMatchObject({ status: "PAUSED", collectionSyncId: null });
      expect(await ownJob(alice, job.id)).toMatchObject({
        sync_waiting: false,
        collection_sync_id: null,
        error_message: null,
        can_start: true,
        can_pause: false,
      });

      holdImportWorker();
      const inLine = newId();
      await enqueueSingleImport(bob.id, modelLink(inLine), {});
      const answer = await startQueueJob(left, { manual: true });
      expect(answer).toMatchObject({ job: { status: "QUEUED" }, position: 2, syncWaiting: false });
      const queued = await reload(job.id);
      expect(queued).toMatchObject({ status: "QUEUED", errorMessage: null });
      expect((await linksJobBody(queued)).itemDelayMs).toBeUndefined();

      resumeImportWorker();
      await importWorkerIdle();
      expect((await reload(job.id)).status).toBe("DONE");
      expect(started).toEqual([inLine, a, b]);
      expect(
        await prisma.notification.findFirst({ where: { userId: alice.id, title: "Imported 2 of 2 models" } }),
      ).not.toBeNull();
    });

    it("is started by Start all, a job still waiting for its lane isn't", async () => {
      holdImportWorker();
      const sync = await makeSync(alice.id);
      const left = await syncJob(sync, [newId()], { errorMessage: SYNC_JOB_WAITING });
      await prisma.collectionSync.delete({ where: { id: sync.id } });
      const waiting = await syncJob(await makeSync(alice.id), [newId()], { errorMessage: SYNC_JOB_WAITING });

      expect(await startAllPaused({ ownerId: alice.id, line: true })).toBe(1);
      expect((await reload(left.id)).status).toBe("QUEUED");
      expect(await reload(waiting.id)).toMatchObject({ status: "PAUSED", errorMessage: SYNC_JOB_WAITING });
    });
  });
});
