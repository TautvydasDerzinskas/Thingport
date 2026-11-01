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
import { setUserMakerworldCookie } from "../src/providers/makerworld/session";
import { PROVIDERS } from "../src/providers/registry";
import { mustRunNow } from "../src/routes/importRequest";
import { createCaptcha } from "../src/services/captchaService";
import { isRunnerLive, SYNC_JOB_INTERRUPTED, trackRunner } from "../src/services/importJobRunner";
import { personKey } from "../src/services/importQueueService";
import { holdImportWorker, importWorkerIdle, resumeImportWorker } from "../src/services/importWorker";
import { setProviderEnabled } from "../src/services/providerSettingsService";
import { getCaptchaSettings, setCaptchaSettings } from "../src/services/settingsService";

const app = createApp();
const stamp = Date.now();
const base = (stamp % 1_000_000_000) + 7000;
const originalFetch = global.fetch;

type Account = { id: string; token: string };
let alice: Account;
let bob: Account;
let admin: Account;

const auth = (account: Account) => ({ Authorization: `Bearer ${account.token}` });
const get = (account: Account, path: string) => request(app).get(`/api${path}`).set(auth(account));
const post = (account: Account, path: string, body: object = {}) =>
  request(app).post(`/api${path}`).set(auth(account)).send(body);

async function register(label: string, role: "ADMIN" | "MEMBER" = "MEMBER"): Promise<Account> {
  const email = `queue-routes-${label}-${stamp}@example.com`;
  const res = await request(app)
    .post("/api/register")
    .send({ displayName: `Private ${label}`, email, password: "password123" });
  if (res.status !== 200) throw new Error(`register ${label}: ${res.status} ${JSON.stringify(res.body)}`);
  await prisma.user.update({ where: { id: res.body.user.id }, data: { role } });
  const login = await request(app).post("/api/login").send({ email, password: "password123" });
  return { id: res.body.user.id, token: login.body.token };
}

const modelUrl = (id: number | string) => `https://makerworld.com/en/models/${id}-phoenix`;
const LIST_URL = "https://makerworld.com/en/collections/987-flock";
const ZIP_URL = "https://example.com/pack.zip";
const SIGNED_ZIP_URL = `${ZIP_URL}?X-Amz-Signature=abc`;

// Everything that can join the line, by every path to it.
const SUBMITS = [
  ["a link", "/import", { url: modelUrl(base) }, "LINKS"],
  ["a list of links", "/import/links", { urls: [modelUrl(base), modelUrl(base + 1)] }, "LINKS"],
  ["a zip", "/import/zip", { url: ZIP_URL, entries: ["hull.stl"] }, "ZIP"],
  ["a provider's list", "/import/makerworld/list", { url: LIST_URL, model_ids: ["1", "2"] }, "COLLECTION"],
  ["a list by its older path", "/import/collection", { url: LIST_URL, design_ids: ["1", "2"] }, "COLLECTION"],
  ["print profiles", "/import/makerworld/profiles", { url: modelUrl(base), scope: "all" }, "PROFILES"],
  ["profiles by their older path", "/import/makerworld-profiles", { url: modelUrl(base), scope: "all" }, "PROFILES"],
] as const;
// A batch has a job and the lock that goes with it even without the line, unlike one link.
const BATCHES = SUBMITS.slice(1);

// What was fetched, a gate per design id that holds its fetch, and designs that have gone.
let fetched: string[] = [];
const gates = new Map<string, { held: Promise<void>; release: () => void }>();
const gone = new Set<string>();
let zipFile: Buffer;

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}

const DESIGNER = { uid: 1692606088, name: "Deus Cat" };

