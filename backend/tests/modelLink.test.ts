import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

// No pacing or DNS here. config.ts reads the pace on load, so it's hoisted.
vi.hoisted(() => {
  process.env.IMPORT_MAKERWORLD_CALL_DELAY_MS = "0";
  process.env.IMPORT_PREVIEW_IMAGE_DELAY_MS = "0";
});
vi.mock("node:dns/promises", () => ({
  default: {
    resolve4: async () => ["93.184.216.34"],
    resolve6: async () => {
      throw new Error("no AAAA");
    },
  },
}));

import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { setProviderEnabled } from "../src/services/providerSettingsService";

const app = createApp();
const stamp = Date.now();
const STL = "solid test\nendsolid test";
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const SITE_CATEGORY = 900 + (stamp % 1000);
const originalFetch = global.fetch;

let token: string;
let userId: string;
let designNumber = 0;
let modelNumber = 0;
const auth = () => ({ Authorization: `Bearer ${token}` });
const designs = new Map<string, Record<string, unknown>>();
/** Every address asked for, so a test can tell nothing was downloaded. */
const asked: string[] = [];

function newDesign(overrides: Partial<Record<string, unknown>> = {}) {
  const id = String((stamp % 100_000_000) + ++designNumber);
  designs.set(id, {
    id: Number(id),
    title: `Phoenix ${id}`,
    summary: "<p>A phoenix.</p>",
    tags: ["Phoenix", "Articulated"],
    coverUrl: "https://makerworld.bblmw.com/cover.jpg",
    designCreator: { uid: 1692606088, name: "Deus Cat" },
    categories: [{ id: SITE_CATEGORY }],
    ...overrides,
  });
  return { id, url: `https://makerworld.com/en/models/${id}-phoenix` };
}

