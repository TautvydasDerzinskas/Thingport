import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { checkImportStatus, identifySourceModel, importPrintFromUrl } from "../src/services/importService";
import { createJob, getActiveJob, updateJob } from "../src/services/importJobService";
import { createNotification, listNotifications, markAllRead } from "../src/services/notificationService";

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

    // Uploads don't go through importPrintFromUrl, so backfill the source identity directly --
    // equivalent to what a real MakerWorld import would have stamped on create.
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

// Distinct bytes per MakerWorld profile, like the real thing -- what the SHA-256 match keys on.
function profileFileContents(instanceId: string) {
  return `solid profile-${instanceId} endsolid`;
}

describe("MakerWorld print profiles", () => {
  // One design, several print profiles ("instances"), each with its own 3MF -- see
  // importService.ts's addMakerworldProfileToPrint. Every import here goes through the extension's
  // pre-resolved path (resolved_download_url + profile ids), so the only fetches are the model page
  // itself and the file; both are intercepted.
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
    const uploadRes = await request(app).post("/api/upload").set(auth()).attach("files", tmpFile("legacy-profile.stl", contents));
    expect(uploadRes.status).toBe(200);
    const printId = uploadRes.body.prints[0].id as string;
    await prisma.print.update({ where: { id: printId }, data: { sourceProvider: "makerworld", sourceExternalId: designId } });
    return printId;
  }

  afterEach(async () => {
    global.fetch = originalFetch;
    const prints = await prisma.print.findMany({ where: { userId, sourceProvider: "makerworld", sourceExternalId: designId } });
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
        .send({ url, resolved_download_url: `https://makerworld.com/files/profile-${instanceId}.stl`, resolved_instance_id: instanceId });

    expect((await post(pageUrl, "100")).body.import_outcome).toBe("created");
    expect((await post(`${pageUrl}#profileId-200`, "200")).body.import_outcome).toBe("profile_added");
    expect((await post(`${pageUrl}#profileId-200`, "200")).body.import_outcome).toBe("already_imported");
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
    // Deliberately a non-default profile -- older imports could come from any profile.
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
    // The hash is stored on first use, so later comparisons don't re-read the file.
    expect(matched.plates[0].contentSha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("import job lock", () => {
  it("blocks a new batch import while one is already running, and reports it via the active/job endpoints", async () => {
    const job = await createJob(userId, "COLLECTION", {
      sourceUrl: "https://makerworld.com/en/collections/1-test",
      provider: "makerworld",
      total: 5,
    });

    const collectionRes = await request(app)
      .post("/api/import/collection")
      .set(auth())
      .send({ url: "https://makerworld.com/en/collections/1-test", design_ids: ["1"] });
    expect(collectionRes.status).toBe(409);

    const zipRes = await request(app)
      .post("/api/import/zip")
      .set(auth())
      .send({ url: "https://example.com/some.zip", entries: ["a.stl"] });
    expect(zipRes.status).toBe(409);

    const activeRes = await request(app).get("/api/import/jobs/active").set(auth());
    expect(activeRes.status).toBe(200);
    expect(activeRes.body.id).toBe(job.id);
    expect(activeRes.body.status).toBe("RUNNING");

    const jobRes = await request(app).get(`/api/import/jobs/${job.id}`).set(auth());
    expect(jobRes.status).toBe(200);
    expect(jobRes.body.total).toBe(5);

    await updateJob(job.id, { status: "DONE" });
    expect(await getActiveJob(userId)).toBeNull();
  });
});

describe("notifications", () => {
  it("lists notifications with an accurate unread count, clearable via mark-all-read", async () => {
    await createNotification(userId, { title: "Test notification A", externalUrl: "https://example.com/a" });
    await createNotification(userId, { title: "Test notification B", internalPath: "/models/collections/xyz" });

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
    await markAllRead(userId); // idempotent no-op, just exercising the direct service path too
  });
});
