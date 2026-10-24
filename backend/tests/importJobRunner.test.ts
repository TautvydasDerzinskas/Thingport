import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { createJob, getJob } from "../src/services/importJobService";
import { listNotifications } from "../src/services/notificationService";
import { HttpError } from "../src/utils/fileUtils";

// Mock only importPrintFromUrl so this runs offline.
vi.mock("../src/services/importService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/importService")>();
  return { ...actual, importPrintFromUrl: vi.fn<typeof actual.importPrintFromUrl>() };
});

// No real requests happen, so skip the pacing delay.
vi.mock("../src/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/config")>();
  return { ...actual, IMPORT_COLLECTION_DELAY_MS: 0 };
});

vi.mock("../src/providers/thingiverse/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/providers/thingiverse/api")>();
  return { ...actual, fetchThingiverseCollectionTitle: vi.fn<typeof actual.fetchThingiverseCollectionTitle>() };
});

import { importPrintFromUrl } from "../src/services/importService";
import { runCollectionImportJob, runListImportJob } from "../src/services/importJobRunner";
import { PROVIDERS } from "../src/providers/registry";
import { fetchThingiverseCollectionTitle } from "../src/providers/thingiverse/api";
import { setThingiverseAccessToken } from "../src/services/settingsService";
import { prisma } from "../src/db";

const app = createApp();
let userId: string;

/** A Thingiverse list's import, as POST /import/thingiverse/list starts it. */
async function runThingiverseList(jobId: string, url: string, modelIds: string[]): Promise<void> {
  const body = { url, model_ids: modelIds, tags: [] };
  const start = await PROVIDERS.thingiverse.lists!.start(userId, url, body);
  if (!("batch" in start)) throw new Error("Thingiverse lists import as a batch");
  await runListImportJob(jobId, userId, "thingiverse", start.batch, body);
}

beforeAll(async () => {
  const email = `import-job-runner-test-${Date.now()}@example.com`;
  const res = await request(app)
    .post("/api/register")
    .send({ displayName: "Job Runner Test", email, password: "password123" });
  if (res.status !== 200) {
    throw new Error(`Failed to register during test setup: ${res.status} ${JSON.stringify(res.body)}`);
  }
  userId = res.body.user.id;
});

