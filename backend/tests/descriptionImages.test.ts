import fs from "node:fs";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { importPrintFromUrl } from "../src/services/importService";
import { descriptionImagePath, localizeDescriptionImages } from "../src/services/descriptionImageService";
import { printAssetHome } from "../src/services/modelAssets";
import { prisma } from "../src/db";

// Images embedded in an imported description are stored locally and served from our own API.

const MODEL_ID = "1786599";
const MODEL_URL = `https://www.printables.com/model/${MODEL_ID}-lamp-kit`;
const STEP_IMAGE = "https://media.printables.com/media/prints/step-1.gif";
const MISSING_IMAGE = "https://media.printables.com/media/prints/gone.jpg";

// 1x1 GIF, so the test also covers keeping a GIF as a GIF.
const ONE_PIXEL_GIF_BASE64 = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const ONE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function modelResponse(description: string) {
  return {
    data: {
      print: {
        id: MODEL_ID,
        name: "Lamp kit",
        description,
        user: { id: "991", handle: "lamps", publicUsername: "lamps", avatarFilePath: null },
        image: { filePath: "media/prints/cover.jpg" },
        images: [{ filePath: "media/prints/cover.jpg" }],
        tags: [],
        category: null,
        stls: [{ id: "5", name: "lamp.3mf" }],
      },
    },
  };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function mockFetch(description: string) {
  return vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input, init) => {
    const url = String(input);
    if (url === "https://api.printables.com/graphql/") {
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (typeof body.query === "string" && body.query.includes("getDownloadLink")) {
        return json({
          data: {
            getDownloadLink: {
              ok: true,
              errors: null,
              output: { files: [{ id: "5", link: "https://files.printables.com/media/prints/lamp.3mf" }] },
            },
          },
        });
      }
      return json(modelResponse(description));
    }
    if (url === "https://files.printables.com/media/prints/lamp.3mf") return new Response("fake-3mf", { status: 200 });
    if (url === "https://media.printables.com/media/prints/cover.jpg") {
      return new Response(Buffer.from(ONE_PIXEL_PNG_BASE64, "base64"), { status: 200 });
    }
    if (url === STEP_IMAGE) return new Response(Buffer.from(ONE_PIXEL_GIF_BASE64, "base64"), { status: 200 });
    if (url === MISSING_IMAGE) return new Response("nope", { status: 404 });
    throw new Error(`Unexpected fetch to ${url}`);
  }) as unknown as typeof fetch;
}

