import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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
    return { id: "print-from-grab", import_outcome: "created" };
  }),
}));

import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { MAKERWORLD_CAPTCHA_CODE, MAKERWORLD_CAPTCHA_MESSAGE } from "../src/providers/makerworld/captcha";
import { runLinksImportJob } from "../src/services/importJobRunner";
import { deleteQueueJob, readOwnQueue } from "../src/services/importQueueService";
import { HttpError } from "../src/utils/fileUtils";

const app = createApp();
const stamp = Date.now();
let userId: string;
let token: string;
const auth = () => ({ Authorization: `Bearer ${token}` });

const modelUrl = (id: number) => `https://makerworld.com/en/models/${(stamp % 1_000_000) + id}-thing`;
const captcha = () => new HttpError(429, MAKERWORLD_CAPTCHA_MESSAGE, MAKERWORLD_CAPTCHA_CODE);

/** A LINKS job of `urls`, run to its end. */
async function runJob(urls: string[]) {
  const body = { notes: null, tags: ["handed"], category_id: null, scope: "url" as const };
  const job = await prisma.importJob.create({
    data: { userId, type: "LINKS", status: "RUNNING", sourceUrl: urls[0], total: urls.length, payload: body },
  });
  for (const url of urls) await prisma.importJobItem.create({ data: { jobId: job.id, url } });
  await runLinksImportJob(job.id, userId, body);
  return job.id;
}

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

  afterEach(async () => {
    imports.failure = captcha;
    imports.brought = [];
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
});
