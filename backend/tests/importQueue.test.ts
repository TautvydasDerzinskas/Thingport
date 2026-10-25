import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

// No pacing or DNS here. config.ts reads the pace on load, so it's hoisted.
vi.hoisted(() => {
  process.env.IMPORT_MAKERWORLD_CALL_DELAY_MS = "0";
});
vi.mock("node:dns/promises", () => ({
  default: {
    resolve4: async () => ["93.184.216.34"],
    resolve6: async () => {
      throw new Error("no AAAA");
    },
  },
}));

// Holds the runner's final notification, so a test can act while the job already reads DONE but
// its runner hasn't returned yet.
const notifyDelay = vi.hoisted(() => ({ ms: 0 }));
vi.mock("../src/services/notificationService", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/services/notificationService")>();
  return {
    ...original,
    createNotification: async (...args: Parameters<typeof original.createNotification>) => {
      if (notifyDelay.ms) await new Promise((resolve) => setTimeout(resolve, notifyDelay.ms));
      return original.createNotification(...args);
    },
  };
});

import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { makerworldCaptchaCooloffActive, resetCaptchaCooloffForTest } from "../src/providers/makerworld/captcha";

const app = createApp();
const stamp = Date.now();
const base = (stamp % 1_000_000_000) + 1000;
const originalFetch = global.fetch;

type Account = { id: string; token: string };
let admin: Account;
let member: Account;
let other: Account;
const auth = (account: Account) => ({ Authorization: `Bearer ${account.token}` });

async function register(label: string, role: "ADMIN" | "MEMBER"): Promise<Account> {
  const email = `queue-${label}-${stamp}@example.com`;
  const res = await request(app)
    .post("/api/register")
    .send({ displayName: `Queue ${label}`, email, password: "password123" });
  if (res.status !== 200) throw new Error(`register ${label}: ${res.status} ${JSON.stringify(res.body)}`);
  await prisma.user.update({ where: { id: res.body.user.id }, data: { role } });
  // Tokens embed the role at issue time.
  const login = await request(app).post("/api/login").send({ email, password: "password123" });
  return { id: res.body.user.id, token: login.body.token };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
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
      { id: 1, profileId: 101, title: "Single-colour version", instanceCreator: DESIGNER },
      { id: 2, profileId: 102, title: "multi-colored version", instanceCreator: DESIGNER },
    ],
  };
}

// Per design id: how often it was fetched, an optional gate that holds the fetch until released,
// and a 404 switch. inFlight/maxInFlight catch two jobs importing at once.
const designCalls = new Map<string, number>();
const gates = new Map<string, { held: Promise<void>; release: () => void }>();
const gone = new Set<string>();
// Design ids MakerWorld answers with its CAPTCHA challenge.
const challenged = new Set<string>();
let inFlight = 0;
let maxInFlight = 0;

function mockFetch() {
  global.fetch = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
    const url = String(input);
    const model = url.match(/^https:\/\/api\.bambulab\.com\/v1\/design-service\/design\/(\d+)/);
    if (model) {
      const id = model[1];
      designCalls.set(id, (designCalls.get(id) ?? 0) + 1);
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        await gates.get(id)?.held;
        await new Promise((resolve) => setTimeout(resolve, 20));
      } finally {
        inFlight--;
      }
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
    if (profile)
      return json({
        message: "success",
        url: `https://s3.example.com/phoenix-${profile[1]}.stl`,
        filename: `phoenix-${profile[1]}.stl`,
      });
    const file = url.match(/^https:\/\/s3\.example\.com\/phoenix-(\d+)\.stl$/);
    if (file)
      return new Response(`solid phoenix-${file[1]}\nendsolid\n`, {
        headers: { "content-type": "application/octet-stream" },
      });
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
}

function gate(id: string): () => void {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  gates.set(id, { held, release });
  return () => {
    gates.delete(id);
    release();
  };
}

const modelUrl = (id: number | string) => `https://makerworld.com/en/models/${id}-phoenix`;

function queue(account: Account, body: Record<string, unknown>) {
  return request(app).post("/api/import/queue").set(auth(account)).send(body);
}

