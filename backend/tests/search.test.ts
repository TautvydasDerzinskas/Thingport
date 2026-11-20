import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";

const app = createApp();
const stamp = Date.now();
// One word that matches nothing else in a shared test database.
const word = `zorblax${stamp}`;
let session: string;
let apiToken: string;
let userId: string;

function auth(t: string) {
  return { Authorization: `Bearer ${t}` };
}

beforeAll(async () => {
  const registered = await request(app)
    .post("/api/register")
    .send({ displayName: "Search Test", email: `search-test-${stamp}@example.com`, password: "password123" });
  if (registered.status !== 200) {
    throw new Error(`Failed to register during test setup: ${registered.status} ${JSON.stringify(registered.body)}`);
  }
  session = registered.body.token;
  userId = registered.body.user.id;
  for (let i = 0; i < 9; i++) {
    const name = `${word} model ${i}`;
    await prisma.print.create({ data: { userId, name, nameNormalized: name.toLowerCase() } });
  }
  apiToken = (await request(app).post("/api/profile/api-token").set(auth(session))).body.token;
});

describe("GET /search", () => {
  it("returns the palette's six models by default", async () => {
    const res = await request(app).get("/api/search").query({ q: word }).set(auth(session));
    expect(res.status).toBe(200);
    expect(res.body.models).toHaveLength(6);
    expect(res.body.has_more_models).toBe(true);
  });

  it("returns more with a limit, for clients that show more", async () => {
    const res = await request(app).get("/api/search").query({ q: word, limit: 8 }).set(auth(session));
    expect(res.body.models).toHaveLength(8);
  });

  it("caps the limit", async () => {
    const res = await request(app).get("/api/search").query({ q: word, limit: 1000 }).set(auth(session));
    expect(res.body.models).toHaveLength(9);
    expect(res.body.has_more_models).toBe(false);
  });

  it("ignores a limit that isn't a number", async () => {
    const res = await request(app).get("/api/search").query({ q: word, limit: "lots" }).set(auth(session));
    expect(res.body.models).toHaveLength(6);
  });

  it("works with an API token", async () => {
    const res = await request(app).get("/api/search").query({ q: word }).set(auth(apiToken));
    expect(res.status).toBe(200);
    expect(res.body.models[0].name).toContain(word);
  });
});

describe('GET /prints?q= -- the palette\'s "see all results"', () => {
  const tagWord = `quibble${stamp}`;
  let nameMatchId: string;
  let tagMatchId: string;

  beforeAll(async () => {
    // The name match is older, so only relevance puts it first.
    const nameMatch = await prisma.print.create({
      data: {
        userId,
        name: `${tagWord} holder`,
        nameNormalized: `${tagWord} holder`,
        createdAt: new Date("2020-01-01T00:00:00Z"),
      },
    });
    const tagMatch = await prisma.print.create({
      data: { userId, name: "Plain stand", nameNormalized: "plain stand", tags: [tagWord] },
    });
    nameMatchId = nameMatch.id;
    tagMatchId = tagMatch.id;
  });

  it("finds what the palette finds, tags included", async () => {
    const res = await request(app).get("/api/prints").query({ q: tagWord }).set(auth(session));
    expect(res.status).toBe(200);
    expect(res.body.map((p: { id: string }) => p.id).toSorted()).toEqual([nameMatchId, tagMatchId].toSorted());
  });

  it("matches word prefixes", async () => {
    const res = await request(app)
      .get("/api/prints")
      .query({ q: tagWord.slice(0, -2) })
      .set(auth(session));
    expect(res.body).toHaveLength(2);
  });

  it("orders by relevance when asked: a name match before a tag match", async () => {
    const res = await request(app).get("/api/prints").query({ q: tagWord, orderBy: "relevance" }).set(auth(session));
    expect(res.body.map((p: { id: string }) => p.id)).toEqual([nameMatchId, tagMatchId]);
    const reversed = await request(app)
      .get("/api/prints")
      .query({ q: tagWord, orderBy: "relevance", orderDirection: "asc" })
      .set(auth(session));
    expect(reversed.body.map((p: { id: string }) => p.id)).toEqual([tagMatchId, nameMatchId]);
  });

  it("pages through all of them", async () => {
    const first = await request(app).get("/api/prints").query({ q: word, limit: 5, offset: 0 }).set(auth(session));
    expect(first.body).toHaveLength(5);
    expect(first.headers["x-has-more"]).toBe("true");
    expect(first.headers["x-total-count"]).toBe("9");
  });

  it("matches nothing when the query has no letters or digits", async () => {
    const res = await request(app).get("/api/prints").query({ q: "%%" }).set(auth(session));
    expect(res.body).toEqual([]);
  });
});
