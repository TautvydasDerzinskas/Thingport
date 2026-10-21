import { afterEach, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import sharp from "sharp";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { attachImportedPreviewImages } from "../src/services/importService";
import { plateThumbPath, saveThumbFromBytes } from "../src/services/printService";
import { previewImagePath } from "../src/services/previewImageService";
import { plateAssetHome, printAssetHome } from "../src/services/modelAssets";
import { MOSAICS, renderTagMosaic } from "../src/services/tagMosaicService";
import { TAG_MOSAICS } from "../src/config";

const app = createApp();
let token: string;
let userId: string;

const STL =
  "solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t\n";
const auth = () => ({ Authorization: `Bearer ${token}` });

function png(r: number) {
  return sharp({ create: { width: 8, height: 8, channels: 3, background: { r, g: 0, b: 0 } } })
    .png()
    .toBuffer();
}

// The stored JPEGs are re-encoded, so an image is recognised by its red channel.
async function redOf(filePath: string) {
  return Math.round((await sharp(filePath).stats()).channels[0].mean);
}

async function uploadStl() {
  const res = await request(app).post("/api/upload").set(auth()).attach("files", Buffer.from(STL), "part.stl");
  expect(res.status).toBe(200);
  return res.body.prints[0] as { id: string; thumb_url: string | null };
}

beforeAll(async () => {
  const registered = await request(app)
    .post("/api/register")
    .send({ displayName: "Thumbs", email: `thumbs-${Date.now()}@example.com`, password: "password123" });
  token = registered.body.token;
  userId = registered.body.user.id;
});

describe("preview images", () => {
  it("makes the first added image the thumbnail of a model without one", async () => {
    const print = await uploadStl();
    expect(print.thumb_url).toBeNull();
    const res = await request(app)
      .post(`/api/print/${print.id}/preview-images`)
      .set(auth())
      .attach("files", await png(10), "a.png")
      .attach("files", await png(200), "b.png");
    expect(res.status).toBe(200);
    expect(res.body.print.preview_images).toHaveLength(2);
    expect(res.body.print.thumb_url).not.toBeNull();
  });
});

describe("a 3D render saved before uploaded images land", () => {
  it("gives way to the first image, as thumbnail and cover", async () => {
    const print = await uploadStl();
    const plate = (await prisma.plate.findFirst({ where: { printId: print.id } }))!;
    await request(app)
      .post(`/api/plate/${plate.id}/thumbnail-generated`)
      .set(auth())
      .attach("file", await png(10), "render.png");

    const res = await request(app)
      .post(`/api/print/${print.id}/preview-images`)
      .set(auth())
      .attach("files", await png(200), "a.png")
      .attach("files", await png(120), "b.png");
    expect(res.status).toBe(200);
    const previews = await prisma.previewImage.findMany({ where: { printId: print.id }, orderBy: { position: "asc" } });
    expect(previews.map((img) => [img.position, img.generated])).toEqual([
      [0, false],
      [1, false],
    ]);
    expect(await redOf(previewImagePath(previews[0].id, await printAssetHome(print.id)))).toBeGreaterThan(180);
    expect(await redOf(plateThumbPath(plate.id, await plateAssetHome(plate.id)))).toBeGreaterThan(180);
  });
});

describe("a 3D render made while an import runs", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("gives way to the imported cover, as thumbnail and first preview image", async () => {
    const print = await uploadStl();
    const plate = (await prisma.plate.findFirst({ where: { printId: print.id } }))!;

    // The model is browsable before its images download, so the app renders and saves one.
    const render = await request(app)
      .post(`/api/plate/${plate.id}/thumbnail-generated`)
      .set(auth())
      .attach("file", await png(10), "render.png");
    expect(render.status).toBe(200);
    expect(render.body.print.preview_images).toHaveLength(1);

    const images: Record<string, Buffer> = {
      "https://img.example.com/cover.png": await png(200),
      "https://img.example.com/gallery.png": await png(120),
    };
    global.fetch = (async (input: RequestInfo | URL) => {
      const body = images[String(input)];
      return body
        ? new Response(body, { headers: { "content-type": "image/png" } })
        : new Response("not found", { status: 404 });
    }) as typeof fetch;
    await attachImportedPreviewImages(
      print.id,
      plate.id,
      "https://img.example.com/cover.png",
      [{ url: "https://img.example.com/gallery.png", filename: "gallery.png" }],
      0,
    );

    const previews = await prisma.previewImage.findMany({ where: { printId: print.id }, orderBy: { position: "asc" } });
    expect(previews.map((img) => [img.position, img.generated])).toEqual([
      [0, false],
      [1, false],
    ]);
    expect(await redOf(previewImagePath(previews[0].id, await printAssetHome(print.id)))).toBeGreaterThan(180);
    expect(await redOf(plateThumbPath(plate.id, await plateAssetHome(plate.id)))).toBeGreaterThan(180);
    expect((await prisma.plate.findUnique({ where: { id: plate.id } }))!.thumbGenerated).toBe(false);

    // A render that finishes after the cover landed doesn't replace it.
    const late = await request(app)
      .post(`/api/plate/${plate.id}/thumbnail-generated`)
      .set(auth())
      .attach("file", await png(10), "render.png");
    expect(late.status).toBe(200);
    expect(late.body.print.preview_images).toHaveLength(2);
    expect(await redOf(plateThumbPath(plate.id, await plateAssetHome(plate.id)))).toBeGreaterThan(180);
  });
});

