import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import {
  fetchThingiverseCollectionThings,
  fetchThingiverseCollectionTitle,
  parseThingiverseCollectionUrl,
} from "../src/providers/thingiverse/api";
import { setThingiverseAccessToken } from "../src/services/settingsService";
import { prisma } from "../src/db";

const ACCESS_TOKEN = "test-access-token";
const COLLECTION_ID = "40781574";
const COLLECTION_TITLE = "Things to Make";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function thingEntry(id: number) {
  return { id, name: `Collected Thing ${id}`, thumbnail: `https://cdn.thingiverse.com/assets/test/${id}.jpg` };
}

describe("parseThingiverseCollectionUrl", () => {
  it("recognizes a Collection page, with or without the trailing /things", () => {
    expect(
      parseThingiverseCollectionUrl(`https://www.thingiverse.com/Derzinskas/collections/${COLLECTION_ID}/things`),
    ).toEqual({
      collectionId: COLLECTION_ID,
    });
    expect(
      parseThingiverseCollectionUrl(`https://www.thingiverse.com/Derzinskas/collections/${COLLECTION_ID}`),
    ).toEqual({
      collectionId: COLLECTION_ID,
    });
  });

  it("rejects a Likes page, a single Thing, and unrelated hosts", () => {
    expect(parseThingiverseCollectionUrl("https://www.thingiverse.com/Derzinskas/likes")).toBeNull();
    expect(parseThingiverseCollectionUrl("https://www.thingiverse.com/thing:763622")).toBeNull();
    expect(parseThingiverseCollectionUrl(`https://example.com/Derzinskas/collections/${COLLECTION_ID}`)).toBeNull();
  });
});

describe("fetchThingiverseCollectionThings / fetchThingiverseCollectionTitle", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("lists a collection's Things and reads its real name", async () => {
    global.fetch = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
      const url = String(input);
      if (url.startsWith(`https://api.thingiverse.com/collections/${COLLECTION_ID}/things`)) {
        return jsonResponse(200, [thingEntry(1), thingEntry(2)]);
      }
      if (url.startsWith(`https://api.thingiverse.com/collections/${COLLECTION_ID}?`)) {
        return jsonResponse(200, { id: Number(COLLECTION_ID), name: COLLECTION_TITLE });
      }
      throw new Error(`Unexpected fetch to ${url}`);
    }) as unknown as typeof fetch;

    const [title, listing] = await Promise.all([
      fetchThingiverseCollectionTitle(COLLECTION_ID, ACCESS_TOKEN),
      fetchThingiverseCollectionThings(COLLECTION_ID, ACCESS_TOKEN),
    ]);

    expect(title).toBe(COLLECTION_TITLE);
    expect(listing.entries).toEqual([
      { thingId: "1", title: "Collected Thing 1", cover: "https://cdn.thingiverse.com/assets/test/1.jpg" },
      { thingId: "2", title: "Collected Thing 2", cover: "https://cdn.thingiverse.com/assets/test/2.jpg" },
    ]);
  });

  it("returns null for a collection with no name (or that doesn't exist)", async () => {
    global.fetch = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async () =>
      jsonResponse(404, { error: "not found" }),
    ) as unknown as typeof fetch;
    const title = await fetchThingiverseCollectionTitle("999999999", ACCESS_TOKEN);
    expect(title).toBeNull();
  });
});

describe("POST /import/thingiverse-collection/entries", () => {
  const app = createApp();
  let token: string;
  let userId: string;

  const originalFetch = global.fetch;

  beforeAll(async () => {
    const email = `thingiverse-collection-route-test-${Date.now()}@example.com`;
    const res = await request(app)
      .post("/api/register")
      .send({ displayName: "Collection Route Test", email, password: "password123" });
    if (res.status !== 200) {
      throw new Error(`Failed to register during test setup: ${res.status} ${JSON.stringify(res.body)}`);
    }
    token = res.body.token;
    userId = res.body.user.id;
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    await setThingiverseAccessToken(null);
  });

  it("lists a collection's Things as importable entries, with the real collection name as title", async () => {
    await setThingiverseAccessToken(ACCESS_TOKEN);
    global.fetch = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
      const url = String(input);
      if (url.includes("/things?")) return jsonResponse(200, [thingEntry(1)]);
      return jsonResponse(200, { id: Number(COLLECTION_ID), name: COLLECTION_TITLE });
    }) as unknown as typeof fetch;

    const res = await request(app)
      .post("/api/import/thingiverse-collection/entries")
      .set("Authorization", `Bearer ${token}`)
      .send({ url: `https://www.thingiverse.com/Derzinskas/collections/${COLLECTION_ID}/things`, tags: [] });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe(COLLECTION_TITLE);
    expect(res.body.entries).toEqual([
      {
        design_id: "1",
        title: "Collected Thing 1",
        cover: "https://cdn.thingiverse.com/assets/test/1.jpg",
        already_imported: false,
      },
    ]);
  });

  it("flags an entry already in the user's library instead of letting it be re-selected", async () => {
    await setThingiverseAccessToken(ACCESS_TOKEN);
    await prisma.print.create({
      data: {
        userId,
        name: "Already imported",
        nameNormalized: "already imported",
        sourceProvider: "thingiverse",
        sourceExternalId: "1",
      },
    });
    global.fetch = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
      const url = String(input);
      if (url.includes("/things?")) return jsonResponse(200, [thingEntry(1)]);
      return jsonResponse(200, { id: Number(COLLECTION_ID), name: COLLECTION_TITLE });
    }) as unknown as typeof fetch;

    const res = await request(app)
      .post("/api/import/thingiverse-collection/entries")
      .set("Authorization", `Bearer ${token}`)
      .send({ url: `https://www.thingiverse.com/Derzinskas/collections/${COLLECTION_ID}/things`, tags: [] });

    expect(res.status).toBe(200);
    expect(res.body.entries).toEqual([
      {
        design_id: "1",
        title: "Collected Thing 1",
        cover: "https://cdn.thingiverse.com/assets/test/1.jpg",
        already_imported: true,
      },
    ]);
  });

  it("rejects a URL that isn't a Thingiverse Collection page", async () => {
    await setThingiverseAccessToken(ACCESS_TOKEN);
    const res = await request(app)
      .post("/api/import/thingiverse-collection/entries")
      .set("Authorization", `Bearer ${token}`)
      .send({ url: "https://www.thingiverse.com/Derzinskas/likes", tags: [] });
    expect(res.status).toBe(400);
  });

  it("fails with a clear 503 when no App Token is configured", async () => {
    const res = await request(app)
      .post("/api/import/thingiverse-collection/entries")
      .set("Authorization", `Bearer ${token}`)
      .send({ url: `https://www.thingiverse.com/Derzinskas/collections/${COLLECTION_ID}/things`, tags: [] });
    expect(res.status).toBe(503);
  });
});
