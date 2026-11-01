import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
// Throws from inside the merge's transaction when asked, after its plates have already been moved over.
const tagFailure = vi.hoisted(() => ({ on: false }));
vi.mock("../src/utils/tagNormalization", async (original) => {
  const actual = await original<typeof import("../src/utils/tagNormalization")>();
  return {
    ...actual,
    normalizeTags: (tags: string[]) => {
      if (tagFailure.on) throw new Error("database went away");
      return actual.normalizeTags(tags);
    },
  };
});

import { createApp } from "../src/app";
import { STORAGE } from "../src/config";
import { prisma } from "../src/db";
import { assetTarget, galleryImageFile, plateRenderFile, plateThumbFile } from "../src/services/modelAssets";
import { addPreviewImage } from "../src/services/previewImageService";
import { ensureAssetHome, renderPlateStoragePath, saveThumbFromBytes } from "../src/services/printService";

const app = createApp();
const stamp = Date.now();
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

let token: string;
let userId: string;
let modelNumber = 0;
const auth = () => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  const registered = (
    await request(app)
      .post("/api/register")
      .send({ displayName: "Merger", email: `model-merge-${stamp}@example.com`, password: "password123" })
  ).body;
  token = registered.token;
  userId = registered.user.id;
});

afterEach(() => {
  tagFailure.on = false;
});

type Spec = {
  name?: string;
  files?: string[];
  notes?: string | null;
  tags?: string[];
  categoryId?: string | null;
  sourceProvider?: string;
};

/** A model with real files on disk, written directly: an upload would start renders that race these assertions. */
async function makeModel(spec: Spec = {}) {
  const name = spec.name ?? `model-${stamp}-${modelNumber++}`;
  const print = await prisma.print.create({
    data: {
      userId,
      name,
      nameNormalized: name.toLowerCase(),
      notes: spec.notes ?? null,
      tags: spec.tags ?? [],
      categoryId: spec.categoryId ?? null,
      categorySource: spec.categoryId ? "MANUAL" : null,
      sourceProvider: spec.sourceProvider ?? null,
      sourceExternalId: spec.sourceProvider ? `${stamp}-${modelNumber++}` : null,
    },
  });
  const plates = [];
  for (const [position, filename] of (spec.files ?? [`${name}.stl`]).entries()) {
    const storagePath = await renderPlateStoragePath(print, filename, position);
    const abs = path.join(STORAGE, storagePath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, `solid ${name} ${filename}`);
    plates.push(
      await prisma.plate.create({ data: { printId: print.id, position, filename, mime: "model/stl", storagePath } }),
    );
  }
  const assetsPath = await ensureAssetHome(print.id);
  return { ...print, assetsPath, plates };
}

const stored = (relative: string) => path.join(STORAGE, relative);
const merge = (primaryId: string, ids: string[]) =>
  request(app).post("/api/prints/merge").set(auth()).send({ primary_id: primaryId, ids });
const assign = (printIds: string[], categoryId: string) =>
  request(app).post("/api/prints/category").set(auth()).send({ print_ids: printIds, category_id: categoryId });

async function makeCategory(kind: "category" | "folder", name = `${kind}-${stamp}-${modelNumber++}`) {
  return prisma.category.create({ data: { userId, name, kind } });
}