describe("description images", () => {
  const app = createApp();
  let token: string;
  let userId: string;
  let printId: string;
  const originalFetch = global.fetch;

  beforeAll(async () => {
    const res = await request(app)
      .post("/api/register")
      .send({
        displayName: "Description Images",
        email: `desc-images-${Date.now()}@example.com`,
        password: "password123",
      });
    if (res.status !== 200) throw new Error(`Failed to register: ${res.status} ${JSON.stringify(res.body)}`);
    token = res.body.token;
    userId = res.body.user.id;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("stores an imported description's images and points the Markdown at them", async () => {
    global.fetch = mockFetch(
      `<h3>STEP 1:</h3><figure><img src="${STEP_IMAGE}"></figure><p>Then:</p><img src="${MISSING_IMAGE}">`,
    );
    const result = await importPrintFromUrl(userId, MODEL_URL, { url: MODEL_URL, tags: [] });
    printId = result.print.id;

    const print = await prisma.print.findUniqueOrThrow({ where: { id: printId } });
    const images = await prisma.descriptionImage.findMany({ where: { printId } });
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ sourceUrl: STEP_IMAGE, mime: "image/gif" });
    expect(print.notes).toContain("### STEP 1:");
    expect(print.notes).toContain(`![](/description-image/${images[0].id})`);
    // One that couldn't be fetched keeps its remote URL rather than disappearing.
    expect(print.notes).toContain(`![](${MISSING_IMAGE})`);

    const served = await request(app)
      .get(`/api/description-image/${images[0].id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(served.status).toBe(200);
    expect(served.headers["content-type"]).toBe("image/gif");
  });

  it("doesn't serve another user's description image", async () => {
    const image = await prisma.descriptionImage.findFirstOrThrow({ where: { printId } });
    const other = await request(app)
      .post("/api/register")
      .send({ displayName: "Other", email: `desc-images-other-${Date.now()}@example.com`, password: "password123" });
    const res = await request(app)
      .get(`/api/description-image/${image.id}`)
      .set("Authorization", `Bearer ${other.body.token}`);
    expect(res.status).toBe(404);
  });

  it("drops the stored images an edit removes from the description", async () => {
    const image = await prisma.descriptionImage.findFirstOrThrow({ where: { printId } });
    const home = await printAssetHome(printId);
    const res = await request(app)
      .post(`/api/print/${printId}/meta`)
      .set("Authorization", `Bearer ${token}`)
      .send({ notes: "Just text now." });
    expect(res.status).toBe(200);
    expect(await prisma.descriptionImage.count({ where: { printId } })).toBe(0);
    expect(fs.existsSync(descriptionImagePath(image, home))).toBe(false);
  });

  it("fills an emptied description from the source, formatting and images included", async () => {
    await request(app).post(`/api/print/${printId}/meta`).set("Authorization", `Bearer ${token}`).send({ notes: "" });
    global.fetch = mockFetch(`<p>Updated <strong>steps</strong></p><img src="${STEP_IMAGE}">`);
    const res = await request(app).post(`/api/print/${printId}/fill-gaps`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.filled).toContain("description");
    const image = await prisma.descriptionImage.findFirstOrThrow({ where: { printId } });
    const print = await prisma.print.findUniqueOrThrow({ where: { id: printId } });
    expect(print.notes).toBe(`Updated **steps**\n\n![](/description-image/${image.id})`);
  });

  it("drops all stored images when the description is cleared", async () => {
    const image = await prisma.descriptionImage.findFirstOrThrow({ where: { printId } });
    const home = await printAssetHome(printId);
    const res = await request(app)
      .post(`/api/print/${printId}/meta`)
      .set("Authorization", `Bearer ${token}`)
      .send({ notes: "" });
    expect(res.status).toBe(200);
    expect(await prisma.descriptionImage.count({ where: { printId } })).toBe(0);
    expect(fs.existsSync(descriptionImagePath(image, home))).toBe(false);

    // Back again for the next test.
    global.fetch = mockFetch(`<img src="${STEP_IMAGE}">`);
    await request(app).post(`/api/print/${printId}/fill-gaps`).set("Authorization", `Bearer ${token}`);
  });

  it("removes the stored images with the model", async () => {
    const image = await prisma.descriptionImage.findFirstOrThrow({ where: { printId } });
    const home = await printAssetHome(printId);
    const res = await request(app).delete(`/api/print/${printId}`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(fs.existsSync(descriptionImagePath(image, home))).toBe(false);
  });

  describe("downloading untrusted image URLs", () => {
    async function printWithImage(url: string): Promise<string> {
      const name = `guarded-${Date.now()}-${Math.random()}`;
      const print = await prisma.print.create({
        data: { userId, name, nameNormalized: name, notes: `![](${url})` },
      });
      return print.id;
    }

    it("follows a redirect to another public host", async () => {
      const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
        if (String(input) === MISSING_IMAGE) {
          return new Response(null, { status: 302, headers: { location: STEP_IMAGE } });
        }
        if (String(input) === STEP_IMAGE) {
          return new Response(Buffer.from(ONE_PIXEL_GIF_BASE64, "base64"), { status: 200 });
        }
        throw new Error(`Unexpected fetch to ${String(input)}`);
      });
      global.fetch = fetchMock as unknown as typeof fetch;
      const id = await printWithImage(MISSING_IMAGE);
      await localizeDescriptionImages(id);
      expect(await prisma.descriptionImage.count({ where: { printId: id } })).toBe(1);
    });

    it("never requests a redirect target on an internal address", async () => {
      const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
        if (String(input) === STEP_IMAGE) {
          return new Response(null, { status: 302, headers: { location: "http://127.0.0.1:8000/secret.png" } });
        }
        throw new Error(`Unexpected fetch to ${String(input)}`);
      });
      global.fetch = fetchMock as unknown as typeof fetch;
      const id = await printWithImage(STEP_IMAGE);
      await localizeDescriptionImages(id);

      expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([STEP_IMAGE]);
      expect(await prisma.descriptionImage.count({ where: { printId: id } })).toBe(0);
      const print = await prisma.print.findUniqueOrThrow({ where: { id } });
      expect(print.notes).toBe(`![](${STEP_IMAGE})`);
    });

    it("leaves an edit saved during the download alone", async () => {
      const id = await printWithImage(STEP_IMAGE);
      global.fetch = vi.fn<() => Promise<Response>>(async () => {
        await prisma.print.update({ where: { id }, data: { notes: "Edited meanwhile." } });
        return new Response(Buffer.from(ONE_PIXEL_GIF_BASE64, "base64"), { status: 200 });
      }) as unknown as typeof fetch;
      await localizeDescriptionImages(id);

      const print = await prisma.print.findUniqueOrThrow({ where: { id } });
      expect(print.notes).toBe("Edited meanwhile.");
      // The download the edit made unnecessary isn't kept.
      expect(await prisma.descriptionImage.count({ where: { printId: id } })).toBe(0);
    });

    it("stops reading an oversized image that doesn't declare its length", async () => {
      // A valid GIF header followed by 17 MB, with no Content-Length.
      const oversized = Buffer.concat([Buffer.from(ONE_PIXEL_GIF_BASE64, "base64"), Buffer.alloc(17 * 1024 * 1024)]);
      global.fetch = vi.fn<() => Promise<Response>>(
        async () => new Response(oversized, { status: 200 }),
      ) as unknown as typeof fetch;
      const id = await printWithImage(STEP_IMAGE);
      await localizeDescriptionImages(id);
      expect(await prisma.descriptionImage.count({ where: { printId: id } })).toBe(0);
    });
  });
});
