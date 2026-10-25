import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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

import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { runLinksImportJob } from "../src/services/importJobRunner";

const app = createApp();
const stamp = Date.now();
let token: string;
const auth = () => ({ Authorization: `Bearer ${token}` });
const originalFetch = global.fetch;

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
    coverUrl: "https://makerworld.bblmw.com/phoenix/cover.jpg",
    designCreator: DESIGNER,
    defaultInstanceId: 2,
    instances: [
      { id: 1, profileId: 101, title: "Single-colour version", instanceCreator: DESIGNER },
      { id: 2, profileId: 102, title: "multi-colored version", instanceCreator: DESIGNER },
    ],
  };
}

/** "ok" imports; "fail-once" drops the first design fetch (a network blip); "gone" 404s forever. */
type Behavior = "ok" | "fail-once" | "gone";
const behavior = new Map<string, Behavior>();
const designCalls = new Map<string, number>();

function mockFetch() {
  global.fetch = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
    const url = String(input);
    const model = url.match(/^https:\/\/api\.bambulab\.com\/v1\/design-service\/design\/(\d+)/);
    if (model) {
      const id = model[1];
      const calls = (designCalls.get(id) ?? 0) + 1;
      designCalls.set(id, calls);
      const b = behavior.get(id) ?? "ok";
      if (b === "gone") return new Response("gone", { status: 404 });
      if (b === "fail-once" && calls === 1) throw new TypeError("network down");
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
    if (url === "https://makerworld.bblmw.com/phoenix/cover.jpg") {
      return new Response(
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          "base64",
        ),
        { headers: { "content-type": "image/png" } },
      );
    }
    return new Response("not found", { status: 404 }); // e.g. the author profile, behind Cloudflare
  }) as unknown as typeof fetch;
}

async function waitJob(jobId: string) {
  let job = (await request(app).get(`/api/import/jobs/${jobId}`).set(auth())).body;
  for (let i = 0; i < 150 && (job.status === "QUEUED" || job.status === "RUNNING"); i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    job = (await request(app).get(`/api/import/jobs/${jobId}`).set(auth())).body;
  }
  return job;
}

function startLinks(urls: string[], extra: Record<string, unknown> = {}) {
  return request(app)
    .post("/api/import/links")
    .set(auth())
    .send({ urls, ...extra });
}

