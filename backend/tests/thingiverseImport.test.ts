import fs from "node:fs";
import os from "node:os";
import JSZip from "jszip";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { downloadPlainFileToTemp, importPrintFromUrl } from "../src/services/importService";
import { setThingiverseAccessToken } from "../src/providers/thingiverse/token";
import { prisma } from "../src/db";

// Thingiverse import end to end against the official API's response shapes, with fetch mocked.

const THING_ID = "9990001";
const THING_URL = `https://www.thingiverse.com/thing:${THING_ID}`;
const ACCESS_TOKEN = "test-access-token";
const CATEGORY_ID = 129;

const ONE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const THING_DETAIL = {
  id: Number(THING_ID),
  name: "Test Articulated Widget",
  description: "A **test** widget for import verification.",
  instructions: "1. Print both parts.<br>2. Snap the wheels on.",
  tags: [{ name: "Widget" }, { name: "Test Fixture" }],
  thumbnail: "https://cdn.thingiverse.com/assets/test/thumb.jpg",
  default_image: { url: "https://cdn.thingiverse.com/assets/test/preview.jpg" },
  categories_url: `https://api.thingiverse.com/things/${THING_ID}/categories`,
  creator: {
    id: 424242,
    name: "TestCreator",
    public_url: "https://www.thingiverse.com/TestCreator",
    thumbnail: "https://cdn.thingiverse.com/renders/test/creator.jpg",
    cover: "https://cdn.thingiverse.com/renders/test/creator-cover.jpg",
  },
  zip_data: {
    files: [
      { name: "body.stl", url: "https://cdn.thingiverse.com/assets/test/body.stl" },
      { name: "wheels.stl", url: "https://cdn.thingiverse.com/assets/test/wheels.stl" },
      { name: "instructions.pdf", url: "https://cdn.thingiverse.com/assets/test/instructions.pdf" },
    ],
    images: [{ name: "render.png", url: "https://cdn.thingiverse.com/renders/test/render.png" }],
  },
};

const THING_CATEGORIES = [{ id: CATEGORY_ID, name: "3D Printing Tests" }];

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function pngResponse(): Response {
  return new Response(Buffer.from(ONE_PIXEL_PNG_BASE64, "base64"), {
    status: 200,
    headers: { "content-type": "image/png" },
  });
}

function stlResponse(name: string): Response {
  return new Response(`solid ${name}\nendsolid ${name}\n`, {
    status: 200,
    headers: { "content-type": "application/sla" },
  });
}

function pdfResponse(): Response {
  return new Response("%PDF-1.4 fake", { status: 200, headers: { "content-type": "application/pdf" } });
}

function challengeResponse(): Response {
  return new Response("<html>Just a moment...</html>", {
    status: 403,
    headers: { "content-type": "text/html", "cf-mitigated": "challenge", server: "cloudflare" },
  });
}

function mockThingiverseFetch(overrides?: {
  detailStatus?: number;
  detailBody?: unknown;
  cdnChallenge?: boolean;
  /** Only the PDF is challenged. */
  pdfChallenge?: boolean;
  /** Served as extras.zip. */
  extrasZip?: Buffer;
}) {
  return vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
    const url = String(input);
    if (overrides?.cdnChallenge && url.startsWith("https://cdn.thingiverse.com/assets/")) return challengeResponse();
    if (overrides?.pdfChallenge && url.endsWith("/instructions.pdf")) return challengeResponse();
    if (overrides?.extrasZip && url === "https://cdn.thingiverse.com/assets/test/extras.zip") {
      return new Response(new Uint8Array(overrides.extrasZip), {
        status: 200,
        headers: { "content-type": "application/zip" },
      });
    }
    // Any Thing's: a test of another Thing passes its own details.
    if (/^https:\/\/api\.thingiverse\.com\/things\/\d+\/categories/.test(url)) {
      return jsonResponse(200, THING_CATEGORIES);
    }
    if (/^https:\/\/api\.thingiverse\.com\/things\/\d+/.test(url)) {
      return jsonResponse(overrides?.detailStatus ?? 200, overrides?.detailBody ?? THING_DETAIL);
    }
    if (url === "https://cdn.thingiverse.com/assets/test/body.stl") return stlResponse("body");
    if (url === "https://cdn.thingiverse.com/assets/test/wheels.stl") return stlResponse("wheels");
    if (url === "https://cdn.thingiverse.com/assets/test/instructions.pdf") return pdfResponse();
    if (url === "https://cdn.thingiverse.com/assets/test/preview.jpg") return pngResponse();
    if (url === "https://cdn.thingiverse.com/renders/test/render.png") return pngResponse();
    throw new Error(`Unexpected fetch to ${url}`);
  }) as unknown as typeof fetch;
}

