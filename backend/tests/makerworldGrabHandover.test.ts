import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

// Imports MakerWorld's CAPTCHA stopped, handed to Thingport Grab to clear with MakerWorld's own puzzle on its site: who
// they're handed to, what the queue says of them, and what Grab bringing one in does to the import it failed in.
// MakerWorld itself is a stand-in: every import here meets its CAPTCHA, or whatever a test says.

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

const imports = vi.hoisted(() => ({
  failure: null as (() => Error) | null,
  brought: [] as { url: string; body: Record<string, unknown> }[],
  // Whatever else happens while Grab's import of a link is under way.
  meanwhile: null as (() => Promise<void>) | null,
}));

vi.mock("../src/services/importService", async (original) => ({
  ...(await original<typeof import("../src/services/importService")>()),
  importPrintFromUrl: vi.fn<() => Promise<never>>(async () => {
    throw imports.failure!();
  }),
}));

vi.mock("../src/services/singleImport", async (original) => ({
  ...(await original<typeof import("../src/services/singleImport")>()),
  importAndDescribe: vi.fn<
    (userId: string, url: string, body: Record<string, unknown>) => Promise<{ id: string; import_outcome: string }>
  >(async (_userId, url, body) => {
    imports.brought.push({ url, body });
    await imports.meanwhile?.();
    return { id: "print-from-grab", import_outcome: "created" };
  }),
}));

// Counting a link done is made to fail where a test says, by the check of which links Grab's import finishes.
vi.mock("../src/services/importJobService", async (original) => {
  const actual = await original<typeof import("../src/services/importJobService")>();
  return {
    ...actual,
    isOneModelLink: vi.fn<typeof actual.isOneModelLink>(actual.isOneModelLink),
    updateJobItem: vi.fn<typeof actual.updateJobItem>(actual.updateJobItem),
  };
});

// Telling the owner a model was given up on is made to fail where a test says.
vi.mock("../src/services/notificationService", async (original) => {
  const actual = await original<typeof import("../src/services/notificationService")>();
  return { ...actual, createNotification: vi.fn<typeof actual.createNotification>(actual.createNotification) };
});

import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { MAKERWORLD_CAPTCHA_CODE, MAKERWORLD_CAPTCHA_MESSAGE } from "../src/providers/makerworld/captcha";
import {
  clearMakerworldGrabImports,
  finishMakerworldGrabImport,
  queueMakerworldGrabImport,
  recordMakerworldGrabImportFailure,
} from "../src/providers/makerworld/grabImports";
import { PROVIDERS } from "../src/providers/registry";
import { runLinksImportJob } from "../src/services/importJobRunner";
import { isOneModelLink, updateJobItem } from "../src/services/importJobService";
import { createNotification } from "../src/services/notificationService";
import { clearFinishedJobs, deleteQueueJob, readOwnQueue, removeQueueItem } from "../src/services/importQueueService";
import { HttpError } from "../src/utils/fileUtils";

const app = createApp();
const stamp = Date.now();
let userId: string;
let token: string;
const auth = () => ({ Authorization: `Bearer ${token}` });

const modelUrl = (id: number) => `https://makerworld.com/en/models/${(stamp % 1_000_000) + id}-thing`;
const captcha = () => new HttpError(429, MAKERWORLD_CAPTCHA_MESSAGE, MAKERWORLD_CAPTCHA_CODE);

/** A LINKS job of `urls`, each link with its own options from `scopes`, started; `run` is its runner, to its end. */
async function startJob(urls: string[], { scopes = [] as (string | null)[], itemDelayMs = 0 } = {}) {
  const body = { notes: null, tags: ["handed"], category_id: null, scope: "url" as const, itemDelayMs };
  const job = await prisma.importJob.create({
    data: { userId, type: "LINKS", status: "RUNNING", sourceUrl: urls[0], total: urls.length, payload: body },
  });
  for (const [index, url] of urls.entries()) {
    const scope = scopes[index];
    await prisma.importJobItem.create({ data: { jobId: job.id, url, ...(scope ? { payload: { scope } } : {}) } });
  }
  return { jobId: job.id, run: runLinksImportJob(job.id, userId, body) };
}

/** A LINKS job of `urls`, run to its end. */
async function runJob(urls: string[], options?: Parameters<typeof startJob>[1]) {
  const { jobId, run } = await startJob(urls, options);
  await run;
  return jobId;
}

