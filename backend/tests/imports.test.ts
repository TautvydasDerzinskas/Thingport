import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import JSZip from "jszip";
import { Client } from "pg";
import { IMPORT_WORKER_LOCK } from "../src/services/importScheduler";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { checkImportStatus, identifySourceModel, importPrintFromUrl } from "../src/services/importService";
import { createJob, getActiveJob, updateJob } from "../src/services/importJobService";
import { createNotification, listNotifications, markAllRead } from "../src/services/notificationService";
import { extractZipEntriesToPrints, listZipEntries } from "../src/services/zipService";

const app = createApp();
let token: string;
let userId: string;

function tmpFile(name: string, contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thingport-test-"));
  const p = path.join(dir, name);
  fs.writeFileSync(p, contents);
  return p;
}

beforeAll(async () => {
  const email = `imports-test-${Date.now()}@example.com`;
  const res = await request(app)
    .post("/api/register")
    .send({ displayName: "Imports Test", email, password: "password123" });
  if (res.status !== 200) {
    throw new Error(`Failed to register during test setup: ${res.status} ${JSON.stringify(res.body)}`);
  }
  token = res.body.token;
  userId = res.body.user.id;
});

function auth() {
  return { Authorization: `Bearer ${token}` };
}

describe("identifySourceModel", () => {
  it("extracts a provider + design id from a MakerWorld model URL", () => {
    expect(identifySourceModel("https://makerworld.com/en/models/681234-some-slug")).toEqual({
      provider: "makerworld",
      externalId: "681234",
    });
  });

  it("returns null for a non-MakerWorld URL", () => {
    expect(identifySourceModel("https://example.com/models/681234")).toBeNull();
  });

  it("returns null for a MakerWorld URL that isn't a model page", () => {
    expect(identifySourceModel("https://makerworld.com/en/collections/12345-name")).toBeNull();
  });

  it("extracts a provider + model id from a Printables model URL", () => {
    expect(identifySourceModel("https://www.printables.com/model/1786545-strong-garden-hose-holder")).toEqual({
      provider: "printables",
      externalId: "1786545",
    });
  });

  it("returns null for a Printables URL that isn't a model page", () => {
    expect(identifySourceModel("https://www.printables.com/@s0ren")).toBeNull();
  });
});

describe("import dedup", () => {
  it("reuses an existing print instead of re-downloading when it was already imported from this source", async () => {
    const uploadRes = await request(app)
      .post("/api/upload")
      .set(auth())
      .attach("files", tmpFile("dedup-me.stl", "solid dedup endsolid"));
    expect(uploadRes.status).toBe(200);
    const printId = uploadRes.body.prints[0].id;

    // Uploads skip importPrintFromUrl, so set the source identity directly.
    await prisma.print.update({
      where: { id: printId },
      data: { sourceProvider: "makerworld", sourceExternalId: "999111" },
    });

    const countBefore = await prisma.print.count({ where: { userId } });

    const result = await importPrintFromUrl(userId, "https://makerworld.com/en/models/999111-dedup-slug", {
      url: "https://makerworld.com/en/models/999111-dedup-slug",
      tags: [],
    });

    expect(result.alreadyImported).toBe(true);
    expect(result.print.id).toBe(printId);

    const countAfter = await prisma.print.count({ where: { userId } });
    expect(countAfter).toBe(countBefore);

    await request(app).delete(`/api/print/${printId}`).set(auth());
  });
});

// Distinct bytes per profile, which the SHA-256 match keys on.
function profileFileContents(instanceId: string) {
  return `solid profile-${instanceId} endsolid`;
}

