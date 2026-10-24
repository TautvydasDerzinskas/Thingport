import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import JSZip from "jszip";
import { createApp } from "../src/app";
import { importPrintFromUrl } from "../src/services/importService";
import { setMyminifactoryApiKey } from "../src/services/settingsService";
import { prisma } from "../src/db";
import { getMyminifactoryConnection, setUserMyminifactoryCookie } from "../src/providers/myminifactory/session";

// MyMiniFactory import end to end: metadata from the API v2 shapes, files from /download, fetch mocked.

const OBJECT_ID = "9990077";
const OBJECT_URL = `https://www.myminifactory.com/object/3d-print-test-skull-${OBJECT_ID}`;
const API_KEY = "test-api-key";
const SIGNED_ZIP = "https://dl4.myminifactory.com/object-assets/test/generated-zips/skull.zip?X-Amz-Signature=x";
const SIGNED_STL = "https://dl4.myminifactory.com/object-assets/test/threedfiles/skull.stl?X-Amz-Signature=x";
const IMAGE_URL = "https://assets.myminifactory.com/object-images/test/images/front.jpg";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const OBJECT = {
  id: Number(OBJECT_ID),
  name: "Test Skull Pen Holder",
  description_html: "<p>A <strong>skull</strong> pen holder.</p>",
  tags: ["skull", "desk"],
  images: [{ is_primary: true, original: { url: IMAGE_URL }, thumbnail: { url: IMAGE_URL } }],
  designer: { id: 777, username: "TestDesigner", name: "Test Designer", avatar_url: IMAGE_URL },
  categories: { total_count: 1, items: [{ id: 4242, name: "Desk", parent: null }] },
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function zipBody(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("skull/skull.stl", "solid skull\nendsolid skull\n");
  zip.file("skull/moustache.stl", "solid moustache\nendsolid moustache\n");
  zip.file("skull/readme.pdf", "%PDF-1.4 fake");
  return zip.generateAsync({ type: "nodebuffer" });
}

function mockMyminifactory(download: string, opts: { objectStatus?: number; price?: string } = {}) {
  return vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
    const url = String(input);
    if (url.startsWith(`https://www.myminifactory.com/api/v2/objects/${OBJECT_ID}?`)) {
      if (opts.objectStatus) return jsonResponse(opts.objectStatus, { error: "x" });
      return jsonResponse(
        200,
        opts.price ? { ...OBJECT, price: { currency: "USD", symbol: "$", value: opts.price } } : OBJECT,
      );
    }
    if (url === `https://www.myminifactory.com/download/${OBJECT_ID}`) {
      return new Response(null, { status: 302, headers: { location: download } });
    }
    if (url === SIGNED_ZIP) {
      return new Response(await zipBody(), { status: 200, headers: { "content-type": "application/zip" } });
    }
    if (url === SIGNED_STL) return new Response("solid skull\nendsolid skull\n", { status: 200 });
    if (url === IMAGE_URL)
      return new Response(ONE_PIXEL_PNG, { status: 200, headers: { "content-type": "image/png" } });
    throw new Error(`Unexpected fetch to ${url}`);
  }) as unknown as typeof fetch;
}

