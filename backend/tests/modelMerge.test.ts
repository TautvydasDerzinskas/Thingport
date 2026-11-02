import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import sharp from "sharp";
// The moments these tests step into: what happens there is what a slow disk or another request would do.
const stage = vi.hoisted(() => ({
  // From inside the merge's transaction, after its plates have already been moved over.
  inTransaction: null as (() => void) | null,
  // From inside it too, before it has moved any: the models are locked, and all of its writes are still to come.
  movingPlates: null as (() => void) | null,
  // After the merge has read the models, before its transaction.
  afterRead: null as (() => Promise<unknown>) | null,
  relocationFails: false,
  readBackFails: false,
  // What the first name check answers: a name free then, and taken by the time it's written.
  staleName: null as string | null,
}));
vi.mock("../src/utils/tagNormalization", async (original) => {
  const actual = await original<typeof import("../src/utils/tagNormalization")>();
  return {
    ...actual,
    normalizeTags: (tags: string[]) => {
      stage.inTransaction?.();
      return actual.normalizeTags(tags);
    },
  };
});
vi.mock("../src/services/printService", async (original) => {
  const actual = await original<typeof import("../src/services/printService")>();
  return {
    ...actual,
    ensureAssetHome: async (printId: string) => {
      const home = await actual.ensureAssetHome(printId);
      await stage.afterRead?.();
      return home;
    },
    freePlateFilename: (...args: Parameters<typeof actual.freePlateFilename>) => {
      stage.movingPlates?.();
      return actual.freePlateFilename(...args);
    },
    relocatePrint: (...args: Parameters<typeof actual.relocatePrint>) =>
      stage.relocationFails ? Promise.reject(new Error("disk full")) : actual.relocatePrint(...args),
    availableModelName: (...args: Parameters<typeof actual.availableModelName>) => {
      const stale = stage.staleName;
      stage.staleName = null;
      return stale === null ? actual.availableModelName(...args) : Promise.resolve(stale);
    },
  };
});
vi.mock("../src/services/printLoader", async (original) => {
  const actual = await original<typeof import("../src/services/printLoader")>();
  return {
    ...actual,
    printOutById: (...args: Parameters<typeof actual.printOutById>) =>
      stage.readBackFails ? Promise.reject(new Error("database went away")) : actual.printOutById(...args),
    printOutsByIds: (...args: Parameters<typeof actual.printOutsByIds>) =>
      stage.readBackFails ? Promise.reject(new Error("database went away")) : actual.printOutsByIds(...args),
  };
});

import { createApp } from "../src/app";
import { STORAGE } from "../src/config";
import { prisma } from "../src/db";
import { assetTarget, galleryImageFile, plateRenderFile, plateThumbFile } from "../src/services/modelAssets";
import { addPreviewImage } from "../src/services/previewImageService";
import {
  ensureAssetHome,
  relocatePrint,
  renderPlateStoragePath,
  saveThumbFromBytes,
} from "../src/services/printService";
import { withStorageLock } from "../src/utils/storageLock";

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
  stage.inTransaction = null;
  stage.movingPlates = null;
  stage.afterRead = null;
  stage.relocationFails = false;
  stage.readBackFails = false;
  stage.staleName = null;
});

const failInTransaction = () => {
  stage.inTransaction = () => {
    throw new Error("database went away");
  };
};

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

type Model = Awaited<ReturnType<typeof makeModel>>;