describe("tag tiles", () => {
  it("show one picture built from the tag's newest models, made anew when their pictures change", async () => {
    const tag = `Mosaic-${Date.now()}`;
    const prints: { id: string; plateId: string }[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await request(app).post("/api/upload").set(auth()).attach("files", Buffer.from(STL), `m${i}.stl`);
      const print = res.body.prints[0] as { id: string; plates: { id: string }[] };
      await request(app)
        .post(`/api/print/${print.id}/tags`)
        .set(auth())
        .send({ tags: [tag] });
      prints.push({ id: print.id, plateId: print.plates[0].id });
    }
    // The newest has no picture at all; the other eleven have a rendered plate.
    for (const { plateId } of prints.slice(0, 11)) {
      await saveThumbFromBytes(
        plateId,
        await sharp(await png(200))
          .jpeg()
          .toBuffer(),
      );
    }
    const tile = async () =>
      (
        (await request(app).get("/api/tags/summary").set(auth())).body.items as {
          name: string;
          mosaic_url: string | null;
        }[]
      ).find((t) => t.name === tag)!;

    const before = (await tile()).mosaic_url!;
    expect(before).toMatch(new RegExp(`^/tags/${tag}/mosaic\\.webp\\?v=[0-9a-f]{16}$`));
    const image = await request(app)
      .get(`/api${before}`)
      .set(auth())
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => done(null, Buffer.concat(chunks)));
      });
    expect(image.status).toBe(200);
    expect(image.headers["content-type"]).toBe("image/webp");
    expect(await sharp(image.body as Buffer).metadata()).toMatchObject({ format: "webp", width: 480, height: 480 });
    const files = await fs.readdir(path.join(TAG_MOSAICS, `u-${userId}`));
    expect(files).toHaveLength(1);

    // Taking the tag off one of its pictured models changes what the tile shows, so its URL too.
    await request(app).post(`/api/print/${prints[10].id}/tags`).set(auth()).send({ tags: [] });
    const after = (await tile()).mosaic_url!;
    expect(after).not.toBe(before);
    expect((await request(app).get(`/api${after}`).set(auth())).status).toBe(200);
    // The older version is gone once the new one is made.
    const now = await fs.readdir(path.join(TAG_MOSAICS, `u-${userId}`));
    expect(now).toHaveLength(1);
    expect(now).not.toEqual(files);
  });

  it("have no picture while none of the tag's models has one", async () => {
    const tag = `Bare-${Date.now()}`;
    const res = await request(app).post("/api/upload").set(auth()).attach("files", Buffer.from(STL), "bare.stl");
    await request(app)
      .post(`/api/print/${res.body.prints[0].id}/tags`)
      .set(auth())
      .send({ tags: [tag] });
    const items = (await request(app).get("/api/tags/summary").set(auth())).body.items as {
      name: string;
      mosaic_url: string | null;
    }[];
    expect(items.find((t) => t.name === tag)!.mosaic_url).toBeNull();
    expect((await request(app).get(`/api/tags/${tag}/mosaic.webp`).set(auth())).status).toBe(404);
  });

  it("draw each picture into its own cell, leaving the gaps between them see-through", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mosaic-"));
    const files = await Promise.all(
      [0, 120, 240].map(async (hue, i) => {
        const file = path.join(dir, `${i}.jpg`);
        await sharp(await png(hue))
          .jpeg()
          .toFile(file);
        return { file };
      }),
    );
    const { data, info } = await sharp(await renderTagMosaic(files))
      .raw()
      .toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4)];
    // Three pictures: the first fills the left half, the other two the right quarters (see MOSAICS).
    expect(pixel(100, 240)[0]).toBeLessThan(40);
    expect(pixel(360, 100)[0]).toBeGreaterThan(100);
    expect(pixel(360, 380)[0]).toBeGreaterThan(200);
    // The gap down the middle shows whatever is behind the tile.
    expect(pixel(239, 240)[3]).toBe(0);
    await fs.rm(dir, { recursive: true });
  });

  it("split the 4 x 4 grid into exactly n rectangles for n pictures", () => {
    MOSAICS.forEach((rows, index) => {
      expect(rows).toHaveLength(4);
      const letters = [...new Set(rows.join(""))].toSorted();
      expect(letters).toEqual(Array.from({ length: index + 1 }, (_, i) => String.fromCharCode(97 + i)));
      for (const letter of letters) {
        const cells = rows.flatMap((row, y) => [...row].flatMap((cell, x) => (cell === letter ? [[x, y]] : [])));
        const width = Math.max(...cells.map(([x]) => x)) - Math.min(...cells.map(([x]) => x)) + 1;
        const height = Math.max(...cells.map(([, y]) => y)) - Math.min(...cells.map(([, y]) => y)) + 1;
        // One rectangle: every cell of its bounding box is that letter.
        expect(cells).toHaveLength(width * height);
      }
    });
  });

  it("come a page at a time, leaving out tags under the minimum count", async () => {
    const own = (
      await request(app)
        .post("/api/register")
        .send({ displayName: "Pages", email: `tag-pages-${Date.now()}@example.com`, password: "password123" })
    ).body.token as string;
    const tagged: string[][] = [
      ["Alpha", "Beta"],
      ["Alpha", "Beta"],
      ["Alpha", "Gamma"],
    ];
    for (const tags of tagged) {
      const res = await request(app)
        .post("/api/upload")
        .set({ Authorization: `Bearer ${own}` })
        .attach("files", Buffer.from(STL), "p.stl");
      await request(app)
        .post(`/api/print/${res.body.prints[0].id}/tags`)
        .set({ Authorization: `Bearer ${own}` })
        .send({ tags });
    }
    const page = (query: Record<string, string | number>) =>
      request(app)
        .get("/api/tags/summary")
        .set({ Authorization: `Bearer ${own}` })
        .query(query);

    const first = await page({ limit: 1, offset: 0, min_count: 2 });
    expect(first.body.items.map((t: { name: string }) => t.name)).toEqual(["Alpha"]);
    expect(first.body).toMatchObject({ total: 2, total_all: 3, has_more: true });

    const second = await page({ limit: 1, offset: 1, min_count: 2 });
    expect(second.body.items.map((t: { name: string; count: number }) => [t.name, t.count])).toEqual([["Beta", 2]]);
    expect(second.body.has_more).toBe(false);

    const byName = await page({ sort: "name" });
    expect(byName.body.items.map((t: { name: string }) => t.name)).toEqual(["Alpha", "Beta", "Gamma"]);
  });
});