async function job(jobId: string) {
  return prisma.importJob.findUniqueOrThrow({ where: { id: jobId } });
}

async function items(jobId: string) {
  return prisma.importJobItem.findMany({ where: { jobId }, orderBy: { createdAt: "asc" } });
}

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 15000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > deadline) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

const waitStatus = (jobId: string, status: string) =>
  waitFor(
    () => job(jobId),
    (j) => j.status === status,
  );

/** Each test starts from an empty queue: the admin page acts on every user's jobs, so another
 *  test's leftovers would be started by "Start all" too. */
async function clearQueue() {
  await request(app).post("/api/admin/import-queue/pause-all").set(auth(admin));
  await waitFor(
    async () => (await request(app).get("/api/admin/import-queue").set(auth(admin))).body,
    (body) => !body.bulk.running && !body.jobs.some((j: { runner_live: boolean }) => j.runner_live),
  );
  await prisma.importJob.deleteMany({ where: { type: "LINKS" } });
  // Going around the API leaves the queues' notifications behind.
  await prisma.notification.deleteMany({ where: { userId: { in: [admin.id, member.id, other.id] } } });
}

describe("the import queue", () => {
  beforeAll(async () => {
    admin = await register("admin", "ADMIN");
    member = await register("member", "MEMBER");
    other = await register("other", "MEMBER");
    // Start/retry take the owner's saved cookie, never one from the request.
    for (const account of [admin, member, other]) {
      await request(app).patch("/api/settings/makerworld").set(auth(account)).send({ cookie: "token=test-bearer" });
    }
    mockFetch();
  });

  afterEach(async () => {
    // A failed assertion can leave a fetch held, which would keep its runner alive forever.
    for (const { release } of gates.values()) release();
    gates.clear();
    await clearQueue();
    global.fetch = originalFetch;
    mockFetch();
    designCalls.clear();
    gone.clear();
    challenged.clear();
    resetCaptchaCooloffForTest();
    inFlight = 0;
    maxInFlight = 0;
    notifyDelay.ms = 0;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [admin.id, member.id, other.id] } } });
  });

  describe("sending links from the extension", () => {
    it("parks links in one paused job without fetching anything", async () => {
      const first = await queue(member, { url: modelUrl(base), title: "Phoenix A" });
      expect(first.status).toBe(201);
      expect(first.body).toMatchObject({ duplicate: false, waiting: 1 });
      const second = await queue(member, { url: modelUrl(base + 1) });
      expect(second.body.job_id).toBe(first.body.job_id);
      expect(second.body.waiting).toBe(2);

      const parked = await job(first.body.job_id);
      expect(parked.status).toBe("PAUSED");
      expect(parked.total).toBe(2);
      expect((await items(parked.id)).map((i) => i.status)).toEqual(["PENDING", "PENDING"]);
      expect(designCalls.size).toBe(0);

      // Wait a beat: nothing starts on its own.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect((await job(parked.id)).status).toBe("PAUSED");
    });

    it("notifies once when a queue starts, and leaves the notification alone after that", async () => {
      await prisma.importJob.deleteMany({ where: { userId: member.id, status: "PAUSED" } });
      await prisma.notification.deleteMany({ where: { userId: member.id } });
      const first = await queue(member, { url: modelUrl(base + 2) });
      await queue(member, { url: modelUrl(base + 3) });
      const notifications = await prisma.notification.findMany({ where: { userId: member.id, type: "queue" } });
      expect(notifications).toHaveLength(1);
      expect(notifications[0].title).toBe("Links are waiting in the import queue");
      // A member can't open the admin page, so the notification doesn't link there.
      expect(notifications[0].internalPath).toBeNull();

      // The notification isn't tied to the queue: deleting it leaves the queue as it was.
      await prisma.notification.deleteMany({ where: { userId: member.id } });
      expect((await job(first.body.job_id)).status).toBe("PAUSED");
    });

    it("links an admin's notification to the queue page", async () => {
      await prisma.notification.deleteMany({ where: { userId: admin.id } });
      await queue(admin, { url: modelUrl(base + 4) });
      const notification = await prisma.notification.findFirst({ where: { userId: admin.id, type: "queue" } });
      expect(notification!.internalPath).toBe("/admin-queue");
    });

    it("doesn't add a link that's already waiting", async () => {
      await queue(member, { url: modelUrl(base + 5) });
      const again = await queue(member, { url: modelUrl(base + 5) });
      expect(again.status).toBe(200);
      expect(again.body.duplicate).toBe(true);
      expect(await items(again.body.job_id)).toHaveLength(1);
    });

    it("collects quick back-to-back sends into one job", async () => {
      const sends = await Promise.all(
        Array.from({ length: 6 }, (_, i) => queue(member, { url: modelUrl(base + 10 + i) })),
      );
      expect(sends.every((r) => r.status === 201)).toBe(true);
      expect(new Set(sends.map((r) => r.body.job_id)).size).toBe(1);
      const paused = await prisma.importJob.findMany({ where: { userId: member.id, status: "PAUSED" } });
      expect(paused).toHaveLength(1);
      expect(await items(paused[0].id)).toHaveLength(6);
    });

    it("keeps each user's queue separate", async () => {
      const a = await queue(member, { url: modelUrl(base + 20) });
      const b = await queue(other, { url: modelUrl(base + 20) });
      expect(a.body.job_id).not.toBe(b.body.job_id);
    });

    it("rejects bad input", async () => {
      expect((await queue(member, { url: "" })).status).toBe(400);
      expect((await queue(member, {})).status).toBe(400);
      expect((await queue(member, { url: modelUrl(base), scope: "everything" })).status).toBe(400);
      expect((await queue(member, { url: "not a url" })).status).toBe(400);
      expect(
        (
          await request(app)
            .post("/api/import/queue")
            .send({ url: modelUrl(base) })
        ).status,
      ).toBe(401);
    });

    it("refuses someone else's collection", async () => {
      const theirs = await request(app)
        .post("/api/collections")
        .set(auth(other))
        .send({ name: `Theirs ${stamp}` });
      const res = await queue(member, { url: modelUrl(base + 21), collection_id: theirs.body.id });
      expect(res.status).toBe(404);
      expect(await prisma.importJob.count({ where: { userId: member.id } })).toBe(0);
    });
  });

  describe("the admin queue page", () => {
    it("is admin-only", async () => {
      expect((await request(app).get("/api/admin/import-queue").set(auth(member))).status).toBe(403);
      expect((await request(app).post("/api/admin/import-queue/start-all").set(auth(member))).status).toBe(403);
    });

    it("lists every user's jobs with their owner and link counts", async () => {
      await queue(member, { url: modelUrl(base + 30), title: "Phoenix Thirty" });
      await queue(other, { url: modelUrl(base + 31) });
      const res = await request(app).get("/api/admin/import-queue").set(auth(admin));
      expect(res.status).toBe(200);
      const mine = res.body.jobs.find((j: { owner: { id: string } }) => j.owner.id === member.id);
      expect(mine).toMatchObject({ status: "PAUSED", pending_count: 1, runner_live: false, total: 1 });
      expect(res.body.jobs.some((j: { owner: { id: string } }) => j.owner.id === other.id)).toBe(true);

      const listed = await request(app).get(`/api/admin/import-queue/jobs/${mine.id}/items`).set(auth(admin));
      expect(listed.body[0]).toMatchObject({ title: "Phoenix Thirty", scope: "url", status: "PENDING" });
    });

    it("starts a paused job as its owner, with each link's collection and profiles", async () => {
      const collection = await request(app)
        .post("/api/collections")
        .set(auth(member))
        .send({ name: `Queued ${stamp}` });
      const res = await queue(member, {
        url: modelUrl(base + 40),
        collection_id: collection.body.id,
        scope: "all",
      });
      await queue(member, { url: modelUrl(base + 41) });

      const start = await request(app).post(`/api/admin/import-queue/jobs/${res.body.job_id}/start`).set(auth(admin));
      expect(start.status).toBe(202);
      const finished = await waitStatus(res.body.job_id, "DONE");
      expect(finished.status).toBe("DONE");
      expect(finished.failedCount).toBe(0);

      // The member owns the models, not the admin who pressed start.
      const withProfiles = await prisma.print.findFirst({
        where: { userId: member.id, sourceExternalId: String(base + 40) },
        include: { plates: true, collectionItems: true },
      });
      expect(withProfiles!.plates).toHaveLength(2);
      expect(withProfiles!.collectionItems.map((c) => c.collectionId)).toEqual([collection.body.id]);
      const plain = await prisma.print.findFirst({
        where: { userId: member.id, sourceExternalId: String(base + 41) },
        include: { plates: true, collectionItems: true },
      });
      expect(plain!.plates).toHaveLength(1);
      expect(plain!.collectionItems).toHaveLength(0);
      expect(await prisma.print.count({ where: { userId: admin.id } })).toBe(0);
    });

    it("still imports a link whose collection was deleted while it waited", async () => {
      const collection = await request(app)
        .post("/api/collections")
        .set(auth(member))
        .send({ name: `Doomed ${stamp}` });
      const res = await queue(member, { url: modelUrl(base + 42), collection_id: collection.body.id });
      await prisma.collection.delete({ where: { id: collection.body.id } });

      await request(app).post(`/api/admin/import-queue/jobs/${res.body.job_id}/start`).set(auth(admin));
      const finished = await waitStatus(res.body.job_id, "DONE");
      expect(finished.failedCount).toBe(0);
      expect(finished.imported).toBe(1);
    });

    it("sends new links to a fresh queue once the old one started", async () => {
      const first = await queue(member, { url: modelUrl(base + 43) });
      await request(app).post(`/api/admin/import-queue/jobs/${first.body.job_id}/start`).set(auth(admin));
      const second = await queue(member, { url: modelUrl(base + 44) });
      expect(second.body.job_id).not.toBe(first.body.job_id);
      expect((await job(second.body.job_id)).status).toBe("PAUSED");
      await waitStatus(first.body.job_id, "DONE");
    });

    it("refuses to start a job that isn't paused, or while the owner has another import running", async () => {
      const release = gate(String(base + 50));
      const a = await queue(member, { url: modelUrl(base + 50) });
      await request(app).post(`/api/admin/import-queue/jobs/${a.body.job_id}/start`).set(auth(admin));
      await waitFor(
        async () => designCalls.get(String(base + 50)) ?? 0,
        (n) => n > 0,
      );

      const again = await request(app).post(`/api/admin/import-queue/jobs/${a.body.job_id}/start`).set(auth(admin));
      expect(again.status).toBe(409);

      // A second queue of the same owner can't run next to the first.
      const b = await queue(member, { url: modelUrl(base + 51) });
      const blocked = await request(app).post(`/api/admin/import-queue/jobs/${b.body.job_id}/start`).set(auth(admin));
      expect(blocked.status).toBe(409);
      expect((await job(b.body.job_id)).status).toBe("PAUSED");

      release();
      await waitStatus(a.body.job_id, "DONE");
      const done = await request(app).post(`/api/admin/import-queue/jobs/${a.body.job_id}/start`).set(auth(admin));
      expect(done.status).toBe(400);
    });

    it("pauses after the current link and resumes where it stopped", async () => {
      const ids = [base + 60, base + 61, base + 62];
      const release = gate(String(ids[0]));
      let res!: request.Response;
      for (const id of ids) res = await queue(member, { url: modelUrl(id) });
      const jobId = res.body.job_id;

      await request(app).post(`/api/admin/import-queue/jobs/${jobId}/start`).set(auth(admin));
      await waitFor(
        async () => designCalls.get(String(ids[0])) ?? 0,
        (n) => n > 0,
      );
      const pause = await request(app).post(`/api/admin/import-queue/jobs/${jobId}/pause`).set(auth(admin));
      expect(pause.status).toBe(200);

      // Its runner is still on the first link, so starting now would run the job twice.
      const early = await request(app).post(`/api/admin/import-queue/jobs/${jobId}/start`).set(auth(admin));
      expect(early.status).toBe(409);

      release();
      await waitFor(
        async () => (await request(app).get("/api/admin/import-queue").set(auth(admin))).body,
        (body) => !body.jobs.find((j: { id: string }) => j.id === jobId).runner_live,
      );
      expect((await job(jobId)).status).toBe("PAUSED");
      expect((await items(jobId)).map((i) => i.status)).toEqual(["DONE", "PENDING", "PENDING"]);
      expect(designCalls.get(String(ids[1]))).toBeUndefined();

      const resume = await request(app).post(`/api/admin/import-queue/jobs/${jobId}/start`).set(auth(admin));
      expect(resume.status).toBe(202);
      const finished = await waitStatus(jobId, "DONE");
      expect(finished.imported).toBe(3);
      expect(finished.processed).toBe(3);
      // Nothing was downloaded twice.
      for (const id of ids) expect(designCalls.get(String(id))).toBe(1);
    });

    it("recovers a job left RUNNING by a restart: pause, then start", async () => {
      const res = await queue(member, { url: modelUrl(base + 70) });
      const jobId = res.body.job_id;
      // What a crash mid-link leaves behind: no runner, the job and its link still RUNNING.
      await prisma.importJob.update({ where: { id: jobId }, data: { status: "RUNNING" } });
      await prisma.importJobItem.updateMany({ where: { jobId }, data: { status: "RUNNING" } });

      const listed = await request(app).get("/api/admin/import-queue").set(auth(admin));
      expect(listed.body.jobs.find((j: { id: string }) => j.id === jobId).runner_live).toBe(false);

      expect((await request(app).post(`/api/admin/import-queue/jobs/${jobId}/start`).set(auth(admin))).status).toBe(
        400,
      );
      expect((await request(app).post(`/api/admin/import-queue/jobs/${jobId}/pause`).set(auth(admin))).status).toBe(
        200,
      );
      expect((await request(app).post(`/api/admin/import-queue/jobs/${jobId}/start`).set(auth(admin))).status).toBe(
        202,
      );
      const finished = await waitStatus(jobId, "DONE");
      expect(finished.imported).toBe(1);
    });

    it("starts a job a restart cut off, which has links waiting but none failed", async () => {
      const res = await queue(member, { url: modelUrl(base + 86) });
      await queue(member, { url: modelUrl(base + 87) });
      const jobId = res.body.job_id;
      // What the boot recovery in server.ts leaves: the link that was importing still RUNNING.
      const [first] = await items(jobId);
      await prisma.importJobItem.update({ where: { id: first.id }, data: { status: "RUNNING" } });
      await prisma.importJob.update({
        where: { id: jobId },
        data: { status: "ERROR", errorMessage: "Interrupted by server restart" },
      });

      const start = await request(app).post(`/api/admin/import-queue/jobs/${jobId}/start`).set(auth(admin));
      expect(start.status).toBe(202);
      const finished = await waitStatus(jobId, "DONE");
      expect(finished.imported).toBe(2);
      expect(finished.errorMessage).toBeNull();
      expect((await items(jobId)).map((item) => item.status)).toEqual(["DONE", "DONE"]);
    });

    it("lets a retry finish a job a restart cut off, too, though none of its links failed", async () => {
      const res = await queue(member, { url: modelUrl(base + 88) });
      await queue(member, { url: modelUrl(base + 89) });
      const jobId = res.body.job_id;
      const [first] = await items(jobId);
      await prisma.importJobItem.update({ where: { id: first.id }, data: { status: "RUNNING" } });
      await prisma.importJob.update({ where: { id: jobId }, data: { status: "ERROR" } });

      const retry = await request(app).post(`/api/admin/import-queue/jobs/${jobId}/retry`).set(auth(admin));
      expect(retry.status).toBe(202);
      const finished = await waitFor(
        () => job(jobId),
        (j) => j.status === "DONE" && j.imported === 2,
      );
      expect(finished.failedCount).toBe(0);
    });

    it("still won't start or retry a finished job with nothing left", async () => {
      const res = await queue(member, { url: modelUrl(base + 79) });
      const jobId = res.body.job_id;
      await request(app).post(`/api/admin/import-queue/jobs/${jobId}/start`).set(auth(admin));
      await waitStatus(jobId, "DONE");
      await waitFor(
        async () => (await request(app).get("/api/admin/import-queue").set(auth(admin))).body,
        (body) => !body.jobs.some((j: { runner_live: boolean }) => j.runner_live),
      );
      expect((await request(app).post(`/api/admin/import-queue/jobs/${jobId}/start`).set(auth(admin))).status).toBe(
        400,
      );
      expect((await request(app).post(`/api/admin/import-queue/jobs/${jobId}/retry`).set(auth(admin))).status).toBe(
        400,
      );
    });

    it("retries just the failed links of a job", async () => {
      gone.add(String(base + 81));
      await queue(member, { url: modelUrl(base + 80) });
      const res = await queue(member, { url: modelUrl(base + 81) });
      await request(app).post(`/api/admin/import-queue/jobs/${res.body.job_id}/start`).set(auth(admin));
      const first = await waitStatus(res.body.job_id, "DONE");
      expect(first.failedCount).toBe(1);

      gone.clear();
      const retry = await request(app).post(`/api/admin/import-queue/jobs/${res.body.job_id}/retry`).set(auth(admin));
      expect(retry.status).toBe(202);
      const second = await waitFor(
        () => job(res.body.job_id),
        (j) => j.status === "DONE" && j.failedCount === 0,
      );
      expect(second.imported).toBe(2);
      expect(designCalls.get(String(base + 80))).toBe(1);
    });

    it("retries a CAPTCHA'd link for real once someone solved the puzzle, instead of failing it on the cooloff", async () => {
      challenged.add(String(base + 83));
      const res = await queue(member, { url: modelUrl(base + 83) });
      await request(app).post(`/api/admin/import-queue/jobs/${res.body.job_id}/start`).set(auth(admin));
      const first = await waitStatus(res.body.job_id, "DONE");
      expect(first.failedCount).toBe(1);
      expect(makerworldCaptchaCooloffActive()).toBe(true);

      // Solved in the browser: the cooloff is still on, but the retry has to ask MakerWorld again.
      challenged.clear();
      const callsBefore = designCalls.get(String(base + 83)) ?? 0;
      await request(app).post(`/api/admin/import-queue/jobs/${res.body.job_id}/retry`).set(auth(admin));
      const second = await waitFor(
        () => job(res.body.job_id),
        (j) => j.status === "DONE" && j.failedCount === 0,
      );
      expect(second.imported).toBe(1);
      expect(designCalls.get(String(base + 83))).toBeGreaterThan(callsBefore);
    });

    it("imports a model whose title talks about robots instead of calling it a CAPTCHA", async () => {
      const res = await queue(member, { url: modelUrl(base + 84) });
      const realFetch = global.fetch;
      global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const response = await realFetch(input, init);
        if (!String(input).includes(`/design-service/design/${base + 84}`)) return response;
        return json({ ...(await response.json()), title: "Robot vacuum dock", summary: "<p>Not a robot.</p>" });
      }) as typeof fetch;
      await request(app).post(`/api/admin/import-queue/jobs/${res.body.job_id}/start`).set(auth(admin));
      const finished = await waitStatus(res.body.job_id, "DONE");
      expect(finished.failedCount).toBe(0);
      expect(finished.imported).toBe(1);
      expect(makerworldCaptchaCooloffActive()).toBe(false);
    });

    it("retries a finished job right away, while its runner is still writing the notification", async () => {
      gone.add(String(base + 85));
      const res = await queue(member, { url: modelUrl(base + 85) });
      const jobId = res.body.job_id;
      notifyDelay.ms = 500;
      await request(app).post(`/api/admin/import-queue/jobs/${jobId}/start`).set(auth(admin));
      // Poll the DB directly, so the retry lands as soon as the job reads DONE.
      await waitFor(
        () => job(jobId),
        (j) => j.status === "DONE",
      );
      expect(
        (await request(app).get("/api/admin/import-queue").set(auth(admin))).body.jobs.find(
          (j: { id: string }) => j.id === jobId,
        ).runner_live,
      ).toBe(true);
      notifyDelay.ms = 0;
      gone.clear();
      const retry = await request(app).post(`/api/admin/import-queue/jobs/${jobId}/retry`).set(auth(admin));
      expect(retry.status).toBe(202);
      const finished = await waitFor(
        () => job(jobId),
        (j) => j.status === "DONE" && j.failedCount === 0,
      );
      expect(finished.imported).toBe(1);
    });

    it("start all runs every paused queue, one job at a time across users", async () => {
      const a = await queue(member, { url: modelUrl(base + 90) });
      await queue(member, { url: modelUrl(base + 91) });
      const b = await queue(other, { url: modelUrl(base + 92) });
      const c = await queue(admin, { url: modelUrl(base + 93) });

      const res = await request(app).post("/api/admin/import-queue/start-all").set(auth(admin));
      expect(res.status).toBe(202);
      expect(res.body.queued).toBe(3);
      // Pressing it again while it runs doesn't queue the same jobs twice.
      expect((await request(app).post("/api/admin/import-queue/start-all").set(auth(admin))).body.queued).toBe(0);

      for (const id of [a.body.job_id, b.body.job_id, c.body.job_id]) await waitStatus(id, "DONE");
      expect(maxInFlight).toBe(1);
      expect(await prisma.print.count({ where: { userId: other.id, sourceExternalId: String(base + 92) } })).toBe(1);
      const listed = await waitFor(
        async () => (await request(app).get("/api/admin/import-queue").set(auth(admin))).body,
        (body) => !body.bulk.running,
      );
      expect(listed.bulk).toMatchObject({ running: false, remaining: 0 });
    });

    it("retry all failed reruns the failed links of every finished job", async () => {
      gone.add(String(base + 100));
      gone.add(String(base + 101));
      const a = await queue(member, { url: modelUrl(base + 100) });
      const b = await queue(other, { url: modelUrl(base + 101) });
      await request(app).post("/api/admin/import-queue/start-all").set(auth(admin));
      for (const id of [a.body.job_id, b.body.job_id]) await waitStatus(id, "DONE");
      await waitFor(
        async () => (await request(app).get("/api/admin/import-queue").set(auth(admin))).body,
        (body) => !body.bulk.running,
      );

      gone.clear();
      const res = await request(app).post("/api/admin/import-queue/retry-failed").set(auth(admin));
      expect(res.body.queued).toBe(2);
      for (const id of [a.body.job_id, b.body.job_id]) {
        const finished = await waitFor(
          () => job(id),
          (j) => j.status === "DONE" && j.failedCount === 0,
        );
        expect(finished.imported).toBe(1);
      }
    });

    it("pause all stops a bulk run before its next job", async () => {
      const release = gate(String(base + 110));
      const a = await queue(member, { url: modelUrl(base + 110) });
      const b = await queue(other, { url: modelUrl(base + 111) });
      await request(app).post("/api/admin/import-queue/start-all").set(auth(admin));
      await waitFor(
        async () => designCalls.get(String(base + 110)) ?? 0,
        (n) => n > 0,
      );

      const res = await request(app).post("/api/admin/import-queue/pause-all").set(auth(admin));
      expect(res.body.paused).toBe(1);
      release();
      await waitFor(
        async () => (await request(app).get("/api/admin/import-queue").set(auth(admin))).body,
        (body) => !body.bulk.running && !body.jobs.some((j: { runner_live: boolean }) => j.runner_live),
      );
      // The link that was importing finishes; the job stays paused and the next one never starts.
      expect((await job(a.body.job_id)).status).toBe("DONE");
      expect((await job(b.body.job_id)).status).toBe("PAUSED");
      expect(designCalls.get(String(base + 111))).toBeUndefined();
    });

    it("removes a waiting link, and the job with its last one", async () => {
      await queue(member, { url: modelUrl(base + 120) });
      const res = await queue(member, { url: modelUrl(base + 121) });
      const jobId = res.body.job_id;
      const [first, second] = await items(jobId);

      const removed = await request(app).delete(`/api/admin/import-queue/items/${first.id}`).set(auth(admin));
      expect(removed.body).toEqual({ jobDeleted: false });
      expect((await job(jobId)).total).toBe(1);
      const notificationsBefore = await prisma.notification.count({ where: { userId: member.id } });

      const last = await request(app).delete(`/api/admin/import-queue/items/${second.id}`).set(auth(admin));
      expect(last.body).toEqual({ jobDeleted: true });
      expect(await prisma.importJob.findUnique({ where: { id: jobId } })).toBeNull();
      // Deleting the queue leaves notifications alone.
      expect(await prisma.notification.count({ where: { userId: member.id } })).toBe(notificationsBefore);
      expect((await request(app).delete(`/api/admin/import-queue/items/${second.id}`).set(auth(admin))).status).toBe(
        404,
      );
    });

    it("won't remove links or delete a job while it runs", async () => {
      const release = gate(String(base + 130));
      await queue(member, { url: modelUrl(base + 130) });
      const res = await queue(member, { url: modelUrl(base + 131) });
      const jobId = res.body.job_id;
      await request(app).post(`/api/admin/import-queue/jobs/${jobId}/start`).set(auth(admin));
      await waitFor(
        async () => designCalls.get(String(base + 130)) ?? 0,
        (n) => n > 0,
      );

      const [, waiting] = await items(jobId);
      expect((await request(app).delete(`/api/admin/import-queue/items/${waiting.id}`).set(auth(admin))).status).toBe(
        409,
      );
      expect((await request(app).delete(`/api/admin/import-queue/jobs/${jobId}`).set(auth(admin))).status).toBe(409);
      release();
      await waitStatus(jobId, "DONE");
      expect((await request(app).delete(`/api/admin/import-queue/jobs/${jobId}`).set(auth(admin))).status).toBe(200);
      expect(await prisma.importJobItem.count({ where: { jobId } })).toBe(0);
    });

    it("clears finished jobs but keeps ones with failed links to retry", async () => {
      gone.add(String(base + 141));
      const clean = await queue(member, { url: modelUrl(base + 140) });
      const failing = await queue(other, { url: modelUrl(base + 141) });
      const waiting = await queue(admin, { url: modelUrl(base + 142) });
      await request(app).post(`/api/admin/import-queue/jobs/${clean.body.job_id}/start`).set(auth(admin));
      await request(app).post(`/api/admin/import-queue/jobs/${failing.body.job_id}/start`).set(auth(admin));
      await waitStatus(clean.body.job_id, "DONE");
      await waitStatus(failing.body.job_id, "DONE");

      const res = await request(app).post("/api/admin/import-queue/clear-finished").set(auth(admin));
      expect(res.body.deleted).toBeGreaterThanOrEqual(1);
      expect(await prisma.importJob.findUnique({ where: { id: clean.body.job_id } })).toBeNull();
      expect(await prisma.importJob.findUnique({ where: { id: failing.body.job_id } })).not.toBeNull();
      expect(await prisma.importJob.findUnique({ where: { id: waiting.body.job_id } })).not.toBeNull();
    });

    it("only starts, pauses or retries link-list jobs", async () => {
      const zip = await prisma.importJob.create({
        data: { userId: member.id, type: "ZIP", status: "DONE", sourceUrl: "https://example.com/a.zip" },
      });
      try {
        for (const action of ["start", "retry", "pause"]) {
          const res = await request(app).post(`/api/admin/import-queue/jobs/${zip.id}/${action}`).set(auth(admin));
          expect(res.status).toBe(400);
        }
        expect((await request(app).post("/api/admin/import-queue/jobs/nope/start").set(auth(admin))).status).toBe(404);
      } finally {
        await prisma.importJob.delete({ where: { id: zip.id } });
      }
    });
  });
});