function mockFetch() {
  global.fetch = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
    const url = String(input);
    asked.push(url);
    const model = url.match(/^https:\/\/api\.bambulab\.com\/v1\/design-service\/design\/(\d+)/);
    if (model) {
      const design = designs.get(model[1]);
      return new Response(JSON.stringify(design ?? {}), {
        status: design ? 200 : 404,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.endsWith(".jpg") || url.endsWith(".png")) {
      return new Response(ONE_PIXEL_PNG, { headers: { "content-type": "image/png" } });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
}

async function upload(fields: { categoryId?: string } = {}) {
  const name = `upload-${stamp}-${++modelNumber}.stl`;
  const req = request(app).post("/api/upload").set(auth());
  if (fields.categoryId) void req.field("category_id", fields.categoryId);
  const res = await req.attach("files", Buffer.from(STL), name);
  expect(res.status).toBe(200);
  return res.body.prints[0] as { id: string; name: string };
}

const link = (printId: string, url: string) =>
  request(app).post(`/api/print/${printId}/link-source`).set(auth()).send({ url });
const preview = (url: string) => request(app).post("/api/import/preview").set(auth()).send({ url });

async function mappedCategory(name: string) {
  return prisma.category.create({
    data: {
      userId,
      name: `${name} ${stamp}`,
      kind: "category",
      siteIds: { create: { provider: "makerworld", siteId: String(SITE_CATEGORY) } },
    },
  });
}

describe("linking a model to its page on a provider", () => {
  beforeAll(async () => {
    const res = await request(app)
      .post("/api/register")
      .send({ displayName: "Model Link Test", email: `modellink-${stamp}@example.com`, password: "password123" });
    token = res.body.token;
    userId = (await prisma.user.findFirstOrThrow({ where: { email: `modellink-${stamp}@example.com` } })).id;
    await request(app).patch("/api/settings/makerworld").set(auth()).send({ cookie: "token=test-bearer" });
  });

  beforeEach(async () => {
    asked.length = 0;
    designs.clear();
    mockFetch();
    await prisma.categorySiteId.deleteMany({ where: { category: { userId } } });
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("takes the page's details and pictures, and leaves the model's files alone", async () => {
    const design = newDesign();
    const model = await upload();
    await prisma.print.update({ where: { id: model.id }, data: { tags: ["Mine"], notes: "Old notes." } });
    const before = await prisma.plate.findMany({ where: { printId: model.id } });

    const res = await link(model.id, design.url);

    expect(res.status).toBe(200);
    expect(res.body.print.source_provider).toBe("makerworld");
    expect(res.body.print.source_url).toContain(design.id);
    const updated = await prisma.print.findUniqueOrThrow({ where: { id: model.id }, include: { author: true } });
    expect(updated.sourceExternalId).toBe(design.id);
    expect(updated.notes).toBe("A phoenix.");
    expect(updated.tags.toSorted()).toEqual(["Articulated", "Mine", "Phoenix"]);
    expect(updated.creator).toBe("Deus Cat");
    expect(updated.author).not.toBeNull();
    expect(await prisma.previewImage.count({ where: { printId: model.id, generated: false } })).toBe(1);
    const after = await prisma.plate.findMany({ where: { printId: model.id } });
    expect(after.map((plate) => [plate.id, plate.filename])).toEqual(before.map((plate) => [plate.id, plate.filename]));
    expect(asked.filter((url) => url.includes("iot-service"))).toEqual([]);
  });

  it("puts the source's pictures ahead of the owner's own and keeps those", async () => {
    const design = newDesign();
    const model = await upload();
    const added = await request(app)
      .post(`/api/print/${model.id}/preview-images`)
      .set(auth())
      .attach("files", ONE_PIXEL_PNG, "mine.png");
    expect(added.status).toBe(200);
    const own = await prisma.previewImage.findFirstOrThrow({ where: { printId: model.id, generated: false } });

    await link(model.id, design.url);

    const images = await prisma.previewImage.findMany({ where: { printId: model.id }, orderBy: { position: "asc" } });
    expect(images).toHaveLength(2);
    expect(images[1].id).toBe(own.id);
  });

  it("replaces our own renders with the source's pictures", async () => {
    const design = newDesign();
    const model = await upload();
    await prisma.previewImage.deleteMany({ where: { printId: model.id } });
    await prisma.previewImage.create({ data: { printId: model.id, position: 0, generated: true } });

    await link(model.id, design.url);

    const images = await prisma.previewImage.findMany({ where: { printId: model.id } });
    expect(images.map((image) => image.generated)).toEqual([false]);
  });

  it("names a model with no title after the source, and keeps a title that's set", async () => {
    const untitled = await upload();
    const titled = await upload();
    await prisma.print.update({ where: { id: titled.id }, data: { title: "My own title" } });
    const first = newDesign({ title: `Dragon ${stamp}` });
    const second = newDesign({ title: `Dragon ${stamp}` });

    await link(untitled.id, first.url);
    await link(titled.id, second.url);

    const named = await prisma.print.findUniqueOrThrow({ where: { id: untitled.id } });
    expect(named.title).toBe(`Dragon ${stamp}`);
    expect(named.name).toBe(`Dragon ${stamp}`);
    expect((await prisma.print.findUniqueOrThrow({ where: { id: titled.id } })).title).toBe("My own title");
  });

  it("takes a free name when another model in the category has the title", async () => {
    const title = `Taken ${stamp}`;
    const other = await upload();
    await prisma.print.update({
      where: { id: other.id },
      data: { name: title, nameNormalized: title.toLowerCase(), title },
    });
    const model = await upload();

    const res = await link(model.id, newDesign({ title }).url);

    expect(res.status).toBe(200);
    const updated = await prisma.print.findUniqueOrThrow({ where: { id: model.id } });
    expect(updated.name).toBe(`${title} (2)`);
    expect(updated.title).toBe(title);
  });

  it("keeps what the source has nothing for", async () => {
    const design = newDesign({ summary: "", tags: [], designCreator: null, coverUrl: null });
    const model = await upload();
    await prisma.print.update({
      where: { id: model.id },
      data: { notes: "My notes.", tags: ["Mine"], creator: "Me" },
    });

    expect((await link(model.id, design.url)).status).toBe(200);

    const updated = await prisma.print.findUniqueOrThrow({ where: { id: model.id } });
    expect(updated.notes).toBe("My notes.");
    expect(updated.tags).toEqual(["Mine"]);
    expect(updated.creator).toBe("Me");
  });

  it("doesn't offer again what the source turned out to have nothing for", async () => {
    const design = newDesign({ tags: [], categories: [] });
    const model = await upload();

    const res = await link(model.id, design.url);

    expect(res.body.print.source_gaps).toEqual([]);
  });

  describe("category", () => {
    it("suggests the mapped category without moving the model, also with AI off", async () => {
      const mapped = await mappedCategory("Mapped");
      const model = await upload();

      const res = await link(model.id, newDesign().url);

      expect(res.body.print.category_id).toBeNull();
      expect(res.body.print.ai_suggestion).toMatchObject({
        category_id: mapped.id,
        provider: "makerworld",
        reason: "",
      });
      await prisma.category.delete({ where: { id: mapped.id } });
    });

    it("leaves a model in a folder until the suggestion is accepted, and files it as a mapped category", async () => {
      const mapped = await mappedCategory("Accepted");
      const folder = await prisma.category.create({ data: { userId, name: `Folder ${stamp}`, kind: "folder" } });
      const model = await upload({ categoryId: folder.id });

      const res = await link(model.id, newDesign().url);
      expect(res.body.print.category_id).toBe(folder.id);

      const accepted = await request(app).post(`/api/print/${model.id}/ai-suggestion/accept`).set(auth()).send({});
      expect(accepted.status).toBe(200);
      const updated = await prisma.print.findUniqueOrThrow({ where: { id: model.id } });
      expect(updated.categoryId).toBe(mapped.id);
      expect(updated.categorySource).toBe("RULE");
      expect(updated.aiSuggestion).toBeNull();
      await prisma.print.update({ where: { id: model.id }, data: { categoryId: null, categorySource: null } });
      await prisma.category.deleteMany({ where: { id: { in: [mapped.id, folder.id] } } });
    });

    it("doesn't suggest the category the model is already in, or one it was turned down for", async () => {
      const mapped = await mappedCategory("Same");
      const inside = await upload({ categoryId: mapped.id });
      const turnedDown = await upload();
      await prisma.print.update({ where: { id: turnedDown.id }, data: { aiRejectedCategoryIds: [mapped.id] } });

      expect((await link(inside.id, newDesign().url)).body.print.ai_suggestion).toBeNull();
      expect((await link(turnedDown.id, newDesign().url)).body.print.ai_suggestion).toBeNull();
      await prisma.print.update({ where: { id: inside.id }, data: { categoryId: null, categorySource: null } });
      await prisma.category.delete({ where: { id: mapped.id } });
    });

    it("remembers a rejected suggestion so AI isn't offered that category either", async () => {
      const mapped = await mappedCategory("Rejected");
      const model = await upload();
      await link(model.id, newDesign().url);

      const rejected = await request(app).post(`/api/print/${model.id}/ai-suggestion/reject`).set(auth()).send({});

      expect(rejected.status).toBe(200);
      const updated = await prisma.print.findUniqueOrThrow({ where: { id: model.id } });
      expect(updated.aiSuggestion).toBeNull();
      expect(updated.aiRejectedCategoryIds).toContain(mapped.id);
      await prisma.category.delete({ where: { id: mapped.id } });
    });

    it("hides AI's own suggestions with AI off, as before", async () => {
      const mapped = await mappedCategory("Hidden");
      const model = await upload();
      await prisma.print.update({
        where: { id: model.id },
        data: {
          aiSuggestion: {
            categoryId: mapped.id,
            confidence: 0.6,
            reason: "fits",
            model: "local",
            createdAt: new Date().toISOString(),
          },
        },
      });

      const shown = await request(app).get(`/api/print/${model.id}`).set(auth());

      expect(shown.body.ai_suggestion).toBeNull();
      await prisma.category.delete({ where: { id: mapped.id } });
    });
  });

  describe("refusals", () => {
    it("refuses a model that already has a source", async () => {
      const model = await upload();
      expect((await link(model.id, newDesign().url)).status).toBe(200);
      const res = await link(model.id, newDesign().url);
      expect(res.status).toBe(409);
    });

    it("refuses a source another model already has, and the preview names that model", async () => {
      const design = newDesign();
      const first = await upload();
      const second = await upload();
      await link(first.id, design.url);
      asked.length = 0;

      const seen = await preview(design.url);
      expect(seen.status).toBe(200);
      expect(seen.body.linked_print.id).toBe(first.id);
      expect(asked).toEqual([]);

      const res = await link(second.id, design.url);
      expect(res.status).toBe(409);
      expect((await prisma.print.findUniqueOrThrow({ where: { id: second.id } })).sourceProvider).toBeNull();
    });

    it("refuses anything that isn't one model on a provider", async () => {
      const model = await upload();
      for (const url of [
        "https://example.com/some/model.stl",
        "https://makerworld.com/en/collections/123-things",
        "not a link",
      ]) {
        expect((await link(model.id, url)).status).toBe(400);
      }
      expect((await prisma.print.findUniqueOrThrow({ where: { id: model.id } })).sourceProvider).toBeNull();
    });

    it("refuses a provider an admin turned off", async () => {
      const model = await upload();
      const url = newDesign().url;
      await setProviderEnabled("makerworld", false);
      try {
        expect((await link(model.id, url)).status).toBeGreaterThanOrEqual(400);
        expect((await preview(url)).status).toBeGreaterThanOrEqual(400);
      } finally {
        await setProviderEnabled("makerworld", true);
      }
    });

    it("refuses a model a tool brought", async () => {
      const model = await upload();
      const tool = await prisma.tool.create({
        data: { source: "own", scope: userId, userId, slug: `tool-${stamp}`, manifest: {}, script: "", sha: "test" },
      });
      await prisma.print.update({ where: { id: model.id }, data: { toolId: tool.id, toolKey: "k" } });
      const res = await link(model.id, newDesign().url);
      expect(res.status).toBe(403);
      await prisma.print.update({ where: { id: model.id }, data: { toolId: null, toolKey: null } });
      await prisma.tool.delete({ where: { id: tool.id } });
    });

    it("refuses someone else's model", async () => {
      const model = await upload();
      const other = await request(app)
        .post("/api/register")
        .send({ displayName: "Other", email: `modellink-other-${stamp}@example.com`, password: "password123" });
      const res = await request(app)
        .post(`/api/print/${model.id}/link-source`)
        .set({ Authorization: `Bearer ${other.body.token}` })
        .send({ url: newDesign().url });
      expect(res.status).toBe(404);
    });

    it("changes nothing when the source can't be read", async () => {
      const model = await upload();
      await prisma.print.update({ where: { id: model.id }, data: { notes: "Mine." } });
      const before = await prisma.print.findUniqueOrThrow({ where: { id: model.id } });

      const res = await link(model.id, "https://makerworld.com/en/models/1-gone");

      expect(res.status).toBeGreaterThanOrEqual(400);
      const after = await prisma.print.findUniqueOrThrow({ where: { id: model.id } });
      expect(after.sourceProvider).toBeNull();
      expect(after.notes).toBe(before.notes);
    });
  });

  it("previews what a link would bring, without changing anything", async () => {
    const design = newDesign({
      designExtension: { design_pictures: [{ name: "a.jpg", url: "https://makerworld.bblmw.com/a.jpg" }] },
    });

    const res = await preview(design.url);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      provider: "makerworld",
      linked_print: null,
      title: `Phoenix ${design.id}`,
      author_name: "Deus Cat",
      cover_url: "https://makerworld.bblmw.com/cover.jpg",
      tag_count: 2,
      has_description: true,
    });
    expect(res.body.image_count).toBeGreaterThanOrEqual(1);
    expect(asked.some((url) => url.endsWith(".jpg"))).toBe(false);
  });
});