describe("MakerWorld print profiles", () => {
  // One design with several profiles, each its own 3MF, imported via the extension's pre-resolved
  // path.
  const designId = "888777";
  const pageUrl = `https://makerworld.com/en/models/${designId}-profile-slug`;
  const originalFetch = global.fetch;

  function mockMakerworldFetch() {
    const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
      const url = String(input);
      if (url.startsWith("https://makerworld.com/en/models/")) {
        return new Response("<html><head><title>Profile Test</title></head><body></body></html>", {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      const file = url.match(/^https:\/\/makerworld\.com\/files\/profile-(\w+)\.stl$/);
      if (file) {
        return new Response(profileFileContents(file[1]), { headers: { "content-type": "application/octet-stream" } });
      }
      throw new Error(`Unexpected fetch to ${url}`);
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  function importProfile(url: string, instanceId: string | null) {
    return importPrintFromUrl(userId, url, {
      url,
      tags: [],
      resolved_download_url: `https://makerworld.com/files/profile-${instanceId ?? "unknown"}.stl`,
      resolved_instance_id: instanceId,
    });
  }

  async function createLegacyPrint(contents: string) {
    const uploadRes = await request(app)
      .post("/api/upload")
      .set(auth())
      .attach("files", tmpFile("legacy-profile.stl", contents));
    expect(uploadRes.status).toBe(200);
    const printId = uploadRes.body.prints[0].id as string;
    await prisma.print.update({
      where: { id: printId },
      data: { sourceProvider: "makerworld", sourceExternalId: designId },
    });
    return printId;
  }

  afterEach(async () => {
    global.fetch = originalFetch;
    const prints = await prisma.print.findMany({
      where: { userId, sourceProvider: "makerworld", sourceExternalId: designId },
    });
    for (const print of prints) await request(app).delete(`/api/print/${print.id}`).set(auth());
  });

  it("adds a second profile as another plate on the same print, and skips a profile it already has", async () => {
    mockMakerworldFetch();
    const first = await importProfile(pageUrl, "100");
    expect(first.alreadyImported).toBe(false);
    expect(first.plates.map((plate) => plate.sourceInstanceId)).toEqual(["100"]);

    const second = await importProfile(`${pageUrl}#profileId-200`, "200");
    expect(second.alreadyImported).toBe(false);
    expect(second.print.id).toBe(first.print.id);
    expect(second.plates.map((plate) => plate.sourceInstanceId)).toEqual(["100", "200"]);

    const fetchMock = mockMakerworldFetch();
    const again = await importProfile(`${pageUrl}#profileId-200`, "200");
    expect(again.alreadyImported).toBe(true);
    expect(again.plates).toHaveLength(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports what POST /import did via import_outcome", async () => {
    mockMakerworldFetch();
    const post = (url: string, instanceId: string) =>
      request(app)
        .post("/api/import")
        .set(auth())
        .send({
          url,
          resolved_download_url: `https://makerworld.com/files/profile-${instanceId}.stl`,
          resolved_instance_id: instanceId,
        });

    expect((await post(pageUrl, "100")).body.import_outcome).toBe("created");
    expect((await post(`${pageUrl}#profileId-200`, "200")).body.import_outcome).toBe("profile_added");
    expect((await post(`${pageUrl}#profileId-200`, "200")).body.import_outcome).toBe("already_imported");
  });

  it("reports MakerWorld's CAPTCHA instead of 'no downloadable file', and stops asking", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
      const url = String(input);
      if (url.startsWith("https://makerworld.com/en/models/")) {
        return new Response("<html><head><title>Captcha Test</title></head><body></body></html>", {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      if (url === `https://makerworld.com/api/v1/models/${designId}/download`) {
        return new Response(JSON.stringify({ captchaId: "abc", message: "we need to confirm you are not a robot" }), {
          status: 418,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`Unexpected fetch to ${url}`);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const res = await request(app).post("/api/import").set(auth()).send({ url: pageUrl });
    expect(res.status).toBe(429);
    expect(res.body.detail).toMatch(/CAPTCHA/);
    // None of the generic API fallbacks ran after the CAPTCHA.
    expect(fetchMock.mock.calls.map(([input]) => String(input)).filter((u) => u.includes("/api/v1/"))).toEqual([
      `https://makerworld.com/api/v1/models/${designId}/download`,
    ]);
  });

  it("runs POST /import?async=1 in the background and serves the result at /import/tasks/:id", async () => {
    mockMakerworldFetch();
    const start = await request(app)
      .post("/api/import?async=1")
      .set(auth())
      .send({ url: pageUrl, resolved_download_url: "https://makerworld.com/files/profile-100.stl" });
    expect(start.status).toBe(202);
    const taskId = start.body.task_id as string;

    let task = (await request(app).get(`/api/import/tasks/${taskId}`).set(auth())).body;
    for (let i = 0; task.status === "running" && i < 100; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      task = (await request(app).get(`/api/import/tasks/${taskId}`).set(auth())).body;
    }
    expect(task.status).toBe("done");
    expect(task.result.import_outcome).toBe("created");
    expect(task.result.id).toEqual(expect.any(String));
  });

  it("hides an import task from other users", async () => {
    mockMakerworldFetch();
    const start = await request(app)
      .post("/api/import?async=1")
      .set(auth())
      .send({ url: pageUrl, resolved_download_url: "https://makerworld.com/files/profile-100.stl" });
    const other = await request(app)
      .post("/api/register")
      .send({ displayName: "Other", email: `imports-other-${Date.now()}@example.com`, password: "password123" });
    const res = await request(app)
      .get(`/api/import/tasks/${start.body.task_id}`)
      .set({ Authorization: `Bearer ${other.body.token}` });
    expect(res.status).toBe(404);
    // Let the import finish before afterEach restores fetch and cleans up.
    for (let i = 0; i < 100; i++) {
      const task = await request(app).get(`/api/import/tasks/${start.body.task_id}`).set(auth());
      if (task.body.status !== "running") break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  });

  it("treats a bare model URL as already imported without asking MakerWorld", async () => {
    mockMakerworldFetch();
    await importProfile(pageUrl, "100");

    const fetchMock = mockMakerworldFetch();
    const result = await importPrintFromUrl(userId, pageUrl, { url: pageUrl, tags: [] });
    expect(result.alreadyImported).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports import status per profile when the URL names one", async () => {
    expect((await checkImportStatus(userId, `${pageUrl}#profileId-200`)).state).toBe("not_imported");

    mockMakerworldFetch();
    await importProfile(`${pageUrl}#profileId-200`, "200");

    const imported = await checkImportStatus(userId, `${pageUrl}#profileId-200`);
    expect(imported).toMatchObject({ already_imported: true, state: "imported" });
    const missing = await checkImportStatus(userId, `${pageUrl}#profileId-300`);
    expect(missing).toMatchObject({ already_imported: false, state: "profile_missing", print_id: imported.print_id });
    expect((await checkImportStatus(userId, pageUrl)).state).toBe("imported");
  });

  it("reports a profile as unknown while the print has plates from before profiles were tracked", async () => {
    await createLegacyPrint("solid anything endsolid");
    const status = await checkImportStatus(userId, `${pageUrl}#profileId-300`);
    expect(status).toMatchObject({ already_imported: false, state: "profile_unknown" });
    expect((await checkImportStatus(userId, pageUrl)).state).toBe("imported");
  });

  it("tags an untagged plate whose file matches the downloaded profile instead of adding a copy", async () => {
    // A non-default profile: older imports could come from any.
    const printId = await createLegacyPrint(profileFileContents("200"));

    mockMakerworldFetch();
    const other = await importProfile(`${pageUrl}#profileId-100`, "100");
    expect(other.alreadyImported).toBe(false);
    expect(other.profileAdded).toBe(true);
    expect(other.plates.map((plate) => plate.sourceInstanceId)).toEqual([null, "100"]);

    const matched = await importProfile(`${pageUrl}#profileId-200`, "200");
    expect(matched.alreadyImported).toBe(true);
    expect(matched.print.id).toBe(printId);
    expect(matched.plates.map((plate) => plate.sourceInstanceId)).toEqual(["200", "100"]);
    expect(matched.plates[0].contentSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("doesn't read an untagged plate whose file is another size than the downloaded profile", async () => {
    const printId = await createLegacyPrint(`${profileFileContents("200")} and more`);

    mockMakerworldFetch();
    const added = await importProfile(`${pageUrl}#profileId-200`, "200");
    expect(added.print.id).toBe(printId);
    expect(added.profileAdded).toBe(true);
    expect(added.plates.map((plate) => plate.sourceInstanceId)).toEqual([null, "200"]);
    // Hashing it would have recorded its hash.
    expect(added.plates[0].contentSha256).toBeNull();
  });
});

describe("import job lock", () => {
  it("queues new batches while one is running and reports progress through the existing endpoints", async () => {
    const lock = new Client({ connectionString: process.env.DATABASE_URL });
    await lock.connect();
    await lock.query("SELECT pg_advisory_lock($1)", [IMPORT_WORKER_LOCK]);
    try {
      const job = await createJob(userId, "COLLECTION", {
        sourceUrl: "https://makerworld.com/en/collections/1-test",
        provider: "makerworld",
        total: 5,
      });

      const collectionRes = await request(app)
        .post("/api/import/collection")
        .set(auth())
        .send({ url: "https://makerworld.com/en/collections/1-test", design_ids: ["1"] });
      expect(collectionRes.status).toBe(202);
      expect((await prisma.importJob.findUniqueOrThrow({ where: { id: collectionRes.body.job_id } })).status).toBe(
        "QUEUED",
      );

      const zipRes = await request(app)
        .post("/api/import/zip")
        .set(auth())
        .send({ url: "https://example.com/some.zip", entries: ["a.stl"] });
      expect(zipRes.status).toBe(202);
      await prisma.importJob.deleteMany({ where: { id: { in: [collectionRes.body.job_id, zipRes.body.job_id] } } });

      const activeRes = await request(app).get("/api/import/jobs/active").set(auth());
      expect(activeRes.status).toBe(200);
      expect(activeRes.body.id).toBe(job.id);
      expect(activeRes.body.status).toBe("RUNNING");

      const jobRes = await request(app).get(`/api/import/jobs/${job.id}`).set(auth());
      expect(jobRes.status).toBe(200);
      expect(jobRes.body.total).toBe(5);

      await updateJob(job.id, { status: "DONE" });
      expect(await getActiveJob(userId)).toBeNull();
    } finally {
      await lock.end();
    }
  });
});

describe("zip import", () => {
  it("imports the entries it lists from a zip whose paths start with ./, as macOS tar -a writes them", async () => {
    const zip = new JSZip();
    zip.file("./Dotted/hull.stl", "solid hull endsolid");
    zip.file("./Dotted/Parts/mast.stl", "solid mast endsolid");
    const zipPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "thingport-test-")), "dotted.zip");
    fs.writeFileSync(zipPath, await zip.generateAsync({ type: "nodebuffer" }));

    const entries = (await listZipEntries(zipPath)).map((entry) => entry.path);
    expect(entries).toEqual(["Dotted/Parts/mast.stl", "Dotted/hull.stl"]);

    const { prints, failed } = await extractZipEntriesToPrints(userId, zipPath, entries, {});
    expect(failed).toEqual([]);
    const categories = await prisma.category.findMany({ where: { id: { in: prints.map((p) => p.categoryId!) } } });
    const categoryName = (id: string | null) => categories.find((c) => c.id === id)?.name;
    expect(prints.map((p) => [p.name, categoryName(p.categoryId)])).toEqual([
      ["mast", "Parts"],
      ["hull", "Dotted"],
    ]);
  });
});

describe("notifications", () => {
  it("lists notifications with an accurate unread count, clearable via mark-all-read", async () => {
    await createNotification(userId, {
      type: "import",
      title: "Test notification A",
      externalUrl: "https://example.com/a",
    });
    await createNotification(userId, {
      type: "sync",
      title: "Test notification B",
      internalPath: "/models/collections/xyz",
    });

    const before = await listNotifications(userId);
    expect(before.unreadCount).toBeGreaterThanOrEqual(2);
    expect(before.items.some((n) => n.title === "Test notification A")).toBe(true);

    const listRes = await request(app).get("/api/notifications").set(auth());
    expect(listRes.status).toBe(200);
    expect(listRes.body.unread_count).toBeGreaterThanOrEqual(2);

    const readRes = await request(app).post("/api/notifications/read-all").set(auth());
    expect(readRes.status).toBe(200);

    const after = await listNotifications(userId);
    expect(after.unreadCount).toBe(0);
    await markAllRead(userId);
  });
});