function mockFetch() {
  global.fetch = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
    const url = String(input);
    fetched.push(url);
    const model = url.match(/^https:\/\/api\.bambulab\.com\/v1\/design-service\/design\/(\d+)/);
    if (model) {
      const id = model[1];
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
        instances: [{ id: 2, profileId: 102, title: "multi-colored version", instanceCreator: DESIGNER }],
      });
    }
    if (/\/iot-service\/api\/user\/profile\/\d+/.test(url)) {
      return json({ message: "success", url: "https://s3.example.com/phoenix.stl", filename: "phoenix.stl" });
    }
    if (/\/design-service\/favorites\/\d+$/.test(url)) return json({ title: "Flock" });
    if (url.startsWith(ZIP_URL)) {
      return new Response(new Uint8Array(zipFile), { headers: { "content-type": "application/zip" } });
    }
    if (url.startsWith("https://makerworld.com/en/models/")) {
      return new Response("<html><head><title>A page</title></head></html>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (url.endsWith(".stl")) {
      return new Response(`solid ${url}\nendsolid\n`, { headers: { "content-type": "application/octet-stream" } });
    }
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

const until = (check: () => boolean | Promise<boolean>) =>
  vi.waitFor(async () => expect(await check()).toBe(true), { timeout: 15_000, interval: 10 });
const reload = (id: string) => prisma.importJob.findUniqueOrThrow({ where: { id } });
const itemsOf = (jobId: string) =>
  prisma.importJobItem.findMany({ where: { jobId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
const jobsOf = (account: Account) => prisma.importJob.findMany({ where: { userId: account.id } });

/** A row as a route or a run leaves it, on hold unless told. `items`: its links, by status. */
async function row(
  account: Account,
  data: Partial<Prisma.ImportJobUncheckedCreateInput> = {},
  items: ("PENDING" | "RUNNING" | "DONE" | "FAILED")[] = ["PENDING"],
): Promise<ImportJob> {
  const job = await prisma.importJob.create({
    data: {
      userId: account.id,
      type: "LINKS",
      status: "PAUSED",
      sourceUrl: `https://example.com/private-${account.id}.stl`,
      total: items.length,
      payload: { notes: null, tags: [], category_id: null, scope: "url" },
      ...data,
    },
  });
  for (const [index, status] of items.entries()) {
    await prisma.importJobItem.create({
      data: { jobId: job.id, url: `https://example.com/private-${job.id}-${index}.stl`, status },
    });
  }
  return job;
}

async function syncedRow(account: Account, data: Partial<Prisma.ImportJobUncheckedCreateInput>): Promise<ImportJob> {
  const collection = await prisma.collection.create({
    data: { userId: account.id, name: `Synced ${stamp}`, nameNormalized: `synced ${stamp} ${Math.random()}` },
  });
  const sync = await prisma.collectionSync.create({
    data: {
      userId: account.id,
      collectionId: collection.id,
      provider: "makerworld",
      externalId: `${stamp}-${Math.random()}`,
      sourceUrl: LIST_URL,
    },
  });
  return row(account, { collectionSyncId: sync.id, ...data });
}

describe("the import queue's routes", () => {
  beforeAll(async () => {
    alice = await register("alice");
    bob = await register("bob");
    admin = await register("admin", "ADMIN");
    // The sign-in a job reads when it runs. It's never in what the job stores.
    for (const account of [alice, bob]) await setUserMakerworldCookie(account.id, "token=test-bearer");
    const zip = new JSZip();
    zip.file("hull.stl", "solid hull endsolid");
    zipFile = await zip.generateAsync({ type: "nodebuffer" });
    // Another file's leftovers mustn't run under this file's fetch, or take a place in line.
    await prisma.importJob.updateMany({ where: { status: "QUEUED" }, data: { status: "PAUSED" } });
    mockFetch();
  });

  // What's in line stays in line, unless a test opens the gate.
  beforeEach(() => {
    holdImportWorker();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await prisma.importJob.updateMany({ where: { status: "QUEUED" }, data: { status: "PAUSED" } });
    resumeImportWorker();
    for (const { release } of gates.values()) release();
    gates.clear();
    await importWorkerIdle();
    const everyone = { in: [alice.id, bob.id, admin.id] };
    await until(async () => {
      const left = await prisma.importJob.findMany({ where: { userId: everyone }, select: { id: true } });
      return !left.some((job) => isRunnerLive(job.id));
    });
    await prisma.importJob.deleteMany({ where: { userId: everyone } });
    await prisma.print.deleteMany({ where: { userId: everyone } });
    await prisma.notification.deleteMany({ where: { userId: everyone } });
    await prisma.user.updateMany({ where: { id: everyone }, data: { startGrabLinks: false } });
    global.fetch = originalFetch;
    mockFetch();
    fetched = [];
    gone.clear();
  });

  afterAll(async () => {
    global.fetch = originalFetch;
    await prisma.user.deleteMany({ where: { id: { in: [alice.id, bob.id, admin.id] } } });
  });

  describe("what can't wait in the line", () => {
    it.each([
      ["a cookie", { makerworld_cookie: "token=browser" }],
      ["a resolved link", { resolved_download_url: "https://example.com/hull.stl" }],
      ["a resolved profile", { resolved_instance_id: "42" }],
      ["resolved files", { resolved_files: [{ url: "https://example.com/hull.stl", name: "hull.stl" }] }],
      ["the page's design", { makerworld_design: { id: 1 } }],
      ["a run its client drives", { notify: false }],
      ["an S3 link", { url: "https://b.s3.amazonaws.com/a.zip?X-Amz-Signature=abc&X-Amz-Date=1" }],
      ["a Google link", { url: "https://storage.googleapis.com/a.zip?x-goog-signature=abc" }],
      ["a link with a signature", { url: "https://cdn.example.com/a.zip?Signature=abc" }],
      ["a link that expires", { url: "https://cdn.example.com/a.zip?expires=1" }],
      ["a signed link with no scheme", { url: "cdn.example.com/a.zip?Expires=1" }],
      [
        "a signed link late in a list",
        { urls: ["https://example.com/a.stl", " https://example.com/b.stl?Expires=1 "] },
      ],
    ])("runs now with %s", (_label, body) => {
      expect(mustRunNow(body)).toBe(true);
    });

    it.each([
      ["nothing", {}],
      ["a plain link", { url: "https://example.com/a.stl?size=large&signature_style=round" }],
      ["plain links", { urls: ["https://example.com/a.stl", "https://example.com/b.stl"] }],
      ["a blank cookie", { makerworld_cookie: "  " }],
      ["empty fields", { makerworld_cookie: null, resolved_download_url: null, resolved_files: [] }],
      ["no design", { makerworld_design: null }],
      ["a notification wanted", { notify: true }],
      ["what isn't a link", { url: "http://[not a link" }],
    ])("can wait with %s", (_label, body) => {
      expect(mustRunNow(body)).toBe(false);
    });
  });

  describe("asking for the line", () => {
    it.each(SUBMITS)("answers 202 and a place for %s, fetching nothing", async (_label, path, body, type) => {
      const first = await post(alice, `${path}?queue=1`, body);
      expect(first.status).toBe(202);
      // Never `queued`, which means a list waiting for Grab.
      expect(first.body).toEqual({ job_id: expect.any(String), status: "QUEUED", position: 1 });
      const job = await reload(first.body.job_id);
      expect(job).toMatchObject({ userId: alice.id, type, status: "QUEUED" });
      expect(job.queuedAt).not.toBeNull();

      const second = await post(bob, `${path}?queue=1`, body);
      expect(second.body.position).toBe(2);
      expect(fetched).toEqual([]);
    });

    it("doesn't care what else its owner has running", async () => {
      await row(alice, { status: "RUNNING" });
      for (const [, path, body] of BATCHES) {
        expect((await post(alice, `${path}?queue=1`, body)).status).toBe(202);
      }
    });

    it("makes one link a job of one link, keeping what it was asked to call it", async () => {
      const category = await prisma.category.create({ data: { userId: alice.id, name: `Line ${stamp}` } });
      const res = await post(alice, "/import?queue=1", {
        url: modelUrl(base),
        title: "Called this",
        filename: "called.stl",
        notes: "A note",
        tags: ["mine"],
        category_id: category.id,
      });
      expect(res.status).toBe(202);
      const job = await reload(res.body.job_id);
      expect(job).toMatchObject({
        type: "LINKS",
        provider: "makerworld",
        sourceUrl: modelUrl(base),
        sourceLabel: "Called this",
        total: 1,
      });
      expect(job.payload).toEqual({
        title: "Called this",
        filename: "called.stl",
        notes: "A note",
        tags: ["mine"],
        category_id: category.id,
        scope: "url",
        single: true,
      });
      expect((await itemsOf(job.id)).map((item) => item.url)).toEqual([modelUrl(base)]);
      await prisma.category.delete({ where: { id: category.id } });
    });

    it("answers with the job already waiting for the same link", async () => {
      const first = await post(alice, "/import?queue=1", { url: modelUrl(base) });
      await post(bob, "/import?queue=1", { url: modelUrl(base) });
      const again = await post(alice, "/import?queue=1", { url: ` ${modelUrl(base)} ` });
      expect(again.status).toBe(202);
      expect(again.body).toEqual({ job_id: first.body.job_id, status: "QUEUED", position: 1 });
      expect(await jobsOf(alice)).toHaveLength(1);

      const other = await post(alice, "/import?queue=1", { url: modelUrl(base + 1) });
      expect(other.body.job_id).not.toBe(first.body.job_id);
      expect(other.body.position).toBe(3);
    });

    it("refuses at once what a single link has always been refused for, leaving nothing behind", async () => {
      const send = (body: object) => post(alice, "/import?queue=1", body);
      expect((await send({ url: "http://127.0.0.1/hull.stl" })).body.detail).toMatch(/local addresses/i);
      expect((await send({ title: "No link" })).status).toBe(400);
      const foreign = await prisma.category.create({ data: { userId: bob.id, name: `Theirs ${stamp}` } });
      const notMine = await send({ url: modelUrl(base), category_id: foreign.id });
      expect(notMine.status).toBe(404);
      expect(notMine.body.detail).toBe("Category not found");
      await prisma.category.delete({ where: { id: foreign.id } });

      await setProviderEnabled("makerworld", false);
      try {
        const off = await send({ url: modelUrl(base) });
        expect(off.status).toBe(403);
        expect(off.body.code).toBe("provider_disabled");
      } finally {
        await setProviderEnabled("makerworld", true);
      }
      expect(await jobsOf(alice)).toEqual([]);
    });

    it("keeps a list of links in order, once each, and notes a provider only when they share one", async () => {
      const urls = [modelUrl(base + 2), modelUrl(base + 1), modelUrl(base + 2), modelUrl(base + 3)];
      const res = await post(alice, "/import/links?queue=1", { urls, scope: "all", notes: "A note", tags: ["mine"] });
      const job = await reload(res.body.job_id);
      expect(job).toMatchObject({ provider: "makerworld", total: 3, sourceUrl: urls[0] });
      expect(job.payload).toMatchObject({ scope: "all", notes: "A note", tags: ["mine"] });
      expect((await itemsOf(job.id)).map((item) => item.url)).toEqual([urls[0], urls[1], urls[3]]);

      const mixed = await post(alice, "/import/links?queue=1", { urls: [modelUrl(base), "https://example.com/a.stl"] });
      expect((await reload(mixed.body.job_id)).provider).toBeNull();
      const scoped = (await reload(mixed.body.job_id)).payload as Record<string, unknown>;
      expect(scoped.scope).toBe("url");
    });

    it("refuses a whole list over one link", async () => {
      const urls = [modelUrl(base), "http://127.0.0.1/hull.stl"];
      expect((await post(alice, "/import/links?queue=1", { urls })).status).toBe(400);
      expect((await post(alice, "/import/links?queue=1", { urls: [modelUrl(base), " "] })).status).toBe(400);
      expect((await post(alice, "/import/links?queue=1", { urls: [] })).status).toBe(400);
      expect(await jobsOf(alice)).toEqual([]);
    });

    it("keeps a zip's request, and refuses one with nothing picked", async () => {
      const res = await post(alice, "/import/zip?queue=1", {
        url: ZIP_URL,
        entries: ["hull.stl", "mast.stl"],
        title: "A boat",
      });
      const job = await reload(res.body.job_id);
      expect(job).toMatchObject({ type: "ZIP", total: 2, sourceUrl: ZIP_URL });
      expect(job.payload).toMatchObject({ entries: ["hull.stl", "mast.stl"], title: "A boat" });

      expect((await post(alice, "/import/zip?queue=1", { url: ZIP_URL, entries: [] })).status).toBe(400);
      expect((await post(alice, "/import/zip?queue=1", { url: "http://127.0.0.1/a.zip", entries: ["a"] })).status).toBe(
        400,
      );
      expect((await post(alice, "/import/zip?queue=1", { url: ZIP_URL })).status).toBe(400);
    });

    it("keeps a list's request without reading the list, named by what the client read", async () => {
      const start = vi.spyOn(PROVIDERS.makerworld.lists!, "start");
      const res = await post(alice, "/import/makerworld/list?queue=1", {
        url: LIST_URL,
        model_ids: ["1", "2", "3"],
        collection_title: "Flock",
      });
      expect(res.status).toBe(202);
      const job = await reload(res.body.job_id);
      expect(job).toMatchObject({
        type: "COLLECTION",
        provider: "makerworld",
        total: 3,
        sourceLabel: "Flock",
        sourceUrl: LIST_URL,
      });
      expect(job.payload).toMatchObject({ model_ids: ["1", "2", "3"], collection_title: "Flock" });
      expect(start).not.toHaveBeenCalled();
    });

    it("takes a list's ids by its older path's name for them", async () => {
      const res = await post(alice, "/import/collection?queue=1", { url: LIST_URL, design_ids: ["7", "8"] });
      expect((await reload(res.body.job_id)).payload).toMatchObject({ model_ids: ["7", "8"] });
      expect((await post(alice, "/import/collection?queue=1", { url: LIST_URL, model_ids: ["7"] })).status).toBe(400);
    });

    it("validates a list as it always has", async () => {
      const send = (path: string, body: object) => post(alice, `${path}?queue=1`, body);
      const good = { url: LIST_URL, model_ids: ["1"] };
      expect((await send("/import/nobody/list", good)).status).toBe(404);
      expect((await send("/import/owlcad/list", good)).status).toBe(404);
      expect((await send("/import/printables/list", good)).status).toBe(400);
      expect((await send("/import/makerworld/list", { url: modelUrl(base), model_ids: ["1"] })).status).toBe(400);
      expect((await send("/import/makerworld/list", { url: LIST_URL, model_ids: [] })).status).toBe(400);
      expect(
        (await send("/import/thangs/list", { url: "https://thangs.com/designer/x/collections/1", model_ids: ["x"] }))
          .status,
      ).toBe(400);
      expect(await jobsOf(alice)).toEqual([]);
    });

    it("keeps print profiles' request, and validates it as it always has", async () => {
      const res = await post(alice, "/import/makerworld/profiles?queue=1", { url: modelUrl(base), scope: "designer" });
      const job = await reload(res.body.job_id);
      expect(job).toMatchObject({ type: "PROFILES", provider: "makerworld", sourceUrl: modelUrl(base) });
      expect(job.payload).toMatchObject({ scope: "designer" });

      const send = (path: string, body: object) => post(alice, `${path}?queue=1`, body);
      expect((await send("/import/makerworld/profiles", { url: modelUrl(base) })).status).toBe(400);
      expect((await send("/import/makerworld/profiles", { url: LIST_URL, scope: "all" })).status).toBe(400);
      expect((await send("/import/nobody/profiles", { url: modelUrl(base), scope: "all" })).status).toBe(404);
      expect((await send("/import/thingiverse/profiles", { url: modelUrl(base), scope: "all" })).status).toBe(404);
      expect(await jobsOf(alice)).toHaveLength(1);
    });

    it("leaves a list that waits for Grab as it was: no job", async () => {
      const url = "https://www.makeronline.com/en/user/collectionDetail/owner/599628.html";
      vi.spyOn(PROVIDERS.makeronline.lists!, "start").mockResolvedValue({ waitForGrab: { title: "A list" } });
      const queueList = vi
        .spyOn(PROVIDERS.makeronline.grabQueue!, "queueList")
        .mockResolvedValue({ queued: 2, collectionId: "c1" });
      const res = await post(alice, "/import/makeronline/list?queue=1", { url, model_ids: ["1", "2"] });
      expect(res.status).toBe(202);
      expect(res.body).toEqual({ queued: 2, collection_id: "c1" });
      expect(queueList).toHaveBeenCalledOnce();
      expect(await jobsOf(alice)).toEqual([]);
    });

    it("keeps nothing it shouldn't, however much the request brings", async () => {
      const extra = {
        captcha_id: "secret",
        captcha_answer: "secret",
        cookie: "secret",
        token: "secret",
        unknown_key: "secret",
      };
      for (const [, path, body] of SUBMITS) {
        const res = await post(alice, `${path}?queue=1`, { ...body, ...extra });
        expect(res.status).toBe(202);
        const job = await prisma.importJob.findUniqueOrThrow({
          where: { id: res.body.job_id },
          include: { items: true },
        });
        const stored = JSON.stringify(job);
        // Not what it was sent, nor the sign-in it runs with.
        expect(stored).not.toContain("secret");
        expect(stored).not.toContain("test-bearer");
      }
    });

    it("goes by the request's own session, not the one saved, and keeps none from the old way either", async () => {
      // Alice has a saved cookie, and that alone doesn't make her imports run now.
      const inLine = await post(alice, "/import/links?queue=1", { urls: [modelUrl(base)] });
      expect(inLine.body.status).toBe("QUEUED");

      const direct = await post(alice, "/import/links?queue=1", {
        urls: [modelUrl(base + 1)],
        makerworld_cookie: "token=from-the-browser",
      });
      expect(direct.status).toBe(202);
      expect(direct.body).toEqual({ job_id: expect.any(String) });
      await until(async () => (await reload(direct.body.job_id)).status !== "RUNNING");
      const job = await reload(direct.body.job_id);
      expect(job.queuedAt).toBeNull();
      expect(JSON.stringify(job.payload)).not.toContain("from-the-browser");
    });
  });

  describe("not asking, or having to run now", () => {
    const anyRunning = () => row(alice, { status: "RUNNING" });

    it.each(BATCHES)("%s keeps its lock without ?queue=1", async (_label, path, body) => {
      await anyRunning();
      const res = await post(alice, path, body);
      expect(res.status).toBe(409);
      expect(res.body.detail).toBe("An import is already in progress");
      expect(await jobsOf(alice)).toHaveLength(1);
    });

    it.each(BATCHES)("%s takes the same path with ?queue=1 when it can't wait", async (_label, path, body) => {
      await anyRunning();
      for (const brought of [
        { makerworld_cookie: "token=browser" },
        { resolved_download_url: "https://example.com/hull.stl" },
        { makerworld_design: { id: 1 } },
        { notify: false },
      ]) {
        const res = await post(alice, `${path}?queue=1`, { ...body, ...brought });
        expect(res.status).toBe(409);
      }
      expect(await jobsOf(alice)).toHaveLength(1);
    });

    it("sees a signed link wherever it is", async () => {
      await anyRunning();
      const zip = await post(alice, "/import/zip?queue=1", { url: SIGNED_ZIP_URL, entries: ["hull.stl"] });
      expect(zip.status).toBe(409);
      const links = await post(alice, "/import/links?queue=1", { urls: [modelUrl(base), SIGNED_ZIP_URL] });
      expect(links.status).toBe(409);
      expect(await jobsOf(alice)).toHaveLength(1);
    });

    it("answers a job that runs by itself as it always has, the gate shut or not", async () => {
      const res = await post(alice, "/import/zip", { url: ZIP_URL, entries: ["hull.stl"] });
      expect(res.status).toBe(202);
      expect(res.body).toEqual({ job_id: expect.any(String) });
      await until(async () => (await reload(res.body.job_id)).status === "DONE");
      const job = await reload(res.body.job_id);
      expect(job).toMatchObject({ imported: 1 });
      expect(job.queuedAt).toBeNull();
      expect(job.payload).toBeNull();
    });

    it("names a list running by itself as soon as it starts, if it came with a name, answering as ever", async () => {
      const release = gate(base + 30);
      const res = await post(alice, "/import/makerworld/list", {
        url: LIST_URL,
        model_ids: [String(base + 30)],
        collection_title: " Named by Grab ",
      });
      expect(res.status).toBe(202);
      expect(res.body).toEqual({ job_id: expect.any(String) });
      await until(() => fetched.some((url) => url.includes(String(base + 30))));
      const running = await get(alice, `/import/jobs/${res.body.job_id}`);
      expect(running.body).toMatchObject({ status: "RUNNING", source_label: "Named by Grab", source_url: LIST_URL });
      expect(await reload(res.body.job_id)).toMatchObject({ queuedAt: null, payload: null });

      release();
      await until(async () => (await reload(res.body.job_id)).status === "DONE");
      expect((await reload(res.body.job_id)).sourceLabel).toBe("Flock");
    });

    it("leaves a list running by itself unnamed when it came with no name", async () => {
      const release = gate(base + 31);
      const res = await post(alice, "/import/makerworld/list", {
        url: LIST_URL,
        model_ids: [String(base + 31)],
        collection_title: "  ",
      });
      await until(() => fetched.some((url) => url.includes(String(base + 31))));
      expect((await reload(res.body.job_id)).sourceLabel).toBeNull();
      release();
      await until(async () => (await reload(res.body.job_id)).status === "DONE");
    });

    it("runs a signed zip right away, past the line, with no number", async () => {
      await post(bob, "/import?queue=1", { url: modelUrl(base) });
      const res = await post(alice, "/import/zip?queue=1", { url: SIGNED_ZIP_URL, entries: ["hull.stl"] });
      expect(res.status).toBe(202);
      expect(res.body).toEqual({ job_id: expect.any(String) });
      await until(async () => (await reload(res.body.job_id)).status === "DONE");
      expect((await reload(res.body.job_id)).queuedAt).toBeNull();
    });

    it("imports one link in the request, answering the model", async () => {
      const res = await post(alice, "/import", { url: "https://example.com/hull.stl" });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: expect.any(String), import_outcome: "created" });
      expect(res.body).not.toHaveProperty("job_id");
      expect(await jobsOf(alice)).toEqual([]);
    });

    it("imports one link in the request when it can't wait, by either answer", async () => {
      const url = modelUrl(base + 4);
      const brought = { url, resolved_download_url: "https://s3.example.com/phoenix-brought.stl" };
      const res = await post(alice, "/import?queue=1", brought);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: expect.any(String), import_outcome: "created" });

      const later = await post(alice, "/import?queue=1&async=1", brought);
      expect(later.status).toBe(202);
      expect(later.body).toEqual({ task_id: expect.any(String) });
      await until(async () => {
        const task = await get(alice, `/import/tasks/${later.body.task_id}`);
        return task.body.status === "done";
      });
      expect(await jobsOf(alice)).toEqual([]);
    });

    it("runs one link with an async client's old answer when not asking", async () => {
      const res = await post(alice, "/import?async=1", { url: "https://example.com/mast.stl" });
      expect(res.status).toBe(202);
      expect(res.body).toEqual({ task_id: expect.any(String) });
      await until(async () => {
        const task = await get(alice, `/import/tasks/${res.body.task_id}`);
        return task.body.status === "done";
      });
    });
  });

  describe("what old clients read", () => {
    const OLD_JOB_KEYS = [
      "already_in_library",
      "error_message",
      "failed_count",
      "id",
      "imported",
      "processed",
      "provider",
      "result_collection_id",
      "result_print_id",
      "source_label",
      "source_url",
      "status",
      "total",
      "type",
    ];

    it("reads a waiting job as RUNNING, and the real status only for whoever asks", async () => {
      const { body } = await post(alice, "/import?queue=1", { url: modelUrl(base) });
      const masked = await get(alice, `/import/jobs/${body.job_id}`);
      expect(masked.body.status).toBe("RUNNING");
      expect(Object.keys(masked.body).toSorted()).toEqual(OLD_JOB_KEYS);
      const real = await get(alice, `/import/jobs/${body.job_id}?queue=1`);
      expect(real.body).toEqual({ ...masked.body, status: "QUEUED" });
    });

    it("hands every other status over as it is, with the job's own message", async () => {
      for (const data of [
        { status: "PAUSED", errorMessage: "Rate limited" },
        { status: "PAUSED", errorMessage: SYNC_JOB_INTERRUPTED },
        { status: "ERROR", errorMessage: SYNC_JOB_INTERRUPTED },
        { status: "DONE", errorMessage: null },
        { status: "RUNNING", errorMessage: null },
      ] as const) {
        const job = await row(alice, data);
        for (const query of ["", "?queue=1"]) {
          const res = await get(alice, `/import/jobs/${job.id}${query}`);
          expect(res.body).toMatchObject({ status: data.status, error_message: data.errorMessage });
          expect(Object.keys(res.body).toSorted()).toEqual(OLD_JOB_KEYS);
        }
        await prisma.importJob.delete({ where: { id: job.id } });
      }
    });

    it("never counts a waiting job as the active one", async () => {
      await post(alice, "/import?queue=1", { url: modelUrl(base) });
      expect((await get(alice, "/import/jobs/active")).body).toBeNull();
    });

    it("gives the active job by one rule when several run: not a sync's, and the oldest", async () => {
      const older = new Date(Date.now() - 60_000);
      await syncedRow(alice, { status: "RUNNING", createdAt: new Date(Date.now() - 120_000) });
      const oldest = await row(alice, { status: "RUNNING", createdAt: older });
      await row(alice, { status: "RUNNING" });
      for (let i = 0; i < 3; i++) {
        const active = await get(alice, "/import/jobs/active");
        expect(active.body.id).toBe(oldest.id);
        expect(active.body.status).toBe("RUNNING");
      }
    });

    it("follows a retry to its end, as a poll from before the line does", async () => {
      gone.add(String(base + 5));
      resumeImportWorker();
      const started = await post(alice, "/import/links?queue=1", { urls: [modelUrl(base + 5)] });
      await importWorkerIdle();
      expect(await reload(started.body.job_id)).toMatchObject({ status: "DONE", failedCount: 1 });

      gone.delete(String(base + 5));
      holdImportWorker();
      const retry = await post(alice, `/import/jobs/${started.body.job_id}/retry`);
      expect(retry.status).toBe(202);
      expect(retry.body).toEqual({ job_id: started.body.job_id });

      // The literal loop: anything but RUNNING is taken for its end.
      const poll = async () => {
        for (;;) {
          const { body } = await get(alice, `/import/jobs/${started.body.job_id}`);
          if (body.status !== "RUNNING") return body;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      };
      const followed = poll();
      await new Promise((resolve) => setTimeout(resolve, 100));
      resumeImportWorker();
      expect(await followed).toMatchObject({ status: "DONE", imported: 1, failed_count: 0 });
    });

    it("keeps a retry's guards: someone else's is a 404, and nothing to retry a 400", async () => {
      const job = await row(alice, { status: "DONE" }, ["DONE"]);
      expect((await post(bob, `/import/jobs/${job.id}/retry`)).status).toBe(404);
      expect((await post(alice, `/import/jobs/${job.id}/retry`)).status).toBe(400);
    });

    it("answers Grab's Add to the queue with the same keys and codes, and two more", async () => {
      const first = await post(alice, "/import/queue", { url: modelUrl(base), title: "A page" });
      expect(first.status).toBe(201);
      expect(first.body).toEqual({
        job_id: expect.any(String),
        item_id: expect.any(String),
        duplicate: false,
        waiting: 1,
        started: false,
        position: null,
      });
      expect((await reload(first.body.job_id)).status).toBe("PAUSED");

      const again = await post(alice, "/import/queue", { url: modelUrl(base) });
      expect(again.status).toBe(200);
      expect(again.body).toEqual({
        job_id: first.body.job_id,
        item_id: first.body.item_id,
        duplicate: true,
        waiting: 1,
        started: false,
        position: null,
      });

      await post(bob, "/import?queue=1", { url: modelUrl(base + 1) });
      await request(app).put("/api/import/queue/settings").set(auth(alice)).send({ start_grab_links: true });
      const started = await post(alice, "/import/queue", { url: modelUrl(base + 2) });
      expect(started.status).toBe(201);
      expect(started.body).toMatchObject({ started: true, position: 2, waiting: 1, duplicate: false });
      expect((await reload(started.body.job_id)).status).toBe("QUEUED");
    });

    it("says the instance has it, to anyone", async () => {
      const res = await request(app).get("/api/health").set("Origin", "chrome-extension://abcdefgh");
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ ok: true, grab_pairing: true, import_queue: true });
    });

    describe("Thingport Grab from before the line, with one waiting and shut", () => {
      const grab = (path: string, body: object) => post(alice, path, body).set("X-Thingport-Client", "grab");
      const pause = () => new Promise((resolve) => setTimeout(resolve, 20));

      /** Its own loops, as they were: any status but RUNNING is the end. */
      async function followJob(jobId: string) {
        const seen = new Set<string>();
        for (;;) {
          const { body } = await get(alice, `/import/jobs/${jobId}`).set("X-Thingport-Client", "grab");
          seen.add(body.status);
          if (body.status !== "RUNNING") return { job: body, seen };
          await pause();
        }
      }

      async function followTask(taskId: string) {
        for (;;) {
          const { body } = await get(alice, `/import/tasks/${taskId}`).set("X-Thingport-Client", "grab");
          if (body.status === "done") return body.result;
          if (body.status === "error") throw new Error(body.detail);
          await pause();
        }
      }

      beforeEach(async () => {
        await post(bob, "/import?queue=1", { url: modelUrl(`${base}000`) });
      });

      it("imports a link and follows its task", async () => {
        const started = await grab("/import?async=1", {
          url: modelUrl(base + 20),
          resolved_download_url: "https://s3.example.com/phoenix-grab.stl",
        });
        expect(started.status).toBe(202);
        expect(Object.keys(started.body)).toEqual(["task_id"]);
        expect(await followTask(started.body.task_id)).toMatchObject({
          id: expect.any(String),
          import_outcome: "created",
        });
      });

      it("imports a zip and follows its job to the model", async () => {
        const started = await grab("/import/zip", { url: ZIP_URL, entries: ["hull.stl"] });
        expect(started.status).toBe(202);
        expect(Object.keys(started.body)).toEqual(["job_id"]);
        const { job, seen } = await followJob(started.body.job_id);
        expect(job).toMatchObject({ status: "DONE", imported: 1, result_print_id: expect.any(String) });
        expect([...seen].every((status) => status === "RUNNING" || status === "DONE")).toBe(true);
      });

      it("imports a list by its older path and follows its job", async () => {
        const started = await grab("/import/collection", { url: LIST_URL, design_ids: [String(base + 21)] });
        expect(started.status).toBe(202);
        expect(Object.keys(started.body)).toEqual(["job_id"]);
        const { job } = await followJob(started.body.job_id);
        expect(job).toMatchObject({ status: "DONE", imported: 1, total: 1 });
      });

      it("collects links on hold, reading only what it always read", async () => {
        const added = await grab("/import/queue", { url: modelUrl(base + 22), makerworld_cookie: "token=browser" });
        expect(added.status).toBe(201);
        expect(added.body).toMatchObject({ duplicate: false, waiting: 1 });
        const job = await reload(added.body.job_id);
        expect(job.status).toBe("PAUSED");
        expect(JSON.stringify([job, await itemsOf(job.id)])).not.toContain("browser");
      });
    });
  });

  describe("someone's own queue", () => {
    const QUEUE_JOB_KEYS = [
      "already_in_library",
      "attention",
      "can_delete",
      "can_pause",
      "can_retry",
      "can_start",
      "collection_sync_id",
      "created_at",
      "done_count",
      "error_message",
      "failed_count",
      "failed_items_count",
      "failure_reason",
      "id",
      "imported",
      "link_title",
      "outcome",
      "pending_count",
      "position",
      "processed",
      "provider",
      "queued_at",
      "result_collection_id",
      "result_print_id",
      "runner_live",
      "running_count",
      "single",
      "source_label",
      "source_url",
      "started_at",
      "status",
      "sync_waiting",
      "total",
      "type",
      "updated_at",
    ];

    const ownQueue = async (account: Account) => (await get(account, "/import/queue").expect(200)).body;
    const ownJob = async (account: Account, id: string) =>
      (await ownQueue(account)).jobs.find((job: { id: string }) => job.id === id);

    it("lists what's open and what's asking for attention, and says what can be done", async () => {
      const inLine = await post(alice, "/import?queue=1", { url: modelUrl(base), title: "Wanted" });
      const held = await row(alice);
      const failed = await row(alice, { status: "DONE", failedCount: 1 }, ["DONE", "FAILED"]);
      await prisma.importJobItem.updateMany({
        where: { jobId: failed.id, status: "FAILED" },
        data: { errorMessage: "It's gone" },
      });
      const finished = await row(alice, { status: "DONE" }, ["DONE"]);
      await row(bob);

      const queue = await ownQueue(alice);
      expect(Object.keys(queue).toSorted()).toEqual(["finished_total", "jobs", "line", "settings"]);
      expect(queue.settings).toEqual({ start_grab_links: false });
      expect(queue.finished_total).toBe(1);
      expect(queue.jobs).toHaveLength(4);
      for (const job of queue.jobs) expect(Object.keys(job).toSorted()).toEqual(QUEUE_JOB_KEYS);

      const byId = (id: string) => queue.jobs.find((job: { id: string }) => job.id === id);
      expect(byId(inLine.body.job_id)).toMatchObject({
        status: "QUEUED",
        single: true,
        position: 1,
        queued_at: expect.any(String),
        started_at: null,
        pending_count: 1,
        attention: false,
        can_pause: true,
        can_delete: true,
        can_start: false,
        can_retry: false,
      });
      expect(byId(held.id)).toMatchObject({ status: "PAUSED", position: null, can_start: true, can_delete: true });
      expect(byId(failed.id)).toMatchObject({
        attention: true,
        failure_reason: "It's gone",
        can_retry: true,
        failed_items_count: 1,
        done_count: 1,
      });
      expect(byId(finished.id)).toMatchObject({ attention: false, can_retry: false, can_delete: true });
    });

    it("gives the page title of a link list's only link, and nothing for any other job", async () => {
      const grabbed = await post(alice, "/import/queue", { url: modelUrl(base), title: "A page" });
      expect(await ownJob(alice, grabbed.body.job_id)).toMatchObject({ total: 1, link_title: "A page" });

      await post(alice, "/import/queue", { url: modelUrl(base + 1), title: "Another page" });
      expect((await ownJob(alice, grabbed.body.job_id)).link_title).toBeNull();

      const untitled = await post(alice, "/import?queue=1", { url: modelUrl(base + 2) });
      expect((await ownJob(alice, untitled.body.job_id)).link_title).toBeNull();
      const named = await post(alice, "/import?queue=1", { url: modelUrl(base + 3), title: "Called this" });
      expect(await ownJob(alice, named.body.job_id)).toMatchObject({ source_label: "Called this", link_title: null });

      const zip = await post(alice, "/import/zip?queue=1", { url: ZIP_URL, entries: ["hull.stl"] });
      expect((await ownJob(alice, zip.body.job_id)).link_title).toBeNull();
    });

    it("keeps a link's page title to its owner: it's nowhere in anyone else's line", async () => {
      await post(bob, "/import/queue", { url: modelUrl(base), title: "Private page" });
      await request(app).put("/api/import/queue/settings").set(auth(bob)).send({ start_grab_links: true });
      const theirs = await post(bob, "/import/queue", { url: modelUrl(base + 1), title: "Private page" });
      expect((await ownJob(bob, theirs.body.job_id)).link_title).toBe("Private page");
      const mine = await post(alice, "/import?queue=1", { url: modelUrl(base + 2) });

      const { line } = await ownQueue(alice);
      expect(line.rows).toHaveLength(2);
      expect(line.rows[1].job_id).toBe(mine.body.job_id);
      for (const seat of line.rows)
        expect(Object.keys(seat).toSorted()).toEqual(["job_id", "mine", "person", "position"]);
      expect(JSON.stringify(await ownQueue(alice))).not.toContain("Private page");
    });

    it("shows other people as places in the line and nothing more", async () => {
      const theirs = await post(bob, "/import?queue=1", { url: modelUrl(`${base}-private`), title: "Private title" });
      const mine = await post(alice, "/import?queue=1", { url: modelUrl(base) });
      const behind = await post(bob, "/import?queue=1", { url: modelUrl(`${base}-behind`), notes: "Private note" });

      const { line, jobs } = await ownQueue(alice);
      expect(line).toEqual({
        now: null,
        rows: [
          { position: 1, mine: false, person: personKey(bob.id), job_id: null },
          { position: 2, mine: true, person: personKey(alice.id), job_id: mine.body.job_id },
        ],
        length: 3,
      });
      expect(jobs.map((job: { id: string }) => job.id)).toEqual([mine.body.job_id]);
      const seen = JSON.stringify(await ownQueue(alice));
      for (const secret of [bob.id, theirs.body.job_id, behind.body.job_id, "Private", "queue-routes-bob", "private"]) {
        expect(seen).not.toContain(secret);
      }
      // Nothing in line, nothing to show.
      expect((await ownQueue(admin)).line).toEqual({ now: null, rows: [], length: 3 });
    });

    it("never puts a sync's or a direct job in the line", async () => {
      await row(alice, { status: "RUNNING" });
      await syncedRow(alice, { status: "PAUSED", errorMessage: SYNC_JOB_INTERRUPTED });
      expect((await ownQueue(alice)).line).toEqual({ now: null, rows: [], length: 0 });
    });

    it("reads a sync job's mark as how it waits, not as a failure", async () => {
      const waiting = await syncedRow(alice, { errorMessage: SYNC_JOB_INTERRUPTED });
      const stopped = await syncedRow(alice, { errorMessage: "Rate limited" });
      const failed = await row(alice, { status: "ERROR", errorMessage: SYNC_JOB_INTERRUPTED }, []);
      expect(await ownJob(alice, waiting.id)).toMatchObject({
        status: "PAUSED",
        sync_waiting: true,
        error_message: null,
        failure_reason: null,
        collection_sync_id: waiting.collectionSyncId,
        can_start: false,
        can_pause: true,
      });
      expect(await ownJob(alice, stopped.id)).toMatchObject({ sync_waiting: false, error_message: "Rate limited" });
      expect(await ownJob(alice, failed.id)).toMatchObject({
        status: "ERROR",
        sync_waiting: false,
        error_message: SYNC_JOB_INTERRUPTED,
      });
    });

    it("keeps someone's setting to themselves", async () => {
      const put = (account: Account, body: object) =>
        request(app).put("/api/import/queue/settings").set(auth(account)).send(body);
      const saved = await put(alice, { start_grab_links: true });
      expect(saved.status).toBe(200);
      expect(saved.body).toEqual({ start_grab_links: true });
      expect((await ownQueue(alice)).settings).toEqual({ start_grab_links: true });
      expect((await ownQueue(bob)).settings).toEqual({ start_grab_links: false });
      expect((await put(alice, { start_grab_links: false })).body).toEqual({ start_grab_links: false });
      expect((await ownQueue(alice)).settings).toEqual({ start_grab_links: false });
      expect((await put(alice, {})).status).toBe(400);
      expect((await put(alice, { start_grab_links: "yes" })).status).toBe(400);
    });

    it("starts a held job at the back of the line, keeping its place on a second click", async () => {
      const ahead = await post(bob, "/import?queue=1", { url: modelUrl(base) });
      const held = await row(alice);
      const start = () => post(alice, `/import/queue/jobs/${held.id}/start`);

      const first = await start();
      expect(first.status).toBe(202);
      expect(first.body).toEqual({ job_id: held.id, status: "QUEUED", position: 2, sync_waiting: false });
      const { queuedAt } = await reload(held.id);
      await post(bob, "/import?queue=1", { url: modelUrl(base + 1) });

      const second = await start();
      expect(second.status).toBe(202);
      expect(second.body).toEqual({ job_id: held.id, status: "QUEUED", position: 2, sync_waiting: false });
      expect((await reload(held.id)).queuedAt).toEqual(queuedAt);

      await request(app).delete(`/api/import/queue/jobs/${ahead.body.job_id}`).set(auth(bob)).expect(200);
      expect((await start()).body.position).toBe(1);
    });

    it("retries by type: links and a saved request again, never a zip or an old row", async () => {
      const retry = (id: string) => post(alice, `/import/queue/jobs/${id}/retry`);
      const links = await row(alice, { status: "DONE", failedCount: 1 }, ["DONE", "FAILED"]);
      const res = await retry(links.id);
      expect(res.status).toBe(202);
      expect(res.body).toEqual({ job_id: links.id, status: "QUEUED", position: 1, sync_waiting: false });
      expect((await itemsOf(links.id)).map((item) => item.status)).toEqual(["DONE", "PENDING"]);

      const list = await row(
        alice,
        { type: "COLLECTION", status: "ERROR", provider: "makerworld", payload: { model_ids: ["1"] } },
        [],
      );
      expect((await retry(list.id)).body).toMatchObject({ status: "QUEUED", position: 2 });

      const zip = await row(alice, { type: "ZIP", status: "ERROR", payload: { entries: ["a"] } }, []);
      expect((await retry(zip.id)).status).toBe(400);
      const old = await row(alice, { type: "COLLECTION", status: "ERROR", payload: undefined }, []);
      expect((await retry(old.id)).status).toBe(400);
      const clean = await row(alice, { status: "DONE" }, ["DONE"]);
      expect((await retry(clean.id)).status).toBe(400);
    });

    it("holds what's waiting, of any type, and it takes the same to start it again", async () => {
      const zip = await post(alice, "/import/zip?queue=1", { url: ZIP_URL, entries: ["hull.stl"] });
      const next = await post(bob, "/import?queue=1", { url: modelUrl(base) });
      const hold = await post(alice, `/import/queue/jobs/${zip.body.job_id}/pause`);
      expect(hold.status).toBe(200);
      expect(hold.body).toEqual({ ok: true });
      expect((await reload(zip.body.job_id)).status).toBe("PAUSED");
      expect((await ownJob(bob, next.body.job_id)).position).toBe(1);

      const start = await post(alice, `/import/queue/jobs/${zip.body.job_id}/start`);
      expect(start.body).toMatchObject({ status: "QUEUED", position: 2 });
    });

    it("pauses a running link list, and refuses what can't stop midway", async () => {
      const running = await row(alice, { status: "RUNNING" });
      expect((await post(alice, `/import/queue/jobs/${running.id}/pause`)).body).toEqual({ ok: true });
      expect((await reload(running.id)).status).toBe("PAUSED");

      const single = await row(alice, { status: "RUNNING", payload: { single: true } });
      expect((await post(alice, `/import/queue/jobs/${single.id}/pause`)).status).toBe(400);
      const zip = await row(alice, { status: "RUNNING", type: "ZIP" }, []);
      expect((await post(alice, `/import/queue/jobs/${zip.id}/pause`)).status).toBe(400);
      const done = await row(alice, { status: "DONE" }, []);
      expect((await post(alice, `/import/queue/jobs/${done.id}/pause`)).status).toBe(400);
    });

    it("refuses to touch what's running or still finishing", async () => {
      const running = await row(alice, { status: "RUNNING" });
      const [link] = await itemsOf(running.id);
      expect((await post(alice, `/import/queue/jobs/${running.id}/start`)).status).toBe(400);
      const remove = request(app).delete(`/api/import/queue/jobs/${running.id}`).set(auth(alice));
      expect((await remove).status).toBe(409);
      const removeLink = request(app).delete(`/api/import/queue/items/${link.id}`).set(auth(alice));
      expect((await removeLink).status).toBe(409);

      const pausing = await row(alice);
      let finish!: () => void;
      const run = trackRunner(pausing.id, new Promise<void>((resolve) => (finish = resolve)));
      expect((await post(alice, `/import/queue/jobs/${pausing.id}/start`)).status).toBe(409);
      expect(await ownJob(alice, pausing.id)).toMatchObject({
        status: "PAUSED",
        runner_live: true,
        can_start: false,
        can_delete: false,
      });
      finish();
      await run;
    });

    it("deletes a job, and a link, and the job with its last link", async () => {
      const del = (path: string) => request(app).delete(`/api${path}`).set(auth(alice));
      const job = await row(alice);
      const removed = await del(`/import/queue/jobs/${job.id}`);
      expect(removed.status).toBe(200);
      expect(removed.body).toEqual({ ok: true });
      expect(await prisma.importJob.findUnique({ where: { id: job.id } })).toBeNull();
      expect((await del(`/import/queue/jobs/${job.id}`)).status).toBe(404);

      const two = await row(alice, {}, ["PENDING", "PENDING"]);
      const [first, second] = await itemsOf(two.id);
      const one = await del(`/import/queue/items/${first.id}`);
      expect(one.status).toBe(200);
      expect(one.body).toEqual({ jobDeleted: false });
      expect((await reload(two.id)).total).toBe(1);
      expect((await del(`/import/queue/items/${second.id}`)).body).toEqual({ jobDeleted: true });
      expect(await prisma.importJob.findUnique({ where: { id: two.id } })).toBeNull();
    });

    it("acts on all of one's own at once, and only one's own", async () => {
      const held = await row(alice);
      const theirsHeld = await row(bob);
      const failed = await row(alice, { status: "DONE", failedCount: 1 }, ["FAILED"]);
      const theirsFailed = await row(bob, { status: "DONE", failedCount: 1 }, ["FAILED"]);

      const started = await post(alice, "/import/queue/start-all");
      expect(started.status).toBe(202);
      expect(started.body).toEqual({ queued: 1 });
      expect((await reload(held.id)).status).toBe("QUEUED");
      expect((await reload(theirsHeld.id)).status).toBe("PAUSED");

      const retried = await post(alice, "/import/queue/retry-failed");
      expect(retried.status).toBe(202);
      expect(retried.body).toEqual({ queued: 1 });
      expect((await reload(failed.id)).status).toBe("QUEUED");
      expect((await reload(theirsFailed.id)).status).toBe("DONE");

      const running = await row(alice, { status: "RUNNING" });
      const theirsRunning = await row(bob, { status: "RUNNING" });
      const paused = await post(alice, "/import/queue/pause-all");
      expect(paused.status).toBe(200);
      expect(paused.body).toEqual({ paused: 1 });
      expect((await reload(running.id)).status).toBe("PAUSED");
      expect((await reload(theirsRunning.id)).status).toBe("RUNNING");
      // Nobody's place in line goes with it.
      expect((await reload(held.id)).status).toBe("QUEUED");
    });

    it("clears exactly what Finished shows, the number it said", async () => {
      const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const clean = await row(alice, { status: "DONE" }, ["DONE"]);
      const oldFailure = await row(alice, { status: "ERROR", errorMessage: "Old", updatedAt: old }, []);
      const asking = await row(alice, { status: "ERROR", errorMessage: "Recent" }, []);
      const theirs = await row(bob, { status: "DONE" }, ["DONE"]);

      const { finished_total: shown } = await ownQueue(alice);
      expect(shown).toBe(2);
      const res = await post(alice, "/import/queue/clear-finished");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ deleted: shown });
      expect(await prisma.importJob.findUnique({ where: { id: clean.id } })).toBeNull();
      expect(await prisma.importJob.findUnique({ where: { id: oldFailure.id } })).toBeNull();
      expect((await reload(asking.id)).status).toBe("ERROR");
      expect((await reload(theirs.id)).status).toBe("DONE");
    });

    it("runs what joined by every route, and shows how it came out", async () => {
      const release = gate(base + 10);
      resumeImportWorker();
      const first = await post(bob, "/import?queue=1", { url: modelUrl(base + 10) });
      await until(() => fetched.some((url) => url.includes(String(base + 10))));
      const second = await post(alice, "/import?queue=1", { url: modelUrl(base + 11), title: "Called this" });
      expect(second.body.position).toBe(1);

      // Someone else's job is running: whose it is, and nothing more.
      const seen = await ownQueue(alice);
      expect(seen.line.now).toEqual({ mine: false, person: personKey(bob.id), job_id: null });
      expect(seen.line.rows).toEqual([
        { position: 1, mine: true, person: personKey(alice.id), job_id: second.body.job_id },
      ]);
      expect((await ownQueue(bob)).line.now).toEqual({
        mine: true,
        person: personKey(bob.id),
        job_id: first.body.job_id,
      });
      const running = await ownJob(bob, first.body.job_id);
      expect(running).toMatchObject({
        status: "RUNNING",
        position: null,
        runner_live: true,
        started_at: expect.any(String),
        can_pause: false,
        can_delete: false,
      });

      release();
      await importWorkerIdle();
      const done = await ownJob(alice, second.body.job_id);
      expect(done).toMatchObject({
        status: "DONE",
        single: true,
        outcome: "created",
        imported: 1,
        attention: false,
        position: null,
        result_print_id: expect.any(String),
        source_label: "Called this",
      });
      const real = await get(alice, `/import/jobs/${second.body.job_id}?queue=1`);
      expect(real.body).toMatchObject({ status: "DONE", result_print_id: done.result_print_id });
    });

    it("takes a failure to Needs attention, and a retry brings it in", async () => {
      gone.add(String(base + 12));
      resumeImportWorker();
      const { body } = await post(alice, "/import?queue=1", { url: modelUrl(base + 12) });
      await importWorkerIdle();
      const failed = await ownJob(alice, body.job_id);
      expect(failed).toMatchObject({
        status: "DONE",
        attention: true,
        can_retry: true,
        outcome: null,
        failure_reason: expect.any(String),
      });

      gone.clear();
      const retried = await post(alice, `/import/queue/jobs/${body.job_id}/retry`);
      expect(retried.status).toBe(202);
      await importWorkerIdle();
      expect(await ownJob(alice, body.job_id)).toMatchObject({
        status: "DONE",
        attention: false,
        can_retry: false,
        outcome: "created",
        imported: 1,
      });
    });
  });

  describe("who may do what", () => {
    type Route = readonly ["post" | "delete", (job: string, item: string) => string];
    const JOB_ROUTES: readonly Route[] = [
      ["post", (job) => `/import/queue/jobs/${job}/start`],
      ["post", (job) => `/import/queue/jobs/${job}/retry`],
      ["post", (job) => `/import/queue/jobs/${job}/pause`],
      ["delete", (job) => `/import/queue/jobs/${job}`],
      ["delete", (_job, item) => `/import/queue/items/${item}`],
    ];
    const BULK_ROUTES = ["start-all", "retry-failed", "pause-all", "clear-finished"];

    async function foreign() {
      const job = await row(bob, { status: "ERROR", failedCount: 1 }, ["FAILED", "PENDING"]);
      const [item] = await itemsOf(job.id);
      return { job, item, before: JSON.stringify([await reload(job.id), await itemsOf(job.id)]) };
    }

    const call = (method: Route[0], url: string) =>
      method === "post" ? request(app).post(url) : request(app).delete(url);

    it.each(JOB_ROUTES)("hides someone else's job on %s, from an admin too: %#", async (method, path) => {
      const { job, item, before } = await foreign();
      const url = `/api${path(job.id, item.id)}`;
      for (const account of [alice, admin]) {
        const res = await call(method, url).set(auth(account)).send({});
        expect(res.status).toBe(404);
        expect(JSON.stringify(res.body)).not.toContain(job.sourceUrl);
      }
      expect(JSON.stringify([await reload(job.id), await itemsOf(job.id)])).toBe(before);
    });

    it.each(JOB_ROUTES)("answers the same for an id that doesn't exist on %s: %#", async (method, path) => {
      const res = await call(method, `/api${path("nope", "nope")}`)
        .set(auth(alice))
        .send({});
      expect(res.status).toBe(404);
    });

    it("hides someone else's job from every read of one", async () => {
      const { job } = await foreign();
      for (const path of [`/import/jobs/${job.id}`, `/import/jobs/${job.id}?queue=1`, `/import/jobs/${job.id}/items`]) {
        expect((await get(alice, path)).status).toBe(404);
        expect((await get(bob, path)).status).toBe(200);
      }
      const { jobs } = (await get(alice, "/import/queue")).body;
      expect(jobs).toEqual([]);
    });

    it("signs everyone else out of all of it", async () => {
      expect((await request(app).get("/api/import/queue")).status).toBe(401);
      expect((await request(app).put("/api/import/queue/settings").send({ start_grab_links: true })).status).toBe(401);
      for (const [method, path] of JOB_ROUTES) {
        expect((await call(method, `/api${path("x", "x")}`).send({})).status).toBe(401);
      }
      for (const action of BULK_ROUTES) {
        expect((await request(app).post(`/api/import/queue/${action}`).send({})).status).toBe(401);
      }
    });

    it("lets an API token read its own queue and change nothing", async () => {
      await post(alice, "/import?queue=1", { url: modelUrl(base) });
      const session = auth(alice);
      const { token } = (await request(app).post("/api/profile/api-token").set(session)).body;
      const viaToken = { Authorization: `Bearer ${token}` };

      const read = await request(app).get("/api/import/queue").set(viaToken);
      expect(read.status).toBe(200);
      expect(read.body.jobs).toHaveLength(1);
      expect(read.body.line.length).toBe(1);

      const write = await request(app).post("/api/import/queue/start-all").set(viaToken);
      expect(write.status).toBe(403);
      expect(write.body.detail).toBe("API tokens are read-only");
      expect((await request(app).put("/api/import/queue/settings").set(viaToken).send({})).status).toBe(403);
      expect((await request(app).get("/api/admin/import-queue").set(viaToken)).status).toBe(403);
    });

    describe("with captchas on for imports", () => {
      let previous: Awaited<ReturnType<typeof getCaptchaSettings>>;

      beforeAll(async () => {
        previous = await getCaptchaSettings();
      });

      beforeEach(async () => {
        await setCaptchaSettings({ import: true });
      });

      afterEach(async () => {
        await setCaptchaSettings(previous);
      });

      it.each(SUBMITS)("still asks one for %s", async (_label, path, body) => {
        const refused = await post(alice, `${path}?queue=1`, body);
        expect(refused.status).toBe(400);
        expect(refused.body.code).toBe("CAPTCHA_REQUIRED");
        expect(await jobsOf(alice)).toEqual([]);

        const { id, answer } = createCaptcha();
        const solved = await post(alice, `${path}?queue=1`, { ...body, captcha_id: id, captcha_answer: answer });
        expect(solved.status).toBe(202);

        const fromGrab = await post(alice, `${path}?queue=1`, body).set("X-Thingport-Client", "grab");
        expect(fromGrab.status).toBe(202);
      });

      it("still guards the retry old clients use, and nothing on the queue's own routes", async () => {
        const failed = await row(alice, { status: "DONE", failedCount: 1 }, ["FAILED"]);
        const guarded = await post(alice, `/import/jobs/${failed.id}/retry`);
        expect(guarded.status).toBe(400);
        expect(guarded.body.code).toBe("CAPTCHA_REQUIRED");

        expect((await post(alice, `/import/queue/jobs/${failed.id}/retry`)).status).toBe(202);
        expect((await post(alice, `/import/queue/jobs/${failed.id}/pause`)).status).toBe(200);
        expect((await post(alice, `/import/queue/jobs/${failed.id}/start`)).status).toBe(202);
        for (const action of BULK_ROUTES) {
          expect((await post(alice, `/import/queue/${action}`)).body.code).toBeUndefined();
        }
      });
    });
  });

  describe("every user's imports, for an admin", () => {
    const adminRow = (body: { jobs: { id: string }[] }, id: string) => body.jobs.find((job) => job.id === id);

    it("needs an admin", async () => {
      expect((await get(alice, "/admin/import-queue?queue=1")).status).toBe(403);
      expect((await post(alice, "/admin/import-queue/start-all?queue=1&user_id=x")).status).toBe(403);
    });

    it("keeps what a page from before the line reads, and adds the real thing for whoever asks", async () => {
      const { body } = await post(alice, "/import?queue=1", { url: modelUrl(base) });
      const old = (await get(admin, "/admin/import-queue")).body;
      expect(Object.keys(old).toSorted()).toEqual(["bulk", "jobs"]);
      expect(Object.keys(old.bulk).toSorted()).toEqual(["currentJobId", "remaining", "running"]);
      const masked = adminRow(old, body.job_id);
      expect(masked).toMatchObject({ status: "RUNNING", runner_live: true, owner: { id: alice.id } });
      expect(masked).not.toHaveProperty("position");
      expect(masked).not.toHaveProperty("can_start");
      expect(masked).not.toHaveProperty("single");

      const asked = (await get(admin, "/admin/import-queue?queue=1")).body;
      expect(Object.keys(asked).toSorted()).toEqual(["bulk", "finished_by_owner", "finished_total", "jobs"]);
      expect(Object.keys(asked.bulk).toSorted()).toEqual(["currentJobId", "remaining", "running"]);
      expect(adminRow(asked, body.job_id)).toMatchObject({
        status: "QUEUED",
        position: 1,
        single: true,
        runner_live: false,
        can_pause: true,
        owner: { id: alice.id, email: `queue-routes-alice-${stamp}@example.com` },
      });
    });

    it("lists everything open and asking for attention past its limit, only for whoever asks", async () => {
      const old = new Date("2019-01-01");
      const held = await row(alice, { createdAt: old });
      const failed = await row(alice, { status: "ERROR", errorMessage: "No", createdAt: old, queuedAt: old }, []);
      const finished = await row(alice, { status: "DONE", createdAt: old }, []);
      await prisma.importJob.createMany({
        data: Array.from({ length: 205 }, () => ({
          userId: alice.id,
          type: "LINKS" as const,
          status: "DONE" as const,
          sourceUrl: ZIP_URL,
        })),
      });

      const plain = (await get(admin, "/admin/import-queue")).body;
      expect(adminRow(plain, held.id)).toBeUndefined();

      const asked = (await get(admin, "/admin/import-queue?queue=1")).body;
      expect(adminRow(asked, held.id)).toMatchObject({ status: "PAUSED", can_start: true });
      expect(adminRow(asked, failed.id)).toMatchObject({ status: "ERROR", attention: true });
      expect(adminRow(asked, finished.id)).toBeUndefined();
    });

    it("counts everything in Finished, by the same rule as Clear finished, far past what it lists", async () => {
      const longAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      await row(alice, { status: "DONE" }, []);
      await row(alice, { status: "ERROR", errorMessage: "Old", updatedAt: longAgo }, []);
      // Asking for attention, or not finished.
      await row(alice, { status: "ERROR", errorMessage: "Recent" }, []);
      await row(alice, { status: "DONE", failedCount: 1 }, ["FAILED"]);
      await row(alice);
      await prisma.importJob.createMany({
        data: Array.from({ length: 205 }, () => ({
          userId: alice.id,
          type: "LINKS" as const,
          status: "DONE" as const,
          sourceUrl: ZIP_URL,
        })),
      });
      await row(bob, { status: "DONE" }, []);
      await row(bob, { status: "ERROR", errorMessage: "Recent" }, []);

      const { jobs, finished_total, finished_by_owner } = (await get(admin, "/admin/import-queue?queue=1")).body;
      expect(finished_by_owner[alice.id]).toBe(207);
      expect(finished_by_owner[bob.id]).toBe(1);
      // Nobody with nothing finished is listed, and everyone with something is counted.
      expect(finished_by_owner).not.toHaveProperty(admin.id);
      const counts = Object.values(finished_by_owner) as number[];
      expect(finished_total).toBe(counts.reduce((sum, count) => sum + count, 0));
      expect(jobs.length).toBeLessThan(finished_total);

      const old = (await get(admin, "/admin/import-queue")).body;
      expect(old).not.toHaveProperty("finished_total");
      expect(old).not.toHaveProperty("finished_by_owner");

      const cleared = await post(admin, `/admin/import-queue/clear-finished?queue=1&user_id=${alice.id}`);
      expect(cleared.body).toEqual({ deleted: 207 });
      const after = (await get(admin, "/admin/import-queue?queue=1")).body;
      expect(after.finished_by_owner).not.toHaveProperty(alice.id);
      expect(after.finished_by_owner[bob.id]).toBe(1);
      expect(after.finished_total).toBe(finished_total - 207);
    });

    it("gives a lone link's page title on its row, and only when asked", async () => {
      const { body } = await post(alice, "/import/queue", { url: modelUrl(base), title: "A page" });
      const asked = (await get(admin, "/admin/import-queue?queue=1")).body;
      expect(adminRow(asked, body.job_id)).toMatchObject({ link_title: "A page", owner: { id: alice.id } });
      const old = (await get(admin, "/admin/import-queue")).body;
      expect(adminRow(old, body.job_id)).not.toHaveProperty("link_title");
    });

    it("starts, retries and pauses any type, answering as it always has", async () => {
      const held = await row(alice, { type: "ZIP", payload: { entries: ["hull.stl"] } }, []);
      const start = await post(admin, `/admin/import-queue/jobs/${held.id}/start`);
      expect(start.status).toBe(202);
      expect(start.body).toEqual({ ok: true });
      expect((await reload(held.id)).status).toBe("QUEUED");

      const pause = await post(admin, `/admin/import-queue/jobs/${held.id}/pause`);
      expect(pause.status).toBe(200);
      expect(pause.body).toEqual({ ok: true });
      expect((await reload(held.id)).status).toBe("PAUSED");

      const list = await row(
        bob,
        { type: "COLLECTION", status: "ERROR", provider: "makerworld", payload: { model_ids: ["1"] } },
        [],
      );
      const retry = await post(admin, `/admin/import-queue/jobs/${list.id}/retry`);
      expect(retry.status).toBe(202);
      expect(retry.body).toEqual({ ok: true });
      expect((await reload(list.id)).status).toBe("QUEUED");

      const zip = await row(alice, { type: "ZIP", status: "ERROR", payload: { entries: ["a"] } }, []);
      expect((await post(admin, `/admin/import-queue/jobs/${zip.id}/retry`)).status).toBe(400);
    });

    it("starts all by the new meaning when asked, by the old one otherwise, for one person if named", async () => {
      const links = await row(alice);
      const zip = await row(alice, { type: "ZIP", payload: { entries: ["a"] } }, []);
      const theirs = await row(bob);

      const one = await post(admin, `/admin/import-queue/start-all?queue=1&user_id=${alice.id}`);
      expect(one.status).toBe(202);
      expect(one.body).toEqual({ queued: 2, bulk: expect.objectContaining({ running: true, currentJobId: null }) });
      expect((await reload(links.id)).status).toBe("QUEUED");
      expect((await reload(zip.id)).status).toBe("QUEUED");
      expect((await reload(theirs.id)).status).toBe("PAUSED");

      const zipOfBob = await row(bob, { type: "ZIP", payload: { entries: ["a"] } }, []);
      const old = await post(admin, `/admin/import-queue/start-all?user_id=${bob.id}`);
      expect(old.body.queued).toBe(1);
      expect((await reload(theirs.id)).status).toBe("QUEUED");
      expect((await reload(zipOfBob.id)).status).toBe("PAUSED");
    });

    it("retries all by what's asking for attention when asked, every failed link list otherwise", async () => {
      const longAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const recent = await row(alice, { status: "DONE", failedCount: 1 }, ["FAILED"]);
      const old = await row(alice, { status: "DONE", failedCount: 1, updatedAt: longAgo }, ["FAILED"]);
      const theirs = await row(bob, { status: "DONE", failedCount: 1 }, ["FAILED"]);

      const asked = await post(admin, `/admin/import-queue/retry-failed?queue=1&user_id=${alice.id}`);
      expect(asked.status).toBe(202);
      expect(asked.body.queued).toBe(1);
      expect((await reload(recent.id)).status).toBe("QUEUED");
      expect((await reload(old.id)).status).toBe("DONE");
      expect((await reload(theirs.id)).status).toBe("DONE");

      const plain = await post(admin, `/admin/import-queue/retry-failed?user_id=${alice.id}`);
      expect(plain.body.queued).toBe(1);
      expect((await reload(old.id)).status).toBe("QUEUED");
    });

    it("pauses all without touching the line when asked, holding it too otherwise", async () => {
      const running = await row(alice, { status: "RUNNING" });
      const waiting = await post(alice, "/import?queue=1", { url: modelUrl(base) });

      const asked = await post(admin, `/admin/import-queue/pause-all?queue=1&user_id=${alice.id}`);
      expect(asked.status).toBe(200);
      expect(asked.body.paused).toBe(1);
      expect(asked.body.bulk).toEqual(expect.objectContaining({ running: true }));
      expect((await reload(running.id)).status).toBe("PAUSED");
      expect((await reload(waiting.body.job_id)).status).toBe("QUEUED");

      await prisma.importJob.update({ where: { id: running.id }, data: { status: "RUNNING" } });
      const plain = await post(admin, `/admin/import-queue/pause-all?user_id=${alice.id}`);
      expect(plain.body.paused).toBe(1);
      expect((await reload(running.id)).status).toBe("PAUSED");
      expect((await reload(waiting.body.job_id)).status).toBe("PAUSED");
    });

    it("clears exactly the Finished section when asked, what finished clean otherwise", async () => {
      const longAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const clean = await row(alice, { status: "DONE" }, []);
      const oldError = await row(alice, { status: "ERROR", updatedAt: longAgo }, []);
      const recentError = await row(alice, { status: "ERROR" }, []);
      const theirs = await row(bob, { status: "DONE" }, []);

      const plain = await post(admin, `/admin/import-queue/clear-finished?user_id=${alice.id}`);
      expect(plain.status).toBe(200);
      expect(plain.body).toEqual({ deleted: 1 });
      expect(await prisma.importJob.findUnique({ where: { id: clean.id } })).toBeNull();
      expect((await reload(oldError.id)).status).toBe("ERROR");

      const asked = await post(admin, `/admin/import-queue/clear-finished?queue=1&user_id=${alice.id}`);
      expect(asked.body).toEqual({ deleted: 1 });
      expect(await prisma.importJob.findUnique({ where: { id: oldError.id } })).toBeNull();
      expect((await reload(recentError.id)).status).toBe("ERROR");
      expect((await reload(theirs.id)).status).toBe("DONE");
    });
  });
});