describe("runCollectionImportJob", () => {
  it("processes MakerWorld collection designs strictly one at a time, never in a concurrent burst", async () => {
    let active = 0;
    let maxActive = 0;
    const mockedImport = vi.mocked(importPrintFromUrl);
    mockedImport.mockImplementation(async (_userId: string, url: string) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      return {
        print: { id: `print-${url}` } as never,
        plates: [],
        author: null,
        previewImages: [],
        alreadyImported: false,
      };
    });

    const job = await createJob(userId, "COLLECTION", {
      sourceUrl: "https://makerworld.com/en/models/does-not-matter",
      provider: "makerworld",
      total: 4,
    });

    await runCollectionImportJob(job.id, userId, {
      url: "https://makerworld.com/en/models/does-not-matter",
      design_ids: ["30", "31", "32", "33"],
      tags: [],
    });

    expect(maxActive).toBe(1);
    const finished = await getJob(job.id, userId);
    expect(finished?.imported).toBe(4);
  });

  it("skips unavailable/failed models instead of failing the whole batch, and reports them separately", async () => {
    const mockedImport = vi.mocked(importPrintFromUrl);
    mockedImport.mockImplementation(async (_userId: string, url: string) => {
      if (url.endsWith("/1")) {
        return {
          print: { id: "print-1" } as never,
          plates: [],
          author: null,
          previewImages: [],
          alreadyImported: false,
        };
      }
      // Hidden/deleted models surface as 403/404.
      if (url.endsWith("/2")) throw new HttpError(404, "Not found");
      throw new HttpError(500, "Boom");
    });

    const job = await createJob(userId, "COLLECTION", {
      sourceUrl: "https://makerworld.com/en/models/does-not-matter",
      provider: "makerworld",
      total: 3,
    });

    await runCollectionImportJob(job.id, userId, {
      url: "https://makerworld.com/en/models/does-not-matter",
      design_ids: ["1", "2", "3"],
      tags: [],
    });

    const finished = await getJob(job.id, userId);
    expect(finished?.status).toBe("DONE");
    expect(finished?.imported).toBe(1);
    expect(finished?.failedCount).toBe(2);

    const { items } = await listNotifications(userId);
    const notification = items.find((n) => n.title.startsWith("Imported 1 of 3"));
    expect(notification).toBeTruthy();
    expect(notification!.body).toBe(
      "From a MakerWorld collection — 1 unavailable (private, deleted, or hidden), 1 failed.",
    );
  });

  it("logs the job's start, each failed model with why, and the totals", async () => {
    vi.mocked(importPrintFromUrl).mockImplementation(async (_userId: string, url: string) => {
      if (url.endsWith("/41")) throw new HttpError(404, "Not found");
      if (url.endsWith("/42")) throw new HttpError(429, "MakerWorld is challenging this account with a CAPTCHA");
      return {
        print: { id: "print-40" } as never,
        plates: [],
        author: null,
        previewImages: [],
        alreadyImported: false,
      };
    });
    const job = await createJob(userId, "COLLECTION", {
      sourceUrl: "https://makerworld.com/en/models/does-not-matter",
      provider: "makerworld",
      total: 3,
    });
    const lines: string[] = [];
    for (const stream of ["log", "warn", "error"] as const) {
      vi.spyOn(console, stream).mockImplementation((line: unknown) => void lines.push(String(line)));
    }
    try {
      await runCollectionImportJob(job.id, userId, {
        url: "https://makerworld.com/en/models/does-not-matter",
        design_ids: ["40", "41", "42"],
        tags: [],
      });
    } finally {
      vi.mocked(console.log).mockRestore();
      vi.mocked(console.warn).mockRestore();
      vi.mocked(console.error).mockRestore();
    }

    const ofJob = lines.filter((line) => line.includes(`job=${job.id}`));
    expect(ofJob[0]).toMatch(/INFO  \[import\] makerworld collection job started .*models=3/);
    const failures = ofJob.filter((line) => line.includes("model import failed"));
    expect(failures).toHaveLength(2);
    expect(failures[0]).toMatch(
      /WARN .*url=https:\/\/makerworld\.com\/en\/models\/41 reason=unavailable error="Not found"/,
    );
    expect(failures[1]).toContain("reason=rateLimited");
    expect(ofJob.at(-1)).toMatch(/collection job done .*imported=1 already_in_library=0 failed=2/);
  });

  it("still marks the job DONE even if every model in the batch is unavailable", async () => {
    const mockedImport = vi.mocked(importPrintFromUrl);
    mockedImport.mockImplementation(async () => {
      throw new HttpError(403, "Forbidden");
    });

    const job = await createJob(userId, "COLLECTION", {
      sourceUrl: "https://makerworld.com/en/models/does-not-matter",
      provider: "makerworld",
      total: 2,
    });

    await runCollectionImportJob(job.id, userId, {
      url: "https://makerworld.com/en/models/does-not-matter",
      design_ids: ["10", "11"],
      tags: [],
    });

    const finished = await getJob(job.id, userId);
    expect(finished?.status).toBe("DONE");
    expect(finished?.imported).toBe(0);
    expect(finished?.failedCount).toBe(2);

    const { items } = await listNotifications(userId);
    const notification = items.find((n) => n.title.startsWith("Imported 0 of 2"));
    expect(notification).toBeTruthy();
    expect(notification!.body).toBe("From a MakerWorld collection — 2 unavailable (private, deleted, or hidden).");
  });

  it("labels a mid-batch CAPTCHA cooloff distinctly instead of an opaque wall of generic failures", async () => {
    // A few succeed, then the CAPTCHA trips and every remaining item fails the same way.
    const mockedImport = vi.mocked(importPrintFromUrl);
    mockedImport.mockImplementation(async (_userId: string, url: string) => {
      if (url.endsWith("/1") || url.endsWith("/2")) {
        return {
          print: { id: `print-${url}` } as never,
          plates: [],
          author: null,
          previewImages: [],
          alreadyImported: false,
        };
      }
      throw new HttpError(429, "MakerWorld is challenging this account with a CAPTCHA...");
    });

    const job = await createJob(userId, "COLLECTION", {
      sourceUrl: "https://makerworld.com/en/models/does-not-matter",
      provider: "makerworld",
      total: 5,
    });

    await runCollectionImportJob(job.id, userId, {
      url: "https://makerworld.com/en/models/does-not-matter",
      design_ids: ["1", "2", "3", "4", "5"],
      tags: [],
    });

    const finished = await getJob(job.id, userId);
    expect(finished?.status).toBe("DONE");
    expect(finished?.imported).toBe(2);
    expect(finished?.failedCount).toBe(3);

    const { items } = await listNotifications(userId);
    const notification = items.find((n) => n.title.startsWith("Imported 2 of 5"));
    expect(notification).toBeTruthy();
    expect(notification!.body).toBe(
      "From a MakerWorld collection — 3 blocked by a MakerWorld CAPTCHA challenge (too many requests at once) — this usually clears in 1-4 hours, then retry the same collection.",
    );
  });

  it("labels an expired MakerWorld session distinctly from a per-model failure", async () => {
    const mockedImport = vi.mocked(importPrintFromUrl);
    mockedImport.mockImplementation(async () => {
      throw new HttpError(401, "Your MakerWorld session has expired or was rejected.");
    });

    const job = await createJob(userId, "COLLECTION", {
      sourceUrl: "https://makerworld.com/en/models/does-not-matter",
      provider: "makerworld",
      total: 1,
    });

    await runCollectionImportJob(job.id, userId, {
      url: "https://makerworld.com/en/models/does-not-matter",
      design_ids: ["20"],
      tags: [],
    });

    const finished = await getJob(job.id, userId);
    expect(finished?.status).toBe("DONE");
    expect(finished?.failedCount).toBe(1);

    const { items } = await listNotifications(userId);
    const notification = items.find((n) => n.title.startsWith("Imported 0 of 1"));
    expect(notification).toBeTruthy();
    expect(notification!.body).toBe(
      "From a MakerWorld collection — 1 failed because your MakerWorld session expired — update the cookie in Settings and retry.",
    );
  });
});

