import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";

const app = createApp();
const stamp = Date.now();
let token: string;
let userId: string;

const auth = () => ({ Authorization: `Bearer ${token}` });
/** Unique to this run, so tags from earlier runs don't count. */
const tag = (name: string) => `${name}${stamp}`;

beforeAll(async () => {
  const registered = (
    await request(app)
      .post("/api/register")
      .send({ displayName: "Merger", email: `merge-${stamp}@example.com`, password: "password123" })
  ).body;
  token = registered.token;
  userId = registered.user.id;
});

let printCount = 0;
async function createPrint(tags: string[] = []) {
  const name = `merge-print-${stamp}-${printCount++}`;
  return (await prisma.print.create({ data: { userId, name, nameNormalized: name, tags } })).id;
}

async function createCollection(name: string, printIds: string[] = []): Promise<string> {
  const res = await request(app)
    .post("/api/collections")
    .set(auth())
    .send({ name: `${name} ${stamp}` });
  expect(res.status).toBe(200);
  if (printIds.length) {
    await request(app).post(`/api/collection/${res.body.id}/items`).set(auth()).send({ print_ids: printIds });
  }
  return res.body.id;
}

const itemsOf = async (collectionId: string) =>
  (await prisma.collectionItem.findMany({ where: { collectionId }, orderBy: { position: "asc" } })).map(
    (item) => item.printId,
  );

describe("merging collections", () => {
  it("previews every model once, whichever is kept", async () => {
    const [a, b, c] = [await createPrint(), await createPrint(), await createPrint()];
    const first = await createCollection("Preview A", [a, b]);
    const second = await createCollection("Preview B", [b, c]);
    const res = await request(app)
      .post("/api/collections/merge/preview")
      .set(auth())
      .send({ ids: [first, second] });
    expect(res.body).toEqual({ models: 3 });
  });

  it("appends the others' models after the kept one's, deletes them, and moves their bookmark", async () => {
    const [a, b, c, d] = [await createPrint(), await createPrint(), await createPrint(), await createPrint()];
    const kept = await createCollection("Kept", [a, b]);
    const other = await createCollection("Other", [b, c]);
    const third = await createCollection("Third", [d]);
    await request(app).post(`/api/collection/${other}/bookmark`).set(auth());

    const res = await request(app)
      .post("/api/collections/merge")
      .set(auth())
      .send({ primary_id: kept, ids: [kept, other, third] });
    expect(res.status).toBe(200);
    expect(res.body.collection.id).toBe(kept);
    expect(res.body.collection.item_count).toBe(4);
    expect(res.body.collection.bookmarked).toBe(true);
    expect(res.body.added).toBe(2);
    expect(res.body.merged_ids.toSorted()).toEqual([other, third].toSorted());
    expect(await itemsOf(kept)).toEqual([a, b, c, d]);
    expect(await prisma.collection.count({ where: { id: { in: [other, third] } } })).toBe(0);
    // The models themselves stay.
    expect(await prisma.print.count({ where: { id: { in: [a, b, c, d] } } })).toBe(4);
  });

  it("drops a merged collection's sync and keeps the kept one's name", async () => {
    const kept = await createCollection("Unsynced");
    const synced = await createCollection("Synced", [await createPrint()]);
    await prisma.collectionSync.create({
      data: { userId, collectionId: synced, provider: "printables", externalId: `x${stamp}`, sourceUrl: "https://x" },
    });
    const res = await request(app)
      .post("/api/collections/merge")
      .set(auth())
      .send({ primary_id: kept, ids: [synced] });
    expect(res.body.collection.name).toBe(`Unsynced ${stamp}`);
    expect(res.body.collection.sync).toBeNull();
    expect(await prisma.collectionSync.count({ where: { collectionId: synced } })).toBe(0);
  });

  it("refuses a lone collection, a built-in one, or someone else's", async () => {
    const lone = await createCollection("Lone");
    const merge = (body: object) => request(app).post("/api/collections/merge").set(auth()).send(body);
    expect((await merge({ primary_id: lone, ids: [lone] })).status).toBe(400);
    expect((await merge({ primary_id: lone, ids: ["favorites"] })).status).toBe(400);
    expect((await merge({ primary_id: lone, ids: ["not-a-collection"] })).status).toBe(404);
    expect(await prisma.collection.count({ where: { id: lone } })).toBe(1);
  });

  it("deletes several at once, keeping their models", async () => {
    const print = await createPrint();
    const ids = [await createCollection("Bulk 1", [print]), await createCollection("Bulk 2", [print])];
    const res = await request(app).post("/api/collections/delete").set(auth()).send({ ids });
    expect(res.body.deleted.toSorted()).toEqual(ids.toSorted());
    expect(await prisma.collection.count({ where: { id: { in: ids } } })).toBe(0);
    expect(await prisma.print.count({ where: { id: print } })).toBe(1);
  });
});