describe("importPrintFromUrl -- Thingiverse", () => {
  const app = createApp();
  let userId: string;
  const originalFetch = global.fetch;

  beforeAll(async () => {
    const email = `thingiverse-import-test-${Date.now()}@example.com`;
    const res = await request(app)
      .post("/api/register")
      .send({ displayName: "Thingiverse Import Test", email, password: "password123" });
    if (res.status !== 200) {
      throw new Error(`Failed to register during test setup: ${res.status} ${JSON.stringify(res.body)}`);
    }
    userId = res.body.user.id;
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    await setThingiverseAccessToken(null);
  });

  it("fails clearly when no App Token is configured", async () => {
    await expect(importPrintFromUrl(userId, THING_URL, { url: THING_URL, tags: [] })).rejects.toThrow(
      /isn't configured/i,
    );
  });

  it("throws a clear auth error when the configured token is rejected", async () => {
    await setThingiverseAccessToken(ACCESS_TOKEN);
    global.fetch = mockThingiverseFetch({ detailStatus: 401, detailBody: { error: "invalid" } });

    await expect(importPrintFromUrl(userId, THING_URL, { url: THING_URL, tags: [] })).rejects.toThrow(/app token/i);
  });

  it("reports a Cloudflare-challenged file download as a block, not a generic failure", async () => {
    await setThingiverseAccessToken(ACCESS_TOKEN);
    global.fetch = mockThingiverseFetch({ cdnChallenge: true });

    await expect(importPrintFromUrl(userId, THING_URL, { url: THING_URL, tags: [] })).rejects.toThrow(
      /blocked a file download/i,
    );
  });

  it("retries a challenged file download once", async () => {
    const url = "https://cdn.thingiverse.com/assets/test/body.stl";
    const fetchMock = vi
      .fn<(input: RequestInfo | URL) => Promise<Response>>()
      .mockResolvedValueOnce(challengeResponse())
      .mockResolvedValueOnce(stlResponse("body"));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await downloadPlainFileToTemp(url, "body.stl");

    expect(result && "input" in result ? result.input.filename : null).toBe("body.stl");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("leaves no partial file behind when a download breaks off", async () => {
    const leftovers = () => fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith("thingport-thingiverse-"));
    const before = new Set(leftovers());
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode("solid body\n"));
        controller.error(new Error("connection reset"));
      },
    });
    global.fetch = vi.fn<() => Promise<Response>>(
      async () => new Response(body, { status: 200 }),
    ) as unknown as typeof fetch;

    const result = await downloadPlainFileToTemp("https://cdn.thingiverse.com/assets/test/body.stl", "body.stl");

    expect(result).toBeNull();
    expect(leftovers().filter((name) => !before.has(name))).toEqual([]);
  });

  it("imports a Thing's model files as plates, matches category, and attaches metadata + images", async () => {
    await setThingiverseAccessToken(ACCESS_TOKEN);
    // Several category ids, only one matching: any overlap should match.
    const category = await prisma.category.create({
      data: {
        userId,
        name: "Thingiverse Tests",
        kind: "category",
        tags: [],
        siteIds: {
          create: [999001, CATEGORY_ID, 999002].map((id, position) => ({
            provider: "thingiverse",
            siteId: String(id),
            position,
          })),
        },
      },
    });

    global.fetch = mockThingiverseFetch();

    const result = await importPrintFromUrl(userId, THING_URL, { url: THING_URL, tags: [] });

    expect(result.alreadyImported).toBe(false);
    expect(result.print.title).toBe("Test Articulated Widget");
    expect(result.print.creator).toBe("TestCreator");
    expect(result.print.sourceProvider).toBe("thingiverse");
    expect(result.print.sourceExternalId).toBe(THING_ID);
    // The separate instructions section is kept, under its own heading, with its HTML mapped onto Markdown.
    expect(result.print.notes).toBe(
      "A **test** widget for import verification.\n\n## Instructions\n\n1. Print both parts.\n2. Snap the wheels on.",
    );
    // Canonical tag casing: only the first character stays uppercase.
    expect(result.print.tags.toSorted()).toEqual(["Test fixture", "Widget"]);
    expect(result.print.categoryId).toBe(category.id);

    // The PDF isn't a plate format: it's kept beside the model.
    expect(result.plates.map((p) => p.filename).toSorted()).toEqual(["body.stl", "wheels.stl"]);
    const files = await prisma.printFile.findMany({ where: { printId: result.print.id } });
    expect(files.map((file) => [file.filename, file.role])).toEqual([["instructions.pdf", "SUPPORTING"]]);

    expect(result.author).toBeTruthy();
    expect(result.author?.name).toBe("TestCreator");
    expect(result.author?.provider).toBe("thingiverse");
    expect(result.author?.externalId).toBe("424242");

    expect(result.previewImages.length).toBeGreaterThanOrEqual(2);
  });

  it("opens a zip Thing File for what it holds, and imports without a document it couldn't download", async () => {
    await setThingiverseAccessToken(ACCESS_TOKEN);
    const zip = new JSZip();
    zip.file("spare.stl", "solid spare endsolid");
    zip.file("docs/manual.pdf", "%PDF-1.4 manual");
    const extrasZip = await zip.generateAsync({ type: "nodebuffer" });
    const files = [
      { name: "body.stl", url: "https://cdn.thingiverse.com/assets/test/body.stl" },
      { name: "extras.zip", url: "https://cdn.thingiverse.com/assets/test/extras.zip" },
      { name: "instructions.pdf", url: "https://cdn.thingiverse.com/assets/test/instructions.pdf" },
    ];
    global.fetch = mockThingiverseFetch({
      detailBody: { ...THING_DETAIL, id: 7700001, zip_data: { ...THING_DETAIL.zip_data, files } },
      pdfChallenge: true,
      extrasZip,
    });
    const url = "https://www.thingiverse.com/thing:7700001";
    const result = await importPrintFromUrl(userId, url, { url, tags: [] });
    expect(result.plates.map((plate) => plate.filename).toSorted()).toEqual(["body.stl", "spare.stl"]);
    const kept = await prisma.printFile.findMany({ where: { printId: result.print.id } });
    expect(kept.map((file) => [file.folder, file.filename, file.role])).toEqual([["docs", "manual.pdf", "SUPPORTING"]]);
  });

  it("imports a Thing's model files past a zip Thing File that won't open", async () => {
    await setThingiverseAccessToken(ACCESS_TOKEN);
    const files = [
      { name: "body.stl", url: "https://cdn.thingiverse.com/assets/test/body.stl" },
      { name: "extras.zip", url: "https://cdn.thingiverse.com/assets/test/extras.zip" },
    ];
    global.fetch = mockThingiverseFetch({
      detailBody: { ...THING_DETAIL, id: 7700003, zip_data: { ...THING_DETAIL.zip_data, files } },
      extrasZip: Buffer.from("not a zip at all"),
    });
    const url = "https://www.thingiverse.com/thing:7700003";
    const result = await importPrintFromUrl(userId, url, { url, tags: [] });
    expect(result.plates.map((plate) => plate.filename)).toEqual(["body.stl"]);
  });

  it("says there's nothing to import for a Thing of documents alone", async () => {
    await setThingiverseAccessToken(ACCESS_TOKEN);
    const files = [{ name: "instructions.pdf", url: "https://cdn.thingiverse.com/assets/test/instructions.pdf" }];
    global.fetch = mockThingiverseFetch({
      detailBody: { ...THING_DETAIL, id: 7700002, zip_data: { ...THING_DETAIL.zip_data, files } },
    });
    const url = "https://www.thingiverse.com/thing:7700002";
    await expect(importPrintFromUrl(userId, url, { url, tags: [] })).rejects.toThrow(
      "None of this Thing's files could be downloaded.",
    );
  });

  it("dedupes a re-import of the same Thing instead of hitting the API again", async () => {
    await setThingiverseAccessToken(ACCESS_TOKEN);
    const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async () => {
      throw new Error("No network call should happen for an already-imported Thing");
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await importPrintFromUrl(userId, THING_URL, { url: THING_URL, tags: [] });

    expect(result.alreadyImported).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