describe("importPrintFromUrl -- MyMiniFactory", () => {
  const app = createApp();
  let userId: string;
  const originalFetch = global.fetch;

  beforeAll(async () => {
    const email = `myminifactory-import-test-${Date.now()}@example.com`;
    const res = await request(app)
      .post("/api/register")
      .send({ displayName: "MyMiniFactory Import Test", email, password: "password123" });
    if (res.status !== 200) throw new Error(`Failed to register: ${res.status} ${JSON.stringify(res.body)}`);
    userId = res.body.user.id;
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    await setMyminifactoryApiKey(null);
    await prisma.print.deleteMany({ where: { userId, sourceProvider: "myminifactory" } });
  });

  it("fails clearly when no API key is configured", async () => {
    await expect(importPrintFromUrl(userId, OBJECT_URL, { url: OBJECT_URL, tags: [] })).rejects.toThrow(
      /isn't configured/i,
    );
  });

  it("names the API key when MyMiniFactory rejects it", async () => {
    await setMyminifactoryApiKey(API_KEY);
    global.fetch = mockMyminifactory(SIGNED_STL, { objectStatus: 401 });
    await expect(importPrintFromUrl(userId, OBJECT_URL, { url: OBJECT_URL, tags: [] })).rejects.toThrow(/API key/);
  });

  it("sends a login-only object to the account connection, without a session", async () => {
    await setMyminifactoryApiKey(API_KEY);
    global.fetch = mockMyminifactory("https://www.myminifactory.com/login");
    await expect(importPrintFromUrl(userId, OBJECT_URL, { url: OBJECT_URL, tags: [] })).rejects.toThrow(
      /MyMiniFactory.*Configuration > Providers/,
    );
  });

  it("tells a store object by its price, without asking for the anonymous download", async () => {
    await setMyminifactoryApiKey(API_KEY);
    const fetchMock = mockMyminifactory(SIGNED_STL, { price: "1.50" });
    global.fetch = fetchMock;
    await expect(importPrintFromUrl(userId, OBJECT_URL, { url: OBJECT_URL, tags: [] })).rejects.toThrow(
      /MyMiniFactory.*Configuration > Providers/,
    );
    expect(vi.mocked(fetchMock).mock.calls.some(([input]) => String(input).includes("/download/"))).toBe(false);
  });

  it("imports a zipped object as one model with a plate per model file", async () => {
    await setMyminifactoryApiKey(API_KEY);
    global.fetch = mockMyminifactory(SIGNED_ZIP);

    const result = await importPrintFromUrl(userId, OBJECT_URL, { url: OBJECT_URL, tags: [] });
    expect(result.alreadyImported).toBe(false);
    expect(result.print).toMatchObject({
      title: "Test Skull Pen Holder",
      creator: "Test Designer",
      sourceProvider: "myminifactory",
      sourceExternalId: OBJECT_ID,
      tags: ["Skull", "Desk"],
    });
    expect(result.print.notes).toContain("**skull**");
    expect(result.plates.map((plate) => plate.filename).toSorted()).toEqual(["moustache.stl", "skull.stl"]);
    expect(result.author).toMatchObject({ id: "myminifactory:777", name: "Test Designer" });
    expect(result.previewImages.length).toBeGreaterThan(0);

    const again = await importPrintFromUrl(userId, OBJECT_URL, { url: OBJECT_URL, tags: [] });
    expect(again).toMatchObject({ alreadyImported: true, print: { id: result.print.id } });
  });

  it("imports a single-file object as one plate", async () => {
    await setMyminifactoryApiKey(API_KEY);
    global.fetch = mockMyminifactory(SIGNED_STL);

    const result = await importPrintFromUrl(userId, OBJECT_URL, { url: OBJECT_URL, tags: [] });
    expect(result.plates.map((plate) => plate.filename)).toEqual(["skull.stl"]);
  });
});

