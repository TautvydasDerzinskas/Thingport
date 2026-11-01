import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
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

import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app";
import { IMPORT_STALL_LIMIT_MINUTES } from "../src/config";
import { prisma } from "../src/db";
import { resetCaptchaCooloffForTest } from "../src/providers/makerworld/captcha";
import { setUserMakerworldCookie } from "../src/providers/makerworld/session";
import { isRunnerLive, SYNC_JOB_INTERRUPTED, SYNC_JOB_WAITING } from "../src/services/importJobRunner";
import {
  holdImportWorker,
  importWorkerIdle,
  importWorkerTuning,
  linksJobBody,
  recoverImportJobs,
  resumeImportWorker,
  startImportWorker,
  startImportWorkerAfterRecovery,
  wakeImportWorker,
} from "../src/services/importWorker";

const app = createApp();
const stamp = Date.now();
const base = (stamp % 1_000_000_000) + 11_000;
const originalFetch = global.fetch;
const tuning = { ...importWorkerTuning };

// The words old rows and old clients hold, written out here so that a new constant can't move them.
const RESTART_TEXT = "Interrupted by server restart";
const LIMIT_TEXT = "MakerWorld daily download limit reached for this account. Try again tomorrow.";

// Every value a client from before the line knows. A status outside these it takes for finished, or follows forever.
const JOB_STATUSES = ["RUNNING", "DONE", "ERROR", "PAUSED"];
const TASK_STATUSES = ["running", "done", "error"];

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
const OLD_ADMIN_KEYS = [
  ...OLD_JOB_KEYS,
  "created_at",
  "done_count",
  "failed_items_count",
  "owner",
  "pending_count",
  "runner_live",
  "running_count",
  "updated_at",
].toSorted();
const OLD_ITEM_KEYS = ["attempts", "collection_id", "error_message", "id", "scope", "status", "title", "url"];

type Account = { id: string; token: string };
let alice: Account;
let bob: Account;
let admin: Account;

const auth = (account: Account) => ({ Authorization: `Bearer ${account.token}` });
const get = (account: Account, path: string) => request(app).get(`/api${path}`).set(auth(account));
const post = (account: Account, path: string, body: object = {}) =>
  request(app).post(`/api${path}`).set(auth(account)).send(body);
const del = (account: Account, path: string) => request(app).delete(`/api${path}`).set(auth(account));

async function register(label: string, role: "ADMIN" | "MEMBER" = "MEMBER"): Promise<Account> {
  const email = `upgrade-${label}-${stamp}@example.com`;
  const res = await request(app)
    .post("/api/register")
    .send({ displayName: `Upgrade ${label}`, email, password: "password123" });
  if (res.status !== 200) throw new Error(`register ${label}: ${res.status} ${JSON.stringify(res.body)}`);
  await prisma.user.update({ where: { id: res.body.user.id }, data: { role } });
  const login = await request(app).post("/api/login").send({ email, password: "password123" });
  return { id: res.body.user.id, token: login.body.token };
}

let nextDesign = base;
const designId = () => ++nextDesign;
const modelUrl = (id: number) => `https://makerworld.com/en/models/${id}-phoenix`;
const LIST_URL = "https://makerworld.com/en/collections/987-flock";
const ZIP_URL = "https://example.com/pack.zip";
const MISSING_ZIP_URL = "https://example.com/missing.zip";

