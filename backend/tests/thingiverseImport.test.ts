import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { importPrintFromUrl } from "../src/services/importService";
import { setThingiverseAccessToken } from "../src/services/settingsService";
import { prisma } from "../src/db";

// Exercises importPrintFromUrl's Thingiverse path end to end against the real shapes confirmed
// live against api.thingiverse.com (the official Developer API -- see thingiverseApi.ts): a
// `things/{id}` response with zip_data.files/images, creator, tags, description, and a separate
// `things/{id}/categories` call. Every actual HTTP fetch is intercepted; no DNS/network needed
// (unlike the old cookie-based www.thingiverse.com flow this replaced -- this API needs no SSRF
// host validation since it's a fixed, admin-configured trusted host, not a user-supplied URL).

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
  return new Response(Buffer.from(ONE_PIXEL_PNG_BASE64, "base64"), { status: 200, headers: { "content-type": "image/png" } });
}

function stlResponse(name: string): Response {
  return new Response(`solid ${name}\nendsolid ${name}\n`, { status: 200, headers: { "content-type": "application/sla" } });
}

function pdfResponse(): Response {
  return new Response("%PDF-1.4 fake", { status: 200, headers: { "content-type": "application/pdf" } });
}

function mockThingiverseFetch(overrides?: { detailStatus?: number; detailBody?: unknown }) {
  return vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
    const url = String(input);
    if (url.startsWith(`https://api.thingiverse.com/things/${THING_ID}/categories`)) {
      return jsonResponse(200, THING_CATEGORIES);
    }
    if (url.startsWith(`https://api.thingiverse.com/things/${THING_ID}`)) {
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

  it("fails clearly when no Access Token is configured", async () => {
    await expect(
      importPrintFromUrl(userId, THING_URL, { url: THING_URL, tags: [] }),
    ).rejects.toThrow(/isn't configured/i);
  });

  it("throws a clear auth error when the configured token is rejected", async () => {
    await setThingiverseAccessToken(ACCESS_TOKEN);
    global.fetch = mockThingiverseFetch({ detailStatus: 401, detailBody: { error: "invalid" } });

    await expect(
      importPrintFromUrl(userId, THING_URL, { url: THING_URL, tags: [] }),
    ).rejects.toThrow(/access token/i);
  });

  it("imports a Thing's model files as plates, matches category, and attaches metadata + images", async () => {
    await setThingiverseAccessToken(ACCESS_TOKEN);
    // A category configured with several category ids, only one of which (129, "3D Printing
    // Tests") actually matches this Thing -- proves both that category matching works against
    // the official API's separate categories_url (previously believed infeasible against the
    // internal v2 API), and that a category listing multiple ids matches on ANY overlap, not just
    // an exact single-id equality.
    const category = await prisma.category.create({
      data: { userId, name: "Thingiverse Tests", tags: [], thingiverseCatIds: [999001, CATEGORY_ID, 999002] },
    });

    global.fetch = mockThingiverseFetch();

    const result = await importPrintFromUrl(userId, THING_URL, { url: THING_URL, tags: [] });

    expect(result.alreadyImported).toBe(false);
    expect(result.print.title).toBe("Test Articulated Widget");
    expect(result.print.creator).toBe("TestCreator");
    expect(result.print.sourceProvider).toBe("thingiverse");
    expect(result.print.sourceExternalId).toBe(THING_ID);
    expect(result.print.notes).toContain("test");
    // Tags are stored in canonical casing (see utils/tagNormalization.ts): only the first
    // character stays uppercase, so "Test Fixture" becomes "Test fixture".
    expect(result.print.tags.toSorted()).toEqual(["Test fixture", "Widget"]);
    expect(result.print.categoryId).toBe(category.id);

    // instructions.pdf is not a recognized plate format -- only the two .stl files should have
    // become plates.
    expect(result.plates.map((p) => p.filename).toSorted()).toEqual(["body.stl", "wheels.stl"]);

    expect(result.author).toBeTruthy();
    expect(result.author?.name).toBe("TestCreator");
    expect(result.author?.provider).toBe("thingiverse");
    expect(result.author?.externalId).toBe("424242");

    // Cover (preview.jpg) plus the one bundled render -- both real, sharp-decodable PNGs.
    expect(result.previewImages.length).toBeGreaterThanOrEqual(2);
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