describe("merging models", () => {
  it("moves the others' files in after the kept one's, and deletes the others", async () => {
    const kept = await makeModel({ files: ["Base.stl"] });
    const other = await makeModel({ files: ["Lid.stl", "base.STL"] });
    const third = await makeModel({ files: ["Knob.stl"] });
    const lidBytes = fs.readFileSync(stored(other.plates[0].storagePath), "utf8");

    const res = await merge(kept.id, [other.id, third.id]);

    expect(res.status).toBe(200);
    expect(res.body.print.id).toBe(kept.id);
    expect(res.body.merged_ids).toEqual([other.id, third.id]);
    expect(await prisma.print.count({ where: { id: { in: [other.id, third.id] } } })).toBe(0);

    const plates = await prisma.plate.findMany({ where: { printId: kept.id }, orderBy: { position: "asc" } });
    // A name a kept file already has, in any case, is suffixed.
    expect(plates.map((plate) => plate.filename)).toEqual(["Base.stl", "Lid.stl", "base (2).STL", "Knob.stl"]);
    expect(plates.map((plate) => plate.position)).toEqual([0, 1, 2, 3]);
    for (const plate of plates) {
      expect(fs.existsSync(stored(plate.storagePath))).toBe(true);
      // Laid out under the kept model, not where the merged one's folder was.
      expect(plate.storagePath).toContain(kept.name);
    }
    expect(fs.readFileSync(stored(plates[1].storagePath), "utf8")).toBe(lidBytes);
    // The merged models' folders don't linger, empty.
    expect(fs.existsSync(path.dirname(stored(other.plates[0].storagePath)))).toBe(false);
  });

  it("keeps real pictures ahead of renders, moves renders along, and deletes the merged models' thumbnails", async () => {
    const kept = await makeModel();
    const other = await makeModel();
    const keptRender = await addPreviewImage(kept.id, ONE_PIXEL_PNG, { generated: true });
    const otherRender = await addPreviewImage(other.id, ONE_PIXEL_PNG, { generated: true });
    const otherPhoto = await addPreviewImage(other.id, ONE_PIXEL_PNG);
    await saveThumbFromBytes(kept.plates[0].id, ONE_PIXEL_PNG);
    await saveThumbFromBytes(other.plates[0].id, ONE_PIXEL_PNG);
    const plateRender = plateRenderFile(other.plates[0].id);
    const renderFrom = assetTarget(other.assetsPath, plateRender);
    fs.mkdirSync(path.dirname(renderFrom), { recursive: true });
    fs.writeFileSync(renderFrom, "render");

    expect((await merge(kept.id, [other.id])).status).toBe(200);

    const gallery = await prisma.previewImage.findMany({ where: { printId: kept.id }, orderBy: { position: "asc" } });
    expect(gallery.map((image) => image.id)).toEqual([otherPhoto!.id, keptRender!.id, otherRender!.id]);
    expect(gallery.map((image) => image.position)).toEqual([0, 1, 2]);
    expect(gallery.map((image) => image.generated)).toEqual([false, true, true]);

    const { assetsPath: home } = await prisma.print.findUniqueOrThrow({ where: { id: kept.id } });
    for (const image of gallery) expect(fs.existsSync(assetTarget(home!, galleryImageFile(image.id)))).toBe(true);
    expect(fs.existsSync(assetTarget(home!, plateRender))).toBe(true);
    expect(fs.existsSync(renderFrom)).toBe(false);
    // Thumbnails: the kept model's stays, the merged model's plate has none now.
    expect(fs.existsSync(assetTarget(home!, plateThumbFile(kept.plates[0].id)))).toBe(true);
    expect(fs.existsSync(assetTarget(home!, plateThumbFile(other.plates[0].id)))).toBe(false);
    expect(fs.existsSync(assetTarget(other.assetsPath, plateThumbFile(other.plates[0].id)))).toBe(false);
  });

  it("gives the first plate an adopted real cover as its thumbnail, in place of our render", async () => {
    const kept = await makeModel();
    const other = await makeModel();
    await saveThumbFromBytes(kept.plates[0].id, ONE_PIXEL_PNG);
    await prisma.plate.update({ where: { id: kept.plates[0].id }, data: { thumbGenerated: true } });
    await addPreviewImage(other.id, ONE_PIXEL_PNG);

    const res = await merge(kept.id, [other.id]);

    expect(res.status).toBe(200);
    expect(res.body.print.plates[0].thumb_generated).toBe(false);
  });

  it("combines descriptions under the merged models' names, once each, keeping their images", async () => {
    const kept = await makeModel({ notes: "The whole thing." });
    const image = await prisma.descriptionImage.create({ data: { printId: kept.id, mime: "image/png", size: 1 } });
    const withImage = await makeModel({ name: `Lid ${stamp}` });
    const moved = await prisma.descriptionImage.create({ data: { printId: withImage.id, mime: "image/png", size: 1 } });
    const unused = await prisma.descriptionImage.create({
      data: { printId: withImage.id, mime: "image/png", size: 1 },
    });
    const lidNotes = `The lid. ![](/description-image/${moved.id})`;
    await prisma.print.update({ where: { id: withImage.id }, data: { notes: lidNotes } });
    await prisma.print.update({
      where: { id: kept.id },
      data: { notes: `The whole thing. ![](/description-image/${image.id})` },
    });
    const same = await makeModel({ notes: lidNotes });
    const empty = await makeModel();

    expect((await merge(kept.id, [withImage.id, same.id, empty.id])).status).toBe(200);

    const after = await prisma.print.findUniqueOrThrow({ where: { id: kept.id } });
    expect(after.notes).toBe(`The whole thing. ![](/description-image/${image.id})\n\n## Lid ${stamp}\n\n${lidNotes}`);
    const images = await prisma.descriptionImage.findMany({ where: { printId: kept.id }, select: { id: true } });
    expect(images.map((row) => row.id).toSorted()).toEqual([image.id, moved.id].toSorted());
    expect(await prisma.descriptionImage.count({ where: { id: unused.id } })).toBe(0);
  });

  it("gives a description that ends up alone no heading", async () => {
    const kept = await makeModel();
    const other = await makeModel({ notes: "Only this one." });
    await merge(kept.id, [other.id]);
    expect((await prisma.print.findUniqueOrThrow({ where: { id: kept.id } })).notes).toBe("Only this one.");
  });

  it("forgets an AI rewrite of the kept description once the description changes", async () => {
    const kept = await makeModel({ notes: "Rewritten." });
    await prisma.print.update({
      where: { id: kept.id },
      data: { aiDescriptionOriginal: "Original.", aiDescriptionAppliedAt: new Date() },
    });
    const other = await makeModel({ notes: "More." });
    await merge(kept.id, [other.id]);
    const after = await prisma.print.findUniqueOrThrow({ where: { id: kept.id } });
    expect(after.aiDescriptionOriginal).toBeNull();
    expect(after.aiDescriptionAppliedAt).toBeNull();
  });

  it("combines tags, collections, favourite and counts, and keeps the kept model's name and category", async () => {
    const category = await makeCategory("category");
    const folder = await makeCategory("folder");
    const kept = await makeModel({ tags: ["shared", "own"], categoryId: category.id });
    const other = await makeModel({ tags: ["Shared", "theirs"], categoryId: folder.id });
    const favoritedAt = new Date("2026-01-02T00:00:00Z");
    await prisma.print.update({ where: { id: kept.id }, data: { viewCount: 2, printCount: 1 } });
    await prisma.print.update({ where: { id: other.id }, data: { viewCount: 5, printCount: 3, favoritedAt } });
    const both = await prisma.collection.create({
      data: { userId, name: `both ${stamp}`, nameNormalized: `both ${stamp}` },
    });
    const theirs = await prisma.collection.create({
      data: { userId, name: `theirs ${stamp}`, nameNormalized: `theirs ${stamp}` },
    });
    await prisma.collectionItem.createMany({
      data: [
        { collectionId: both.id, printId: kept.id, position: 0 },
        { collectionId: both.id, printId: other.id, position: 1 },
        { collectionId: theirs.id, printId: other.id, position: 7 },
      ],
    });

    expect((await merge(kept.id, [other.id])).status).toBe(200);

    const after = await prisma.print.findUniqueOrThrow({
      where: { id: kept.id },
      include: { collectionItems: true },
    });
    expect(after.name).toBe(kept.name);
    expect(after.categoryId).toBe(category.id);
    expect(after.tags.toSorted()).toEqual(["Own", "Shared", "Theirs"]);
    expect(after.viewCount).toBe(7);
    expect(after.printCount).toBe(4);
    expect(after.favoritedAt).toEqual(favoritedAt);
    expect(after.collectionItems.map((item) => item.collectionId).toSorted()).toEqual([both.id, theirs.id].toSorted());
    expect(after.collectionItems.find((item) => item.collectionId === theirs.id)?.position).toBe(7);
  });

  it("moves supporting files, and a prepared file only into a model that has none", async () => {
    const prepared = async (printId: string, filename: string, role: "PREPARED" | "SUPPORTING" = "PREPARED") => {
      const storagePath = `merge-${stamp}-${modelNumber++}/${filename}`;
      fs.mkdirSync(path.dirname(stored(storagePath)), { recursive: true });
      fs.writeFileSync(stored(storagePath), filename);
      const file = await prisma.printFile.create({
        data: { printId, role, filename, mime: "application/octet-stream", storagePath },
      });
      if (role === "PREPARED") await prisma.print.update({ where: { id: printId }, data: { preparedFileId: file.id } });
      return file;
    };

    const empty = await makeModel();
    const withPrepared = await makeModel();
    const adopted = await prepared(withPrepared.id, "adopted.gcode.3mf");
    const notes = await prepared(withPrepared.id, "notes.pdf", "SUPPORTING");
    await merge(empty.id, [withPrepared.id]);
    const afterAdopt = await prisma.print.findUniqueOrThrow({ where: { id: empty.id }, include: { files: true } });
    expect(afterAdopt.preparedFileId).toBe(adopted.id);
    expect(afterAdopt.files.map((file) => file.id).toSorted()).toEqual([adopted.id, notes.id].toSorted());
    for (const file of afterAdopt.files) expect(fs.existsSync(stored(file.storagePath))).toBe(true);

    const hasOwn = await makeModel();
    const own = await prepared(hasOwn.id, "own.gcode.3mf");
    const another = await makeModel();
    const demoted = await prepared(another.id, "other.gcode.3mf");
    await merge(hasOwn.id, [another.id]);
    const afterDemote = await prisma.print.findUniqueOrThrow({ where: { id: hasOwn.id } });
    expect(afterDemote.preparedFileId).toBe(own.id);
    const demotedAfter = await prisma.printFile.findUniqueOrThrow({ where: { id: demoted.id } });
    expect(demotedAfter.role).toBe("SUPPORTING");
    expect(demotedAfter.printId).toBe(hasOwn.id);
  });

  it("merges uploads that already have a category", async () => {
    const category = await makeCategory("category");
    const kept = await makeModel({ categoryId: category.id });
    const other = await makeModel({ categoryId: category.id });
    expect((await merge(kept.id, [other.id])).status).toBe(200);
  });

  it("refuses any imported or tool's model, and changes nothing", async () => {
    const kept = await makeModel();
    const upload = await makeModel();
    const imported = await makeModel({ sourceProvider: "makerworld" });

    expect((await merge(kept.id, [upload.id, imported.id])).status).toBe(409);
    expect((await merge(imported.id, [upload.id])).status).toBe(409);

    const tool = await prisma.tool.create({
      data: { source: "own", scope: userId, slug: `merge-${stamp}`, userId, manifest: {}, script: "", sha: "x" },
    });
    await prisma.print.update({ where: { id: upload.id }, data: { toolId: tool.id } });
    expect((await merge(kept.id, [upload.id])).status).toBe(409);

    expect(await prisma.print.count({ where: { id: { in: [kept.id, upload.id, imported.id] } } })).toBe(3);
    expect(await prisma.plate.count({ where: { printId: kept.id } })).toBe(1);
  });

  it("needs another model, and only the user's own", async () => {
    const kept = await makeModel();
    expect((await merge(kept.id, [kept.id])).status).toBe(400);

    const stranger = (
      await request(app)
        .post("/api/register")
        .send({ displayName: "Stranger", email: `model-merge-other-${stamp}@example.com`, password: "password123" })
    ).body;
    const theirs = await prisma.print.create({
      data: { userId: stranger.user.id, name: `theirs-${stamp}`, nameNormalized: `theirs-${stamp}` },
    });
    expect((await merge(kept.id, [theirs.id])).status).toBe(404);
    expect(await prisma.print.count({ where: { id: theirs.id } })).toBe(1);
  });

  it("puts the pictures back when the database refuses the merge", async () => {
    const kept = await makeModel();
    const other = await makeModel();
    const image = await addPreviewImage(other.id, ONE_PIXEL_PNG);
    const picture = assetTarget(other.assetsPath, galleryImageFile(image!.id));
    expect(fs.existsSync(picture)).toBe(true);
    tagFailure.on = true;

    expect((await merge(kept.id, [other.id])).status).toBe(500);

    expect(fs.existsSync(picture)).toBe(true);
    expect(await prisma.print.count({ where: { id: other.id } })).toBe(1);
    expect(await prisma.previewImage.count({ where: { id: image!.id, printId: other.id } })).toBe(1);
    expect(await prisma.plate.count({ where: { id: other.plates[0].id, printId: other.id } })).toBe(1);
    expect(fs.existsSync(stored(other.plates[0].storagePath))).toBe(true);

    // Nothing was left half done: the same merge goes through once the database is back.
    tagFailure.on = false;
    expect((await merge(kept.id, [other.id])).status).toBe(200);
    expect(await prisma.previewImage.count({ where: { id: image!.id, printId: kept.id } })).toBe(1);
  });
});

