import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { HttpError } from "../src/utils/fileUtils";

// A file named "corrupt.*" fails to become a model, the way an unreadable file would.
vi.mock("../src/services/printCreation", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/services/printCreation")>();
  return {
    ...original,
    createPrint: (async (...args: Parameters<typeof original.createPrint>) => {
      if (args[2] === "corrupt") throw new HttpError(422, "Unreadable model file.");
      return original.createPrint(...args);
    }) as typeof original.createPrint,
  };
});

const app = createApp();
const STL =
  "solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t\n";
let token: string;
let userId: string;
const auth = () => ({ Authorization: `Bearer ${token}` });
const notifications = () => prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });

beforeAll(async () => {
  const email = `model-notifications-${Date.now()}@example.com`;
  const res = await request(app)
    .post("/api/register")
    .send({ displayName: "Notified", email, password: "password123" });
  token = res.body.token;
  userId = res.body.user.id;
});

beforeEach(async () => {
  await prisma.notification.deleteMany({ where: { userId } });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
});

describe("single imports", () => {
  const designId = "777555";
  const pageUrl = `https://makerworld.com/en/models/${designId}-notify-slug`;
  const originalFetch = global.fetch;

  function mockMakerworld({ fileFails = false } = {}) {
    global.fetch = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
      const url = String(input);
      if (url.startsWith("https://makerworld.com/en/models/")) {
        return new Response("<html><head><title>Notify Test</title></head><body></body></html>", {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      if (url.startsWith("https://makerworld.com/files/")) {
        if (fileFails) return new Response("gone", { status: 404 });
        return new Response(STL, { headers: { "content-type": "application/octet-stream" } });
      }
      throw new Error(`Unexpected fetch to ${url}`);
    }) as unknown as typeof fetch;
  }

  const post = (extra: Record<string, unknown> = {}) =>
    request(app)
      .post("/api/import")
      .set(auth())
      .send({
        url: pageUrl,
        resolved_download_url: "https://makerworld.com/files/notify.stl",
        resolved_instance_id: "1",
        ...extra,
      });

  afterEach(async () => {
    global.fetch = originalFetch;
    await prisma.print.deleteMany({ where: { userId, sourceExternalId: designId } });
  });

  it("notifies when an import finishes, and when it was already in the library", async () => {
    mockMakerworld();
    const first = await post();
    expect(first.status).toBe(200);
    await post();
    const [created, again] = await notifications();
    expect(created).toMatchObject({
      type: "import",
      title: `Imported "${first.body.title || first.body.name}"`,
      externalUrl: pageUrl,
      internalPath: `/models/${first.body.id}`,
    });
    expect(again.title).toMatch(/is already in your library$/);
  });

  it("folds imports one after another into one notification while it's unread", async () => {
    mockMakerworld();
    const first = await post();
    const second = await post({ url: `${pageUrl}#profileId-2`, resolved_instance_id: "2" });
    expect(second.body.id).toBe(first.body.id);
    // A different design: a second model.
    const other = await post({
      url: "https://makerworld.com/en/models/777556-other",
      resolved_download_url: "https://makerworld.com/files/other.stl",
    });
    const [merged, ...rest] = await notifications();
    expect(rest).toHaveLength(0);
    expect(merged).toMatchObject({ type: "import", title: "Imported 2 models", internalPath: "/models" });
    expect(merged.body).toContain(`"${other.body.title || other.body.name}"`);

    // Once read, the next import starts a notification of its own.
    await request(app).post("/api/notifications/read-all").set(auth());
    await post({ url: `${pageUrl}#profileId-3`, resolved_instance_id: "3" });
    expect(await notifications()).toHaveLength(2);
    await prisma.print.deleteMany({ where: { userId, sourceExternalId: "777556" } });
  });

  it("notifies a failed import with its reason, and stays quiet with notify: false", async () => {
    mockMakerworld({ fileFails: true });
    const failed = await post();
    expect(failed.status).toBeGreaterThanOrEqual(400);
    const [notification] = await notifications();
    expect(notification).toMatchObject({ type: "import", title: "Couldn't import a model", body: failed.body.detail });

    await prisma.notification.deleteMany({ where: { userId } });
    mockMakerworld();
    expect((await post({ notify: false })).status).toBe(200);
    expect(await notifications()).toHaveLength(0);
  });

  it("sums up a run the extension drove one model at a time", async () => {
    mockMakerworld();
    const first = await post({ notify: false });
    const res = await request(app)
      .post("/api/import/summary")
      .set(auth())
      .send({
        source_url: "https://makerworld.com/en/collections/1",
        total: 3,
        print_ids: [first.body.id, "someone-elses-print"],
        stopped: "MakerWorld wants a CAPTCHA.",
      });
    expect(res.status).toBe(200);
    const [summary] = await notifications();
    expect(summary).toMatchObject({
      type: "import",
      title: "Imported 1 of 3 models from MakerWorld",
      internalPath: `/models/${first.body.id}`,
    });
    expect(summary.body).toContain("Stopped early: MakerWorld wants a CAPTCHA.");
  });
});

describe("uploads", () => {
  const upload = (names: string[], fields: Record<string, string> = {}) => {
    let req = request(app).post("/api/upload").set(auth());
    for (const [key, value] of Object.entries(fields)) req = req.field(key, value);
    for (const name of names) req = req.attach("files", Buffer.from(STL), name);
    return req;
  };

  afterEach(async () => {
    const prints = await prisma.print.findMany({ where: { userId }, select: { id: true } });
    for (const print of prints) await request(app).delete(`/api/print/${print.id}`).set(auth());
  });

  it("notifies a single upload, and one request's several models together", async () => {
    const one = await upload(["bracket.stl"]);
    expect(one.status).toBe(200);
    await upload(["left.stl", "right.stl"], { mode: "separate" });
    const [single, pair] = await notifications();
    expect(single).toMatchObject({
      type: "upload",
      title: `Uploaded "${one.body.prints[0].name}"`,
      internalPath: `/models/${one.body.prints[0].id}`,
    });
    expect(pair).toMatchObject({ type: "upload", title: "Uploaded 2 models", internalPath: "/models" });
  });

  it("notifies a failed upload", async () => {
    // Two files without a mode is refused.
    expect((await upload(["a.stl", "b.stl"])).status).toBe(400);
    const [failed] = await notifications();
    expect(failed).toMatchObject({ type: "upload", title: "Couldn't upload 2 models" });
    expect(failed.body).toContain('"a.stl", "b.stl"');
  });

  it("reports the models a partly failed upload already created as uploaded", async () => {
    const res = await upload(["fine.stl", "corrupt.stl"], { mode: "separate" });
    expect(res.status).toBe(422);
    const [partial, ...rest] = await notifications();
    expect(rest).toHaveLength(0);
    expect(partial).toMatchObject({ type: "upload", title: "Uploaded 1 of 2 models" });
    expect(partial.body).toBe('Couldn\'t upload "corrupt.stl": Unreadable model file.');
    expect(partial.internalPath).toMatch(/^\/models\/.+/);
  });

  // A model the customizer generated, or a tool built, was never a file anyone had: "uploaded" would name
  // the one step the person didn't take.
  it("calls a generated model generated and a tool's created, not uploaded", async () => {
    const generated = await upload(["wreath.stl"], { origin: "generated" });
    const built = await upload(["keyring.stl"], { origin: "created" });
    const [gen, made] = await notifications();
    expect(gen).toMatchObject({ type: "upload", title: `Generated "${generated.body.prints[0].name}"` });
    expect(made).toMatchObject({ type: "upload", title: `Created "${built.body.prints[0].name}"` });
  });

  it("says a generated model couldn't be saved, since generating it already worked", async () => {
    expect((await upload(["a.stl", "b.stl"], { origin: "generated" })).status).toBe(400);
    const [failed] = await notifications();
    expect(failed).toMatchObject({ title: "Couldn't save 2 models" });
  });

  it("ignores an origin it doesn't know, rather than putting it in the title", async () => {
    await upload(["plain.stl"], { origin: "smuggled" });
    const [plain] = await notifications();
    expect(plain.title).toMatch(/^Uploaded "/);
  });

  it("sends one summary for a batch uploaded one request at a time", async () => {
    const a = await upload(["one.stl"], { notify: "false" });
    const b = await upload(["two.stl"], { notify: "false" });
    expect(await notifications()).toHaveLength(0);

    const res = await request(app)
      .post("/api/upload/summary")
      .set(auth())
      .send({ print_ids: [a.body.prints[0].id, b.body.prints[0].id], failed: ["broken.stl (Upload failed)"] });
    expect(res.status).toBe(200);
    const [summary] = await notifications();
    expect(summary).toMatchObject({ type: "upload", title: "Uploaded 2 of 3 models", internalPath: "/models" });
    expect(summary.body).toContain('Couldn\'t upload "broken.stl (Upload failed)".');
  });
});