const bringIn = (row: { id: string }) =>
  request(app)
    .post(`/api/import/makerworld/waiting/${row.id}`)
    .set(auth())
    .send({ resolved_download_url: "https://makerworld.bblmw.com/model/f.3mf" });
const jobOf = (jobId: string) => prisma.importJob.findUniqueOrThrow({ where: { id: jobId } });

const waiting = () =>
  prisma.grabImport.findMany({ where: { userId, provider: "makerworld" }, orderBy: { createdAt: "asc" } });
const itemsOf = (jobId: string) =>
  prisma.importJobItem.findMany({ where: { jobId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });

async function pairGrab(): Promise<void> {
  await prisma.grabConnection.create({ data: { userId, tokenHash: `hash-${stamp}-${Math.random()}`, name: "Chrome" } });
}

describe("imports MakerWorld's CAPTCHA stopped, handed to Grab", () => {
  beforeAll(async () => {
    const res = await request(app)
      .post("/api/register")
      .send({ displayName: "Handover", email: `handover-${stamp}@example.com`, password: "password123" });
    userId = res.body.user.id;
    token = res.body.token;
  });

  beforeEach(() => {
    imports.failure = captcha;
    imports.brought = [];
    imports.meanwhile = null;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await prisma.grabImport.deleteMany({ where: { userId } });
    await prisma.grabConnection.deleteMany({ where: { userId } });
    await prisma.importJob.deleteMany({ where: { userId } });
  });

  it("waits for a paired Grab: the link it stopped, and those after it the CAPTCHA stopped", async () => {
    imports.failure = captcha;
    await pairGrab();
    const urls = [modelUrl(1), modelUrl(2), modelUrl(3)];
    const jobId = await runJob(urls);

    expect((await waiting()).map((row) => [row.url, row.tags])).toEqual(urls.map((url) => [url, ["handed"]]));
    const items = await itemsOf(jobId);
    expect(items.map((item) => item.status)).toEqual(["FAILED", "FAILED", "FAILED"]);
    expect(items[0].errorMessage).toMatch(/^Waits for Thingport Grab: solve MakerWorld's puzzle on makerworld\.com/);

    const queue = await request(app).get("/api/import/queue").set(auth());
    expect(queue.body.grab_waiting).toEqual([{ provider: "makerworld", count: 3, url: urls[0] }]);
    expect(queue.body.jobs.find((job: { id: string }) => job.id === jobId)).toMatchObject({
      grab_waiting: 3,
      failed_items_count: 3,
      attention: true,
    });
  });

  it("fails as before for someone without a paired Grab", async () => {
    imports.failure = captcha;
    const jobId = await runJob([modelUrl(4)]);

    expect(await waiting()).toEqual([]);
    expect((await itemsOf(jobId))[0].errorMessage).toBe(MAKERWORLD_CAPTCHA_MESSAGE);
    const queue = await request(app).get("/api/import/queue").set(auth());
    expect(queue.body.grab_waiting).toEqual([]);
    expect(queue.body.jobs.find((job: { id: string }) => job.id === jobId).grab_waiting).toBe(0);
  });

  it("hands over nothing that isn't the CAPTCHA", async () => {
    imports.failure = () => new HttpError(404, "MakerWorld has no such model");
    await pairGrab();
    await runJob([modelUrl(5)]);
    expect(await waiting()).toEqual([]);
  });

  it("counts a link done in the import it failed in once Grab brings it in", async () => {
    imports.failure = captcha;
    await pairGrab();
    const jobId = await runJob([modelUrl(6), modelUrl(7)]);
    const [first, second] = await waiting();

    const brought = await request(app)
      .post(`/api/import/makerworld/waiting/${first.id}`)
      .set(auth())
      .send({ resolved_download_url: "https://makerworld.bblmw.com/model/6/f.3mf", resolved_instance_id: "60" });
    expect(brought.status).toBe(200);
    expect(imports.brought).toMatchObject([
      {
        url: first.url,
        body: { resolved_download_url: "https://makerworld.bblmw.com/model/6/f.3mf", resolved_instance_id: "60" },
      },
    ]);
    expect((await waiting()).map((row) => row.id)).toEqual([second.id]);
    expect((await itemsOf(jobId)).map((item) => item.status)).toEqual(["DONE", "FAILED"]);
    expect(await prisma.importJob.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({
      failedCount: 1,
      imported: 1,
    });

    await request(app)
      .post(`/api/import/makerworld/waiting/${second.id}`)
      .set(auth())
      .send({ resolved_download_url: "https://makerworld.bblmw.com/model/7/f.3mf" })
      .expect(200);
    const own = await readOwnQueue(userId);
    expect(own.jobs.find((job) => job.id === jobId)).toMatchObject({ attention: false, grabWaiting: 0 });
  });

  it("keeps a waiting link Grab couldn't bring in, until its last try", async () => {
    imports.failure = captcha;
    await pairGrab();
    await runJob([modelUrl(8)]);
    const [row] = await waiting();
    for (let attempt = 1; attempt <= 2; attempt++) {
      await request(app)
        .post(`/api/import/makerworld/waiting/${row.id}/failed`)
        .set(auth())
        .send({ error: "MakerWorld still wants its puzzle solved" })
        .expect(200);
      expect((await waiting()).map((left) => left.attempts)).toEqual([attempt]);
    }
    await request(app).post(`/api/import/makerworld/waiting/${row.id}/failed`).set(auth()).send({ error: "no" });
    expect(await waiting()).toEqual([]);
  });

  it("drops what waits for Grab with the import it came from", async () => {
    imports.failure = captcha;
    await pairGrab();
    const jobId = await runJob([modelUrl(9)]);
    expect(await waiting()).toHaveLength(1);

    await deleteQueueJob(jobId, userId);
    expect(await waiting()).toEqual([]);
  });

  it("hands over the links after a CAPTCHA that stopped one it couldn't hand over", async () => {
    // All of a model's print profiles, which one file from Grab wouldn't bring in, met the CAPTCHA first.
    vi.spyOn(PROVIDERS.makerworld, "profileUrls").mockRejectedValue(captcha());
    await pairGrab();
    const jobId = await runJob([modelUrl(10), modelUrl(11)], { scopes: ["all"] });

    expect((await waiting()).map((row) => row.url)).toEqual([modelUrl(11)]);
    const items = await itemsOf(jobId);
    expect(items.map((item) => item.status)).toEqual(["FAILED", "FAILED"]);
    expect(items[1].errorMessage).toMatch(/^Waits for Thingport Grab/);
  });

  it("counts done only the links asking for the one model Grab brought in", async () => {
    await pairGrab();
    const handed = await runJob([modelUrl(12)]);
    // The same link, for all of the model's print profiles, in another import.
    const all = await prisma.importJob.create({
      data: { userId, type: "LINKS", status: "DONE", sourceUrl: modelUrl(12), total: 1, failedCount: 1 },
    });
    await prisma.importJobItem.create({
      data: { jobId: all.id, url: modelUrl(12), status: "FAILED", payload: { scope: "all" } },
    });
    const own = await readOwnQueue(userId);
    expect(own.jobs.find((job) => job.id === all.id)?.grabWaiting).toBe(0);

    const [row] = await waiting();
    expect((await bringIn(row)).status).toBe(200);
    expect((await itemsOf(handed))[0].status).toBe("DONE");
    expect((await itemsOf(all.id))[0].status).toBe("FAILED");
    expect(await jobOf(all.id)).toMatchObject({ failedCount: 1, imported: 0 });
  });

  it("counts every link Grab brings in at once", async () => {
    await pairGrab();
    const jobId = await runJob([modelUrl(13), modelUrl(14)]);
    const rows = await waiting();

    const replies = await Promise.all(rows.map((row) => bringIn(row)));
    expect(replies.map((reply) => reply.status)).toEqual([200, 200]);
    expect(await jobOf(jobId)).toMatchObject({ failedCount: 0, imported: 2 });
  });

  it("keeps what Grab counts done while the import it failed in still runs", async () => {
    await pairGrab();
    const { jobId, run } = await startJob([modelUrl(15), modelUrl(16)], { itemDelayMs: 600 });
    const first = await vi.waitFor(
      async () => {
        const [row] = await waiting();
        expect((await itemsOf(jobId))[0].status).toBe("FAILED");
        return row;
      },
      { timeout: 500, interval: 20 },
    );
    expect((await bringIn(first)).status).toBe(200);
    await run;

    expect((await itemsOf(jobId)).map((item) => item.status)).toEqual(["DONE", "FAILED"]);
    expect(await jobOf(jobId)).toMatchObject({ imported: 1, failedCount: 1 });
    const told = await prisma.notification.findFirst({
      where: { userId, title: { startsWith: "Imported" } },
      orderBy: { createdAt: "desc" },
    });
    expect(told?.title).toBe("Imported 1 of 2 models");
  });

  it("keeps a waiting link whose import can't be counted done, to bring in again", async () => {
    await pairGrab();
    const jobId = await runJob([modelUrl(17)]);
    const [row] = await waiting();
    vi.mocked(isOneModelLink).mockImplementationOnce(() => {
      throw new Error("database gone");
    });

    expect((await bringIn(row)).status).toBe(500);
    expect((await waiting()).map((left) => [left.id, left.attempts])).toEqual([[row.id, 0]]);

    expect((await bringIn(row)).status).toBe(200);
    expect(await waiting()).toEqual([]);
    expect((await itemsOf(jobId))[0].status).toBe("DONE");
  });

  it("keeps what waits for Grab while another import still wants it", async () => {
    await pairGrab();
    const first = await runJob([modelUrl(18)]);
    const second = await runJob([modelUrl(18)]);
    expect(await waiting()).toHaveLength(1);

    await deleteQueueJob(first, userId);
    expect(await waiting()).toHaveLength(1);
    await deleteQueueJob(second, userId);
    expect(await waiting()).toEqual([]);
  });

  it("drops what waits for Grab with a link taken out of its import, the last one too", async () => {
    await pairGrab();
    const jobId = await runJob([modelUrl(19), modelUrl(20)]);
    const [one, two] = await itemsOf(jobId);

    await removeQueueItem(one.id, userId);
    expect((await waiting()).map((row) => row.url)).toEqual([modelUrl(20)]);
    expect(await removeQueueItem(two.id, userId)).toEqual({ jobDeleted: true });
    expect(await waiting()).toEqual([]);
  });

  it("drops what waits for Grab with an old failure cleared from Finished", async () => {
    await pairGrab();
    const jobId = await runJob([modelUrl(22)]);
    // Out of Needs attention after a week, so the Finished section's Clear takes it.
    await prisma.importJob.update({
      where: { id: jobId },
      data: { queuedAt: null, updatedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) },
    });

    expect(await clearFinishedJobs({ ownerId: userId, line: true })).toBe(1);
    expect(await waiting()).toEqual([]);
  });

  it("keeps a link naming another print profile waiting once the model comes in", async () => {
    const design = String((stamp % 1_000_000) + 21);
    const link = (profile?: string) =>
      `https://makerworld.com/en/models/${design}${profile ? `#profileId-${profile}` : ""}`;
    for (const url of [link("10"), link("20"), link()]) {
      await prisma.grabImport.create({ data: { userId, provider: "makerworld", url } });
    }

    await clearMakerworldGrabImports(userId, design, []);
    expect((await waiting()).map((row) => row.url)).toEqual([link("10"), link("20")]);
    await clearMakerworldGrabImports(userId, design, ["10"]);
    expect((await waiting()).map((row) => row.url)).toEqual([link("20")]);
  });

  it("leaves a link queued again during Grab's import waiting, with its newer options, in the same millisecond too", async () => {
    await pairGrab();
    const first = await runJob([modelUrl(23)]);
    const [row] = await waiting();
    // Another import meets the CAPTCHA on the same link meanwhile, to be filed with other tags.
    let second = "";
    imports.meanwhile = async () => {
      imports.meanwhile = null;
      const { jobId, run } = await startJob([modelUrl(23)]);
      second = jobId;
      await run;
      // Its newer options, written as the row was: `updatedAt` alone wouldn't tell the two apart.
      await prisma.grabImport.update({ where: { id: row.id }, data: { tags: ["newer"], updatedAt: row.updatedAt } });
    };

    expect((await bringIn(row)).status).toBe(200);
    expect((await waiting()).map((left) => [left.id, left.tags])).toEqual([[row.id, ["newer"]]]);
    expect((await itemsOf(second))[0].status).toBe("FAILED");

    expect((await bringIn(row)).status).toBe(200);
    expect(imports.brought.at(-1)?.body).toMatchObject({ tags: ["newer"] });
    expect(await waiting()).toEqual([]);
    expect([(await itemsOf(first))[0].status, (await itemsOf(second))[0].status]).toEqual(["DONE", "DONE"]);
  });

  it("counts every failed try in Grab, however many come at once", async () => {
    await pairGrab();
    await runJob([modelUrl(24)]);
    const [row] = await waiting();
    await prisma.grabImport.update({ where: { id: row.id }, data: { attempts: 1 } });

    const fail = () =>
      request(app).post(`/api/import/makerworld/waiting/${row.id}/failed`).set(auth()).send({ error: "no file" });
    expect((await Promise.all([fail(), fail()])).map((reply) => reply.status)).toEqual([200, 200]);

    expect(await waiting()).toEqual([]);
    const told = await prisma.notification.findMany({
      where: { userId, externalUrl: row.url, title: { startsWith: "Couldn't import" } },
    });
    expect(told).toHaveLength(1);
  });

  it("keeps a link queued again as its last try in Grab failed, in the same millisecond too", async () => {
    await pairGrab();
    await runJob([modelUrl(25)]);
    const [row] = await waiting();
    await prisma.grabImport.update({ where: { id: row.id }, data: { attempts: 2 } });
    // Another import meets the CAPTCHA on the link between the last try's count and its drop.
    const count = prisma.grabImport.update.bind(prisma.grabImport);
    vi.spyOn(prisma.grabImport, "update").mockImplementationOnce((async (args: Parameters<typeof count>[0]) => {
      const counted = await count(args);
      const before = await prisma.grabImport.findUniqueOrThrow({ where: { id: row.id } });
      await queueMakerworldGrabImport(userId, row.url, { tags: ["newer"] });
      await prisma.grabImport.update({ where: { id: row.id }, data: { updatedAt: before.updatedAt } });
      return counted;
    }) as unknown as typeof count);

    await request(app)
      .post(`/api/import/makerworld/waiting/${row.id}/failed`)
      .set(auth())
      .send({ error: "no file" })
      .expect(200);
    expect((await waiting()).map((left) => [left.id, left.attempts, left.tags])).toEqual([[row.id, 0, ["newer"]]]);
    const told = await prisma.notification.findMany({
      where: { userId, externalUrl: row.url, title: { startsWith: "Couldn't import" } },
    });
    expect(told).toEqual([]);
  });

  it("doesn't count tries begun before a link was queued again against it", async () => {
    await pairGrab();
    await runJob([modelUrl(26)]);
    // Three tries in Grab under way, each with the row as it was then.
    const [begun] = await waiting();
    await queueMakerworldGrabImport(userId, begun.url, { tags: ["newer"] });

    for (let attempt = 0; attempt < 3; attempt++) await recordMakerworldGrabImportFailure(begun, "no file");
    expect((await waiting()).map((left) => [left.id, left.attempts, left.tags])).toEqual([[begun.id, 0, ["newer"]]]);
    const told = await prisma.notification.findMany({
      where: { userId, externalUrl: begun.url, title: { startsWith: "Couldn't import" } },
    });
    expect(told).toEqual([]);

    // Tries at the link as it's queued now count as before.
    const [now] = await waiting();
    for (let attempt = 0; attempt < 3; attempt++) await recordMakerworldGrabImportFailure(now, "no file");
    expect(await waiting()).toEqual([]);
  });

  it("doesn't count a try Grab reports at an earlier queueing of a link against a newer one", async () => {
    await pairGrab();
    await runJob([modelUrl(27)]);
    const listed = await request(app).get("/api/import/makerworld/waiting").set(auth()).expect(200);
    const [row] = listed.body as { id: string; url: string; revision: number }[];
    expect(row.revision).toBe(0);
    // Queued again while Grab works through the list it got.
    await queueMakerworldGrabImport(userId, row.url, { tags: ["newer"] });

    const fail = (revision: number) =>
      request(app)
        .post(`/api/import/makerworld/waiting/${row.id}/failed`)
        .set(auth())
        .send({ error: "no file", revision })
        .expect(200);
    for (let attempt = 0; attempt < 3; attempt++) await fail(row.revision);
    expect((await waiting()).map((left) => [left.attempts, left.revision])).toEqual([[0, 1]]);

    for (let attempt = 0; attempt < 3; attempt++) await fail(1);
    expect(await waiting()).toEqual([]);
  });

  it("keeps a link waiting where telling its owner it was given up on fails", async () => {
    await pairGrab();
    await runJob([modelUrl(28)]);
    const [row] = await waiting();
    await prisma.grabImport.update({ where: { id: row.id }, data: { attempts: 2 } });
    vi.mocked(createNotification).mockRejectedValueOnce(new Error("database gone"));
    const fail = () =>
      request(app).post(`/api/import/makerworld/waiting/${row.id}/failed`).set(auth()).send({ error: "no file" });

    expect((await fail()).status).toBe(500);
    expect((await waiting()).map((left) => left.id)).toEqual([row.id]);
    expect((await fail()).status).toBe(200);
    expect(await waiting()).toEqual([]);
    const told = await prisma.notification.findMany({
      where: { userId, externalUrl: row.url, title: { startsWith: "Couldn't import" } },
    });
    expect(told).toHaveLength(1);
  });

  it("counts a link done that Grab brings in the moment it's handed over", async () => {
    await pairGrab();
    const upsert = prisma.grabImport.upsert.bind(prisma.grabImport);
    vi.spyOn(prisma.grabImport, "upsert").mockImplementationOnce((async (args: Parameters<typeof upsert>[0]) => {
      const row = await upsert(args);
      await finishMakerworldGrabImport(row, false);
      return row;
    }) as unknown as typeof upsert);
    const jobId = await runJob([modelUrl(29)]);

    expect(await waiting()).toEqual([]);
    expect((await itemsOf(jobId)).map((item) => item.status)).toEqual(["DONE"]);
    expect(await jobOf(jobId)).toMatchObject({ imported: 1, failedCount: 0 });
  });

  it("keeps a link queued again while what no import wants is being dropped", async () => {
    await pairGrab();
    const jobId = await runJob([modelUrl(30)]);
    const [item] = await itemsOf(jobId);
    const drop = prisma.grabImport.deleteMany.bind(prisma.grabImport);
    vi.spyOn(prisma.grabImport, "deleteMany").mockImplementationOnce((async (args: Parameters<typeof drop>[0]) => {
      await queueMakerworldGrabImport(userId, modelUrl(30), { tags: ["newer"] });
      return drop(args);
    }) as unknown as typeof drop);

    await removeQueueItem(item.id, userId);
    expect((await waiting()).map((left) => [left.url, left.tags])).toEqual([[modelUrl(30), ["newer"]]]);
  });

  it("doesn't hand a link over that it couldn't mark as failed", async () => {
    await pairGrab();
    const write = vi.mocked(updateJobItem).getMockImplementation()!;
    vi.mocked(updateJobItem).mockImplementation(async (id, data) => {
      if (typeof data.errorMessage === "string" && data.errorMessage.startsWith("Waits for")) {
        throw new Error("database gone");
      }
      return write(id, data);
    });
    try {
      const jobId = await runJob([modelUrl(31)]);
      expect(await waiting()).toEqual([]);
      expect((await itemsOf(jobId)).map((item) => [item.status, item.errorMessage])).toEqual([
        ["FAILED", MAKERWORLD_CAPTCHA_MESSAGE],
      ]);
    } finally {
      vi.mocked(updateJobItem).mockImplementation(write);
    }
  });

  it("doesn't count a failed import of Grab's at an earlier queueing of a link against a newer one", async () => {
    await pairGrab();
    await runJob([modelUrl(32)]);
    const [row] = await waiting();
    await queueMakerworldGrabImport(userId, row.url, { tags: ["newer"] });
    imports.meanwhile = async () => {
      throw new Error("MakerWorld's file went away");
    };
    const bring = (revision: number) =>
      request(app)
        .post(`/api/import/makerworld/waiting/${row.id}`)
        .set(auth())
        .send({ resolved_download_url: "https://makerworld.bblmw.com/model/f.3mf", revision });

    for (let attempt = 0; attempt < 3; attempt++) expect((await bring(0)).status).toBe(500);
    expect((await waiting()).map((left) => [left.attempts, left.revision])).toEqual([[0, 1]]);
    // What Grab resolved reaches the import, its revision doesn't.
    expect(imports.brought.at(-1)?.body).not.toHaveProperty("revision");

    for (let attempt = 0; attempt < 3; attempt++) expect((await bring(1)).status).toBe(500);
    expect(await waiting()).toEqual([]);
  });
});