describe("runListImportJob, of Thingiverse Likes", () => {
  afterEach(async () => {
    await setThingiverseAccessToken(null);
  });

  it("fails clearly when no App Token is configured, without touching the job's other bookkeeping", async () => {
    const job = await createJob(userId, "COLLECTION", {
      sourceUrl: "https://www.thingiverse.com/someuser/likes",
      provider: "thingiverse",
      total: 1,
    });

    await runThingiverseList(job.id, "https://www.thingiverse.com/someuser/likes", ["1"]);

    const finished = await getJob(job.id, userId);
    expect(finished?.status).toBe("ERROR");
    expect(finished?.errorMessage).toMatch(/isn't configured/i);
  });

  it("imports every liked Thing into the user's 'Thingiverse likes (@user)' collection, one at a time with pacing", async () => {
    await setThingiverseAccessToken("test-token");
    let active = 0;
    let maxActive = 0;
    const mockedImport = vi.mocked(importPrintFromUrl);
    mockedImport.mockImplementation(async (_userId: string, url: string) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      // addPrintsToCollection needs a real Print row for its FK.
      const print = await prisma.print.create({
        data: { userId, name: `Liked ${url}`, nameNormalized: `liked ${url}`.toLowerCase() },
      });
      return {
        print,
        plates: [],
        author: null,
        previewImages: [],
        alreadyImported: false,
      };
    });

    const job = await createJob(userId, "COLLECTION", {
      sourceUrl: "https://www.thingiverse.com/someuser/likes",
      provider: "thingiverse",
      total: 3,
    });

    await runThingiverseList(job.id, "https://www.thingiverse.com/someuser/likes", ["101", "102", "103"]);

    expect(maxActive).toBe(1);
    const finished = await getJob(job.id, userId);
    expect(finished?.status).toBe("DONE");
    expect(finished?.imported).toBe(3);
    expect(finished?.resultCollectionId).toBeTruthy();

    const collection = await prisma.collection.findFirst({ where: { userId, name: "Thingiverse likes (@someuser)" } });
    expect(collection?.id).toBe(finished?.resultCollectionId);
    const itemCount = await prisma.collectionItem.count({ where: { collectionId: collection!.id } });
    expect(itemCount).toBe(3);

    const { items } = await listNotifications(userId);
    const notification = items.find((n) => n.title === "Imported 3 of 3 models from Thingiverse");
    expect(notification).toBeTruthy();
    expect(notification!.body).toBe("From @someuser's Likes.");
  });

  it("gives each user's Likes their own collection, and reuses it on the next import", async () => {
    await setThingiverseAccessToken("test-token");
    const mockedImport = vi.mocked(importPrintFromUrl);
    mockedImport.mockImplementation(async (_userId: string, url: string) => ({
      print: await prisma.print.create({
        data: { userId, name: `Liked again ${url}`, nameNormalized: `liked again ${url}`.toLowerCase() },
      }),
      plates: [],
      author: null,
      previewImages: [],
      alreadyImported: false,
    }));

    const importLikes = async (username: string, thingId: string) => {
      const url = `https://www.thingiverse.com/${username}/likes`;
      const job = await createJob(userId, "COLLECTION", { sourceUrl: url, provider: "thingiverse", total: 1 });
      await runThingiverseList(job.id, url, [thingId]);
      return (await getJob(job.id, userId))?.resultCollectionId;
    };

    const a1 = await importLikes("userA", "201");
    const a2 = await importLikes("userA", "202");
    const b = await importLikes("userB", "203");
    expect(a2).toBe(a1);
    expect(b).not.toBe(a1);

    const names = (await prisma.collection.findMany({ where: { id: { in: [a1!, b!] } } }))
      .map((c) => c.name)
      .toSorted();
    expect(names).toEqual(["Thingiverse likes (@userA)", "Thingiverse likes (@userB)"]);
  });
});

