import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { resolveCategoryIdByCategory } from "../src/services/importService";

// Free-text "800;71;1001" input for the *_cat_ids fields.

const app = createApp();
let token: string;

beforeAll(async () => {
  const email = `category-ids-test-${Date.now()}@example.com`;
  const res = await request(app)
    .post("/api/register")
    .send({ displayName: "Category Ids Test", email, password: "password123" });
  if (res.status !== 200) {
    throw new Error(`Failed to register during test setup: ${res.status} ${JSON.stringify(res.body)}`);
  }
  token = res.body.token;
});

const storedIds = async (categoryId: string, provider: string) =>
  (await prisma.categorySiteId.findMany({ where: { categoryId, provider }, orderBy: { position: "asc" } })).map(
    (row) => row.siteId,
  );

function auth() {
  return { Authorization: `Bearer ${token}` };
}

async function createCategory(name: string): Promise<string> {
  const res = await request(app).post("/api/categories").set(auth()).send({ name, tags: [] });
  expect(res.status).toBe(200);
  return res.body.id;
}

describe("PATCH /category/:id/meta -- multi-value category ids", () => {
  it("parses a semicolon-separated string into multiple ids, and round-trips it back the same way", async () => {
    const categoryId = await createCategory("Multi Cat Category");
    const res = await request(app)
      .patch(`/api/category/${categoryId}/meta`)
      .set(auth())
      .send({ thingiverse_cat_ids: "800;71;1001" });

    expect(res.status).toBe(200);
    expect(res.body.thingiverse_cat_ids).toBe("800;71;1001");

    expect(await storedIds(categoryId, "thingiverse")).toEqual(["800", "71", "1001"]);
  });

  it("tolerates stray/duplicate separators and whitespace, deduping the result", async () => {
    const categoryId = await createCategory("Messy Input Category");
    const res = await request(app)
      .patch(`/api/category/${categoryId}/meta`)
      .set(auth())
      .send({ makerworld_cat_ids: " 800 ;;71; 800 ;1001;" });

    expect(res.status).toBe(200);
    expect(res.body.makerworld_cat_ids).toBe("800;71;1001");
  });

  it("clears the field on an empty or whitespace-only string", async () => {
    const categoryId = await createCategory("Clearable Category");
    await request(app).patch(`/api/category/${categoryId}/meta`).set(auth()).send({ printables_cat_ids: "42" });

    const res = await request(app)
      .patch(`/api/category/${categoryId}/meta`)
      .set(auth())
      .send({ printables_cat_ids: "   " });
    expect(res.status).toBe(200);
    expect(res.body.printables_cat_ids).toBe("");

    expect(await storedIds(categoryId, "printables")).toEqual([]);
  });

  it("rejects a non-numeric token, naming it in the error", async () => {
    const categoryId = await createCategory("Bad Input Category");
    const res = await request(app)
      .patch(`/api/category/${categoryId}/meta`)
      .set(auth())
      .send({ thingiverse_cat_ids: "800;abc;71" });

    expect(res.status).toBe(400);
    expect(res.body.detail).toContain("abc");
  });

  it("rejects zero, negative, and decimal ids", async () => {
    const categoryId = await createCategory("Invalid Numbers Category");
    for (const bad of ["0", "-5", "1.5"]) {
      const res = await request(app)
        .patch(`/api/category/${categoryId}/meta`)
        .set(auth())
        .send({ thingiverse_cat_ids: bad });
      expect(res.status).toBe(400);
    }
  });

  it("rejects an excessive number of ids", async () => {
    const categoryId = await createCategory("Too Many Ids Category");
    const manyIds = Array.from({ length: 51 }, (_, i) => i + 1).join(";");
    const res = await request(app)
      .patch(`/api/category/${categoryId}/meta`)
      .set(auth())
      .send({ thingiverse_cat_ids: manyIds });
    expect(res.status).toBe(400);
  });

  it("keeps each site's ids independent of the others", async () => {
    const categoryId = await createCategory("Independent Sites Category");
    const res = await request(app)
      .patch(`/api/category/${categoryId}/meta`)
      .set(auth())
      .send({ makerworld_cat_ids: "1;2", thingiverse_cat_ids: "3;4", printables_cat_ids: "5;6" });

    expect(res.status).toBe(200);
    expect(res.body.makerworld_cat_ids).toBe("1;2");
    expect(res.body.thingiverse_cat_ids).toBe("3;4");
    expect(res.body.printables_cat_ids).toBe("5;6");
  });

  it("leaves a provider's ids alone when the request doesn't name it", async () => {
    const categoryId = await createCategory("Left Alone Category");
    await request(app).patch(`/api/category/${categoryId}/meta`).set(auth()).send({ cults3d_cat_ids: "7;8" });
    const res = await request(app)
      .patch(`/api/category/${categoryId}/meta`)
      .set(auth())
      .send({ meta_title: "Only the title" });
    expect(res.status).toBe(200);
    expect(res.body.cults3d_cat_ids).toBe("7;8");
  });

  it("takes Thangs' category paths and NexPrint's 16-digit ids as given", async () => {
    const categoryId = await createCategory("Text Ids Category");
    const res = await request(app)
      .patch(`/api/category/${categoryId}/meta`)
      .set(auth())
      .send({ thangs_cat_ids: "Toys & Games / Puzzles;Art", nexprint_cat_ids: "1422473859022863" });
    expect(res.status).toBe(200);
    expect(res.body.thangs_cat_ids).toBe("Toys & Games/Puzzles;Art");
    expect(res.body.nexprint_cat_ids).toBe("1422473859022863");
  });
});

describe("resolveCategoryIdByCategory -- the most specific site category wins", () => {
  it("files a model under the category its own site category maps to, not the one its parent's does", async () => {
    const email = `category-specificity-${Date.now()}@example.com`;
    const res = await request(app)
      .post("/api/register")
      .send({ displayName: "Specificity Test", email, password: "password123" });
    expect(res.status).toBe(200);
    const userId: string = res.body.user.id;
    const named = async (name: string) =>
      (await prisma.category.findFirstOrThrow({ where: { userId, name, kind: "category" } })).id;

    // MyMiniFactory's Phones & Tablets (94) maps to Gadgets; its parent, Gadgets & Electronics (59), to Electronics.
    expect(await resolveCategoryIdByCategory(userId, "myminifactory", [94, 59])).toBe(await named("Gadgets"));
    expect(await resolveCategoryIdByCategory(userId, "myminifactory", [59, 94])).toBe(await named("Electronics"));
    // Vases (362) under Home Decor (335), which the starter Decor category both lists.
    expect(await resolveCategoryIdByCategory(userId, "myminifactory", [362, 335])).toBe(await named("Decor"));
    expect(await resolveCategoryIdByCategory(userId, "myminifactory", [358])).toBeNull();
  });
});