describe("the links import queue", () => {
  beforeAll(async () => {
    const res = await request(app)
      .post("/api/register")
      .send({
        displayName: "Links Import Test",
        email: `links-${stamp}@example.com`,
        password: "password123",
      });
    token = res.body.token;
    // The retry route takes the cookie from the user's saved settings, never from a stored payload.
    await request(app).patch("/api/settings/makerworld").set(auth()).send({ cookie: "token=test-bearer" });
    mockFetch();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    mockFetch();
    behavior.clear();
    designCalls.clear();
  });

  it("imports every pasted link as one job, with an item per link", async () => {
    const ids = [String(stamp % 1_000_000_000), String((stamp % 1_000_000_000) + 1)];
    const start = await startLinks(ids.map((id) => `https://makerworld.com/en/models/${id}-phoenix`));
    expect(start.status).toBe(202);

    const job = await waitJob(start.body.job_id);
    expect(job.status).toBe("DONE");
    expect(job.total).toBe(2);
    expect(job.imported).toBe(2);
    expect(job.failed_count).toBe(0);

    const items = (await request(app).get(`/api/import/jobs/${job.id}`).set(auth())).body;
    expect(items.result_print_id).toBeNull();
    for (const id of ids) {
      const print = await prisma.print.findFirst({
        where: {
          userId: (await prisma.user.findFirst({ where: { email: `links-${stamp}@example.com` } }))!.id,
          sourceExternalId: id,
        },
      });
      expect(print).not.toBeNull();
    }
    const dbItems = await prisma.importJobItem.findMany({ where: { jobId: job.id } });
    expect(dbItems.map((i) => i.status)).toEqual(["DONE", "DONE"]);
  });

  it("collapses repeated links into one queue item", async () => {
    const id = String((stamp % 1_000_000_000) + 2);
    const start = await startLinks([
      `https://makerworld.com/en/models/${id}-phoenix`,
      `https://makerworld.com/en/models/${id}-phoenix`,
    ]);
    const job = await waitJob(start.body.job_id);
    expect(job.total).toBe(1);
    expect(job.imported).toBe(1);
  });

  it("keeps importing when one link fails, then a retry reruns just the failed one", async () => {
    const goodId = String((stamp % 1_000_000_000) + 3);
    const badId = String((stamp % 1_000_000_000) + 4);
    behavior.set(badId, "gone");

    const start = await startLinks([
      `https://makerworld.com/en/models/${goodId}-phoenix`,
      `https://makerworld.com/en/models/${badId}-phoenix`,
    ]);
    const job = await waitJob(start.body.job_id);
    expect(job.status).toBe("DONE");
    expect(job.imported).toBe(1);
    expect(job.failed_count).toBe(1);

    let items = await prisma.importJobItem.findMany({ where: { jobId: job.id }, orderBy: { url: "asc" } });
    expect(items.map((i) => i.status)).toEqual(["DONE", "FAILED"]);
    expect(items[1].errorMessage).toBeTruthy();
    expect(items[1].attempts).toBe(1);

    // The model reappears: retrying the job brings in only the failed link.
    behavior.delete(badId);
    designCalls.clear();
    const retry = await request(app).post(`/api/import/jobs/${job.id}/retry`).set(auth()).send({});
    expect(retry.status).toBe(202);
    const rerun = await waitJob(job.id);
    expect(rerun.status).toBe("DONE");
    expect(rerun.imported).toBe(2);
    expect(rerun.failed_count).toBe(0);

    items = await prisma.importJobItem.findMany({ where: { jobId: job.id }, orderBy: { url: "asc" } });
    expect(items.map((i) => i.status)).toEqual(["DONE", "DONE"]);
    expect(designCalls.get(goodId)).toBeUndefined(); // the good link wasn't downloaded again
  });

  it("retries a transient network failure on its own", async () => {
    const id = String((stamp % 1_000_000_000) + 5);
    behavior.set(id, "fail-once");

    const start = await startLinks([`https://makerworld.com/en/models/${id}-phoenix`]);
    const job = await waitJob(start.body.job_id);
    expect(job.status).toBe("DONE");
    expect(job.imported).toBe(1);
    expect(job.failed_count).toBe(0);
    expect(designCalls.get(id)).toBe(2);

    const items = await prisma.importJobItem.findMany({ where: { jobId: job.id } });
    expect(items[0].status).toBe("DONE");
    expect(items[0].attempts).toBe(2);
  });

  it("does not retry a provider's own 4xx answer", async () => {
    const id = String((stamp % 1_000_000_000) + 6);
    behavior.set(id, "gone");

    const start = await startLinks([`https://makerworld.com/en/models/${id}-phoenix`]);
    const job = await waitJob(start.body.job_id);
    expect(job.failed_count).toBe(1);
    expect(designCalls.get(id)).toBe(1);

    const items = await prisma.importJobItem.findMany({ where: { jobId: job.id } });
    expect(items[0].status).toBe("FAILED");
  });

  it("imports every wanted profile of a MakerWorld link onto one model", async () => {
    const id = String((stamp % 1_000_000_000) + 7);
    const start = await startLinks([`https://makerworld.com/en/models/${id}-phoenix`], { scope: "all" });
    const job = await waitJob(start.body.job_id);
    expect(job.status).toBe("DONE");
    // One link is one model, however many profiles it brought in.
    expect(job.imported).toBe(1);

    const items = await prisma.importJobItem.findMany({ where: { jobId: job.id } });
    expect(items[0].status).toBe("DONE");

    const user = await prisma.user.findFirst({ where: { email: `links-${stamp}@example.com` } });
    const notification = await prisma.notification.findFirst({
      where: { userId: user!.id },
      orderBy: { createdAt: "desc" },
    });
    expect(notification!.title).toBe("Imported 1 of 1 models");
    expect(notification!.body).toBe("2 of 2 print profiles imported.");
    const print = await prisma.print.findFirst({
      where: { userId: user!.id, sourceExternalId: id },
      include: { plates: true },
    });
    expect(print!.plates).toHaveLength(2);
  });

  it("lists each link with its status and failure reason", async () => {
    const goodId = String((stamp % 1_000_000_000) + 9);
    const badId = String((stamp % 1_000_000_000) + 10);
    behavior.set(badId, "gone");

    const start = await startLinks([
      `https://makerworld.com/en/models/${goodId}-phoenix`,
      `https://makerworld.com/en/models/${badId}-phoenix`,
    ]);
    const job = await waitJob(start.body.job_id);

    const res = await request(app).get(`/api/import/jobs/${job.id}/items`).set(auth());
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    const good = res.body.find((item: { url: string }) => item.url.includes(goodId));
    const bad = res.body.find((item: { url: string }) => item.url.includes(badId));
    expect(good).toMatchObject({ status: "DONE", attempts: 1, error_message: null });
    expect(bad).toMatchObject({ status: "FAILED", attempts: 1 });
    expect(bad.error_message).toBeTruthy();
  });

  it("refuses a retry with nothing failed", async () => {
    const id = String((stamp % 1_000_000_000) + 8);
    const start = await startLinks([`https://makerworld.com/en/models/${id}-phoenix`]);
    const job = await waitJob(start.body.job_id);
    expect(job.failed_count).toBe(0);

    const retry = await request(app).post(`/api/import/jobs/${job.id}/retry`).set(auth()).send({});
    expect(retry.status).toBe(400);
  });
  it("keeps a single import queued when its session comes from saved settings", async () => {
    const id = String((stamp % 1_000_000_000) + 12);
    const response = await request(app)
      .post("/api/import?async=1")
      .set(auth())
      .send({ url: `https://makerworld.com/en/models/${id}-phoenix` });
    expect(response.status).toBe(202);
    expect(response.body.job_id).toBe(response.body.task_id);
    expect(typeof response.body.job_id).toBe("string");
    expect((await waitJob(response.body.job_id)).status).toBe("DONE");
  });

  it("imports immediately with an explicit session without retaining its cookie", async () => {
    const id = String((stamp % 1_000_000_000) + 11);
    const response = await startLinks([`https://makerworld.com/en/models/${id}-phoenix`], {
      makerworld_cookie: "token=test-bearer",
    });
    expect(response.status).toBe(202);
    const finished = await waitJob(response.body.job_id);
    expect(finished).toMatchObject({ status: "DONE", imported: 1 });
    const job = await prisma.importJob.findUniqueOrThrow({ where: { id: response.body.job_id } });
    expect(job.payload).toMatchObject({ immediate: true });
    expect(JSON.stringify(job.payload)).not.toContain("test-bearer");
    expect(designCalls.get(id)).toBe(1);
  });

  it.each(["DONE", "PENDING"] as const)("reconstructs sync results after a crash with the item %s", async (status) => {
    const user = await prisma.user.findFirstOrThrow({ where: { email: `links-${stamp}@example.com` } });
    const print = await prisma.print.create({
      data: { userId: user.id, name: `Recovered ${status}`, nameNormalized: `recovered ${status}` },
    });
    const collection = await prisma.collection.create({
      data: { userId: user.id, name: `Recovered ${status}`, nameNormalized: `recovered ${status}` },
    });
    const sync = await prisma.collectionSync.create({
      data: {
        userId: user.id,
        collectionId: collection.id,
        provider: "makerworld",
        externalId: `recovered-${status}`,
        sourceUrl: "https://makerworld.com/en/collections/123",
      },
    });
    const job = await prisma.importJob.create({
      data: {
        userId: user.id,
        type: "LINKS",
        status: "RUNNING",
        total: 1,
        sourceUrl: sync.sourceUrl,
        collectionSyncId: sync.id,
        items: {
          create: [
            {
              url: "https://makerworld.com/en/models/123",
              status,
              result: {
                processed: 1,
                imported: 1,
                alreadyInLibrary: 0,
                failed: 0,
                printId: print.id,
                stopReason: null,
                profiles: false,
              },
            },
          ],
        },
      },
    });
    await runLinksImportJob(job.id, user.id, { url: sync.sourceUrl });
    const recovered = await prisma.importJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(recovered).toMatchObject({
      status: "DONE",
      processed: 1,
      imported: 1,
      alreadyInLibrary: 0,
      resultPrintId: print.id,
    });
    expect(designCalls.size).toBe(0);
    const notification = await prisma.notification.findFirstOrThrow({
      where: { userId: user.id, type: "sync" },
      orderBy: { createdAt: "desc" },
    });
    expect(notification.title).toBe(`1 new model synced into "Recovered ${status}"`);
    expect(notification.body).toContain(`"Recovered ${status}"`);
  });
});
