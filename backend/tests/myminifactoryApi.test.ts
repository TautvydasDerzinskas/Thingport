import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchMyminifactoryCollectionObjects,
  myminifactoryMetaFromObject,
  parseMyminifactoryCollectionUrl,
  parseMyminifactoryObjectUrl,
  resolveMyminifactoryDownload,
} from "../src/providers/myminifactory/api";
import { modelIdFromUrl, modelUrlFor, parseSyncSource } from "../src/services/collectionSyncService";
import { normalizeMyminifactoryCookie } from "../src/providers/myminifactory/session";
import { buildImportSourceUrl, identifySourceModel } from "../src/services/importService";

// The MyMiniFactory client against the official API v2's documented shapes, with fetch mocked. No database.

const API_KEY = "test-api-key";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function redirectResponse(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

function image(name: string, primary = false) {
  const url = (size: string) => `https://assets.myminifactory.com/object-images/abc/images/${size}-${name}.jpg`;
  return {
    id: name,
    is_primary: primary,
    original: { url: url("original") },
    standard: { url: url("standard") },
    thumbnail: { url: url("thumb") },
  };
}

describe("MyMiniFactory URLs", () => {
  it("recognizes object pages, with a slug, without one, and behind a language prefix", () => {
    expect(
      parseMyminifactoryObjectUrl("https://www.myminifactory.com/object/3d-print-diana-at-the-louvre-16357"),
    ).toEqual({ objectId: "16357" });
    expect(parseMyminifactoryObjectUrl("https://www.myminifactory.com/object/3d-print-16357")).toEqual({
      objectId: "16357",
    });
    expect(parseMyminifactoryObjectUrl("https://myminifactory.com/it/object/3d-print-skull-100000/")).toEqual({
      objectId: "100000",
    });
  });

  it("rejects users, collections and other hosts as objects", () => {
    expect(parseMyminifactoryObjectUrl("https://www.myminifactory.com/users/schmick101")).toBeNull();
    expect(parseMyminifactoryObjectUrl("https://www.myminifactory.com/users/a/collection/b")).toBeNull();
    expect(parseMyminifactoryObjectUrl("https://example.com/object/3d-print-16357")).toBeNull();
  });

  it("reads a collection's owner and slug", () => {
    expect(
      parseMyminifactoryCollectionUrl("https://www.myminifactory.com/users/schmick101/collection/steampunk"),
    ).toEqual({ username: "schmick101", slug: "steampunk" });
    expect(parseMyminifactoryCollectionUrl("https://www.myminifactory.com/users/schmick101")).toBeNull();
    expect(parseMyminifactoryCollectionUrl("https://www.myminifactory.com/users/%zz/collection/x")).toBeNull();
  });

  it("round-trips a model id through the import and sync links", () => {
    const url = buildImportSourceUrl("myminifactory", "16357")!;
    expect(identifySourceModel(url)).toEqual({ provider: "myminifactory", externalId: "16357" });
    expect(modelIdFromUrl("myminifactory", modelUrlFor("myminifactory", "16357"))).toBe("16357");
  });

  it("syncs one collection once, however the owner's name is typed", () => {
    const a = parseSyncSource("https://www.myminifactory.com/users/Schmick101/collection/steampunk");
    const b = parseSyncSource("https://www.myminifactory.com/it/users/schmick101/collection/steampunk");
    expect(a).toMatchObject({ provider: "myminifactory", externalId: "schmick101/steampunk" });
    expect(b?.externalId).toBe(a?.externalId);
  });
});

describe("myminifactoryMetaFromObject", () => {
  it("maps an object's details, designer, images and categories", () => {
    const { meta, galleryImages } = myminifactoryMetaFromObject({
      id: 16357,
      name: "Diana at the Louvre",
      description_html: "<p>A <strong>marble</strong> statue.</p>",
      printing_details_html: "<p>Print with supports.</p>",
      tags: ["statue", " louvre "],
      images: [image("side"), image("front", true)],
      designer: {
        id: 20099,
        username: "ScanTheWorld",
        name: "Scan The World",
        profile_url: "https://www.myminifactory.com/users/ScanTheWorld",
        avatar_url: "https://assets.myminifactory.com/avatar.jpg",
        website: "https://example.com",
      },
      // A page, as the API answers, though its spec says a plain list.
      categories: { total_count: 1, items: [{ id: 112, name: "Paris", parent: { id: 7, name: "Europe" } }] },
    });

    expect(meta.title).toBe("Diana at the Louvre");
    expect(meta.description).toContain("**marble**");
    expect(meta.description).toContain("## Printing details");
    expect(meta.tags).toEqual(["statue", "louvre"]);
    expect(meta.previewImageUrl).toContain("original-front");
    expect(galleryImages.map((img) => img.url)).toEqual([
      expect.stringContaining("original-side"),
      expect.stringContaining("original-front"),
    ]);
    expect(meta.author).toMatchObject({
      provider: "myminifactory",
      externalId: "20099",
      handle: "ScanTheWorld",
      name: "Scan The World",
      links: ["https://www.myminifactory.com/users/ScanTheWorld", "https://example.com"],
    });
    expect(meta.creator).toBe("Scan The World");
    expect(meta.siteCategoryIds).toEqual([112, 7]);
    expect(meta.categorySite).toBe("myminifactory");
  });

  it("tells a store object by its price", () => {
    expect(myminifactoryMetaFromObject({ id: 1, name: "Free" }).paid).toBe(false);
    expect(
      myminifactoryMetaFromObject({ id: 2, name: "Paid", price: { currency: "USD", symbol: "$", value: "1.50" } }).paid,
    ).toBe(true);
  });
});

describe("resolveMyminifactoryDownload", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("follows a free object to its signed file link", async () => {
    const signed = "https://dl4.myminifactory.com/object-assets/abc/threedfiles/diana.stl?X-Amz-Signature=x";
    global.fetch = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async () =>
      redirectResponse(signed),
    ) as unknown as typeof fetch;
    expect(await resolveMyminifactoryDownload("16357")).toEqual({ kind: "file", url: signed });
  });

  it("tells a paid or members-only object by its redirect to the login page", async () => {
    global.fetch = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async () =>
      redirectResponse("https://www.myminifactory.com/login"),
    ) as unknown as typeof fetch;
    expect(await resolveMyminifactoryDownload("300000")).toEqual({ kind: "login" });
  });

  it("ignores a redirect anywhere but MyMiniFactory's file hosts", async () => {
    global.fetch = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async () =>
      redirectResponse("https://evil.example.com/x.stl"),
    ) as unknown as typeof fetch;
    expect(await resolveMyminifactoryDownload("16357")).toEqual({ kind: "missing" });
  });
});