describe("runListImportJob, of a Thingiverse collection", () => {
  afterEach(async () => {
    await setThingiverseAccessToken(null);
    vi.mocked(fetchThingiverseCollectionTitle).mockReset();
  });

  it("files successful imports into a Thingport Collection named after the real Thingiverse Collection", async () => {
    await setThingiverseAccessToken("test-token");
    vi.mocked(fetchThingiverseCollectionTitle).mockResolvedValue("Things to Make");
    const mockedImport = vi.mocked(importPrintFromUrl);
    mockedImport.mockImplementation(async (_userId: string, url: string) => ({
      print: await prisma.print.create({
        data: { userId, name: `Collected ${url}`, nameNormalized: `collected ${url}`.toLowerCase() },
      }),
      plates: [],
      author: null,
      previewImages: [],
      alreadyImported: false,
    }));

    const job = await createJob(userId, "COLLECTION", {
      sourceUrl: "https://www.thingiverse.com/Derzinskas/collections/40781574/things",
      provider: "thingiverse",
      total: 2,
    });

    await runThingiverseList(job.id, "https://www.thingiverse.com/Derzinskas/collections/40781574/things", [
      "301",
      "302",
    ]);

    const finished = await getJob(job.id, userId);
    expect(finished?.status).toBe("DONE");
    expect(finished?.imported).toBe(2);
    expect(finished?.sourceLabel).toBe("Things to Make");

    const collection = await prisma.collection.findFirst({ where: { userId, name: "Things to Make" } });
    expect(collection?.id).toBe(finished?.resultCollectionId);

    const { items } = await listNotifications(userId);
    const notification = items.find((n) => n.title === "Imported 2 of 2 models from Thingiverse");
    expect(notification).toBeTruthy();
    expect(notification!.body).toBe('From "Things to Make".');
  });

  it("falls back to a generic name when the Collection's real name can't be resolved", async () => {
    await setThingiverseAccessToken("test-token");
    vi.mocked(fetchThingiverseCollectionTitle).mockResolvedValue(null);
    const mockedImport = vi.mocked(importPrintFromUrl);
    mockedImport.mockImplementation(async (_userId: string, url: string) => ({
      print: await prisma.print.create({
        data: { userId, name: `Collected fallback ${url}`, nameNormalized: `collected fallback ${url}`.toLowerCase() },
      }),
      plates: [],
      author: null,
      previewImages: [],
      alreadyImported: false,
    }));

    const job = await createJob(userId, "COLLECTION", {
      sourceUrl: "https://www.thingiverse.com/someone/collections/40781575/things",
      provider: "thingiverse",
      total: 1,
    });

    await runThingiverseList(job.id, "https://www.thingiverse.com/someone/collections/40781575/things", ["401"]);

    const finished = await getJob(job.id, userId);
    expect(finished?.status).toBe("DONE");
    expect(finished?.sourceLabel).toBe("Thingiverse Collection 40781575");
  });

  it("fails clearly when no App Token is configured", async () => {
    const job = await createJob(userId, "COLLECTION", {
      sourceUrl: "https://www.thingiverse.com/someone/collections/1/things",
      provider: "thingiverse",
      total: 1,
    });

    await runThingiverseList(job.id, "https://www.thingiverse.com/someone/collections/1/things", ["1"]);

    const finished = await getJob(job.id, userId);
    expect(finished?.status).toBe("ERROR");
    expect(finished?.errorMessage).toMatch(/isn't configured/i);
    expect(fetchThingiverseCollectionTitle).not.toHaveBeenCalled();
  });
});