describe("assigning a category to several models", () => {
  it("takes uploads out of their folders and moves their files", async () => {
    const folder = await makeCategory("folder");
    const category = await makeCategory("category");
    const inFolder = await makeModel({ categoryId: folder.id });
    const loose = await makeModel();
    const before = stored(inFolder.plates[0].storagePath);
    await prisma.print.update({ where: { id: inFolder.id }, data: { aiSuggestion: { categoryId: folder.id } } });

    const res = await assign([inFolder.id, loose.id], category.id);

    expect(res.status).toBe(200);
    expect(res.body.skipped).toBe(0);
    expect(res.body.failed).toBe(0);
    expect(res.body.prints).toHaveLength(2);
    expect(res.body.prints[0].category_id).toBe(category.id);
    expect(res.body.prints[0].category_kind).toBe("category");
    const after = await prisma.print.findUniqueOrThrow({ where: { id: inFolder.id }, include: { plates: true } });
    expect(after.categoryId).toBe(category.id);
    expect(after.categorySource).toBe("MANUAL");
    expect(after.aiSuggestion).toBeNull();
    expect(after.plates[0].storagePath).toContain(category.name);
    expect(fs.existsSync(stored(after.plates[0].storagePath))).toBe(true);
    expect(fs.existsSync(before)).toBe(false);
  });

  it("changes a category an upload already has", async () => {
    const from = await makeCategory("category");
    const to = await makeCategory("category");
    const model = await makeModel({ categoryId: from.id });
    const res = await assign([model.id], to.id);
    expect(res.body.prints[0].category_id).toBe(to.id);
  });

  it("leaves imported models and tools' models as they are, and counts them", async () => {
    const category = await makeCategory("category");
    const upload = await makeModel();
    const imported = await makeModel({ sourceProvider: "makerworld" });
    const res = await assign([upload.id, imported.id, "no-such-model"], category.id);
    expect(res.body.prints.map((print: { id: string }) => print.id)).toEqual([upload.id]);
    expect(res.body.skipped).toBe(2);
    expect((await prisma.print.findUniqueOrThrow({ where: { id: imported.id } })).categoryId).toBeNull();
  });

  it("renames a model whose name the category already has, rather than failing it", async () => {
    const category = await makeCategory("category");
    const name = `Same name ${stamp}`;
    await makeModel({ name, categoryId: category.id });
    const incoming = await makeModel({ name });
    const res = await assign([incoming.id], category.id);
    expect(res.body.failed).toBe(0);
    expect(res.body.prints[0].name).toBe(`${name} (2)`);
  });

  it("refuses a folder as the category", async () => {
    const folder = await makeCategory("folder");
    const model = await makeModel();
    expect((await assign([model.id], folder.id)).status).toBe(400);
    expect((await prisma.print.findUniqueOrThrow({ where: { id: model.id } })).categoryId).toBeNull();
  });
});
