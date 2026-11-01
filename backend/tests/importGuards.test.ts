import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

// No pacing or DNS here. config.ts reads the pace on load, so it's hoisted.
vi.hoisted(() => {
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
import { prisma } from "../src/db";
import {
  hasActiveCollectionSync,
  releaseSync,
  reserveSync,
  runSyncRound,
  syncCollection,
} from "../src/services/collectionSyncRunner";
import { getDatabaseInfo, testAndSwitchDatabase } from "../src/services/databaseSettingsService";
import { rawFetch } from "../src/services/guardedFetch";
import { withImportActivity } from "../src/services/importActivity";
import { trackRunner } from "../src/services/importJobRunner";
import { enqueueSingleImport } from "../src/services/importQueueService";
import { fetchImageBytes, streamToFileCapped } from "../src/services/importService";
import { hasRunningImportTasks, startImportTask } from "../src/services/importTaskService";
import {
  beginDatabaseSwitch,
  endDatabaseSwitch,
  holdImportWorker,
  importWorkerIdle,
  importWorkerTuning,
  isDatabaseSwitching,
  recoverAfterDatabaseSwitch,
  resumeImportWorker,
  wakeImportWorker,
} from "../src/services/importWorker";
import { HttpError } from "../src/utils/fileUtils";
import { bodyReadTuning, readCapped, withIdleLimit } from "../src/utils/readCapped";

const app = createApp();
const stamp = Date.now();
const tuning = { ...importWorkerTuning };
const originalFetch = global.fetch;

function deferred() {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { held, release };
}

describe("a body that goes silent", () => {
  const IDLE_MS = 300;
  // A byte every 50 ms for longer than the limit: it has to be silence that fails a body, not time taken.
  const TRICKLED = 14;
  let server: http.Server;
  let origin: string;
  const hungUp = new Set<string>();

  beforeAll(async () => {
    bodyReadTuning.idleMs = IDLE_MS;
    server = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.on("close", () => hungUp.add(req.url!));
      if (req.url!.startsWith("/stalls")) {
        res.write("ab");
      } else if (req.url!.startsWith("/silent")) {
        res.flushHeaders();
      } else {
        let sent = 0;
        const timer = setInterval(() => {
          res.write("x");
          if (++sent < TRICKLED) return;
          clearInterval(timer);
          res.end();
        }, 50);
        res.on("close", () => clearInterval(timer));
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    bodyReadTuning.idleMs = 60_000;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  /** How a read ended, once the sender has been hung up on. */
  async function stall(url: string, read: () => Promise<unknown>) {
    const from = Date.now();
    const failure = await read().then(
      () => null,
      (err: unknown) => err,
    );
    await vi.waitFor(() => expect(hungUp.has(url)).toBe(true));
    return {
      transient: failure instanceof HttpError && failure.transient,
      inTime: Date.now() - from < IDLE_MS * 5,
    };
  }
  const STALLED = { transient: true, inTime: true };

  // rawFetch refuses local addresses, so it's given a public one and the request lands on this server.
  const PUBLIC_ORIGIN = "http://93.184.216.34";
  async function fromPublicHost<T>(read: () => Promise<T>): Promise<T> {
    global.fetch = ((url, init) => originalFetch(`${origin}${new URL(String(url)).pathname}`, init)) as typeof fetch;
    try {
      return await read();
    } finally {
      global.fetch = originalFetch;
    }
  }

  it("fails readCapped as transient", async () => {
    const res = await fetch(`${origin}/stalls-read`);
    expect(await stall("/stalls-read", () => readCapped(res, 1000))).toEqual(STALLED);
  });

  it("fails readCapped when no byte ever came", async () => {
    const res = await fetch(`${origin}/silent-read`);
    expect(await stall("/silent-read", () => readCapped(res, 1000))).toEqual(STALLED);
  });

  it("fails streamToFileCapped as transient", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "thingport-guards-"));
    const res = await fetch(`${origin}/stalls-file`);
    expect(await stall("/stalls-file", () => streamToFileCapped(res, path.join(dir, "file"), 1000))).toEqual(STALLED);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("gives no picture from fetchImageBytes, within the limit", async () => {
    const from = Date.now();
    await expect(fromPublicHost(() => fetchImageBytes(`${PUBLIC_ORIGIN}/stalls-image`))).resolves.toBeNull();
    await vi.waitFor(() => expect(hungUp.has("/stalls-image")).toBe(true));
    expect(Date.now() - from).toBeLessThan(IDLE_MS * 5);
  });

  it("lets a body that trickles finish, however long it takes", async () => {
    const from = Date.now();
    const { buffer, truncated } = await readCapped(await fetch(`${origin}/trickle-read`), 1000);
    expect(Date.now() - from).toBeGreaterThan(IDLE_MS);
    expect({ size: buffer.length, truncated }).toEqual({ size: TRICKLED, truncated: false });

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "thingport-guards-"));
    const file = path.join(dir, "file");
    await expect(streamToFileCapped(await fetch(`${origin}/trickle-file`), file, 1000)).resolves.toBe(TRICKLED);
    expect((await fs.readFile(file)).length).toBe(TRICKLED);
    await fs.rm(dir, { recursive: true, force: true });

    const picture = await fromPublicHost(() => fetchImageBytes(`${PUBLIC_ORIGIN}/trickle-image`));
    expect(picture?.length).toBe(TRICKLED);
  });

  it("still gives no picture past the cap", async () => {
    global.fetch = vi.fn<typeof fetch>(async () => new Response(new Uint8Array(16 * 1024 * 1024 + 1)));
    try {
      await expect(fetchImageBytes("https://images.example.com/huge.png")).resolves.toBeNull();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("is a sign of life per chunk, and so is asking", async () => {
    const asked = { lastActivity: 0 };
    const res = await fromPublicHost(() =>
      withImportActivity(asked, () => rawFetch(`${PUBLIC_ORIGIN}/trickle-beat`, {})),
    );
    expect(asked.lastActivity).toBeGreaterThan(0);

    const reading = { lastActivity: 0 };
    const beats: number[] = [];
    const watching = setInterval(() => beats.push(reading.lastActivity), 40);
    await withImportActivity(reading, () => readCapped(res, 1000));
    clearInterval(watching);
    expect(new Set(beats.filter(Boolean)).size).toBeGreaterThan(3);
  });

  describe("through Chrome's handshake", () => {
    // tests/setup.ts sends browserFetch through global.fetch, which has a limit of its own. This is the real one.
    const realBrowserFetch = async () =>
      (await vi.importActual<typeof import("../src/utils/browserFetch")>("../src/utils/browserFetch")).browserFetch;

    it("fails whatever reads the body", async () => {
      const browserFetch = await realBrowserFetch();
      const res = await browserFetch(`${origin}/stalls-browser`, {});
      const failure = await res.text().catch((err: unknown) => err);
      expect(failure).toBeInstanceOf(HttpError);
      expect((failure as HttpError).transient).toBe(true);
    });

    it("lets a body that trickles finish", async () => {
      const browserFetch = await realBrowserFetch();
      const res = await browserFetch(`${origin}/trickle-browser`, {});
      expect((await res.text()).length).toBe(TRICKLED);
    });

    it("doesn't take a reader busy with the last chunk for silence", async () => {
      const source = new ReadableStream<Uint8Array>({
        pull: (controller) => controller.enqueue(new Uint8Array([1])),
      });
      const reader = withIdleLimit(source).getReader();
      await reader.read();
      await new Promise((resolve) => setTimeout(resolve, IDLE_MS * 2));
      expect((await reader.read()).done).toBe(false);
      await reader.cancel();
    });
  });
});

describe("switching the database", () => {
  const home = new URL(process.env.DATABASE_URL!);
  const homeName = home.pathname.slice(1);
  const credsFor = (database: string) => ({
    database,
    user: decodeURIComponent(home.username),
    password: decodeURIComponent(home.password) || "unused",
  });
  const urlOf = (database: string) => {
    const url = new URL(home);
    url.pathname = `/${database}`;
    return url.toString();
  };
  // One with the whole schema, and one that's only got a User table: an older schema, as far as the worker can tell.
  const fullName = `${homeName}_guards_full`;
  const bareName = `${homeName}_guards_bare`;
  const IMPORTS_RUNNING = /Imports are running/;
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);

  let admin: { id: string; token: string };
  let homeClient: PrismaClient;
  let fullClient: PrismaClient;

  async function makeAdmin() {
    const email = `guards-admin-${stamp}@example.com`;
    const registered = await request(app)
      .post("/api/register")
      .send({ displayName: "Guards admin", email, password: "password123" });
    const id: string = registered.body.user.id;
    await prisma.user.update({ where: { id }, data: { role: "ADMIN" } });
    const login = await request(app).post("/api/login").send({ email, password: "password123" });
    return { id, token: login.body.token as string };
  }

  function postSwitch(database: string) {
    return request(app)
      .post("/api/settings/database")
      .set("Authorization", `Bearer ${admin.token}`)
      .send(credsFor(database));
  }

  const nothingHere = () => vi.fn<typeof fetch>(async () => new Response("nothing here", { status: 404 }));
  const link = (name: string) => `https://files.example.com/${name}-${stamp}.stl`;

  async function waitLeftLine(client: PrismaClient, id: string) {
    await vi.waitFor(
      async () => expect((await client.importJob.findUniqueOrThrow({ where: { id } })).status).not.toBe("QUEUED"),
      { timeout: 10_000, interval: 50 },
    );
  }

  /** The gate is open if a job added now gets its turn. */
  async function expectGateOpen() {
    expect(isDatabaseSwitching()).toBe(false);
    const { job } = await enqueueSingleImport(admin.id, link(`gate-${Math.random()}`), {});
    await waitLeftLine(homeClient, job.id);
    await importWorkerIdle();
  }

  beforeAll(async () => {
    process.on("unhandledRejection", onUnhandled);
    global.fetch = nothingHere();
    admin = await makeAdmin();
    homeClient = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

    for (const name of [fullName, bareName]) {
      await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await prisma.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
    }
    const bareClient = new PrismaClient({ datasources: { db: { url: urlOf(bareName) } } });
    await bareClient.$executeRawUnsafe('CREATE TABLE "User" ("id" TEXT PRIMARY KEY)');
    await bareClient.$disconnect();

    execFileSync("npx", ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"], {
      env: { ...process.env, DATABASE_URL: urlOf(fullName) },
      stdio: "pipe",
    });
    fullClient = new PrismaClient({ datasources: { db: { url: urlOf(fullName) } } });
  }, 60_000);

  afterEach(async () => {
    vi.restoreAllMocks();
    global.fetch = nothingHere();
    Object.assign(importWorkerTuning, tuning);
    resumeImportWorker();
    await importWorkerIdle();
    if (getDatabaseInfo().database !== homeName) await testAndSwitchDatabase(credsFor(homeName));
  });

  afterAll(async () => {
    process.off("unhandledRejection", onUnhandled);
    global.fetch = originalFetch;
    await fullClient.$disconnect();
    await homeClient.$disconnect();
    for (const name of [fullName, bareName]) {
      await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    }
  });

  describe("refuses, with a 422, and opens the gate again", () => {
    it("while the worker is on a job", async () => {
      const held = deferred();
      global.fetch = vi.fn<typeof fetch>(async () => {
        await held.held;
        return new Response("nothing here", { status: 404 });
      });
      const { job } = await enqueueSingleImport(admin.id, link("worker"), {});
      await vi.waitFor(() => expect(global.fetch).toHaveBeenCalled(), { timeout: 5_000 });

      const res = await postSwitch(fullName);
      expect(res.status).toBe(422);
      expect(res.body.detail).toMatch(IMPORTS_RUNNING);
      expect(getDatabaseInfo().database).toBe(homeName);

      held.release();
      await waitLeftLine(homeClient, job.id);
      await importWorkerIdle();
      global.fetch = nothingHere();
      await expectGateOpen();
    }, 20_000);

    it("while a direct runner is live", async () => {
      const held = deferred();
      const runner = trackRunner(`guards-runner-${stamp}`, held.held);
      const res = await postSwitch(fullName);
      expect(res.status).toBe(422);
      expect(res.body.detail).toMatch(IMPORTS_RUNNING);
      await expectGateOpen();
      held.release();
      await runner;
      expect((await postSwitch(fullName)).status).toBe(200);
    });

    it("while a sync has its place, and takes it back once it's let go", async () => {
      const id = `guards-sync-${stamp}`;
      expect(reserveSync(id)).toBe(true);
      expect(hasActiveCollectionSync()).toBe(true);
      const res = await postSwitch(fullName);
      expect(res.status).toBe(422);
      expect(res.body.detail).toMatch(IMPORTS_RUNNING);
      await expectGateOpen();
      releaseSync(id);
      expect(hasActiveCollectionSync()).toBe(false);
      expect((await postSwitch(fullName)).status).toBe(200);
    });

    it("while a background task runs", async () => {
      const held = deferred();
      startImportTask(admin.id, () => held.held);
      expect(hasRunningImportTasks()).toBe(true);
      const res = await postSwitch(fullName);
      expect(res.status).toBe(422);
      expect(res.body.detail).toMatch(IMPORTS_RUNNING);
      await expectGateOpen();
      held.release();
      await vi.waitFor(() => expect(hasRunningImportTasks()).toBe(false));
      expect((await postSwitch(fullName)).status).toBe(200);
    });

    it("while a RUNNING row says a direct import is going", async () => {
      const row = await prisma.importJob.create({
        data: { userId: admin.id, type: "ZIP", sourceUrl: link("direct"), status: "RUNNING", total: 1, payload: {} },
      });
      const res = await postSwitch(fullName);
      expect(res.status).toBe(422);
      expect(res.body.detail).toMatch(IMPORTS_RUNNING);
      await expectGateOpen();
      await prisma.importJob.delete({ where: { id: row.id } });
    });

    it("says what's wrong with the credentials first", async () => {
      const held = deferred();
      startImportTask(admin.id, () => held.held);
      const res = await postSwitch(`${homeName}_guards_none`);
      expect(res.status).toBe(422);
      expect(res.body.detail).toMatch(/does not exist/);
      held.release();
      await vi.waitFor(() => expect(hasRunningImportTasks()).toBe(false));
    });
  });

  it("opens the gate again when the candidate can't connect", async () => {
    await expect(testAndSwitchDatabase(credsFor(`${homeName}_guards_none`))).rejects.toThrow(/does not exist/);
    expect(getDatabaseInfo().database).toBe(homeName);
    await expectGateOpen();
  });

  it("refuses a second switch while one is under way", async () => {
    const answers = await Promise.allSettled([
      testAndSwitchDatabase(credsFor(fullName)),
      testAndSwitchDatabase(credsFor(bareName)),
    ]);
    expect(answers[0].status).toBe("fulfilled");
    expect(answers[1]).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({ message: expect.stringMatching(/under way/) }),
    });
    expect(getDatabaseInfo().database).toBe(fullName);
  });

  it("keeps syncs from starting while it's going", async () => {
    const findMany = vi.spyOn(prisma.collectionSync, "findMany");
    expect(beginDatabaseSwitch()).toBe(true);
    try {
      const id = `guards-gated-${stamp}`;
      expect(reserveSync(id)).toBe(false);
      await expect(syncCollection(id)).resolves.toBe("busy");
      await runSyncRound();
      expect(findMany).not.toHaveBeenCalled();
    } finally {
      endDatabaseSwitch();
    }
    const id = `guards-after-${stamp}`;
    expect(reserveSync(id)).toBe(true);
    releaseSync(id);
  });

  it("settles what the new database left RUNNING, and the worker reads the new one", async () => {
    const user = await fullClient.user.create({
      data: { email: `guards-${stamp}@example.com`, displayName: "Over there" },
    });
    const left = await fullClient.importJob.create({
      data: { userId: user.id, type: "LINKS", sourceUrl: link("left"), status: "RUNNING", total: 1, payload: {} },
    });
    const there = await fullClient.importJob.create({
      data: {
        userId: user.id,
        type: "LINKS",
        sourceUrl: link("there"),
        status: "QUEUED",
        queuedAt: new Date(),
        total: 0,
        payload: {},
      },
    });
    holdImportWorker();
    const here = await enqueueSingleImport(admin.id, link("stays-here"), {});

    const res = await postSwitch(fullName);
    expect(res.status).toBe(200);
    expect(res.body.database).toBe(fullName);
    expect(await fullClient.importJob.findUniqueOrThrow({ where: { id: left.id } })).toMatchObject({
      status: "ERROR",
      errorMessage: "Interrupted by server restart",
    });
    // The switch doesn't open a gate someone else shut.
    expect((await fullClient.importJob.findUniqueOrThrow({ where: { id: there.id } })).status).toBe("QUEUED");

    resumeImportWorker();
    await waitLeftLine(fullClient, there.id);
    await importWorkerIdle();
    expect((await homeClient.importJob.findUniqueOrThrow({ where: { id: here.job.id } })).status).toBe("QUEUED");
    await homeClient.importJob.update({ where: { id: here.job.id }, data: { status: "PAUSED" } });
  });

  describe("to a database on an older schema", () => {
    it("is still a successful switch, with the polls backing off and nothing rejected", async () => {
      const delays: unknown[] = [];
      const realSetTimeout = global.setTimeout;
      vi.spyOn(global, "setTimeout").mockImplementation(((fn: () => void, ms?: number) => {
        delays.push(ms);
        return realSetTimeout(fn, ms);
      }) as never);

      const res = await postSwitch(bareName);
      expect(res.status).toBe(200);
      expect(res.body.database).toBe(bareName);
      expect(isDatabaseSwitching()).toBe(false);

      await importWorkerIdle();
      expect(delays).toContain(5_000);
      wakeImportWorker();
      await importWorkerIdle();
      expect(unhandled).toEqual([]);
    });

    it("doesn't take its leftover RUNNING rows for live imports on the way back", async () => {
      // Recovery can't work there, so nothing else would ever settle them.
      const owed = await prisma.importJob.create({
        data: { userId: admin.id, type: "ZIP", sourceUrl: link("owed"), status: "RUNNING", total: 1, payload: {} },
      });
      await new Promise((resolve) => setTimeout(resolve, 5));
      vi.spyOn(prisma.importJob, "findMany").mockRejectedValueOnce(new Error("no such column"));
      await recoverAfterDatabaseSwitch();
      expect((await postSwitch(fullName)).status).toBe(200);
      await testAndSwitchDatabase(credsFor(homeName));
      await homeClient.importJob.delete({ where: { id: owed.id } });
    });
  });

  it("tries a failed recovery again, leaving work started since", async () => {
    const owed = await prisma.importJob.create({
      data: { userId: admin.id, type: "ZIP", sourceUrl: link("retried"), status: "RUNNING", total: 1, payload: {} },
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    vi.spyOn(prisma.importJob, "findMany").mockRejectedValueOnce(new Error("database blip"));
    importWorkerTuning.recoveryRetryMs = 100;
    await expect(recoverAfterDatabaseSwitch()).resolves.toBeUndefined();

    const since = await prisma.importJob.create({
      data: { userId: admin.id, type: "ZIP", sourceUrl: link("since"), status: "RUNNING", total: 1, payload: {} },
    });
    await vi.waitFor(
      async () => expect((await prisma.importJob.findUniqueOrThrow({ where: { id: owed.id } })).status).toBe("ERROR"),
      { timeout: 5_000, interval: 50 },
    );
    expect((await prisma.importJob.findUniqueOrThrow({ where: { id: since.id } })).status).toBe("RUNNING");
    await prisma.importJob.deleteMany({ where: { id: { in: [owed.id, since.id] } } });
  });

  it("backs off when a poll fails, without rejecting", async () => {
    const delays: unknown[] = [];
    const realSetTimeout = global.setTimeout;
    vi.spyOn(global, "setTimeout").mockImplementation(((fn: () => void, ms?: number) => {
      delays.push(ms);
      return realSetTimeout(fn, ms);
    }) as never);
    vi.spyOn(prisma.importJob, "findFirst").mockRejectedValueOnce(new Error("database down"));
    wakeImportWorker();
    await expect(importWorkerIdle()).resolves.toBeUndefined();
    expect(delays).toContain(5_000);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(unhandled).toEqual([]);
  });
});