let fetched: string[] = [];
const gates = new Map<string, { held: Promise<void>; release: () => void }>();
const gone = new Set<string>();
const challenged = new Set<string>();
const limited = new Set<string>();
let zipFile: Buffer;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
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
      if (challenged.has(id)) return json({ captchaId: "c1", error: "confirm you are not a robot" }, 418);
      return json({
        id: Number(id),
        modelId: `US${id}`,
        title: `Phoenix ${id}`,
        summary: "<p>A phoenix.</p>",
        tags: ["phoenix"],
        designCreator: DESIGNER,
        defaultInstanceId: 2,
        instances: [{ id: Number(id) + 1, profileId: Number(id) + 2, title: "Multi", instanceCreator: DESIGNER }],
      });
    }
    const profile = url.match(/\/iot-service\/api\/user\/profile\/(\d+)/);
    if (profile) {
      if (limited.has(String(Number(profile[1]) - 2))) {
        return json({ code: -1, error: "You've reached your daily download limit." }, 400);
      }
      return json({ message: "success", url: `https://s3.example.com/${profile[1]}.stl`, filename: "phoenix.stl" });
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const until = (check: () => boolean | Promise<boolean>) =>
  vi.waitFor(async () => expect(await check()).toBe(true), { timeout: 15_000, interval: 10 });
const reload = (id: string) => prisma.importJob.findUniqueOrThrow({ where: { id } });
const statusOf = async (id: string) => (await reload(id)).status;

async function newCollection(userId: string, name: string, client: PrismaClient = prisma) {
  return client.collection.create({
    data: { userId, name: `${name} ${stamp}`, nameNormalized: `${name} ${stamp} ${Math.random()}`.toLowerCase() },
  });
}

async function newSync(userId: string, client: PrismaClient = prisma) {
  const collection = await newCollection(userId, "Synced", client);
  return client.collectionSync.create({
    data: {
      userId,
      collectionId: collection.id,
      provider: "makerworld",
      externalId: `${stamp}-${Math.random()}`,
      sourceUrl: LIST_URL,
    },
  });
}

/** A worker on someone else's link, and another of theirs behind it, so a direct import can't be passing by luck. */
async function busyLine() {
  const held = designId();
  const release = gate(held);
  const first = await post(bob, "/import?queue=1", { url: modelUrl(held) });
  await until(() => fetched.some((url) => url.includes(`/design/${held}`)));
  const second = await post(bob, "/import?queue=1", { url: modelUrl(designId()) });
  const line = { running: first.body.job_id as string, waiting: second.body.job_id as string, release };
  expect(await statusOf(line.running)).toBe("RUNNING");
  expect(await statusOf(line.waiting)).toBe("QUEUED");
  return line;
}

// ---- Thingport Grab as shipped: extension/src/background/{api,importJobs}.ts, content/panels/{batch,single}.ts ----

type Answer = { path: string; status: unknown };
type GrabApi = <T = Record<string, unknown>>(method: "GET" | "POST", path: string, body?: object) => Promise<T>;

/** `apiCall`: the browser's live cookie on any /import call with a MakerWorld link; any 2xx is JSON, and anything else
 *  an Error carrying only its detail. */
function grabApi(account: Account, answers: Answer[]): GrabApi {
  return async <T>(method: "GET" | "POST", path: string, body?: object) => {
    let finalBody = body as Record<string, unknown> | undefined;
    if (path.startsWith("/import") && finalBody && String(finalBody.url).includes("makerworld.com")) {
      finalBody = { ...finalBody, makerworld_cookie: "token=browser-live" };
    }
    const sending =
      method === "GET" ? get(account, path) : request(app).post(`/api${path}`).set(auth(account)).send(finalBody);
    const res = await sending.set("X-Thingport-Client", "grab");
    if (res.status < 200 || res.status >= 300) throw new Error(res.body?.detail || `Request failed (${res.status})`);
    if (/^\/import\/(jobs|tasks)\//.test(path)) answers.push({ path, status: res.body.status });
    if (res.status === 204) return null as T;
    return res.body as T;
  };
}

type OldJob = {
  id: string;
  type: string;
  status: string;
  processed: number;
  total: number;
  imported: number;
  already_in_library: number;
  failed_count: number;
  error_message: string | null;
  result_print_id: string | null;
  runner_live?: boolean;
  pending_count?: number;
  running_count?: number;
  failed_items_count?: number;
};
type OldPrint = { id?: string; import_outcome?: string };

async function pollJobToCompletion(api: GrabApi, jobId: string): Promise<OldJob> {
  for (;;) {
    const job = await api<OldJob>("GET", `/import/jobs/${jobId}`);
    if (job.status !== "RUNNING") return job;
    await sleep(10);
  }
}

async function pollImportTask(api: GrabApi, taskId: string): Promise<OldPrint> {
  for (;;) {
    const task = await api<{ status: string; result: OldPrint; detail: string }>("GET", `/import/tasks/${taskId}`);
    if (task.status === "done") return task.result;
    if (task.status === "error") throw new Error(task.detail);
    await sleep(10);
  }
}

async function importSingle(
  api: GrabApi,
  {
    url,
    entries,
    collectionId,
    resolved,
  }: { url: string; entries?: string[]; collectionId?: string; resolved?: string },
  { notify = true }: { notify?: boolean } = {},
): Promise<OldPrint | null> {
  const extra = resolved
    ? { resolved_download_url: resolved, resolved_instance_id: null, makerworld_design: null }
    : null;
  let print: OldPrint | null;
  if (entries) {
    const { job_id } = await api<{ job_id: string }>("POST", "/import/zip", { url, entries, ...extra });
    const job = await pollJobToCompletion(api, job_id);
    if (job.status === "ERROR") throw new Error(job.error_message || "Import failed");
    print = job.result_print_id ? { id: job.result_print_id } : null;
  } else {
    const started = await api<OldPrint | { task_id: string }>("POST", "/import?async=1", {
      url,
      ...extra,
      ...(notify ? {} : { notify: false }),
    });
    print = "task_id" in started ? await pollImportTask(api, started.task_id) : started;
  }
  if (collectionId && print?.id) {
    await api("POST", `/collection/${collectionId}/items/${print.id}`).catch(() => undefined);
  }
  return print;
}

/** `pollJobWithProgress`: what the panel ends on. */
async function pollJobWithProgress(api: GrabApi, jobId: string) {
  const progress: string[] = [];
  for (;;) {
    const job = await api<OldJob>("GET", `/import/jobs/${jobId}`);
    if (job.status === "RUNNING") {
      progress.push(`Importing ${job.processed} of ${job.total}…`);
      await sleep(10);
      continue;
    }
    if (job.status === "ERROR") return { error: job.error_message || "Import failed", job, progress };
    return { success: `Imported ${job.imported} of ${job.total}.`, job, progress };
  }
}

/** `runQueueImport`: the panel's words. Reads only `duplicate` and `waiting`. */
function queuePanel(result: { duplicate: boolean; waiting: number }) {
  const waiting = `${result.waiting} link${result.waiting === 1 ? "" : "s"} waiting`;
  return result.duplicate
    ? `This link was already waiting in the queue (${waiting}).`
    : `Paused until it's started from Administration > Import queue (${waiting}).`;
}

function expectKnownStatuses(answers: Answer[]) {
  for (const { path, status } of answers) {
    expect(path.startsWith("/import/tasks/") ? TASK_STATUSES : JOB_STATUSES).toContain(status);
  }
}

// ---- A web app tab left open across the upgrade: ImportJobContext.tsx ----

function oldTab(account: Account) {
  const tab = {
    active: null as OldJob | null,
    navigated: [] as string[],
    completed: 0,
    seen: [] as string[],
    polling: false,
    following: Promise.resolve() as Promise<void>,
    follow: async (jobId: string) => {
      tab.active = await getImportJob(jobId);
      startPolling(jobId);
    },
    boot: async () => {
      const { body: job } = await get(account, "/import/jobs/active");
      if (job && job.status === "RUNNING") {
        tab.active = job;
        startPolling(job.id);
      }
    },
  };
  async function getImportJob(jobId: string): Promise<OldJob> {
    const { body } = await get(account, `/import/jobs/${jobId}`);
    tab.seen.push(body.status);
    return body;
  }
  async function pollJob(jobId: string) {
    const job = await getImportJob(jobId);
    if (job.status === "RUNNING") {
      tab.active = job;
      return;
    }
    tab.polling = false;
    if (job.status === "PAUSED") {
      tab.active = null;
      return;
    }
    tab.completed++;
    if (job.type === "LINKS" && (job.failed_count > 0 || job.status === "ERROR")) {
      tab.active = job;
      return;
    }
    tab.active = null;
    if (job.status === "DONE") {
      if (job.result_print_id) tab.navigated.push(`/models/${job.result_print_id}`);
      else if (job.imported + job.already_in_library > 1) tab.navigated.push("/models");
    }
  }
  function startPolling(jobId: string) {
    tab.polling = true;
    tab.following = (async () => {
      while (tab.polling) {
        await sleep(10);
        await pollJob(jobId);
      }
    })();
  }
  return tab;
}

// ---- An admin page left open: ImportQueuePage/index.tsx ----

function oldPageRow(job: OldJob) {
  const isLinks = job.type === "LINKS";
  const stalled = job.status === "RUNNING" && !job.runner_live;
  const label = stalled
    ? "stalled"
    : job.status === "PAUSED"
      ? job.runner_live
        ? "pausing"
        : "paused"
      : job.status === "RUNNING"
        ? "running"
        : job.status === "ERROR"
          ? "error"
          : job.failed_count > 0
            ? "doneWithFailures"
            : "done";
  const idle = job.status !== "RUNNING" && !job.runner_live;
  return {
    label,
    canStart:
      isLinks &&
      (job.status === "PAUSED" || job.status === "ERROR") &&
      !job.runner_live &&
      job.pending_count! + job.running_count! > 0,
    canPause: isLinks && job.status === "RUNNING",
    canRetry: isLinks && idle && job.failed_items_count! > 0,
  };
}

const adminList = async () => (await get(admin, "/admin/import-queue")).body as { jobs: OldJob[]; bulk: unknown };
const adminRow = async (id: string) => (await adminList()).jobs.find((job) => job.id === id)!;

// ---- Rows as the old code left them: only the columns it knew, in raw SQL ----

type RowStatus = "RUNNING" | "DONE" | "ERROR" | "PAUSED";
type ItemStatus = "PENDING" | "RUNNING" | "DONE" | "FAILED";
type OldItem = { status: ItemStatus; url?: string; payload?: object | null };
type OldRow = {
  status: RowStatus;
  type?: "LINKS" | "ZIP" | "COLLECTION" | "PROFILES";
  label?: string | null;
  provider?: string | null;
  total?: number;
  processed?: number;
  imported?: number;
  failedCount?: number;
  errorMessage?: string | null;
  payload?: object | null;
  syncId?: string | null;
  at?: Date;
};

const JOB_PAYLOAD = { notes: null, tags: [], category_id: null, scope: "url" };
const SYNC_PAYLOAD = { ...JOB_PAYLOAD, item_delay_ms: 60_000, sync_filed: 0 };
const ITEM_PAYLOAD = { collection_id: null, scope: "url", title: null };
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const recently = () => new Date(Date.now() - HOUR);
const longAgo = () => new Date(Date.now() - 30 * DAY);

let rows = 0;
async function oldRow(userId: string, row: OldRow, items: OldItem[] = [], client: PrismaClient = prisma) {
  const id = `old${stamp}x${++rows}`;
  const at = row.at ?? recently();
  const type = row.type ?? "LINKS";
  const payload = row.payload === undefined ? (type === "LINKS" ? JOB_PAYLOAD : null) : row.payload;
  await client.$executeRaw`
    INSERT INTO "ImportJob" ("id", "userId", "type", "status", "sourceUrl", "sourceLabel", "provider", "total", "processed",
      "imported", "failedCount", "errorMessage", "payload", "collectionSyncId", "createdAt", "updatedAt")
    VALUES (${id}, ${userId}, ${type}::text::"ImportJobType", ${row.status}::text::"ImportJobStatus",
      ${`https://example.com/source-${id}`}, ${row.label ?? null}::text, ${row.provider ?? null}::text,
      ${row.total ?? items.length}::int, ${row.processed ?? 0}::int, ${row.imported ?? 0}::int, ${row.failedCount ?? 0}::int,
      ${row.errorMessage ?? null}::text, ${payload === null ? null : JSON.stringify(payload)}::text::jsonb,
      ${row.syncId ?? null}::text, ${at.toISOString()}::text::timestamp, ${at.toISOString()}::text::timestamp)`;
  for (const [index, item] of items.entries()) {
    const itemAt = new Date(at.getTime() + index).toISOString();
    const itemPayload = item.payload === undefined ? null : JSON.stringify(item.payload);
    await client.$executeRaw`
      INSERT INTO "ImportJobItem" ("id", "jobId", "url", "status", "payload", "createdAt", "updatedAt")
      VALUES (${`${id}i${index}`}, ${id}, ${item.url ?? modelUrl(designId())},
        ${item.status}::text::"ImportJobItemStatus", ${itemPayload}::text::jsonb,
        ${itemAt}::text::timestamp, ${itemAt}::text::timestamp)`;
  }
  return id;
}

const ITEMS = (...statuses: ItemStatus[]): OldItem[] => statuses.map((status) => ({ status }));

/** One row per line of the table of what an upgrade can find, each as that line says the old code wrote it. */
async function seedTable(userId: string, client: PrismaClient = prisma) {
  const syncs = await Promise.all([newSync(userId, client), newSync(userId, client), newSync(userId, client)]);
  const insert = (row: OldRow, items?: OldItem[]) => oldRow(userId, row, items, client);
  return {
    // 1
    syncRunning: await insert(
      { status: "RUNNING", label: "Sync: One", provider: "makerworld", payload: SYNC_PAYLOAD, syncId: syncs[0].id },
      ITEMS("DONE", "RUNNING", "PENDING"),
    ),
    // 2
    linksRunning: await insert({ status: "RUNNING", processed: 1, imported: 1 }, ITEMS("DONE", "RUNNING", "PENDING")),
    // 3
    zipRunning: await insert({ status: "RUNNING", type: "ZIP" }),
    listRunning: await insert({ status: "RUNNING", type: "COLLECTION", provider: "makerworld", total: 3 }),
    profilesRunning: await insert({ status: "RUNNING", type: "PROFILES", provider: "makerworld" }),
    // 4
    errorRecent: await insert({ status: "ERROR", errorMessage: RESTART_TEXT }, ITEMS("PENDING", "RUNNING")),
    errorOld: await insert(
      { status: "ERROR", errorMessage: "Old failure", failedCount: 1, at: longAgo() },
      ITEMS("FAILED"),
    ),
    errorZip: await insert({ status: "ERROR", type: "ZIP", errorMessage: "Bad zip", at: longAgo() }),
    // 5
    parked: await insert({ status: "PAUSED", label: "Sent from Thingport Grab" }, [
      { status: "PENDING", payload: ITEM_PAYLOAD },
    ]),
    // 6
    pausedByHand: await insert({ status: "PAUSED", processed: 1, imported: 1 }, ITEMS("DONE", "RUNNING", "PENDING")),
    // 7
    rateLimited: await insert(
      { status: "PAUSED", errorMessage: LIMIT_TEXT, payload: SYNC_PAYLOAD, syncId: syncs[1].id, label: "Sync: Two" },
      ITEMS("PENDING"),
    ),
    // 8
    interrupted: await insert(
      {
        status: "PAUSED",
        errorMessage: RESTART_TEXT,
        payload: SYNC_PAYLOAD,
        syncId: syncs[2].id,
        label: "Sync: Three",
      },
      ITEMS("PENDING"),
    ),
    // 9
    orphanedSync: await insert({ status: "PAUSED", label: "Sync: Gone", payload: SYNC_PAYLOAD }, ITEMS("PENDING")),
    // 10
    nothingToDo: await insert({ status: "PAUSED", processed: 1, imported: 1 }, ITEMS("DONE")),
    // 11
    doneClean: await insert({ status: "DONE", processed: 1, imported: 1 }, ITEMS("DONE")),
    // 12
    doneFailedRecent: await insert({ status: "DONE", processed: 1, failedCount: 1 }, ITEMS("FAILED")),
    doneFailedOld: await insert({ status: "DONE", processed: 1, failedCount: 1, at: longAgo() }, ITEMS("FAILED")),
    // 13
    doneZip: await insert({ status: "DONE", type: "ZIP", failedCount: 1, total: 2, processed: 2 }),
    doneList: await insert({ status: "DONE", type: "COLLECTION", failedCount: 1, total: 2, processed: 2 }),
    doneProfiles: await insert({ status: "DONE", type: "PROFILES", failedCount: 1, at: longAgo() }),
    // 14
    stuckItem: await insert({ status: "DONE", processed: 1, imported: 1 }, ITEMS("DONE", "RUNNING")),
  };
}

const RUNNING_ROWS = ["syncRunning", "linksRunning", "zipRunning", "listRunning", "profilesRunning"] as const;

async function snapshot(ids: string[]) {
  const jobs = await prisma.importJob.findMany({
    where: { id: { in: ids } },
    include: { items: { orderBy: { id: "asc" } } },
  });
  return Object.fromEntries(jobs.map((job) => [job.id, job]));
}

const can = (...allowed: ("start" | "pause" | "retry" | "delete")[]) => ({
  can_start: allowed.includes("start"),
  can_pause: allowed.includes("pause"),
  can_retry: allowed.includes("retry"),
  can_delete: allowed.includes("delete"),
});

describe("upgrading to the import queue", () => {
  beforeAll(async () => {
    alice = await register("alice");
    bob = await register("bob");
    admin = await register("admin", "ADMIN");
    for (const account of [alice, bob, admin]) await setUserMakerworldCookie(account.id, "token=saved");
    const zip = new JSZip();
    zip.file("hull.stl", "solid hull endsolid");
    zipFile = await zip.generateAsync({ type: "nodebuffer" });
    // Another file's leftovers would run under this file's fetch, and count in what an admin's bulk action covers.
    await prisma.importJob.deleteMany({});
    await importWorkerIdle();
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
    const everyone = { in: [alice.id, bob.id, admin.id] };
    await until(async () => {
      const left = await prisma.importJob.findMany({ where: { userId: everyone }, select: { id: true } });
      return !left.some((job) => isRunnerLive(job.id));
    });
    await prisma.importJob.deleteMany({ where: { userId: everyone } });
    await prisma.print.deleteMany({ where: { userId: everyone } });
    await prisma.notification.deleteMany({ where: { userId: everyone } });
    await prisma.grabImport.deleteMany({ where: { userId: everyone } });
    await prisma.collection.deleteMany({ where: { userId: everyone } });
    await prisma.user.updateMany({ where: { id: everyone }, data: { startGrabLinks: false } });
    global.fetch = originalFetch;
    mockFetch();
    fetched = [];
    gone.clear();
    challenged.clear();
    limited.clear();
    resetCaptchaCooloffForTest();
  });

  afterAll(async () => {
    global.fetch = originalFetch;
    await prisma.user.deleteMany({ where: { id: { in: [alice.id, bob.id, admin.id] } } });
  });

  describe("making the app", () => {
    it("never starts the worker just by making the app: an enqueue or the server has to", async () => {
      resumeImportWorker();
      await importWorkerIdle();
      const row = await prisma.importJob.create({
        data: {
          userId: alice.id,
          type: "LINKS",
          status: "QUEUED",
          sourceUrl: modelUrl(designId()),
          queuedAt: new Date(),
        },
      });
      createApp();
      await sleep(100);
      expect(await statusOf(row.id)).toBe("QUEUED");
      await prisma.importJob.delete({ where: { id: row.id } });
    });
  });

  describe("Thingport Grab from before the line, past a busy one", () => {
    const answers: Answer[] = [];
    const api = () => grabApi(alice, answers);

    beforeEach(() => {
      answers.length = 0;
    });

    it("imports a link by its task, files it, and leaves the line alone", async () => {
      const line = await busyLine();
      const collection = await newCollection(alice.id, "Picked");
      const url = modelUrl(designId());

      const print = await importSingle(api(), { url, collectionId: collection.id });
      expect(print).toMatchObject({ id: expect.any(String), import_outcome: "created" });
      expect(await prisma.collectionItem.count({ where: { collectionId: collection.id, printId: print!.id } })).toBe(1);

      // A task, never a job: nothing of hers is in the line, and it didn't wait for those who are.
      expect(await prisma.importJob.count({ where: { userId: alice.id } })).toBe(0);
      expect(await statusOf(line.running)).toBe("RUNNING");
      expect(await statusOf(line.waiting)).toBe("QUEUED");
      expect(answers.length).toBeGreaterThan(0);
      expectKnownStatuses(answers);

      // Again: already there, which Grab reads to skip its recent imports.
      const again = await importSingle(api(), { url });
      expect(again).toMatchObject({ id: print!.id, import_outcome: "already_imported" });
    });

    it("answers an import that started with the task id and nothing else", async () => {
      await busyLine();
      for (const body of [
        { url: modelUrl(designId()) },
        { url: modelUrl(designId()), notify: false },
        { url: modelUrl(designId()), resolved_download_url: "https://s3.example.com/1.stl" },
      ]) {
        const started = await post(alice, "/import?async=1", body).set("X-Thingport-Client", "grab");
        expect(started.status).toBe(202);
        expect(Object.keys(started.body)).toEqual(["task_id"]);
        await pollImportTask(api(), started.body.task_id);
      }
      expectKnownStatuses(answers);
    });

    it("keeps a guided run's models quiet, for its one summary", async () => {
      await busyLine();
      await importSingle(api(), { url: modelUrl(designId()) }, { notify: false });
      expect(await prisma.notification.count({ where: { userId: alice.id } })).toBe(0);
    });

    it("shows a failed link's reason, with the status code it always had", async () => {
      await busyLine();
      const id = designId();
      gone.add(String(id));
      await expect(importSingle(api(), { url: modelUrl(id) })).rejects.toThrow(/./);
      expectKnownStatuses(answers);

      const started = await post(alice, "/import?async=1", { url: modelUrl(id) });
      await vi.waitFor(
        async () => {
          const { body } = await get(alice, `/import/tasks/${started.body.task_id}`);
          expect(body).toEqual({ status: "error", detail: expect.any(String), http_status: expect.any(Number) });
        },
        { timeout: 15_000 },
      );
    });

    it.each([
      ["a CAPTCHA", challenged, /captcha/i],
      ["the daily limit", limited, /download limit/i],
    ])("keeps the words it looks for on %s", async (_label, trouble, words) => {
      const id = designId();
      trouble.add(String(id));
      await expect(importSingle(api(), { url: modelUrl(id) })).rejects.toThrow(words);
      // What the panel tests before offering to park the link.
      await expect(importSingle(api(), { url: modelUrl(id) })).rejects.toThrow(/captcha|download limit/i);
    });

    it("imports a zip by its job, to the model, and files it", async () => {
      const line = await busyLine();
      const collection = await newCollection(alice.id, "Picked");

      const started = await post(alice, "/import/zip", { url: ZIP_URL, entries: ["hull.stl"] });
      expect(started.status).toBe(202);
      expect(Object.keys(started.body)).toEqual(["job_id"]);
      await pollJobToCompletion(api(), started.body.job_id);

      const print = await importSingle(api(), {
        url: `${ZIP_URL}?second`,
        entries: ["hull.stl"],
        collectionId: collection.id,
      });
      expect(print?.id).toEqual(expect.any(String));
      expect(await prisma.collectionItem.count({ where: { collectionId: collection.id, printId: print!.id } })).toBe(1);

      expectKnownStatuses(answers);
      for (const { status } of answers) expect(["RUNNING", "DONE"]).toContain(status);
      expect(await statusOf(line.waiting)).toBe("QUEUED");
    });

    it("throws a zip's failure at the panel, with the job's own words", async () => {
      await expect(importSingle(api(), { url: MISSING_ZIP_URL, entries: ["hull.stl"] })).rejects.toThrow(/./);
      expectKnownStatuses(answers);
      expect(answers.at(-1)?.status).toBe("ERROR");
    });

    it.each([
      ["its older path", "/import/collection", "design_ids"],
      ["the provider's path", "/import/makerworld/list", "model_ids"],
    ])("imports a list by %s and ends on the panel it always did", async (_label, path, idsField) => {
      const line = await busyLine();
      const ids = [String(designId()), String(designId())];
      const { job_id } = await api()<{ job_id: string }>("POST", path, { url: LIST_URL, [idsField]: ids });

      const { success, job, progress } = await pollJobWithProgress(api(), job_id);
      expect(success).toBe("Imported 2 of 2.");
      expect(job.status).toBe("DONE");
      for (const shown of progress) expect(shown).toMatch(/^Importing \d of 2…$/);
      expectKnownStatuses(answers);
      expect(await statusOf(line.waiting)).toBe("QUEUED");
    });

    it("refuses a batch only when its owner has one running, in the words it shows", async () => {
      holdImportWorker();
      const waiting = await post(alice, "/import/links?queue=1", { urls: [modelUrl(designId())] });
      expect(await statusOf(waiting.body.job_id)).toBe("QUEUED");
      const passes = await post(alice, "/import/zip", { url: ZIP_URL, entries: ["hull.stl"] });
      expect(passes.status).toBe(202);
      await until(async () => (await statusOf(passes.body.job_id)) !== "RUNNING");

      const running = await oldRow(alice.id, { status: "RUNNING" }, ITEMS("RUNNING"));
      await expect(importSingle(api(), { url: ZIP_URL, entries: ["hull.stl"] })).rejects.toThrow(
        "An import is already in progress",
      );
      await prisma.importJob.delete({ where: { id: running } });
    });

    it("collects links on hold, and the panel reads what it always read", async () => {
      resumeImportWorker();
      const first = modelUrl(designId());
      const second = modelUrl(designId());
      const send = (url: string) =>
        api()<{ job_id: string; duplicate: boolean; waiting: number }>("POST", "/import/queue", {
          url,
          collection_id: null,
          scope: "url",
          title: "A page",
        });

      const added = await send(first);
      // Answers of its own, without a status it could take for a job's.
      expect(added).not.toHaveProperty("status");
      expect(queuePanel(added)).toBe("Paused until it's started from Administration > Import queue (1 link waiting).");
      expect(queuePanel(await send(second))).toBe(
        "Paused until it's started from Administration > Import queue (2 links waiting).",
      );
      expect(queuePanel(await send(first))).toBe("This link was already waiting in the queue (2 links waiting).");

      // Nobody started it, and an open line doesn't take it.
      wakeImportWorker();
      await importWorkerIdle();
      const job = await reload(added.job_id);
      expect(job.status).toBe("PAUSED");
      expect(fetched).toEqual([]);
      // The cookie Grab attached stays out of what's stored.
      const items = await prisma.importJobItem.findMany({ where: { jobId: job.id } });
      expect(JSON.stringify([job, items])).not.toContain("browser-live");
      expect(items[0].payload).toEqual({ collection_id: null, scope: "url", title: "A page" });
    });

    it("reads a link's status the same, in line or not", async () => {
      const id = designId();
      await post(alice, "/import?queue=1", { url: modelUrl(id) });
      const { body } = await get(alice, `/import/status?url=${encodeURIComponent(modelUrl(id))}`);
      expect(body).toEqual({
        recognized: true,
        already_imported: false,
        print_id: null,
        state: "not_imported",
        gaps: [],
      });
    });

    it("says a task the restart took is gone, in the words it shows", async () => {
      const res = await get(alice, "/import/tasks/from-the-last-process");
      expect(res.status).toBe(404);
      expect(res.body.detail).toBe("Import task not found -- it may have expired or the server restarted");
    });
  });

  describe("a web app tab from before the line", () => {
    it("gets a model back from a plain import, past a busy line, cookie and all", async () => {
      const line = await busyLine();
      const res = await post(alice, "/import", {
        url: modelUrl(designId()),
        makerworld_cookie: "token=from-local-storage",
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: expect.any(String), import_outcome: "created" });
      expect(await prisma.importJob.count({ where: { userId: alice.id } })).toBe(0);
      expect(await statusOf(line.waiting)).toBe("QUEUED");
    });

    it.each([
      ["a list of links", "/import/links", () => ({ urls: [modelUrl(designId()), modelUrl(designId())] })],
      [
        "a list",
        "/import/makerworld/list",
        () => ({ url: LIST_URL, model_ids: [String(designId()), String(designId())] }),
      ],
    ])("follows %s to the models page, its bar up all the way", async (_label, path, body) => {
      await busyLine();
      const started = await post(alice, path, body());
      expect(started.status).toBe(202);
      expect(Object.keys(started.body)).toEqual(["job_id"]);

      const tab = oldTab(alice);
      await tab.follow(started.body.job_id);
      await tab.following;
      for (const status of tab.seen) expect(["RUNNING", "DONE"]).toContain(status);
      expect(tab.navigated).toEqual(["/models"]);
      expect(tab.completed).toBe(1);
      expect(tab.active).toBeNull();
    });

    it("follows zip and profiles to the end", async () => {
      await busyLine();
      for (const [path, body] of [
        ["/import/zip", { url: ZIP_URL, entries: ["hull.stl"] }],
        ["/import/makerworld/profiles", { url: modelUrl(designId()), scope: "all" }],
      ] as const) {
        const started = await post(alice, path, body);
        expect(started.status).toBe(202);
        expect(Object.keys(started.body)).toEqual(["job_id"]);
        const tab = oldTab(alice);
        await tab.follow(started.body.job_id);
        await tab.following;
        for (const status of tab.seen) expect(JOB_STATUSES).toContain(status);
        expect(tab.completed).toBe(1);
      }
    });

    it("keeps following a retry through the wait in line, to the model", async () => {
      const id = designId();
      gone.add(String(id));
      const started = await post(alice, "/import/links", { urls: [modelUrl(id)] });
      const jobId: string = started.body.job_id;
      await until(async () => (await statusOf(jobId)) === "DONE");

      const tab = oldTab(alice);
      // A list with failures stays on screen, with its Retry.
      await tab.follow(jobId);
      await tab.following;
      expect(tab.active).toMatchObject({ id: jobId, status: "DONE", failed_count: 1 });
      expect(tab.navigated).toEqual([]);

      gone.delete(String(id));
      const line = await busyLine();
      const retry = await post(alice, `/import/jobs/${jobId}/retry`);
      expect(retry.status).toBe(202);
      expect(retry.body).toEqual({ job_id: jobId });

      // Behind the two of the other person's: still "running" to this tab, whose bar would go otherwise.
      await tab.follow(jobId);
      await sleep(100);
      expect(await statusOf(jobId)).toBe("QUEUED");
      expect(tab.polling).toBe(true);
      expect(tab.active?.status).toBe("RUNNING");

      line.release();
      await tab.following;
      for (const status of tab.seen) expect(JOB_STATUSES).toContain(status);
      expect(tab.seen).not.toContain("PAUSED");
      expect(tab.active).toBeNull();
      const done = await reload(jobId);
      expect(done).toMatchObject({ status: "DONE", imported: 1, failedCount: 0 });
      expect(tab.navigated).toEqual([`/models/${done.resultPrintId}`]);
    });

    it("takes a second click on Retry as the same place", async () => {
      holdImportWorker();
      const job = await oldRow(alice.id, { status: "DONE", failedCount: 1 }, ITEMS("FAILED"));
      expect((await post(alice, `/import/jobs/${job}/retry`)).body).toEqual({ job_id: job });
      const { queuedAt } = await reload(job);
      const second = await post(alice, `/import/jobs/${job}/retry`);
      expect(second.status).toBe(202);
      expect(second.body).toEqual({ job_id: job });
      expect((await reload(job)).queuedAt).toEqual(queuedAt);
    });

    it("clears its bar without going anywhere when what it follows is held", async () => {
      holdImportWorker();
      const started = await post(alice, "/import/links?queue=1", { urls: [modelUrl(designId())] });
      const tab = oldTab(alice);
      await tab.follow(started.body.job_id);
      await sleep(50);
      expect(tab.polling).toBe(true);

      await post(alice, `/import/queue/jobs/${started.body.job_id}/pause`);
      await tab.following;
      expect(tab.seen.at(-1)).toBe("PAUSED");
      expect(tab.active).toBeNull();
      expect(tab.completed).toBe(0);
      expect(tab.navigated).toEqual([]);
    });

    it("picks up only what's really running when it loads", async () => {
      holdImportWorker();
      const started = await post(alice, "/import?queue=1", { url: modelUrl(designId()) });
      const waitingTab = oldTab(alice);
      await waitingTab.boot();
      expect(waitingTab.active).toBeNull();
      expect(waitingTab.polling).toBe(false);

      const id = designId();
      const release = gate(id);
      await post(alice, "/import?queue=1", { url: modelUrl(id) });
      await post(alice, `/import/queue/jobs/${started.body.job_id}/pause`);
      resumeImportWorker();
      await until(() => fetched.some((url) => url.includes(`/design/${id}`)));

      const tab = oldTab(alice);
      await tab.boot();
      expect(tab.active).toMatchObject({ status: "RUNNING" });
      release();
      await tab.following;
      expect(tab.seen.at(-1)).toBe("DONE");
    });

    it.each(["", "?queue=0", "?queue=true", "?queue=", "?queue=2", "?queue[]=1"])(
      "takes %j for today's path",
      async (query) => {
        holdImportWorker();
        const links = await post(alice, `/import/links${query}`, { urls: [modelUrl(designId())] });
        expect(links.status).toBe(202);
        expect(Object.keys(links.body)).toEqual(["job_id"]);
        // It ran at once with the line shut, never having been in it.
        const job = await reload(links.body.job_id);
        expect(job.queuedAt).toBeNull();
        expect(job.status).not.toBe("QUEUED");
        await until(async () => (await statusOf(job.id)) === "DONE");

        const one = await post(alice, `/import${query}`, { url: modelUrl(designId()) });
        expect(one.status).toBe(200);
        expect(one.body.id).toEqual(expect.any(String));
        expect(one.body).not.toHaveProperty("job_id");
      },
    );
  });

  describe("every row an upgrade can find, at the first boot", () => {
    beforeEach(() => {
      holdImportWorker();
    });

    it("settles what the old process left as today, and nothing else moves or gets claimed", async () => {
      const grabImport = await prisma.grabImport.create({
        data: { userId: alice.id, provider: "makeronline", url: "https://www.makeronline.com/model/1" },
      });
      const notification = await prisma.notification.create({
        data: { userId: alice.id, type: "queue", title: "Links are waiting", internalPath: "/admin-queue" },
      });
      const table = await seedTable(alice.id);
      const ids = Object.values(table);
      const before = await snapshot(ids);

      await recoverImportJobs();

      const settled = await snapshot(ids);
      for (const name of Object.keys(table) as (keyof typeof table)[]) {
        const [was, now] = [before[table[name]], settled[table[name]]];
        // No row from before has a place in the line, or a run on record.
        expect(now.queuedAt).toBeNull();
        expect(now.startedAt).toBeNull();
        // Links of every row stay as they are, the stuck ones too.
        expect(now.items).toEqual(was.items);
        expect(now.payload).toEqual(was.payload);
      }
      const names = Object.keys(table) as (keyof typeof table)[];
      for (const name of names.filter((row) => !(RUNNING_ROWS as readonly string[]).includes(row))) {
        expect(settled[table[name]]).toEqual(before[table[name]]);
      }
      expect(settled[table.syncRunning]).toMatchObject({ status: "PAUSED", errorMessage: RESTART_TEXT });
      for (const name of ["linksRunning", "zipRunning", "listRunning", "profilesRunning"] as const) {
        expect(settled[table[name]]).toMatchObject({ status: "ERROR", errorMessage: RESTART_TEXT });
      }

      // The worker opens on it, as at boot, and finds nothing to do.
      startImportWorker();
      await importWorkerIdle();
      expect(await snapshot(ids)).toEqual(settled);
      expect(fetched).toEqual([]);

      // Told nobody; what's stored stays.
      expect(await prisma.notification.findMany({ where: { userId: alice.id } })).toEqual([notification]);
      expect(await prisma.grabImport.findUnique({ where: { id: grabImport.id } })).toEqual(grabImport);

      // Doing it again changes nothing.
      await recoverImportJobs(new Date());
      expect(await snapshot(ids)).toEqual(settled);

      const queue = await get(alice, "/import/queue");
      expect(queue.body.line).toEqual({ now: null, rows: [], length: 0 });
      // Over plain HTTP, as many instances are.
      expect(queue.status).toBe(200);
      expect(queue.headers["strict-transport-security"]).toBeUndefined();
    });

    it("offers each what it can do, and flags only what's asking for attention", async () => {
      const table = await seedTable(alice.id);
      await recoverImportJobs();
      const { body } = await get(alice, "/import/queue");
      const row = (id: string) => body.jobs.find((job: { id: string }) => job.id === id);

      const quiet = { attention: false, sync_waiting: false, runner_live: false, position: null };
      const flagged = { ...quiet, attention: true };
      const expected: Record<keyof typeof table, object> = {
        syncRunning: { ...quiet, status: "PAUSED", sync_waiting: true, error_message: null, ...can("pause", "delete") },
        interrupted: { ...quiet, status: "PAUSED", sync_waiting: true, error_message: null, ...can("pause", "delete") },
        linksRunning: { ...flagged, error_message: RESTART_TEXT, running_count: 1, ...can("start", "retry", "delete") },
        zipRunning: { ...flagged, error_message: RESTART_TEXT, ...can("delete") },
        listRunning: { ...flagged, error_message: RESTART_TEXT, ...can("delete") },
        profilesRunning: { ...flagged, error_message: RESTART_TEXT, ...can("delete") },
        errorRecent: { ...flagged, error_message: RESTART_TEXT, ...can("start", "retry", "delete") },
        errorOld: { ...quiet, error_message: "Old failure", ...can("retry", "delete") },
        errorZip: { ...quiet, error_message: "Bad zip", ...can("delete") },
        parked: { ...quiet, status: "PAUSED", ...can("start", "delete") },
        pausedByHand: { ...quiet, status: "PAUSED", running_count: 1, ...can("start", "delete") },
        rateLimited: {
          ...quiet,
          status: "PAUSED",
          error_message: LIMIT_TEXT,
          failure_reason: LIMIT_TEXT,
          ...can("start", "delete"),
        },
        orphanedSync: { ...quiet, status: "PAUSED", ...can("start", "delete") },
        nothingToDo: { ...quiet, status: "PAUSED", ...can("delete") },
        doneClean: { ...quiet, status: "DONE", ...can("delete") },
        doneFailedRecent: { ...flagged, status: "DONE", ...can("retry", "delete") },
        doneFailedOld: { ...quiet, status: "DONE", ...can("retry", "delete") },
        doneZip: { ...quiet, status: "DONE", ...can("delete") },
        doneList: { ...flagged, status: "DONE", ...can("delete") },
        doneProfiles: { ...quiet, status: "DONE", ...can("delete") },
        stuckItem: { ...quiet, status: "DONE", running_count: 1, ...can("retry", "delete") },
      };
      for (const name of Object.keys(expected) as (keyof typeof table)[]) {
        expect({ name, ...row(table[name]) }).toMatchObject({ name, ...expected[name] });
      }
      // What Clear finished would take: everything finished that isn't asking for attention.
      expect(body.finished_total).toBe(7);
    });

    it("lets Retry all take only what's asking for attention and can retry, leaving what's held", async () => {
      const table = await seedTable(alice.id);
      await recoverImportJobs();
      const before = await snapshot(Object.values(table));

      const retried = await post(alice, "/import/queue/retry-failed");
      expect(retried.status).toBe(202);
      expect(retried.body).toEqual({ queued: 3 });

      const after = await snapshot(Object.values(table));
      const moved = (Object.keys(table) as (keyof typeof table)[]).filter(
        (name) => after[table[name]].status !== before[table[name]].status,
      );
      expect(moved.toSorted()).toEqual(["doneFailedRecent", "errorRecent", "linksRunning"]);
      for (const name of moved) expect(after[table[name]].status).toBe("QUEUED");
      const held = Object.values(before).filter((job) => job.status === "PAUSED");
      expect(held).toHaveLength(7);
      for (const job of held) expect(after[job.id]).toEqual(job);
    });

    it("shows an open admin page each row as it always has", async () => {
      const table = await seedTable(alice.id);
      await recoverImportJobs();
      for (const [id, expected] of [
        [table.syncRunning, { label: "paused", canStart: true, canPause: false, canRetry: false }],
        [table.linksRunning, { label: "error", canStart: true, canPause: false, canRetry: false }],
        [table.zipRunning, { label: "error", canStart: false, canPause: false, canRetry: false }],
        [table.parked, { label: "paused", canStart: true, canPause: false, canRetry: false }],
        [table.nothingToDo, { label: "paused", canStart: false, canPause: false, canRetry: false }],
        [table.doneFailedOld, { label: "doneWithFailures", canStart: false, canPause: false, canRetry: true }],
        [table.doneZip, { label: "doneWithFailures", canStart: false, canPause: false, canRetry: false }],
        [table.doneClean, { label: "done", canStart: false, canPause: false, canRetry: false }],
      ] as const) {
        expect(oldPageRow(await adminRow(id))).toEqual(expected);
      }
      // It reads a mark as it always did: the text is there on the old route.
      expect(await adminRow(table.interrupted)).toMatchObject({ status: "PAUSED", error_message: RESTART_TEXT });
    });

    it("reruns a legacy job's cut-off links on Retry, from the old tab's route", async () => {
      const job = await oldRow(
        alice.id,
        { status: "RUNNING", processed: 1, imported: 1 },
        ITEMS("DONE", "RUNNING", "PENDING"),
      );
      await recoverImportJobs();
      resumeImportWorker();
      const retry = await post(alice, `/import/jobs/${job}/retry`);
      expect(retry.status).toBe(202);
      expect(retry.body).toEqual({ job_id: job });
      await until(async () => (await statusOf(job)) === "DONE");
      expect(await reload(job)).toMatchObject({ imported: 3, failedCount: 0, errorMessage: null });
    });

    it("never runs an old batch, which has nothing to run from: only delete", async () => {
      const table = {
        zip: await oldRow(alice.id, { status: "RUNNING", type: "ZIP" }),
        list: await oldRow(alice.id, { status: "RUNNING", type: "COLLECTION", provider: "makerworld" }),
        profiles: await oldRow(alice.id, { status: "RUNNING", type: "PROFILES", provider: "makerworld" }),
      };
      await recoverImportJobs();
      resumeImportWorker();
      for (const id of Object.values(table)) {
        expect((await post(alice, `/import/jobs/${id}/retry`)).status).toBe(400);
        expect((await post(alice, `/import/queue/jobs/${id}/retry`)).status).toBe(400);
        expect((await post(alice, `/import/queue/jobs/${id}/start`)).status).toBe(400);
        expect((await post(admin, `/admin/import-queue/jobs/${id}/retry`)).status).toBe(400);
        await importWorkerIdle();
        expect(await statusOf(id)).toBe("ERROR");
        expect((await del(alice, `/import/queue/jobs/${id}`)).status).toBe(200);
      }
      expect(fetched).toEqual([]);
    });

    it("lets its owner start links parked by Grab, with the choices each came with", async () => {
      const collection = await newCollection(alice.id, "Parked");
      const url = modelUrl(designId());
      const job = await oldRow(alice.id, { status: "PAUSED", label: "Sent from Thingport Grab", total: 2 }, [
        { status: "PENDING", url, payload: { collection_id: collection.id, scope: "url", title: "A title" } },
        { status: "PENDING", payload: ITEM_PAYLOAD },
      ]);
      await recoverImportJobs();
      resumeImportWorker();
      await importWorkerIdle();
      expect(await statusOf(job)).toBe("PAUSED");

      // Old Grab goes on adding to the job it knows.
      const another = await post(alice, "/import/queue", { url: modelUrl(designId()), scope: "url" });
      expect(another.status).toBe(201);
      expect(another.body).toMatchObject({ job_id: job, duplicate: false, waiting: 3 });
      const again = await post(alice, "/import/queue", { url });
      expect(again.status).toBe(200);
      expect(again.body).toMatchObject({ job_id: job, duplicate: true, waiting: 3 });

      const started = await post(alice, `/import/queue/jobs/${job}/start`);
      expect(started.status).toBe(202);
      expect(started.body).toMatchObject({ job_id: job, status: "QUEUED", sync_waiting: false });
      await until(async () => (await statusOf(job)) === "DONE");
      expect(await reload(job)).toMatchObject({ imported: 3, failedCount: 0 });
      expect(await prisma.collectionItem.count({ where: { collectionId: collection.id } })).toBe(1);
      const items = await get(alice, `/import/jobs/${job}/items`);
      expect(items.body[0]).toMatchObject({ url, title: "A title", collection_id: collection.id, scope: "url" });
    });

    it("tolerates what's gone since a job was parked: an admin's Start still brings it in", async () => {
      const job = await oldRow(
        alice.id,
        {
          status: "PAUSED",
          label: "Sent from Thingport Grab",
          payload: { ...JOB_PAYLOAD, category_id: "category-long-gone" },
        },
        [{ status: "PENDING", payload: { collection_id: "collection-long-gone", scope: "url", title: null } }],
      );
      await recoverImportJobs();
      resumeImportWorker();
      const started = await post(admin, `/admin/import-queue/jobs/${job}/start`);
      expect(started.status).toBe(202);
      expect(started.body).toEqual({ ok: true });
      await until(async () => (await statusOf(job)) === "DONE");
      expect(await reload(job)).toMatchObject({ imported: 1, failedCount: 0 });
    });

    it("reruns a link a pause left reading as running, on Start", async () => {
      const job = await oldRow(alice.id, { status: "PAUSED", processed: 1, imported: 1 }, ITEMS("DONE", "RUNNING"));
      await recoverImportJobs();
      resumeImportWorker();
      await post(alice, `/import/queue/jobs/${job}/start`);
      await until(async () => (await statusOf(job)) === "DONE");
      expect(await reload(job)).toMatchObject({ imported: 2, failedCount: 0 });
    });

    it("runs a job its sync left behind without a sync's pace, and collects nothing new in it", async () => {
      const job = await oldRow(
        alice.id,
        { status: "PAUSED", label: "Sync: Gone", payload: SYNC_PAYLOAD },
        ITEMS("PENDING", "PENDING"),
      );
      await recoverImportJobs();
      expect((await linksJobBody(await reload(job))).itemDelayMs).toBeUndefined();

      const added = await post(alice, "/import/queue", { url: modelUrl(designId()) });
      expect(added.status).toBe(201);
      expect(added.body.job_id).not.toBe(job);
      expect(added.body.waiting).toBe(1);

      resumeImportWorker();
      await post(alice, `/import/queue/jobs/${job}/start`);
      // At the stored pace this would take a minute.
      await until(async () => (await statusOf(job)) === "DONE");
      expect(await reload(job)).toMatchObject({ imported: 2, sourceLabel: "Sync: Gone" });
    });

    it("keeps a sync's stored pace for its own job", async () => {
      const sync = await newSync(alice.id);
      const job = await oldRow(
        alice.id,
        { status: "PAUSED", payload: SYNC_PAYLOAD, syncId: sync.id },
        ITEMS("PENDING"),
      );
      expect((await linksJobBody(await reload(job))).itemDelayMs).toBe(60_000);
    });

    it("refuses Start on a job with nothing to do, and deletes it", async () => {
      const job = await oldRow(alice.id, { status: "PAUSED" }, ITEMS("DONE"));
      await recoverImportJobs();
      for (const res of [
        await post(alice, `/import/queue/jobs/${job}/start`),
        await post(admin, `/admin/import-queue/jobs/${job}/start`),
      ]) {
        expect(res.status).toBe(400);
        expect(res.body.detail).toBe("This import has no links waiting to import");
      }
      expect((await del(admin, `/admin/import-queue/jobs/${job}`)).body).toEqual({ ok: true });

      const failed = await oldRow(alice.id, { status: "ERROR", errorMessage: "x" }, ITEMS("FAILED"));
      const start = await post(admin, `/admin/import-queue/jobs/${failed}/start`);
      expect(start.status).toBe(400);
      expect(start.body.detail).toBe("This import has no links waiting to import");
    });

    it("retries a list with no saved request the way it always could: not at all", async () => {
      const job = await oldRow(alice.id, {
        status: "ERROR",
        failedCount: 1,
        type: "COLLECTION",
        provider: "makerworld",
      });
      const { body } = await get(alice, "/import/queue");
      expect(body.jobs.find((row: { id: string }) => row.id === job)).toMatchObject(can("delete"));
      expect((await post(alice, "/import/queue/retry-failed")).body).toEqual({ queued: 0 });
    });

    it("runs a link list with no payload at all, as it could", async () => {
      const job = await oldRow(alice.id, { status: "ERROR", failedCount: 1, payload: null }, ITEMS("FAILED"));
      resumeImportWorker();
      expect((await post(alice, `/import/jobs/${job}/retry`)).status).toBe(202);
      await until(async () => (await statusOf(job)) === "DONE");
      expect(await reload(job)).toMatchObject({ imported: 1, failedCount: 0 });
    });

    it("has nothing left to settle or run of someone since deleted", async () => {
      const leaving = await prisma.user.create({
        data: { email: `upgrade-gone-${stamp}@example.com`, displayName: "Gone" },
      });
      const jobs = [
        await oldRow(leaving.id, { status: "RUNNING" }, ITEMS("RUNNING")),
        await oldRow(leaving.id, { status: "PAUSED", label: "Sent from Thingport Grab" }, ITEMS("PENDING")),
      ];
      await prisma.user.delete({ where: { id: leaving.id } });
      expect(await prisma.importJob.count({ where: { id: { in: jobs } } })).toBe(0);
      await expect(recoverImportJobs()).resolves.toBeUndefined();
    });

    it("hands a link of a provider that waits for Grab to Grab, in the line and out of it", async () => {
      const page = "https://www.makeronline.com/en/model/38684";
      const collection = await newCollection(alice.id, "Waiting");
      const parked = await oldRow(alice.id, { status: "PAUSED", label: "Sent from Thingport Grab" }, [
        { status: "PENDING", url: page, payload: { collection_id: collection.id, scope: "all", title: null } },
      ]);
      resumeImportWorker();
      await post(alice, `/import/queue/jobs/${parked}/start`);
      await until(async () => (await statusOf(parked)) === "DONE");
      expect(await prisma.grabImport.findMany({ where: { userId: alice.id } })).toMatchObject([
        { provider: "makeronline", url: page, scope: "all", collectionId: collection.id },
      ]);
      expect(fetched.filter((url) => url.includes("makeronline"))).toEqual([]);

      const single = await post(alice, "/import?queue=1", { url: "https://www.makeronline.com/en/model/38685" });
      expect(single.status).toBe(202);
      await until(async () => (await statusOf(single.body.job_id)) === "DONE");
      expect(await prisma.grabImport.count({ where: { userId: alice.id } })).toBe(2);
      expect(await reload(single.body.job_id)).toMatchObject({ failedCount: 0, resultPrintId: null });
    });

    it("lets the line run past a job its owner has running", async () => {
      const sync = await newSync(alice.id);
      await oldRow(alice.id, { status: "RUNNING" }, ITEMS("RUNNING"));
      await oldRow(alice.id, { status: "RUNNING", syncId: sync.id, payload: SYNC_PAYLOAD }, ITEMS("RUNNING"));
      const started = await post(alice, "/import/links?queue=1", { urls: [modelUrl(designId())] });
      expect(started.status).toBe(202);
      resumeImportWorker();
      await until(async () => (await statusOf(started.body.job_id)) === "DONE");
      await prisma.importJob.updateMany({ where: { userId: alice.id, status: "RUNNING" }, data: { status: "DONE" } });
    });
  });

  describe("the masks", () => {
    beforeEach(() => {
      holdImportWorker();
    });

    it("reads a waiting job as RUNNING everywhere an old client looks, and for real where asked", async () => {
      const started = await post(alice, "/import/links?queue=1", { urls: [modelUrl(designId())] });
      expect(started.status).toBe(202);
      expect(started.body).toEqual({ job_id: expect.any(String), status: "QUEUED", position: 1 });
      const id: string = started.body.job_id;

      for (const query of ["", "?queue=0", "?queue=true", "?queue="]) {
        const masked = await get(alice, `/import/jobs/${id}${query}`);
        expect(masked.body.status).toBe("RUNNING");
        expect(Object.keys(masked.body).toSorted()).toEqual(OLD_JOB_KEYS);
      }
      const real = await get(alice, `/import/jobs/${id}?queue=1`);
      expect(real.body.status).toBe("QUEUED");
      expect(Object.keys(real.body).toSorted()).toEqual(OLD_JOB_KEYS);

      // Tokens read what scripts always read.
      const { token } = (await request(app).post("/api/profile/api-token").set(auth(alice))).body;
      const viaToken = await request(app)
        .get(`/api/import/jobs/${id}`)
        .set({ Authorization: `Bearer ${token}` });
      expect(viaToken.body.status).toBe("RUNNING");

      // The active job is the one really running, and the tasks route knows nothing of jobs.
      expect((await get(alice, "/import/jobs/active")).body).toBeNull();
      expect((await get(alice, `/import/tasks/${id}`)).status).toBe(404);

      expect(await adminRow(id)).toMatchObject({ status: "RUNNING", runner_live: true });
      const page = (await get(admin, "/admin/import-queue?queue=1")).body;
      expect(page.jobs.find((job: { id: string }) => job.id === id)).toMatchObject({ status: "QUEUED", position: 1 });
      expect((await get(alice, "/import/queue")).body.jobs[0]).toMatchObject({ id, status: "QUEUED", position: 1 });
    });

    it("hands a held job's real status to everyone: nothing old can be following one", async () => {
      const started = await post(alice, "/import/zip?queue=1", { url: ZIP_URL, entries: ["hull.stl"] });
      await post(alice, `/import/queue/jobs/${started.body.job_id}/pause`);
      const held = await get(alice, `/import/jobs/${started.body.job_id}`);
      expect(held.body.status).toBe("PAUSED");
    });

    it.each([
      ["a restart's", RESTART_TEXT],
      ["a turn's", SYNC_JOB_WAITING],
    ])("keeps %s mark as the message on an ERROR job, on every read", async (_label, text) => {
      const sync = await newSync(alice.id);
      const job = await oldRow(alice.id, {
        status: "ERROR",
        errorMessage: text,
        syncId: sync.id,
        payload: SYNC_PAYLOAD,
      });
      const sameText = { status: "ERROR", error_message: text };

      for (const query of ["", "?queue=1"]) {
        expect((await get(alice, `/import/jobs/${job}${query}`)).body).toMatchObject(sameText);
      }
      expect(await adminRow(job)).toMatchObject(sameText);
      const own = { ...sameText, sync_waiting: false, failure_reason: text };
      expect((await get(alice, "/import/queue")).body.jobs.find((j: { id: string }) => j.id === job)).toMatchObject(
        own,
      );
      const page = (await get(admin, "/admin/import-queue?queue=1")).body;
      expect(page.jobs.find((j: { id: string }) => j.id === job)).toMatchObject(own);
    });

    it.each([
      ["a restart's", RESTART_TEXT],
      ["a turn's", SYNC_JOB_WAITING],
    ])("reads %s mark on a held sync job as how it waits, old reads keeping the text", async (_label, text) => {
      const sync = await newSync(alice.id);
      const job = await oldRow(
        alice.id,
        { status: "PAUSED", errorMessage: text, syncId: sync.id, payload: SYNC_PAYLOAD },
        ITEMS("PENDING"),
      );
      expect((await get(alice, `/import/jobs/${job}`)).body).toMatchObject({ status: "PAUSED", error_message: text });
      expect(await adminRow(job)).toMatchObject({ status: "PAUSED", error_message: text });
      const own = { status: "PAUSED", error_message: null, sync_waiting: true, failure_reason: null };
      expect((await get(alice, "/import/queue")).body.jobs.find((j: { id: string }) => j.id === job)).toMatchObject(
        own,
      );
    });

    it("keeps the words a sync looks for to pick its job back up", () => {
      expect(SYNC_JOB_INTERRUPTED).toBe(RESTART_TEXT);
    });
  });

  describe("an admin page from before the line", () => {
    beforeEach(() => {
      holdImportWorker();
    });

    it("gets the list and each row as it always was", async () => {
      const job = await oldRow(alice.id, { status: "PAUSED" }, ITEMS("PENDING", "DONE", "FAILED", "RUNNING"));
      const { status, body } = await get(admin, "/admin/import-queue");
      expect(status).toBe(200);
      expect(Object.keys(body).toSorted()).toEqual(["bulk", "jobs"]);
      expect(body.bulk).toEqual({ running: false, currentJobId: null, remaining: 0 });
      const row = body.jobs.find((j: OldJob) => j.id === job);
      expect(Object.keys(row).toSorted()).toEqual(OLD_ADMIN_KEYS);
      expect(row).toMatchObject({
        owner: { id: alice.id, display_name: "Upgrade alice", email: `upgrade-alice-${stamp}@example.com` },
        pending_count: 1,
        running_count: 1,
        done_count: 1,
        failed_items_count: 1,
        runner_live: false,
      });
      const items = await get(admin, `/admin/import-queue/jobs/${job}/items`);
      expect(Object.keys(items.body[0]).toSorted()).toEqual(OLD_ITEM_KEYS);
    });

    it("says running for a job in line, not stalled, and stalled for one really left", async () => {
      const inLine = await post(alice, "/import/links?queue=1", { urls: [modelUrl(designId())] });
      const left = await oldRow(alice.id, { status: "RUNNING" }, ITEMS("RUNNING"));

      expect(oldPageRow(await adminRow(inLine.body.job_id))).toEqual({
        label: "running",
        canStart: false,
        canPause: true,
        canRetry: false,
      });
      const stale = await adminRow(left);
      expect(stale.runner_live).toBe(false);
      expect(oldPageRow(stale).label).toBe("stalled");
    });

    it("tells who the line is on through bulk, as its own run used to", async () => {
      resumeImportWorker();
      const line = await busyLine();
      expect((await adminList()).bulk).toEqual({ running: true, currentJobId: line.running, remaining: 1 });
      expect(await adminRow(line.running)).toMatchObject({ status: "RUNNING", runner_live: true });
      expect(await adminRow(line.waiting)).toMatchObject({ status: "RUNNING", runner_live: true });
    });

    it("answers each action as it always did, on what it thinks it's looking at", async () => {
      const started = await post(alice, "/import/links?queue=1", {
        urls: [modelUrl(designId()), modelUrl(designId())],
      });
      const id: string = started.body.job_id;

      // Pause, the only thing it offers on a row reading as running, takes it off the line.
      const pause = await post(admin, `/admin/import-queue/jobs/${id}/pause`);
      expect(pause.status).toBe(200);
      expect(pause.body).toEqual({ ok: true });
      expect(await statusOf(id)).toBe("PAUSED");
      expect(oldPageRow(await adminRow(id))).toMatchObject({ label: "paused", canStart: true });
      const twice = await post(admin, `/admin/import-queue/jobs/${id}/pause`);
      expect(twice.status).toBe(400);
      expect(twice.body.detail).toBe("Only a running import can be paused");

      const start = await post(admin, `/admin/import-queue/jobs/${id}/start`);
      expect(start.status).toBe(202);
      expect(start.body).toEqual({ ok: true });
      expect(await statusOf(id)).toBe("QUEUED");
      // A click from a page that hasn't noticed yet.
      expect((await post(admin, `/admin/import-queue/jobs/${id}/start`)).body).toEqual({ ok: true });

      await post(admin, `/admin/import-queue/jobs/${id}/pause`);
      const items = await prisma.importJobItem.findMany({ where: { jobId: id } });
      expect((await del(admin, `/admin/import-queue/items/${items[0].id}`)).body).toEqual({ jobDeleted: false });
      expect((await del(admin, `/admin/import-queue/jobs/${id}`)).body).toEqual({ ok: true });

      const failed = await oldRow(alice.id, { status: "DONE", failedCount: 1 }, ITEMS("FAILED"));
      const retry = await post(admin, `/admin/import-queue/jobs/${failed}/retry`);
      expect(retry.status).toBe(202);
      expect(retry.body).toEqual({ ok: true });
      expect(oldPageRow(await adminRow(failed))).toMatchObject({ label: "running" });
    });

    it("gets a stalled job going the way it always did: Pause, then Start", async () => {
      const left = await oldRow(alice.id, { status: "RUNNING" }, ITEMS("RUNNING"));
      expect((await post(admin, `/admin/import-queue/jobs/${left}/pause`)).body).toEqual({ ok: true });
      expect(oldPageRow(await adminRow(left))).toMatchObject({ label: "paused", canStart: true });
      resumeImportWorker();
      expect((await post(admin, `/admin/import-queue/jobs/${left}/start`)).status).toBe(202);
      await until(async () => (await statusOf(left)) === "DONE");
    });

    it("starts every paused link list and nothing else, as Start all always did", async () => {
      const held = await oldRow(alice.id, { status: "PAUSED" }, ITEMS("PENDING"));
      const another = await oldRow(bob.id, { status: "PAUSED" }, ITEMS("PENDING"));
      const heldZip = await oldRow(alice.id, {
        status: "PAUSED",
        type: "ZIP",
        payload: { ...JOB_PAYLOAD, entries: ["hull.stl"] },
      });
      const heldList = await oldRow(alice.id, {
        status: "PAUSED",
        type: "COLLECTION",
        provider: "makerworld",
        payload: { ...JOB_PAYLOAD, model_ids: ["1"] },
      });
      const cutOff = await oldRow(alice.id, { status: "ERROR", errorMessage: RESTART_TEXT }, ITEMS("PENDING"));

      const res = await post(admin, "/admin/import-queue/start-all");
      expect(res.status).toBe(202);
      expect(res.body).toEqual({
        queued: 2,
        bulk: { running: true, currentJobId: null, remaining: 2 },
      });
      expect(await statusOf(held)).toBe("QUEUED");
      expect(await statusOf(another)).toBe("QUEUED");
      expect(await statusOf(heldZip)).toBe("PAUSED");
      expect(await statusOf(heldList)).toBe("PAUSED");
      expect(await statusOf(cutOff)).toBe("ERROR");
    });

    it("retries every failed link list, however old, and nothing else, as Retry all always did", async () => {
      const old = await oldRow(alice.id, { status: "DONE", failedCount: 1, at: longAgo() }, ITEMS("FAILED"));
      const erred = await oldRow(
        bob.id,
        { status: "ERROR", failedCount: 1, errorMessage: "x", at: longAgo() },
        ITEMS("FAILED"),
      );
      const clean = await oldRow(alice.id, { status: "DONE" }, ITEMS("DONE"));
      const cutOff = await oldRow(alice.id, { status: "ERROR", errorMessage: RESTART_TEXT }, ITEMS("PENDING"));
      const list = await oldRow(alice.id, {
        status: "ERROR",
        type: "COLLECTION",
        provider: "makerworld",
        failedCount: 1,
        payload: { ...JOB_PAYLOAD, model_ids: ["1"] },
      });

      const res = await post(admin, "/admin/import-queue/retry-failed");
      expect(res.status).toBe(202);
      expect(res.body).toEqual({ queued: 2, bulk: { running: true, currentJobId: null, remaining: 2 } });
      expect(await statusOf(old)).toBe("QUEUED");
      expect(await statusOf(erred)).toBe("QUEUED");
      expect(await statusOf(clean)).toBe("DONE");
      expect(await statusOf(cutOff)).toBe("ERROR");
      expect(await statusOf(list)).toBe("ERROR");
    });

    it("holds what's waiting too on Pause all, counting only what ran, and leaves what can't stop", async () => {
      const waiting = await post(alice, "/import/links?queue=1", { urls: [modelUrl(designId())] });
      const running = await oldRow(alice.id, { status: "RUNNING" }, ITEMS("RUNNING"));
      const zip = await oldRow(bob.id, { status: "RUNNING", type: "ZIP" });

      const res = await post(admin, "/admin/import-queue/pause-all");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ paused: 1, bulk: { running: false, currentJobId: null, remaining: 0 } });
      expect(await statusOf(waiting.body.job_id)).toBe("PAUSED");
      expect(await statusOf(running)).toBe("PAUSED");
      expect(await statusOf(zip)).toBe("RUNNING");
      await prisma.importJob.delete({ where: { id: zip } });
    });

    it("clears what finished clean on Clear finished, every type and everyone's, and nothing else", async () => {
      const gonna = [
        await oldRow(alice.id, { status: "DONE", at: longAgo() }, ITEMS("DONE")),
        await oldRow(bob.id, { status: "DONE" }, ITEMS("DONE")),
        await oldRow(alice.id, { status: "DONE", type: "ZIP" }),
      ];
      const staying = [
        await oldRow(alice.id, { status: "DONE", failedCount: 1, at: longAgo() }, ITEMS("FAILED")),
        await oldRow(alice.id, { status: "DONE", type: "ZIP", failedCount: 1, at: longAgo() }),
        await oldRow(alice.id, { status: "ERROR", errorMessage: "x", at: longAgo() }),
        await oldRow(alice.id, { status: "PAUSED" }, ITEMS("PENDING")),
      ];
      const inLine = await post(alice, "/import/links?queue=1", { urls: [modelUrl(designId())] });

      const res = await post(admin, "/admin/import-queue/clear-finished");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ deleted: 3 });
      expect(await prisma.importJob.count({ where: { id: { in: gonna } } })).toBe(0);
      expect(await prisma.importJob.count({ where: { id: { in: [...staying, inLine.body.job_id] } } })).toBe(5);
    });

    it("stays out of reach of a token, even an admin's", async () => {
      const { token } = (await request(app).post("/api/profile/api-token").set(auth(admin))).body;
      for (const path of ["/api/admin/import-queue", "/api/admin/import-queue?queue=1"]) {
        const res = await request(app)
          .get(path)
          .set({ Authorization: `Bearer ${token}` });
        expect(res.status).toBe(403);
      }
    });
  });

  describe("boot", () => {
    it("recovers first, listens whatever happens, and only then starts the worker", () => {
      const server = fs.readFileSync(join(process.cwd(), "src/server.ts"), "utf8");
      const order = ["holdImportWorker();", "await recoverImportJobs(", "app.listen(", "startImportWorker();"].map(
        (step) => server.indexOf(step),
      );
      expect(order.every((at) => at >= 0)).toBe(true);
      expect(order).toEqual(order.toSorted((a, b) => a - b));
      const made = fs.readFileSync(join(process.cwd(), "src/app.ts"), "utf8");
      expect(made).not.toMatch(/startImportWorker|recoverImportJobs|holdImportWorker/);
    });

    it("needs no new setting to be given", () => {
      expect(IMPORT_STALL_LIMIT_MINUTES).toBe(Number(process.env.IMPORT_STALL_LIMIT_MINUTES ?? 60));
    });

    it("keeps the line shut while a late recovery fails, then leaves everything started since", async () => {
      holdImportWorker();
      importWorkerTuning.recoveryRetryMs = 10;
      const left = await oldRow(alice.id, { status: "RUNNING" }, ITEMS("RUNNING"));
      const leftSync = await oldRow(
        alice.id,
        { status: "RUNNING", syncId: (await newSync(alice.id)).id, payload: SYNC_PAYLOAD },
        ITEMS("RUNNING"),
      );
      const inLine = await post(admin, "/import/links?queue=1", { urls: [modelUrl(designId())] });
      await sleep(5);
      const bootedAt = new Date();
      await sleep(5);

      // The recovery at boot failed, but the server is up, so someone's direct import runs.
      const id = designId();
      const release = gate(id);
      const direct = await post(bob, "/import/links", { urls: [modelUrl(id)] });
      expect(direct.status).toBe(202);
      await until(() => fetched.some((url) => url.includes(`/design/${id}`)));

      const failing = vi.spyOn(prisma.importJob, "updateMany").mockRejectedValueOnce(new Error("database is away"));
      startImportWorkerAfterRecovery(bootedAt);
      await until(() => failing.mock.calls.length > 0);
      expect(await statusOf(inLine.body.job_id)).toBe("QUEUED");

      await until(async () => (await statusOf(left)) === "ERROR");
      expect(await reload(left)).toMatchObject({ errorMessage: RESTART_TEXT });
      expect(await reload(leftSync)).toMatchObject({ status: "PAUSED", errorMessage: RESTART_TEXT });
      // Still its own: started after the boot, with its runner going.
      expect(await statusOf(direct.body.job_id)).toBe("RUNNING");
      expect(isRunnerLive(direct.body.job_id)).toBe(true);

      await until(async () => (await statusOf(inLine.body.job_id)) === "DONE");
      release();
      await until(async () => (await statusOf(direct.body.job_id)) === "DONE");
      expect(await reload(direct.body.job_id)).toMatchObject({ imported: 1, failedCount: 0 });
    });
  });

  describe("the migration", () => {
    const home = new URL(process.env.DATABASE_URL!);
    const name = `${home.pathname.slice(1)}_upgrade`;
    const url = new URL(home);
    url.pathname = `/${name}`;
    const MIGRATIONS = join(process.cwd(), "prisma/migrations");
    const OURS = "20261116120000_import_queue";
    const sql = () => fs.readFileSync(join(MIGRATIONS, OURS, "migration.sql"), "utf8");

    afterAll(async () => {
      await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    });

    it("sorts after what it builds on, and uses nothing it adds", () => {
      const all = fs.readdirSync(MIGRATIONS).toSorted();
      for (const earlier of ["20261115120000_generator_script_withheld", "20261115120000_grab_import_provider"]) {
        expect(all.indexOf(OURS)).toBeGreaterThan(all.indexOf(earlier));
      }
      const statements = sql().replace(/--.*$/gm, "");
      // PostgreSQL won't use a value in the transaction that added it, and no row changes state.
      expect(statements.match(/QUEUED/g)).toHaveLength(1);
      expect(statements).toMatch(/ALTER TYPE "ImportJobStatus" ADD VALUE IF NOT EXISTS 'QUEUED'/);
      expect(statements).not.toMatch(/\b(UPDATE|DELETE|INSERT)\b/i);
      // Any new column on a row that's there has to do without being told.
      for (const added of statements.match(/ADD COLUMN[^;]*/g) ?? []) {
        expect(added).toMatch(/TIMESTAMP\(3\)|BOOLEAN NOT NULL DEFAULT false/);
      }
    });

    it("carries a database full of old rows across, none of them changed", async () => {
      const folder = fs.mkdtempSync(join(os.tmpdir(), "thingport-upgrade-"));
      const schema = join(folder, "schema.prisma");
      const env = { ...process.env, DATABASE_URL: url.toString() };
      const deploy = () =>
        execFileSync("npx", ["prisma", "migrate", "deploy", "--schema", schema], { env, stdio: "pipe" });

      fs.copyFileSync(join(process.cwd(), "prisma/schema.prisma"), schema);
      fs.cpSync(MIGRATIONS, join(folder, "migrations"), {
        recursive: true,
        filter: (source) => !source.includes(OURS),
      });
      await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await prisma.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
      deploy();

      const client = new PrismaClient({ datasources: { db: { url: url.toString() } } });
      try {
        const owner = `old-user-${stamp}`;
        await client.$executeRaw`
          INSERT INTO "User" ("id", "email", "displayName", "updatedAt")
          VALUES (${owner}, ${`old-${stamp}@example.com`}, 'Old', NOW())`;
        const stored = await client.notification.create({
          data: { userId: owner, type: "queue", title: "Links are waiting", internalPath: "/admin-queue" },
        });
        await seedTable(owner, client);
        const read = () => client.$queryRaw`
          SELECT "id", "status"::text, "type"::text, "errorMessage", "payload", "collectionSyncId", "updatedAt"
          FROM "ImportJob" ORDER BY "id"`;
        const before = await read();
        expect(before).toHaveLength(21);

        fs.cpSync(join(MIGRATIONS, OURS), join(folder, "migrations", OURS), { recursive: true });
        deploy();

        expect(await read()).toEqual(before);
        const migrated = await client.importJob.findMany({ select: { queuedAt: true, startedAt: true } });
        expect(migrated).toHaveLength(21);
        for (const row of migrated) expect(row).toEqual({ queuedAt: null, startedAt: null });
        const user = await client.user.findUniqueOrThrow({ where: { id: owner } });
        expect(user.startGrabLinks).toBe(false);
        expect(await client.notification.findUnique({ where: { id: stored.id } })).toEqual(stored);

        const [applied] = await client.$queryRaw<{ finished_at: Date | null; rolled_back_at: Date | null }[]>`
          SELECT "finished_at", "rolled_back_at" FROM "_prisma_migrations" WHERE "migration_name" = ${OURS}`;
        expect(applied.finished_at).not.toBeNull();
        expect(applied.rolled_back_at).toBeNull();

        const labels = async (type: string) =>
          (
            await client.$queryRaw<{ enumlabel: string }[]>`
              SELECT "enumlabel" FROM pg_enum e JOIN pg_type t ON t."oid" = e."enumtypid" WHERE t."typname" = ${type}`
          )
            .map((row) => row.enumlabel)
            .toSorted();
        expect(await labels("ImportJobStatus")).toEqual(["DONE", "ERROR", "PAUSED", "QUEUED", "RUNNING"]);
        expect(await labels("ImportJobType")).toEqual(["COLLECTION", "LINKS", "PROFILES", "ZIP"]);

        // The new value is good once it has committed, and running it again, as after a resolve, changes nothing.
        expect(await client.importJob.updateMany({ where: { status: "PAUSED" }, data: { status: "QUEUED" } })).toEqual({
          count: 6,
        });
        execFileSync(
          "npx",
          ["prisma", "db", "execute", "--file", join(MIGRATIONS, OURS, "migration.sql"), "--schema", schema],
          {
            env,
            stdio: "pipe",
          },
        );
      } finally {
        await client.$disconnect();
        fs.rmSync(folder, { recursive: true, force: true });
      }
    }, 180_000);
  });
});
