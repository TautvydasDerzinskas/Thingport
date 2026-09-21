import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { importPrintFromUrl } from "../src/services/importService";
import { prisma } from "../src/db";

// Exercises importPrintFromUrl's Printables path end to end against the real shapes confirmed
// live against api.printables.com's public GraphQL endpoint (see printablesApi.ts): one query
// for the model's metadata + file list, one mutation to resolve each file's real download link.
// Every actual HTTP fetch is intercepted; no DNS/network needed. No auth/cookie involved --
// Printables' GraphQL API is public for public models, unlike MakerWorld/Thingiverse.

const MODEL_ID = "1786545";
const MODEL_URL = `https://www.printables.com/model/${MODEL_ID}-strong-garden-hose-holder`;
const CATEGORY_ID = 42;
const FILE_ID = "7449061";

const ONE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const MODEL_RESPONSE = {
  data: {
    print: {
      id: MODEL_ID,
      name: "Strong garden hose holder",
      description: "<h4>Mounting</h4><p>4 x M5 or M6 screws</p>",
      user: { id: "4584310", handle: "s0ren", publicUsername: "s0ren", avatarFilePath: "media/auth/avatars/a.png" },
      image: { filePath: "media/prints/cover.jpg" },
      images: [{ filePath: "media/prints/cover.jpg" }, { filePath: "media/prints/gallery-1.jpg" }],
      tags: [{ name: "garden" }, { name: "hose" }],
      category: { id: CATEGORY_ID, name: "Outdoor & Garden" },
      stls: [{ id: FILE_ID, name: "garden-hose-holder.3mf" }],
    },
  },
};

const DOWNLOAD_LINK_RESPONSE = {
  data: {
    getDownloadLink: {
      ok: true,
      errors: null,
      output: { files: [{ id: FILE_ID, link: "https://files.printables.com/media/prints/garden-hose-holder.3mf" }] },
    },
  },
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function pngResponse(): Response {
  return new Response(Buffer.from(ONE_PIXEL_PNG_BASE64, "base64"), { status: 200, headers: { "content-type": "image/png" } });
}

function threeMfResponse(): Response {
  return new Response("fake-3mf-bytes", { status: 200, headers: { "content-type": "application/octet-stream" } });
}

function mockPrintablesFetch(overrides?: { modelStatus?: number; modelBody?: unknown }) {
  return vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input, init) => {
    const url = String(input);
    if (url === "https://api.printables.com/graphql/") {
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (typeof body.query === "string" && body.query.includes("getDownloadLink")) {
        return jsonResponse(200, DOWNLOAD_LINK_RESPONSE);
      }
      return jsonResponse(overrides?.modelStatus ?? 200, overrides?.modelBody ?? MODEL_RESPONSE);
    }
    if (url === "https://files.printables.com/media/prints/garden-hose-holder.3mf") return threeMfResponse();
    if (url === "https://media.printables.com/media/prints/cover.jpg") return pngResponse();
    if (url === "https://media.printables.com/media/prints/gallery-1.jpg") return pngResponse();
    throw new Error(`Unexpected fetch to ${url}`);
  }) as unknown as typeof fetch;
}

describe("importPrintFromUrl -- Printables", () => {
  const app = createApp();
  let userId: string;
  const originalFetch = global.fetch;

  beforeAll(async () => {
    const email = `printables-import-test-${Date.now()}@example.com`;
    const res = await request(app)
      .post("/api/register")
      .send({ displayName: "Printables Import Test", email, password: "password123" });
    if (res.status !== 200) {
      throw new Error(`Failed to register during test setup: ${res.status} ${JSON.stringify(res.body)}`);
    }
    userId = res.body.user.id;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns a clear error when the model doesn't exist / isn't public", async () => {
    global.fetch = mockPrintablesFetch({ modelBody: { data: { print: null } } });
    await expect(
      importPrintFromUrl(userId, MODEL_URL, { url: MODEL_URL, tags: [] }),
    ).rejects.toThrow(/could not be found/i);
  });

  it("imports a model's files as plates, matches category, and attaches metadata + images", async () => {
    const category = await prisma.category.create({
      data: { userId, name: "Printables Tests", tags: [], printablesCatIds: [1, CATEGORY_ID, 2] },
    });

    global.fetch = mockPrintablesFetch();

    const result = await importPrintFromUrl(userId, MODEL_URL, { url: MODEL_URL, tags: [] });

    expect(result.alreadyImported).toBe(false);
    expect(result.print.title).toBe("Strong garden hose holder");
    expect(result.print.creator).toBe("s0ren");
    expect(result.print.sourceProvider).toBe("printables");
    expect(result.print.sourceExternalId).toBe(MODEL_ID);
    expect(result.print.notes).toContain("Mounting");
    // Tags are stored in canonical casing (see utils/tagNormalization.ts).
    expect(result.print.tags.toSorted()).toEqual(["Garden", "Hose"]);
    expect(result.print.categoryId).toBe(category.id);

    expect(result.plates.map((p) => p.filename)).toEqual(["garden-hose-holder.3mf"]);

    expect(result.author).toBeTruthy();
    expect(result.author?.name).toBe("s0ren");
    expect(result.author?.provider).toBe("printables");
    expect(result.author?.externalId).toBe("4584310");

    // Cover plus the one other gallery image -- both real, decodable PNGs.
    expect(result.previewImages.length).toBeGreaterThanOrEqual(2);
  });

  it("dedupes a re-import of the same model instead of hitting the API again", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async () => {
      throw new Error("No network call should happen for an already-imported model");
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await importPrintFromUrl(userId, MODEL_URL, { url: MODEL_URL, tags: [] });

    expect(result.alreadyImported).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
