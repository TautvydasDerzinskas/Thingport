import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { fetchThingiverseUserLikes, parseThingiverseLikesUrl } from "../src/providers/thingiverse/api";
import { setThingiverseAccessToken } from "../src/providers/thingiverse/token";
import { prisma } from "../src/db";

const ACCESS_TOKEN = "test-access-token";
const USERNAME = "Derzinskas";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function likeEntry(id: number) {
  return { id, name: `Liked Thing ${id}`, thumbnail: `https://cdn.thingiverse.com/assets/test/${id}.jpg` };
}

describe("parseThingiverseLikesUrl", () => {
  it("recognizes a user's Likes page", () => {
    expect(parseThingiverseLikesUrl("https://www.thingiverse.com/Derzinskas/likes")).toEqual({
      username: "Derzinskas",
    });
    expect(parseThingiverseLikesUrl("https://thingiverse.com/someone/likes/")).toEqual({ username: "someone" });
  });

  it("rejects a single Thing URL and unrelated hosts", () => {
    expect(parseThingiverseLikesUrl("https://www.thingiverse.com/thing:763622")).toBeNull();
    expect(parseThingiverseLikesUrl("https://example.com/someone/likes")).toBeNull();
  });
});

describe("fetchThingiverseUserLikes", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("pages through multiple pages until a short page signals the end", async () => {
    global.fetch = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
      const url = String(input);
      const pageMatch = url.match(/page=(\d+)/);
      const page = pageMatch ? Number(pageMatch[1]) : 1;
      if (page === 1)
        return jsonResponse(
          200,
          Array.from({ length: 30 }, (_, i) => likeEntry(i + 1)),
        );
      if (page === 2)
        return jsonResponse(
          200,
          Array.from({ length: 5 }, (_, i) => likeEntry(31 + i)),
        );
      throw new Error(`Unexpected page ${page}`);
    }) as unknown as typeof fetch;

    const result = await fetchThingiverseUserLikes(USERNAME, ACCESS_TOKEN);
    expect(result.entries.length).toBe(35);
    expect(result.truncated).toBe(false);
    expect(result.entries[0]).toEqual({
      thingId: "1",
      title: "Liked Thing 1",
      cover: "https://cdn.thingiverse.com/assets/test/1.jpg",
    });
  });

  it("stops at maxItems and reports truncated", async () => {
    global.fetch = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async () =>
      jsonResponse(
        200,
        Array.from({ length: 30 }, (_, i) => likeEntry(i + 1)),
      ),
    ) as unknown as typeof fetch;

    const result = await fetchThingiverseUserLikes(USERNAME, ACCESS_TOKEN, 10);
    expect(result.entries.length).toBe(10);
    expect(result.truncated).toBe(true);
  });

  it("returns an empty result for a user with no likes (or who doesn't exist)", async () => {
    global.fetch = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async () =>
      jsonResponse(200, []),
    ) as unknown as typeof fetch;

    const result = await fetchThingiverseUserLikes(USERNAME, ACCESS_TOKEN);
    expect(result.entries).toEqual([]);
    expect(result.truncated).toBe(false);
  });
});

describe("POST /import/thingiverse-likes/entries", () => {
  const app = createApp();
  let token: string;
  let userId: string;
  const originalFetch = global.fetch;

  beforeAll(async () => {
    const email = `thingiverse-likes-route-test-${Date.now()}@example.com`;
    const res = await request(app)
      .post("/api/register")
      .send({ displayName: "Likes Route Test", email, password: "password123" });
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

  it("fails with a clear 503 when no App Token is configured", async () => {
    const res = await request(app)
      .post("/api/import/thingiverse-likes/entries")
      .set("Authorization", `Bearer ${token}`)
      .send({ url: `https://www.thingiverse.com/${USERNAME}/likes`, tags: [] });
    expect(res.status).toBe(503);
    expect(res.body.detail).toMatch(/isn't configured/i);
  });

  it("lists a user's liked Things as importable entries", async () => {
    await setThingiverseAccessToken(ACCESS_TOKEN);
    global.fetch = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async () =>
      jsonResponse(200, [likeEntry(1), likeEntry(2)]),
    ) as unknown as typeof fetch;

    const res = await request(app)
      .post("/api/import/thingiverse-likes/entries")
      .set("Authorization", `Bearer ${token}`)
      .send({ url: `https://www.thingiverse.com/${USERNAME}/likes`, tags: [] });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe(`${USERNAME}'s Thingiverse Likes`);
    expect(res.body.entries).toEqual([
      {
        design_id: "1",
        title: "Liked Thing 1",
        cover: "https://cdn.thingiverse.com/assets/test/1.jpg",
        already_imported: false,
      },
      {
        design_id: "2",
        title: "Liked Thing 2",
        cover: "https://cdn.thingiverse.com/assets/test/2.jpg",
        already_imported: false,
      },
    ]);
  });

  it("flags entries already in the user's library instead of letting them be re-selected", async () => {
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
    global.fetch = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async () =>
      jsonResponse(200, [likeEntry(1), likeEntry(2)]),
    ) as unknown as typeof fetch;

    const res = await request(app)
      .post("/api/import/thingiverse-likes/entries")
      .set("Authorization", `Bearer ${token}`)
      .send({ url: `https://www.thingiverse.com/${USERNAME}/likes`, tags: [] });

    expect(res.status).toBe(200);
    expect(res.body.entries).toEqual([
      {
        design_id: "1",
        title: "Liked Thing 1",
        cover: "https://cdn.thingiverse.com/assets/test/1.jpg",
        already_imported: true,
      },
      {
        design_id: "2",
        title: "Liked Thing 2",
        cover: "https://cdn.thingiverse.com/assets/test/2.jpg",
        already_imported: false,
      },
    ]);
  });

  it("rejects a URL that isn't a Thingiverse Likes page", async () => {
    await setThingiverseAccessToken(ACCESS_TOKEN);
    const res = await request(app)
      .post("/api/import/thingiverse-likes/entries")
      .set("Authorization", `Bearer ${token}`)
      .send({ url: "https://www.thingiverse.com/thing:763622", tags: [] });
    expect(res.status).toBe(400);
  });
});