// Paid models, and free ones whose files are archives, download as the user from their library: the session lists
// the files MyMiniFactory unpacked from each archive, and each one redirects to its own signed link.
describe("importPrintFromUrl -- MyMiniFactory, from the user's library", () => {
  const app = createApp();
  let userId: string;
  const originalFetch = global.fetch;
  const SESSION = "PHPSESSID=abc123";
  const SIGNED_PART = (id: string) =>
    `https://dl4.myminifactory.com/object-assets/test/extracted-files/${id}.stl?sig=x`;

  beforeAll(async () => {
    const email = `myminifactory-library-test-${Date.now()}@example.com`;
    const res = await request(app)
      .post("/api/register")
      .send({ displayName: "MyMiniFactory Library Test", email, password: "password123" });
    if (res.status !== 200) throw new Error(`Failed to register: ${res.status} ${JSON.stringify(res.body)}`);
    userId = res.body.user.id;
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    await setMyminifactoryApiKey(null);
    await setUserMyminifactoryCookie(userId, null);
    await prisma.print.deleteMany({ where: { userId, sourceProvider: "myminifactory" } });
  });

  /** `library`: what downloadables answers -- the unpacked archive, "not owned" (401), or "signed out" (to login). */
  function mockLibrary({
    paid = false,
    library = "owned",
  }: {
    paid?: boolean;
    library?: "owned" | "not-owned" | "expired";
  }) {
    return vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input, init) => {
      const url = String(input);
      const cookie = new Headers(init?.headers).get("cookie");
      if (url.startsWith(`https://www.myminifactory.com/api/v2/objects/${OBJECT_ID}?`)) {
        return jsonResponse(200, {
          ...OBJECT,
          file_mode: 1,
          ...(paid ? { price: { currency: "USD", symbol: "$", value: "4.00" } } : {}),
        });
      }
      if (url.startsWith("https://www.myminifactory.com/api/data-library/") || url.includes("/download/")) {
        if (cookie !== SESSION) throw new Error(`Library request without the session: ${url}`);
        if (library === "expired") {
          return new Response(null, { status: 302, headers: { location: "https://www.myminifactory.com/login" } });
        }
      }
      if (url === `https://www.myminifactory.com/api/data-library/myObjects/object-${OBJECT_ID}/downloadables`) {
        if (library === "not-owned") return jsonResponse(401, { error: "access_denied" });
        return jsonResponse(200, {
          archives: [
            {
              id: 55,
              name: "Skull.rar",
              extractedFiles: [
                { id: 901, path: "Skull/skull.stl", size: "100" },
                { id: 902, path: "Skull/skull.chitubox", size: "100" },
                { id: 903, path: "Skull/moustache.stl", size: "100" },
              ],
            },
          ],
          pdfs: [],
          parts: [],
        });
      }
      const contents = url.match(/\/api\/data-library\/archive-file-contents\/(\d+)\/download$/);
      if (contents) return new Response(null, { status: 302, headers: { location: SIGNED_PART(contents[1]) } });
      const part = url.match(/extracted-files\/(\d+)\.stl/);
      if (part) return new Response(`solid p${part[1]}\nendsolid\n`, { status: 200 });
      if (url === IMAGE_URL)
        return new Response(ONE_PIXEL_PNG, { status: 200, headers: { "content-type": "image/png" } });
      throw new Error(`Unexpected fetch to ${url}`);
    });
  }

  it("asks for a MyMiniFactory sign-in when there's none", async () => {
    await setMyminifactoryApiKey(API_KEY);
    global.fetch = mockLibrary({}) as unknown as typeof fetch;
    await expect(importPrintFromUrl(userId, OBJECT_URL, { url: OBJECT_URL, tags: [] })).rejects.toThrow(
      /downloads only when signed in.*Configuration > Providers/,
    );
  });

  it("imports the model files MyMiniFactory unpacked from its archives, one plate each", async () => {
    await setMyminifactoryApiKey(API_KEY);
    await setUserMyminifactoryCookie(userId, SESSION);
    global.fetch = mockLibrary({ paid: true }) as unknown as typeof fetch;

    const result = await importPrintFromUrl(userId, OBJECT_URL, { url: OBJECT_URL, tags: [] });
    expect(result.plates.map((plate) => plate.filename).toSorted()).toEqual(["moustache.stl", "skull.stl"]);
    expect(result.print).toMatchObject({ sourceProvider: "myminifactory", sourceExternalId: OBJECT_ID });
  });

  it("says so when a paid model isn't in the user's library", async () => {
    await setMyminifactoryApiKey(API_KEY);
    await setUserMyminifactoryCookie(userId, SESSION);
    global.fetch = mockLibrary({ paid: true, library: "not-owned" }) as unknown as typeof fetch;
    await expect(importPrintFromUrl(userId, OBJECT_URL, { url: OBJECT_URL, tags: [] })).rejects.toThrow(
      /isn't in your library/,
    );
  });

  it("marks an expired session, so the app can ask for a new one", async () => {
    await setMyminifactoryApiKey(API_KEY);
    await setUserMyminifactoryCookie(userId, SESSION);
    global.fetch = mockLibrary({ library: "expired" }) as unknown as typeof fetch;
    await expect(importPrintFromUrl(userId, OBJECT_URL, { url: OBJECT_URL, tags: [] })).rejects.toThrow(
      /didn't accept your saved sign-in/,
    );
    expect(await getMyminifactoryConnection(userId)).toBe("expired");
  });
});