describe("fetchMyminifactoryCollectionObjects", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("pages through a collection and reads its name", async () => {
    const object = (id: number) => ({ id, name: `Object ${id}`, images: [image(String(id), true)] });
    const pages: Record<string, unknown[]> = {
      "1": Array.from({ length: 30 }, (_, i) => object(i + 1)),
      // A store object, left out as it can't be imported.
      "2": [object(31), { ...object(32), price: { currency: "USD", symbol: "$", value: "2.00" } }],
    };
    global.fetch = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/api/v2/users/schmick101/collections/steampunk");
      expect(url.searchParams.get("key")).toBe(API_KEY);
      const page = url.searchParams.get("page")!;
      return jsonResponse(200, { name: "Steampunk", objects: { total_count: 32, items: pages[page] } });
    }) as unknown as typeof fetch;

    const listing = await fetchMyminifactoryCollectionObjects("schmick101", "steampunk", API_KEY);
    expect(listing?.title).toBe("Steampunk");
    expect(listing?.entries).toHaveLength(31);
    expect(listing?.entries[0]).toEqual({
      objectId: "1",
      title: "Object 1",
      cover: "https://assets.myminifactory.com/object-images/abc/images/thumb-1.jpg",
    });
    expect(listing?.truncated).toBe(false);
    expect(listing?.paid).toBe(1);
  });

  it("is null for a collection that doesn't exist, and throws on a rejected key", async () => {
    global.fetch = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async () =>
      jsonResponse(404, { status: 404 }),
    ) as unknown as typeof fetch;
    expect(await fetchMyminifactoryCollectionObjects("a", "b", API_KEY)).toBeNull();

    global.fetch = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async () =>
      jsonResponse(401, { error: "access_denied", error_description: "Invalid API key." }),
    ) as unknown as typeof fetch;
    await expect(fetchMyminifactoryCollectionObjects("a", "b", API_KEY)).rejects.toThrow(/API key/);
  });
});

describe("normalizeMyminifactoryCookie", () => {
  it("keeps only the session, from a Cookie header, a pair or a bare value", () => {
    const header = "hl=en; __cflb=02Di; PHPSESSID=1fd6e084e0ad; cf_clearance=JXx-1.2; __cf_bm=wK";
    expect(normalizeMyminifactoryCookie(header)).toBe("PHPSESSID=1fd6e084e0ad");
    expect(normalizeMyminifactoryCookie("Cookie: PHPSESSID=abc")).toBe("PHPSESSID=abc");
    expect(normalizeMyminifactoryCookie("  abc123 ")).toBe("PHPSESSID=abc123");
  });

  it("is null without a session", () => {
    expect(normalizeMyminifactoryCookie("hl=en; __cflb=02Di")).toBeNull();
    expect(normalizeMyminifactoryCookie("")).toBeNull();
    expect(normalizeMyminifactoryCookie("PHPSESSID=bad value;")).toBeNull();
  });
});