describe("merging tags", () => {
  const tagsOf = async (id: string) => (await prisma.print.findUniqueOrThrow({ where: { id } })).tags;

  it("previews every model with any of them, once", async () => {
    await createPrint([tag("Pa"), tag("Pb")]);
    await createPrint([tag("Pb")]);
    const res = await request(app)
      .post("/api/tags/merge/preview")
      .set(auth())
      .send({ tags: [tag("Pa"), tag("Pb")] });
    expect(res.body).toEqual({ models: 2 });
  });

  it("swaps the others for the kept one on models and collections, without doubling it", async () => {
    const both = await createPrint([tag("Dragon"), "Other", tag("Dragons").toLowerCase()]);
    const onlyOld = await createPrint([tag("Dragons")]);
    const untouched = await createPrint(["Other"]);
    const collection = await createCollection("Tagged");
    await prisma.collection.update({ where: { id: collection }, data: { tags: [tag("Dragons")] } });
    await request(app)
      .post(`/api/tags/${tag("Dragons")}/bookmark`)
      .set(auth());

    const res = await request(app)
      .post("/api/tags/merge")
      .set(auth())
      .send({ primary: tag("Dragon"), tags: [tag("Dragon"), tag("Dragons")] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ tag: tag("Dragon"), merged: [tag("Dragons")], added: 1 });
    expect(await tagsOf(both)).toEqual([tag("Dragon"), "Other"]);
    expect(await tagsOf(onlyOld)).toEqual([tag("Dragon")]);
    expect(await tagsOf(untouched)).toEqual(["Other"]);
    expect((await prisma.collection.findUniqueOrThrow({ where: { id: collection } })).tags).toEqual([tag("Dragon")]);
    const bookmarked = (await request(app).get("/api/tags/bookmarked").set(auth())).body as string[];
    expect(bookmarked).toContain(tag("Dragon"));
    expect(bookmarked).not.toContain(tag("Dragons"));
  });

  it("refuses to merge a tag into itself alone", async () => {
    const res = await request(app)
      .post("/api/tags/merge")
      .set(auth())
      .send({ primary: tag("Self"), tags: [tag("Self")] });
    expect(res.status).toBe(400);
  });

  it("deletes several at once", async () => {
    const print = await createPrint([tag("Gone1"), tag("Gone2"), "Kept"]);
    const res = await request(app)
      .post("/api/tags/delete")
      .set(auth())
      .send({ tags: [tag("Gone1"), tag("Gone2")] });
    expect(res.body.deleted.toSorted()).toEqual([tag("Gone1"), tag("Gone2")].toSorted());
    expect(await tagsOf(print)).toEqual(["Kept"]);
  });
});

describe("sorting tags by newest", () => {
  it("leads with the tag on the newest model", async () => {
    await createPrint([tag("Older")]);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await createPrint([tag("Newer")]);
    const res = await request(app).get("/api/tags/summary?sort=newest&limit=100").set(auth());
    const names = (res.body.items as { name: string }[]).map((item) => item.name);
    expect(names.indexOf(tag("Newer"))).toBeLessThan(names.indexOf(tag("Older")));
  });
});
