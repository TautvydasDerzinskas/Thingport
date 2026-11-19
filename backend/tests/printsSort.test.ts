import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";

const app = createApp();
let token: string;
let userId: string;

beforeAll(async () => {
  const email = `prints-sort-test-${Date.now()}@example.com`;
  const res = await request(app)
    .post("/api/register")
    .send({ displayName: "Prints Sort Test", email, password: "password123" });
  if (res.status !== 200) {
    throw new Error(`Failed to register during test setup: ${res.status} ${JSON.stringify(res.body)}`);
  }
  token = res.body.token;
  userId = res.body.user.id;
});

function auth() {
  return { Authorization: `Bearer ${token}` };
}

describe("GET /prints -- orderBy", () => {
  let oldestId: string;
  let middleId: string;
  let newestId: string;

  beforeAll(async () => {
    // Deliberately uncorrelated values, so each sort only passes by reading its own field.
    const oldest = await prisma.print.create({
      data: {
        userId,
        name: "Sort Oldest",
        nameNormalized: "sort oldest",
        createdAt: new Date("2020-01-01T00:00:00Z"),
        viewCount: 100,
        printCount: 1,
      },
    });
    const middle = await prisma.print.create({
      data: {
        userId,
        name: "Sort Middle",
        nameNormalized: "sort middle",
        createdAt: new Date("2021-01-01T00:00:00Z"),
        viewCount: 50,
        printCount: 5,
      },
    });
    const newest = await prisma.print.create({
      data: {
        userId,
        name: "Sort Newest",
        nameNormalized: "sort newest",
        createdAt: new Date("2022-01-01T00:00:00Z"),
        viewCount: 10,
        printCount: 20,
      },
    });
    oldestId = oldest.id;
    middleId = middle.id;
    newestId = newest.id;
  });

  it("defaults to newest-first (createdAt desc) when orderBy is omitted", async () => {
    const res = await request(app).get("/api/prints").set(auth());
    expect(res.status).toBe(200);
    const ids = res.body.map((p: { id: string }) => p.id);
    expect(ids.indexOf(newestId)).toBeLessThan(ids.indexOf(middleId));
    expect(ids.indexOf(middleId)).toBeLessThan(ids.indexOf(oldestId));
  });

  it("orderBy=newest sorts by createdAt desc explicitly", async () => {
    const res = await request(app).get("/api/prints").set(auth()).query({ orderBy: "newest" });
    const ids = res.body.map((p: { id: string }) => p.id);
    expect(ids.indexOf(newestId)).toBeLessThan(ids.indexOf(middleId));
    expect(ids.indexOf(middleId)).toBeLessThan(ids.indexOf(oldestId));
  });

  it("orderBy=popular sorts by view count desc", async () => {
    const res = await request(app).get("/api/prints").set(auth()).query({ orderBy: "popular" });
    const ids = res.body.map((p: { id: string }) => p.id);
    expect(ids.indexOf(oldestId)).toBeLessThan(ids.indexOf(middleId));
    expect(ids.indexOf(middleId)).toBeLessThan(ids.indexOf(newestId));
  });

  it("orderBy=downloads sorts by print count desc", async () => {
    const res = await request(app).get("/api/prints").set(auth()).query({ orderBy: "downloads" });
    const ids = res.body.map((p: { id: string }) => p.id);
    expect(ids.indexOf(newestId)).toBeLessThan(ids.indexOf(middleId));
    expect(ids.indexOf(middleId)).toBeLessThan(ids.indexOf(oldestId));
  });

  it("sorts filtered model names naturally in either direction before paginating", async () => {
    const category = await prisma.category.create({ data: { userId, name: "Name sort category" } });
    const prints = await Promise.all(
      ["Bearing", "Áxle 10", "axle 2", "Axle 1"].map((name) =>
        prisma.print.create({
          data: {
            userId,
            name: name === "Áxle 10" ? "Imported filename" : name,
            nameNormalized: name === "Áxle 10" ? "imported filename" : name.toLowerCase(),
            title: name === "Áxle 10" ? name : null,
            categoryId: category.id,
            tags: name === "Axle 1" ? [] : ["hardware"],
          },
        }),
      ),
    );
    const collection = await prisma.collection.create({
      data: {
        userId,
        name: "Name sort collection",
        nameNormalized: "name sort collection",
        items: { create: prints.map(({ id: printId }) => ({ printId })) },
      },
    });

    const query = { category_id: category.id, collection_id: collection.id, tags: "hardware", limit: 2 };
    const ascending = ["axle 2", "Áxle 10", "Bearing"];
    const modelNames = (body: { name: string; title: string | null }[]) => body.map((p) => p.title || p.name);
    for (const orderDirection of [undefined, "desc"]) {
      const expected = orderDirection === "desc" ? ascending.toReversed() : ascending;
      const sort = orderDirection ? { orderBy: "name", orderDirection } : { orderBy: "name" };
      const first = await request(app)
        .get("/api/prints")
        .set(auth())
        .query({ ...query, ...sort })
        .expect(200);
      expect(modelNames(first.body)).toEqual(expected.slice(0, 2));
      expect(first.headers["x-has-more"]).toBe("true");
      expect(first.headers["x-next-offset"]).toBe("2");

      const next = await request(app)
        .get("/api/prints")
        .set(auth())
        .query({ ...query, ...sort, offset: first.headers["x-next-offset"] })
        .expect(200);
      expect(modelNames(next.body)).toEqual(expected.slice(2));
      expect(next.headers["x-has-more"]).toBe("false");
    }
  });

  it("can reverse each numeric sort without changing its default direction", async () => {
    for (const [orderBy, firstId, lastId] of [
      ["newest", oldestId, newestId],
      ["popular", newestId, oldestId],
      ["downloads", oldestId, newestId],
    ]) {
      const { body } = await request(app)
        .get("/api/prints")
        .set(auth())
        .query({ orderBy, orderDirection: "asc" })
        .expect(200);
      const ids = body.map((p: { id: string }) => p.id);
      expect(ids.indexOf(firstId)).toBeLessThan(ids.indexOf(middleId));
      expect(ids.indexOf(middleId)).toBeLessThan(ids.indexOf(lastId));
    }
  });

  it("falls back to newest for an unrecognized orderBy value", async () => {
    const res = await request(app).get("/api/prints").set(auth()).query({ orderBy: "bogus" });
    const ids = res.body.map((p: { id: string }) => p.id);
    expect(ids.indexOf(newestId)).toBeLessThan(ids.indexOf(middleId));
    expect(ids.indexOf(middleId)).toBeLessThan(ids.indexOf(oldestId));
  });
});
