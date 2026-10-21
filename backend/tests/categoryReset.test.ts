import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { DEFAULT_CATEGORIES } from "../src/seedData/defaultCategories";

const app = createApp();
const stamp = Date.now();
let token: string;
let userId: string;

type CategoryOut = { id: string; name: string; parent_id: string | null; position: number; kind: string };

const auth = () => ({ Authorization: `Bearer ${token}` });
const list = async () => (await request(app).get("/api/categories").set(auth())).body as CategoryOut[];
const reset = () => request(app).post("/api/categories/reset-defaults").set(auth());

async function create(name: string, parentId: string | null = null, kind?: string): Promise<string> {
  const res = await request(app).post("/api/categories").set(auth()).send({ name, parent_id: parentId, kind });
  expect(res.status).toBe(200);
  return res.body.id;
}

async function createPrint(name: string, categoryId: string) {
  return prisma.print.create({
    data: { userId, name, nameNormalized: name.toLowerCase(), categoryId, categorySource: "MANUAL" },
  });
}

const [firstRoot] = DEFAULT_CATEGORIES;
const firstChild = firstRoot.children![0];

beforeAll(async () => {
  const registered = (
    await request(app)
      .post("/api/register")
      .send({ displayName: "Resetter", email: `reset-${stamp}@example.com`, password: "password123" })
  ).body;
  token = registered.token;
  userId = registered.user.id;
});

type Preview = {
  added: string[][];
  restored: string[][];
  removed: { path: string[]; models: number }[];
  models_moved: number;
  models_uncategorized: number;
  models_renamed: number;
};
const preview = async () => (await request(app).get("/api/categories/reset-defaults").set(auth())).body as Preview;
const atDefaults = async () => {
  const p = await preview();
  return !p.added.length && !p.restored.length && !p.removed.length;
};

describe("POST /api/categories/reset-defaults", () => {
  it("reports a fresh tree as at its defaults, and an edited one as not, until it's reset", async () => {
    expect(await atDefaults()).toBe(true);
    const folder = await create(`Folder ${stamp}`, null, "folder");
    expect(await atDefaults()).toBe(true);
    const extra = await create(`Extra ${stamp}`, null, "category");
    expect(await atDefaults()).toBe(false);
    await request(app).delete(`/api/category/${extra}`).set(auth());
    expect(await atDefaults()).toBe(true);

    const root = (await list()).find((c) => c.name === firstRoot.name && !c.parent_id)!;
    await request(app).patch(`/api/category/${root.id}/meta`).set(auth()).send({ meta_title: "Changed" });
    expect(await atDefaults()).toBe(false);
    expect((await reset()).status).toBe(200);
    expect(await atDefaults()).toBe(true);
    await request(app).delete(`/api/category/${folder}`).set(auth());
  });

  it("restores renamed and deleted defaults, keeps matching ones and leaves folders alone", async () => {
    const before = await list();
    const root = before.find((c) => c.name === firstRoot.name && !c.parent_id)!;
    const child = before.find((c) => c.name === firstChild.name && c.parent_id === root.id)!;
    const printInChild = await createPrint(`Kept ${stamp}`, child.id);

    // Rename the root away (so its default comes back new) and delete another default.
    await request(app).patch(`/api/category/${root.id}`).set(auth()).send({ name: "Renamed", tags: [] });
    const second = before.find((c) => c.name === DEFAULT_CATEGORIES[1].name && !c.parent_id)!;
    await request(app).delete(`/api/category/${second.id}`).set(auth());
    const folder = await create(`Folder ${stamp}`, null, "folder");

    const res = await reset();
    expect(res.status).toBe(200);
    const after = res.body as CategoryOut[];

    const roots = after
      .filter((c) => c.kind === "category" && !c.parent_id)
      .toSorted((a, b) => a.position - b.position)
      .map((c) => c.name);
    expect(roots).toEqual(DEFAULT_CATEGORIES.map((c) => c.name));
    expect(after.filter((c) => c.kind === "category")).toHaveLength(before.filter((c) => c.kind === "category").length);
    expect(after.some((c) => c.name === "Renamed")).toBe(false);
    expect(after.find((c) => c.id === folder)?.kind).toBe("folder");

    // The renamed root was dropped, so its children went with it, and the model with them, out of any category.
    const moved = await prisma.print.findUniqueOrThrow({ where: { id: printInChild.id } });
    expect(moved.categoryId).toBeNull();
    expect(moved.categorySource).toBeNull();
  });

  it("keeps a matching category's id and models, and moves models in added categories to the nearest kept one", async () => {
    const before = await list();
    const root = before.find((c) => c.name === firstRoot.name && !c.parent_id)!;
    const child = before.find((c) => c.name === firstChild.name && c.parent_id === root.id)!;
    const kept = await createPrint(`Clash ${stamp}`, child.id);
    const extra = await create(`Extra ${stamp}`, child.id);
    const nested = await create(`Nested ${stamp}`, extra);
    const fromNested = await createPrint(`Clash ${stamp}`, nested);
    // Lands after the first one has taken its name.
    const suffixed = await createPrint(`Clash ${stamp} (2)`, nested);
    await prisma.print.update({ where: { id: suffixed.id }, data: { createdAt: new Date(Date.now() + 1000) } });

    const planned = await preview();
    expect(planned.added).toEqual([]);
    expect(planned.restored).toEqual([]);
    expect(planned.removed).toEqual([
      { path: [firstRoot.name, firstChild.name, `Extra ${stamp}`], models: 0 },
      { path: [firstRoot.name, firstChild.name, `Extra ${stamp}`, `Nested ${stamp}`], models: 2 },
    ]);
    expect(planned).toMatchObject({ models_moved: 2, models_uncategorized: 0, models_renamed: 2 });

    expect((await reset()).status).toBe(200);
    const after = await list();
    expect(after.find((c) => c.id === child.id)?.parent_id).toBe(root.id);
    expect(after.some((c) => c.id === extra || c.id === nested)).toBe(false);

    expect((await prisma.print.findUniqueOrThrow({ where: { id: kept.id } })).categoryId).toBe(child.id);
    const moved = await prisma.print.findUniqueOrThrow({ where: { id: fromNested.id } });
    expect(moved.categoryId).toBe(child.id);
    expect(moved.categorySource).toBe("MANUAL");
    expect(moved.name).toBe(`Clash ${stamp} (2)`);
    expect((await prisma.print.findUniqueOrThrow({ where: { id: suffixed.id } })).name).toBe(`Clash ${stamp} (2) (2)`);
  });
});
