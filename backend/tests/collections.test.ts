import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createApp } from "../src/app";
import { addPrintsToCollection } from "../src/services/collectionService";

const app = createApp();
let token: string;

function tmpFile(name: string, contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thingport-test-"));
  const p = path.join(dir, name);
  fs.writeFileSync(p, contents);
  return p;
}

beforeAll(async () => {
  const email = `collections-test-${Date.now()}@example.com`;
  const res = await request(app)
    .post("/api/register")
    .send({ displayName: "Collections Test", email, password: "password123" });
  if (res.status !== 200) {
    throw new Error(`Failed to register during test setup: ${res.status} ${JSON.stringify(res.body)}`);
  }
  token = res.body.token;
});

function auth() {
  return { Authorization: `Bearer ${token}` };
}

describe("collections routes", () => {
  let id: string;

  it("creates a collection", async () => {
    const res = await request(app)
      .post("/api/collections")
      .set(auth())
      .send({ name: "My Collection", description: "desc", tags: ["a", "b"] });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("My Collection");
    expect(res.body.item_count).toBe(0);
    id = res.body.id;
  });

  it("lists collections", async () => {
    const res = await request(app).get("/api/collections").set(auth());
    expect(res.status).toBe(200);
    expect(res.body.some((c: { id: string }) => c.id === id)).toBe(true);
  });

  it("rejects a duplicate name with 409", async () => {
    const res = await request(app).post("/api/collections").set(auth()).send({ name: "My Collection" });
    expect(res.status).toBe(409);
  });

  it("gets a single collection", async () => {
    const res = await request(app).get(`/api/collection/${id}`).set(auth());
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
  });

  it("updates a collection", async () => {
    const res = await request(app)
      .patch(`/api/collection/${id}`)
      .set(auth())
      .send({ name: "Renamed Collection", tags: ["c"] });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Renamed Collection");
    // Tags are stored in canonical casing (see utils/tagNormalization.ts).
    expect(res.body.tags).toEqual(["C"]);
  });

  it("filters /prints by collection_id (empty collection -> empty list)", async () => {
    const res = await request(app).get("/api/prints").set(auth()).query({ collection_id: id });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("deletes a collection", async () => {
    const res = await request(app).delete(`/api/collection/${id}`).set(auth());
    expect(res.status).toBe(200);
    const after = await request(app).get(`/api/collection/${id}`).set(auth());
    expect(after.status).toBe(404);
  });
});

describe("removing one item from a collection", () => {
  it("drops membership without deleting the print, leaving other collections untouched", async () => {
    const uploadRes = await request(app)
      .post("/api/upload")
      .set(auth())
      .attach("files", tmpFile("remove-item.stl", "solid remove-item endsolid"));
    expect(uploadRes.status).toBe(200);
    const printId = uploadRes.body.prints[0].id;

    const collectionA = await request(app).post("/api/collections").set(auth()).send({ name: "Remove Item A" });
    const collectionB = await request(app).post("/api/collections").set(auth()).send({ name: "Remove Item B" });
    await addPrintsToCollection(collectionA.body.id, [printId]);
    await addPrintsToCollection(collectionB.body.id, [printId]);

    const removeRes = await request(app)
      .delete(`/api/collection/${collectionA.body.id}/items/${printId}`)
      .set(auth());
    expect(removeRes.status).toBe(200);

    const afterA = await request(app).get(`/api/collection/${collectionA.body.id}`).set(auth());
    expect(afterA.body.item_count).toBe(0);
    const afterB = await request(app).get(`/api/collection/${collectionB.body.id}`).set(auth());
    expect(afterB.body.item_count).toBe(1);

    const printRes = await request(app).get(`/api/print/${printId}`).set(auth());
    expect(printRes.status).toBe(200);

    await request(app).delete(`/api/print/${printId}`).set(auth());
    await request(app).delete(`/api/collection/${collectionA.body.id}`).set(auth());
    await request(app).delete(`/api/collection/${collectionB.body.id}`).set(auth());
  });

  it("rejects removing from a system collection", async () => {
    const uploadRes = await request(app)
      .post("/api/upload")
      .set(auth())
      .attach("files", tmpFile("remove-item-fav.stl", "solid remove-item-fav endsolid"));
    const printId = uploadRes.body.prints[0].id;
    await request(app).post(`/api/print/${printId}/favorite`).set(auth());

    const res = await request(app).delete(`/api/collection/favorites/items/${printId}`).set(auth());
    expect(res.status).toBe(400);

    await request(app).delete(`/api/print/${printId}`).set(auth());
  });
});

describe("collection/print deletion cascades", () => {
  it("deleting a collection does not delete the models in it", async () => {
    const uploadRes = await request(app)
      .post("/api/upload")
      .set(auth())
      .attach("files", tmpFile("keep-me.stl", "solid keep endsolid"));
    expect(uploadRes.status).toBe(200);
    const printId = uploadRes.body.prints[0].id;

    const collectionRes = await request(app)
      .post("/api/collections")
      .set(auth())
      .send({ name: "Cascade Test A" });
    expect(collectionRes.status).toBe(200);
    const collectionId = collectionRes.body.id;

    await addPrintsToCollection(collectionId, [printId]);

    const deleteRes = await request(app).delete(`/api/collection/${collectionId}`).set(auth());
    expect(deleteRes.status).toBe(200);

    const printRes = await request(app).get(`/api/print/${printId}`).set(auth());
    expect(printRes.status).toBe(200);
    expect(printRes.body.id).toBe(printId);

    await request(app).delete(`/api/print/${printId}`).set(auth());
  });

  it("deleting a model removes it from every category and collection it's assigned to", async () => {
    const categoryRes = await request(app)
      .post("/api/categories")
      .set(auth())
      .send({ name: "Cascade Category" });
    expect(categoryRes.status).toBe(200);
    const categoryId = categoryRes.body.id;

    const uploadRes = await request(app)
      .post("/api/upload")
      .set(auth())
      .field("category_id", categoryId)
      .attach("files", tmpFile("remove-me.stl", "solid remove endsolid"));
    expect(uploadRes.status).toBe(200);
    const printId = uploadRes.body.prints[0].id;

    const collectionRes = await request(app)
      .post("/api/collections")
      .set(auth())
      .send({ name: "Cascade Test B" });
    expect(collectionRes.status).toBe(200);
    const collectionId = collectionRes.body.id;

    await addPrintsToCollection(collectionId, [printId]);
    const beforeDelete = await request(app).get(`/api/collection/${collectionId}`).set(auth());
    expect(beforeDelete.body.item_count).toBe(1);

    const deleteRes = await request(app).delete(`/api/print/${printId}`).set(auth());
    expect(deleteRes.status).toBe(200);

    // Gone from the category it was filed under.
    const categoryPrints = await request(app).get("/api/prints").set(auth()).query({ category_id: categoryId });
    expect(categoryPrints.body.some((p: { id: string }) => p.id === printId)).toBe(false);

    // Gone from the collection it was assigned to.
    const afterDelete = await request(app).get(`/api/collection/${collectionId}`).set(auth());
    expect(afterDelete.body.item_count).toBe(0);
    const collectionPrints = await request(app).get("/api/prints").set(auth()).query({ collection_id: collectionId });
    expect(collectionPrints.body).toEqual([]);

    await request(app).delete(`/api/collection/${collectionId}`).set(auth());
    await request(app).delete(`/api/category/${categoryId}`).set(auth());
  });
});

describe("system collections (Favourites / Browsing History)", () => {
  it("always lists both, even for a brand new user with no prints", async () => {
    const res = await request(app).get("/api/collections").set(auth());
    expect(res.status).toBe(200);
    const favorites = res.body.find((c: { id: string }) => c.id === "favorites");
    const history = res.body.find((c: { id: string }) => c.id === "history");
    expect(favorites).toMatchObject({ system_key: "favorites" });
    expect(history).toMatchObject({ system_key: "history" });
  });

  it("rejects creating a real collection with a reserved name", async () => {
    const res = await request(app).post("/api/collections").set(auth()).send({ name: "Favourites" });
    expect(res.status).toBe(409);
  });

  it("rejects editing or deleting either system collection", async () => {
    const patchRes = await request(app).patch("/api/collection/favorites").set(auth()).send({ name: "Nope" });
    expect(patchRes.status).toBe(400);
    const deleteRes = await request(app).delete("/api/collection/history").set(auth());
    expect(deleteRes.status).toBe(400);
  });

  it("favorite/unfavorite toggles a print's membership in Favourites", async () => {
    const uploadRes = await request(app)
      .post("/api/upload")
      .set(auth())
      .attach("files", tmpFile("fav-me.stl", "solid fav endsolid"));
    const printId = uploadRes.body.prints[0].id;

    const favorited = await request(app).post(`/api/print/${printId}/favorite`).set(auth());
    expect(favorited.status).toBe(200);
    expect(favorited.body.is_favorite).toBe(true);

    const collection = await request(app).get("/api/collection/favorites").set(auth());
    expect(collection.body.item_count).toBe(1);
    const listed = await request(app).get("/api/prints").set(auth()).query({ collection_id: "favorites" });
    expect(listed.body.map((p: { id: string }) => p.id)).toEqual([printId]);

    const unfavorited = await request(app).delete(`/api/print/${printId}/favorite`).set(auth());
    expect(unfavorited.status).toBe(200);
    expect(unfavorited.body.is_favorite).toBe(false);

    const collectionAfter = await request(app).get("/api/collection/favorites").set(auth());
    expect(collectionAfter.body.item_count).toBe(0);

    await request(app).delete(`/api/print/${printId}`).set(auth());
  });

  it("tracks Browsing History from most recently viewed to oldest", async () => {
    const upload = await request(app)
      .post("/api/upload")
      .set(auth())
      .field("mode", "separate")
      .attach("files", tmpFile("history-a.stl", "solid a endsolid"))
      .attach("files", tmpFile("history-b.stl", "solid b endsolid"));
    expect(upload.status).toBe(200);
    const [printA, printB] = upload.body.prints.map((p: { id: string }) => p.id);

    // Viewing (GET /print/:id) is what records history -- listing/uploading does not.
    await request(app).get(`/api/print/${printA}`).set(auth());
    await new Promise((resolve) => setTimeout(resolve, 5));
    await request(app).get(`/api/print/${printB}`).set(auth());

    const listed = await request(app).get("/api/prints").set(auth()).query({ collection_id: "history" });
    const ids = listed.body.map((p: { id: string }) => p.id);
    expect(ids.indexOf(printB)).toBeLessThan(ids.indexOf(printA));

    // Re-viewing an older entry bumps it back to the top.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await request(app).get(`/api/print/${printA}`).set(auth());
    const listedAgain = await request(app).get("/api/prints").set(auth()).query({ collection_id: "history" });
    const idsAgain = listedAgain.body.map((p: { id: string }) => p.id);
    expect(idsAgain.indexOf(printA)).toBeLessThan(idsAgain.indexOf(printB));

    await request(app).delete(`/api/print/${printA}`).set(auth());
    await request(app).delete(`/api/print/${printB}`).set(auth());
  });
});