/** A file row turning up from another request. */
const addLatePlate = (printId: string) =>
  prisma.plate.create({
    data: { printId, position: 5000, filename: "late.stl", mime: "model/stl", storagePath: `late-${printId}.stl` },
  });

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
    const solid = (background: { r: number; g: number; b: number }) =>
      sharp({ create: { width: 8, height: 8, channels: 3, background } })
        .png()
        .toBuffer();
    const kept = await makeModel();
    const other = await makeModel();
    await saveThumbFromBytes(kept.plates[0].id, await solid({ r: 0, g: 0, b: 255 }));
    await prisma.plate.update({ where: { id: kept.plates[0].id }, data: { thumbGenerated: true } });
    await addPreviewImage(other.id, await solid({ r: 255, g: 0, b: 0 }));

    const res = await merge(kept.id, [other.id]);

    expect(res.status).toBe(200);
    expect(res.body.print.plates[0].thumb_generated).toBe(false);
    const { assetsPath: home } = await prisma.print.findUniqueOrThrow({ where: { id: kept.id } });
    const { channels } = await sharp(assetTarget(home!, plateThumbFile(kept.plates[0].id))).stats();
    // The adopted cover's red, not our render's blue.
    expect(channels[0].mean).toBeGreaterThan(channels[2].mean);
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

  it("forgets an AI rewrite and suggestion of the kept description once the description changes", async () => {
    const kept = await makeModel({ notes: "Rewritten." });
    await prisma.print.update({
      where: { id: kept.id },
      data: {
        aiDescriptionOriginal: "Original.",
        aiDescriptionAppliedAt: new Date(),
        aiDescriptionSuggestion: { suggested: "Written from the old description." },
      },
    });
    const other = await makeModel({ notes: "More." });
    await merge(kept.id, [other.id]);
    const after = await prisma.print.findUniqueOrThrow({ where: { id: kept.id } });
    expect(after.aiDescriptionOriginal).toBeNull();
    expect(after.aiDescriptionAppliedAt).toBeNull();
    expect(after.aiDescriptionSuggestion).toBeNull();
  });

  it("keeps an AI rewrite of the kept description when the description stays as it was", async () => {
    const kept = await makeModel({ notes: "Rewritten." });
    await prisma.print.update({ where: { id: kept.id }, data: { aiDescriptionOriginal: "Original." } });
    const other = await makeModel();
    await merge(kept.id, [other.id]);
    const after = await prisma.print.findUniqueOrThrow({ where: { id: kept.id } });
    expect(after.aiDescriptionOriginal).toBe("Original.");
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
    const copy = assetTarget(kept.assetsPath, galleryImageFile(image!.id));
    expect(fs.existsSync(picture)).toBe(true);
    failInTransaction();

    expect((await merge(kept.id, [other.id])).status).toBe(500);

    expect(fs.existsSync(picture)).toBe(true);
    expect(fs.existsSync(copy)).toBe(false);
    expect(await prisma.print.count({ where: { id: other.id } })).toBe(1);
    expect(await prisma.previewImage.count({ where: { id: image!.id, printId: other.id } })).toBe(1);
    expect(await prisma.plate.count({ where: { id: other.plates[0].id, printId: other.id } })).toBe(1);
    expect(fs.existsSync(stored(other.plates[0].storagePath))).toBe(true);

    // Nothing was left half done: the same merge goes through once the database is back.
    stage.inTransaction = null;
    expect((await merge(kept.id, [other.id])).status).toBe(200);
    expect(await prisma.previewImage.count({ where: { id: image!.id, printId: kept.id } })).toBe(1);
  });

  it("has the pictures in both places until it commits, so a crash at any moment leaves them found", async () => {
    const kept = await makeModel();
    const other = await makeModel();
    const image = await addPreviewImage(other.id, ONE_PIXEL_PNG);
    const picture = assetTarget(other.assetsPath, galleryImageFile(image!.id));
    const copy = assetTarget(kept.assetsPath, galleryImageFile(image!.id));
    const seen: boolean[] = [];
    stage.inTransaction = () => seen.push(fs.existsSync(picture), fs.existsSync(copy));

    expect((await merge(kept.id, [other.id])).status).toBe(200);

    expect(seen).toEqual([true, true]);
    expect(fs.existsSync(picture)).toBe(false);
    expect(fs.existsSync(copy)).toBe(true);
    expect(fs.readFileSync(copy).length).toBeGreaterThan(0);
  });

  it.each([
    ["a file on a merged model", (other: Model) => addLatePlate(other.id)],
    ["a picture on a merged model", (other: Model) => addPreviewImage(other.id, ONE_PIXEL_PNG)],
    [
      "a description image on a merged model",
      (other: Model) => prisma.descriptionImage.create({ data: { printId: other.id, mime: "image/png", size: 1 } }),
    ],
  ])("refuses to delete %s added after it read them, and goes through once asked again", async (_what, add) => {
    const kept = await makeModel();
    const other = await makeModel();
    stage.afterRead = async () => {
      stage.afterRead = null;
      await add(other);
    };

    expect((await merge(kept.id, [other.id])).status).toBe(409);
    expect(await prisma.print.count({ where: { id: other.id } })).toBe(1);

    expect((await merge(kept.id, [other.id])).status).toBe(200);
    expect(await prisma.print.count({ where: { id: other.id } })).toBe(0);
  });

  it("counts what changed after it read them, rather than overwriting it", async () => {
    const kept = await makeModel({ tags: ["own"], notes: "Mine." });
    const other = await makeModel();
    const favoritedAt = new Date("2026-02-03T00:00:00Z");
    stage.afterRead = async () => {
      stage.afterRead = null;
      await prisma.print.update({
        where: { id: other.id },
        data: { viewCount: 5, printCount: 2, favoritedAt, tags: ["late"], notes: "Late." },
      });
      await prisma.print.update({ where: { id: kept.id }, data: { viewCount: 1, tags: ["own", "edited"] } });
    };

    expect((await merge(kept.id, [other.id])).status).toBe(200);

    const after = await prisma.print.findUniqueOrThrow({ where: { id: kept.id } });
    expect(after.viewCount).toBe(6);
    expect(after.printCount).toBe(2);
    expect(after.favoritedAt).toEqual(favoritedAt);
    expect(after.tags.toSorted()).toEqual(["Edited", "Late", "Own"]);
    expect(after.notes).toContain("Late.");
  });

  it("keeps a rename made after it read them, and does without a file deleted since", async () => {
    const kept = await makeModel({ files: ["kept.stl"] });
    const other = await makeModel({ files: ["part.stl", "gone.stl"] });
    stage.afterRead = async () => {
      stage.afterRead = null;
      await prisma.plate.update({ where: { id: other.plates[0].id }, data: { filename: "renamed.stl" } });
      await prisma.plate.update({ where: { id: kept.plates[0].id }, data: { filename: "renamed.stl" } });
      await prisma.plate.delete({ where: { id: other.plates[1].id } });
    };

    expect((await merge(kept.id, [other.id])).status).toBe(200);

    const plates = await prisma.plate.findMany({ where: { printId: kept.id }, orderBy: { position: "asc" } });
    expect(plates.map((plate) => plate.filename)).toEqual(["renamed.stl", "renamed (2).stl"]);
  });

  it("waits for a rename under way rather than overwriting it", async () => {
    const kept = await makeModel();
    const other = await makeModel({ files: ["part.stl"] });
    let release = () => {};
    const released = new Promise<void>((resolve) => (release = resolve));
    let holding = () => {};
    const held = new Promise<void>((resolve) => (holding = resolve));
    const renaming = prisma.$transaction(async (tx) => {
      await tx.plate.update({ where: { id: other.plates[0].id }, data: { filename: "renamed.stl" } });
      holding();
      await released;
    });
    await held;
    const merging = merge(kept.id, [other.id]).then((res) => res);
    await new Promise((resolve) => setTimeout(resolve, 300));

    release();
    await renaming;

    expect((await merging).status).toBe(200);
    expect((await prisma.plate.findUniqueOrThrow({ where: { id: other.plates[0].id } })).filename).toBe("renamed.stl");
  });

  it("refuses a model linked to a site after it read them, and leaves it", async () => {
    const kept = await makeModel();
    const other = await makeModel();
    stage.afterRead = async () => {
      stage.afterRead = null;
      await prisma.print.update({
        where: { id: other.id },
        data: { sourceProvider: "makerworld", sourceExternalId: `linked-${stamp}` },
      });
    };
    expect((await merge(kept.id, [other.id])).status).toBe(409);
    expect(await prisma.print.count({ where: { id: other.id } })).toBe(1);
    expect(await prisma.plate.count({ where: { id: other.plates[0].id, printId: other.id } })).toBe(1);
  });

  it("refuses when the kept model's pictures moved after it chose where to copy to, and removes the copies", async () => {
    const kept = await makeModel();
    const other = await makeModel();
    const image = await addPreviewImage(other.id, ONE_PIXEL_PNG);
    const picture = assetTarget(other.assetsPath, galleryImageFile(image!.id));
    const copy = assetTarget(kept.assetsPath, galleryImageFile(image!.id));
    stage.afterRead = async () => {
      stage.afterRead = null;
      await prisma.print.update({ where: { id: kept.id }, data: { assetsPath: `moved-${stamp}/${kept.id}` } });
    };

    expect((await merge(kept.id, [other.id])).status).toBe(409);

    expect(fs.existsSync(picture)).toBe(true);
    expect(fs.existsSync(copy)).toBe(false);
    expect(await prisma.previewImage.count({ where: { id: image!.id, printId: other.id } })).toBe(1);
  });

  it("takes along a picture that arrived while its pictures were waiting to move", async () => {
    const category = await makeCategory("category");
    const model = await makeModel({ files: [] });
    let release = () => {};
    const released = new Promise<void>((resolve) => (release = resolve));
    // As a merge copying into this folder holds it.
    const holding = withStorageLock(() => released);
    const assigning = assign([model.id], category.id).then((res) => res);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const image = await addPreviewImage(model.id, ONE_PIXEL_PNG);

    release();
    await holding;

    expect((await assigning).status).toBe(200);
    const { assetsPath } = await prisma.print.findUniqueOrThrow({ where: { id: model.id } });
    expect(assetsPath).not.toBe(model.assetsPath);
    expect(fs.existsSync(assetTarget(assetsPath!, galleryImageFile(image!.id)))).toBe(true);
  });

  it("leaves every file where its record finds it when two moves of one model overlap", async () => {
    const [first, second] = [await makeCategory("category"), await makeCategory("category")];
    const model = await makeModel();
    const image = await addPreviewImage(model.id, ONE_PIXEL_PNG);
    const storagePath = `merge-${stamp}-${modelNumber++}/notes.pdf`;
    fs.mkdirSync(path.dirname(stored(storagePath)), { recursive: true });
    fs.writeFileSync(stored(storagePath), "notes");
    await prisma.printFile.create({
      data: { printId: model.id, role: "SUPPORTING", filename: "notes.pdf", mime: "application/pdf", storagePath },
    });
    const read = await prisma.print.findUniqueOrThrow({ where: { id: model.id }, include: { plates: true } });
    let release = () => {};
    const released = new Promise<void>((resolve) => (release = resolve));
    const holding = withStorageLock(() => released);
    // Both read the model before either has moved anything, and both wait their turn at the lock.
    const moves = [first, second].map((category) => relocatePrint({ ...read, categoryId: category.id }, read.plates));
    await new Promise((resolve) => setTimeout(resolve, 300));

    release();
    await holding;
    await Promise.all(moves);

    const after = await prisma.print.findUniqueOrThrow({
      where: { id: model.id },
      include: { plates: true, files: true },
    });
    expect(fs.existsSync(stored(after.plates[0].storagePath))).toBe(true);
    expect(fs.existsSync(stored(after.files[0].storagePath))).toBe(true);
    expect(fs.existsSync(assetTarget(after.assetsPath!, galleryImageFile(image!.id)))).toBe(true);
  });

  it("refuses a file added to the kept model after it read them", async () => {
    const kept = await makeModel();
    const other = await makeModel();
    stage.afterRead = async () => {
      stage.afterRead = null;
      await addLatePlate(kept.id);
    };
    expect((await merge(kept.id, [other.id])).status).toBe(409);
    expect(await prisma.print.count({ where: { id: other.id } })).toBe(1);
  });

  it("makes what's added during its transaction wait and fail, rather than be deleted having succeeded", async () => {
    const kept = await makeModel();
    const other = await makeModel();
    const picture = await addPreviewImage(other.id, ONE_PIXEL_PNG);
    // Holding one of its pictures parks the merge at its first write of one, for as long as this takes.
    let release = () => {};
    const released = new Promise<void>((resolve) => (release = resolve));
    let holding = () => {};
    const held = new Promise<void>((resolve) => (holding = resolve));
    const holder = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "PreviewImage" WHERE id = ${picture!.id} FOR UPDATE`;
      holding();
      await released;
    });
    await held;
    const reached = new Promise<void>((resolve) => (stage.movingPlates = resolve));
    const merging = merge(kept.id, [other.id]).then((res) => res);
    await reached;

    const late = addLatePlate(other.id);
    const lateSoFar = await Promise.race([
      late.then(
        () => "added",
        () => "refused",
      ),
      new Promise((resolve) => setTimeout(() => resolve("waiting"), 300)),
    ]);
    release();
    await holder;

    expect(lateSoFar).toBe("waiting");
    expect((await merging).status).toBe(200);
    await expect(late).rejects.toMatchObject({ code: "P2003" });
    expect(await prisma.plate.count({ where: { filename: "late.stl", printId: { in: [kept.id, other.id] } } })).toBe(0);
  });

  it("answers a merge that went through even if it can't read the model back, and logs it", async () => {
    const kept = await makeModel();
    const other = await makeModel();
    stage.readBackFails = true;

    const res = await merge(kept.id, [other.id]);

    expect(res.status).toBe(200);
    expect(res.body.print).toBeNull();
    expect(res.body.merged_ids).toEqual([other.id]);
    expect(await prisma.print.count({ where: { id: other.id } })).toBe(0);
    await vi.waitFor(async () =>
      expect(await prisma.log.count({ where: { action: "models_merged", targetId: kept.id } })).toBe(1),
    );
  });

  it("stands when the files can't then be moved where the storage structure puts them", async () => {
    const category = await makeCategory("category");
    const kept = await makeModel({ categoryId: category.id });
    const other = await makeModel();
    const file = other.plates[0].storagePath;
    stage.relocationFails = true;

    const res = await merge(kept.id, [other.id]);

    expect(res.status).toBe(200);
    expect(res.body.print.plates).toHaveLength(2);
    const moved = await prisma.plate.findUniqueOrThrow({ where: { id: other.plates[0].id } });
    expect(moved.printId).toBe(kept.id);
    expect(moved.storagePath).toBe(file);
    expect(fs.existsSync(stored(file))).toBe(true);
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
    const tool = await prisma.tool.create({
      data: { source: "own", scope: userId, slug: `assign-${stamp}`, userId, manifest: {}, script: "", sha: "x" },
    });
    const toolOwned = await makeModel();
    await prisma.print.update({ where: { id: toolOwned.id }, data: { toolId: tool.id } });
    const res = await assign([upload.id, imported.id, toolOwned.id, "no-such-model"], category.id);
    expect(res.body.prints.map((print: { id: string }) => print.id)).toEqual([upload.id]);
    expect(res.body.skipped).toBe(3);
    expect((await prisma.print.findUniqueOrThrow({ where: { id: imported.id } })).categoryId).toBeNull();
    expect((await prisma.print.findUniqueOrThrow({ where: { id: toolOwned.id } })).categoryId).toBeNull();
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

  it("renames a model whose name was taken after the check, rather than failing it", async () => {
    const category = await makeCategory("category");
    const name = `Raced name ${stamp}`;
    await makeModel({ name, categoryId: category.id });
    const incoming = await makeModel({ name });
    stage.staleName = name;
    const res = await assign([incoming.id], category.id);
    expect(res.body.failed).toBe(0);
    expect(res.body.prints[0].name).toBe(`${name} (2)`);
  });

  it("reports a model as assigned when only its files couldn't follow, as they still work where they are", async () => {
    const category = await makeCategory("category");
    const model = await makeModel();
    const file = model.plates[0].storagePath;
    stage.relocationFails = true;

    const res = await assign([model.id], category.id);

    expect(res.body.failed).toBe(0);
    expect(res.body.prints.map((print: { id: string }) => print.id)).toEqual([model.id]);
    expect(res.body.prints[0].category_id).toBe(category.id);
    const plate = await prisma.plate.findUniqueOrThrow({ where: { id: model.plates[0].id } });
    expect(plate.storagePath).toBe(file);
    expect(fs.existsSync(stored(file))).toBe(true);
  });

  it("logs the change even if it can't read the models back, and asking again answers them", async () => {
    const category = await makeCategory("category");
    const model = await makeModel();
    stage.readBackFails = true;

    expect((await assign([model.id], category.id)).status).toBe(500);

    expect((await prisma.print.findUniqueOrThrow({ where: { id: model.id } })).categoryId).toBe(category.id);
    await vi.waitFor(async () =>
      expect(await prisma.log.count({ where: { action: "model_edited", targetId: model.id } })).toBe(1),
    );

    stage.readBackFails = false;
    const again = await assign([model.id], category.id);
    expect(again.status).toBe(200);
    expect(again.body.failed).toBe(0);
    expect(again.body.prints[0].id).toBe(model.id);
    expect(again.body.prints[0].category_id).toBe(category.id);
    expect(again.body.prints[0].name).toBe(model.name);
  });

  it("refuses a folder as the category", async () => {
    const folder = await makeCategory("folder");
    const model = await makeModel();
    expect((await assign([model.id], folder.id)).status).toBe(400);
    expect((await prisma.print.findUniqueOrThrow({ where: { id: model.id } })).categoryId).toBeNull();
  });
});