describe("deleting a tag", () => {
  it("takes it off every model that has it, and drops its bookmark", async () => {
    const own = (
      await request(app)
        .post("/api/register")
        .send({ displayName: "Untag", email: `tag-delete-${Date.now()}@example.com`, password: "password123" })
    ).body.token as string;
    const as = { Authorization: `Bearer ${own}` };
    const ids: string[] = [];
    for (const tags of [["Doomed", "Kept"], ["Doomed"], ["Kept"]]) {
      const res = await request(app).post("/api/upload").set(as).attach("files", Buffer.from(STL), "p.stl");
      ids.push(res.body.prints[0].id);
      await request(app).post(`/api/print/${res.body.prints[0].id}/tags`).set(as).send({ tags });
    }
    await request(app).post("/api/tags/Doomed/bookmark").set(as);

    const res = await request(app).delete("/api/tags/doomed").set(as);
    expect(res.status).toBe(200);
    expect(res.body.models).toBe(2);
    const tagsOf = await Promise.all(
      ids.map(async (id) => (await request(app).get(`/api/print/${id}`).set(as)).body.tags),
    );
    expect(tagsOf).toEqual([["Kept"], [], ["Kept"]]);
    expect((await request(app).get("/api/tags/bookmarked").set(as)).body).toEqual([]);
  });
});
