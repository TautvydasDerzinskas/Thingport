import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { STORAGE } from "../src/config";
import { prisma } from "../src/db";
import { getThingiverseAccessToken, setThingiverseAccessToken } from "../src/providers/thingiverse/token";
import { replaceModelFiles, type DownloadedModelFiles } from "../src/services/importService";
import { scanMissingFiles } from "../src/services/missingFilesService";
import { currentModelRepairRun, modelRepairRunSettled } from "../src/services/modelRepairService";
import { removeMissingPrintFiles } from "../src/services/printFileService";
import { withStorageLock } from "../src/utils/storageLock";
import { checkLibraryInvariants, faults, useStorageKit, type KitUser } from "./harness";
import { contentOf } from "./intake/files";
import { installFetch } from "./providers/support";

// A site's address, should a repair ask for one: nothing here may reach the network.
vi.mock("node:dns/promises", () => ({
  default: {
    resolve4: async () => ["93.184.216.34"],
    resolve6: async () => {
      throw new Error("no AAAA");
    },
  },
}));

// A repair swaps a model's plates for the ones its site gives again and keeps the rest of the model: its other files
// still on disk keep their rows, the prepared print its place, LICENSE.txt is written again, and the photos stay. A disk
// that can't answer for a file stops it before anything is removed (docs/STORAGE_DEVELOPMENT.md, Fs 1).

const app = createApp();
const kit = useStorageKit(app);
const at = (relative: string) => path.join(STORAGE, relative);
const libraryOf = (owner: KitUser) => checkLibraryInvariants({ userIds: [owner.id] });

/** The accident: the files go, the rows stay. */
function lose(...rows: { storagePath: string }[]) {
  for (const row of rows) fs.rmSync(at(row.storagePath), { force: true });
}

/** What a site's download gives a repair: these files, in temp files, and the pictures it would bring. */
async function download(
  names: string[],
  pictures: Partial<Pick<DownloadedModelFiles, "coverImageUrl" | "galleryImages">> = {},
): Promise<DownloadedModelFiles> {
  const seed = kit.nonce();
  const inputs = [];
  for (const name of names) {
    const tempFilePath = path.join(kit.tempStorage(), `download-${kit.nonce()}`);
    fs.writeFileSync(tempFilePath, await contentOf(name, seed));
    inputs.push({ filename: name, tempFilePath });
  }
  return { inputs, coverImageUrl: null, galleryImages: [], profiles: {}, ...pictures };
}

/** Every file under `dir`, by path from it, with its bytes. */
function filesUnder(dir: string): [string, Buffer][] {
  if (!fs.existsSync(dir)) return [];
  return (fs.readdirSync(dir, { recursive: true, withFileTypes: true }) as fs.Dirent[])
    .filter((entry) => !entry.isDirectory())
    .map((entry): [string, Buffer] => {
      const abs = path.join(entry.parentPath, entry.name);
      return [path.relative(dir, abs), fs.readFileSync(abs)];
    })
    .toSorted(([a], [b]) => a.localeCompare(b));
}

/** The model's rows and its owner's disk, to tell whether anything changed. */
async function stateOf(owner: KitUser, printId: string) {
  const print = await prisma.print.findUniqueOrThrow({
    where: { id: printId },
    include: {
      plates: { orderBy: { position: "asc" } },
      files: { orderBy: { id: "asc" } },
      previewImages: { orderBy: { position: "asc" } },
    },
  });
  return {
    plates: print.plates.map(({ id, storagePath, position, filename }) => ({ id, storagePath, position, filename })),
    files: print.files.map(({ id, storagePath, role, size }) => ({ id, storagePath, role, size })),
    preparedFileId: print.preparedFileId,
    preparedMetadata: print.preparedMetadata,
    photos: print.previewImages.map((image) => image.id),
    disk: filesUnder(path.join(STORAGE, `u-${owner.id}`)),
  };
}

describe("a repair keeps what it didn't lose", () => {
  it("keeps the files still on disk, drops those that went with the plates, and writes LICENSE.txt again", async () => {
    const owner = await kit.user();
    const model = await kit.model(owner, {
      supporting: ["notes.txt", "guide.pdf"],
      prepared: "ready.gcode",
      license: "CC-BY-4.0",
    });
    // The owner's notes and sliced print, which no source can give back, beside a guide whose file went too.
    const [note, guide, sliced, license] = model.files;
    lose(model.plates[0], guide, license);

    const replaced = await replaceModelFiles(owner.id, model.print.id, await download(["fetched.stl"]));

    expect(replaced?.plates.map((plate) => plate.filename)).toEqual(["fetched.stl"]);
    const files = await prisma.printFile.findMany({ where: { printId: model.print.id } });
    expect(files.map((file) => file.id)).toEqual(expect.arrayContaining([note.id, sliced.id]));
    expect(files.some((file) => file.id === guide.id)).toBe(false);
    for (const kept of [note, sliced]) expect(fs.readFileSync(at(kept.storagePath))).toEqual(kept.bytes);
    expect(replaced?.print.preparedFileId).toBe(sliced.id);
    const licenses = files.filter((file) => file.role === "LICENSE");
    expect(licenses).toHaveLength(1);
    expect(fs.readFileSync(at(licenses[0].storagePath))).toEqual(license.bytes);
    expect(await libraryOf(owner)).toEqual([]);
  });

  it("drops a prepared print whose file went too, and empties its place", async () => {
    const owner = await kit.user();
    const model = await kit.model(owner, { supporting: ["notes.txt"], prepared: "ready.gcode" });
    const [note, sliced] = model.files;
    lose(model.plates[0], sliced);

    const replaced = await replaceModelFiles(owner.id, model.print.id, await download(["fetched.stl"]));

    expect(replaced?.print.preparedFileId).toBeNull();
    expect(await prisma.printFile.findUnique({ where: { id: sliced.id } })).toBeNull();
    expect(await prisma.printFile.findUnique({ where: { id: note.id } })).not.toBeNull();
    expect(await libraryOf(owner)).toEqual([]);
  });

  it("keeps a LICENSE.txt still on disk, row and all", async () => {
    const owner = await kit.user();
    const model = await kit.model(owner, { license: "CC-BY-4.0" });
    const [license] = model.files;
    lose(model.plates[0]);

    await replaceModelFiles(owner.id, model.print.id, await download(["fetched.stl"]));

    const licenses = await prisma.printFile.findMany({ where: { printId: model.print.id, role: "LICENSE" } });
    expect(licenses.map((file) => file.id)).toEqual([license.id]);
    expect(fs.readFileSync(at(license.storagePath))).toEqual(license.bytes);
  });

  it("brings back a script whose file went, and doesn't store one it still has twice", async () => {
    const owner = await kit.user();
    const model = await kit.model(owner, { supporting: ["shape.scad", "other.scad"] });
    const [shape, other] = model.files;
    lose(model.plates[0], other);

    await replaceModelFiles(owner.id, model.print.id, await download(["fetched.stl", "shape.scad", "other.scad"]));

    const files = await prisma.printFile.findMany({ where: { printId: model.print.id }, orderBy: { filename: "asc" } });
    expect(files.map((file) => file.filename)).toEqual(["other.scad", "shape.scad"]);
    // The one still there is the owner's, as it was; the one that went is the source's again.
    expect(files[1].id).toBe(shape.id);
    expect(fs.readFileSync(at(files[1].storagePath))).toEqual(shape.bytes);
    expect(files[0].id).not.toBe(other.id);
    expect(await libraryOf(owner)).toEqual([]);
  });

  it("counts a file behind a file, a path out of storage and a folder at a file's path as gone, and leaves the folder", async () => {
    const owner = await kit.user();
    const model = await kit.model(owner, {
      supporting: [{ name: "notes.txt", folder: "Docs" }, "guide.pdf", "extra.txt"],
    });
    const [note, guide, extra] = model.files;
    lose(model.plates[0], guide, extra);
    // The note's folder is a file now, so looking for the note answers ENOTDIR.
    const docs = path.dirname(at(note.storagePath));
    fs.rmSync(docs, { recursive: true });
    fs.writeFileSync(docs, kit.distinctBytes());
    fs.mkdirSync(at(guide.storagePath));
    await prisma.printFile.update({ where: { id: extra.id }, data: { storagePath: `../outside-${kit.nonce()}.txt` } });

    await replaceModelFiles(owner.id, model.print.id, await download(["fetched.stl"]));

    const left = await prisma.printFile.findMany({ where: { printId: model.print.id } });
    expect(left).toEqual([]);
    expect(fs.statSync(at(guide.storagePath)).isDirectory()).toBe(true);
  });

  it("leaves a file still being saved, which has no place yet to look at", async () => {
    const owner = await kit.user();
    const model = await kit.model(owner, { supporting: ["notes.txt"] });
    lose(model.plates[0]);
    const saving = await prisma.printFile.create({
      data: {
        printId: model.print.id,
        filename: "late.txt",
        mime: "text/plain",
        role: "SUPPORTING",
        storagePath: "pending",
      },
    });
    try {
      await replaceModelFiles(owner.id, model.print.id, await download(["fetched.stl"]));

      expect(await prisma.printFile.findUnique({ where: { id: saving.id } })).not.toBeNull();
      // The note was looked at before the swap and again in the sweep; the placeholder never.
      expect([kit.hits("fileState:repair.look"), kit.hits("fileState:repair.sweep")]).toEqual([1, 1]);
    } finally {
      // One placeholder for every model: left there, it would stop every other suite's saves.
      await prisma.printFile.deleteMany({ where: { id: saving.id } });
    }
  });

  it("looks at all of the model's files in one turn of the storage lock, so a move waits for the whole look", async () => {
    const owner = await kit.user();
    const model = await kit.model(owner, { supporting: ["guide.pdf", "notes.txt"] });
    lose(model.plates[0]);
    const look = kit.pauseAt("fileState:repair.look");
    const repair = kit.start(async () => replaceModelFiles(owner.id, model.print.id, await download(["fetched.stl"])));
    await look.reachedBy(repair);

    // Asked for while the look is at the first file: a move's turn comes once the look has seen both.
    const move = kit.start(() => withStorageLock(async () => kit.hits("fileState:repair.look")));
    look.release();

    expect(await move).toBe(2);
    expect(await repair).not.toBeNull();
  });

  it("leaves a file a move is carrying, rather than taking it for gone", async () => {
    const owner = await kit.user();
    const model = await kit.model(owner, { supporting: ["notes.txt"] });
    const [note] = model.files;
    const movedTo = path.join(path.dirname(note.storagePath), "moved notes.txt");
    const look = kit.pauseAt("fileState:repair.sweep");
    const sweep = kit.start(() => removeMissingPrintFiles(model.print.id));
    await look.reachedBy(sweep);

    // The sweep has read the rows and is about to look at the note when a move starts, as a rename of the model makes
    // one under the storage lock: the file goes first, its row after. The sweep's turn of the lock holds it back.
    const move = kit.start(() =>
      withStorageLock(async () => {
        fs.renameSync(at(note.storagePath), at(movedTo));
        await prisma.printFile.update({ where: { id: note.id }, data: { storagePath: movedTo } });
      }),
    );
    look.release();
    await Promise.all([sweep, move]);

    const row = await prisma.printFile.findUnique({ where: { id: note.id } });
    expect(row?.storagePath).toBe(movedTo);
    expect(kit.hits("fileState:repair.sweep")).toBe(1);
    expect(await libraryOf(owner)).toEqual([]);
  });
});

describe("a disk that can't answer", () => {
  it.each(["EIO", "EACCES"] as const)(
    "leaves the model as it was found when a look at one of its files answers %s",
    async (code) => {
      const owner = await kit.user();
      const model = await kit.model(owner, {
        plates: ["Benchy.gcode.3mf", "Lid.stl"],
        supporting: ["Guide.pdf", "notes.txt"],
        prepared: "ready.gcode",
        license: "CC-BY-4.0",
        gallery: 1,
      });
      lose(...model.plates);
      const before = await stateOf(owner, model.print.id);
      // Plate 0's reading is one of the things to keep.
      expect(before.preparedMetadata).not.toBeNull();
      faults.at("fileState:repair.look", 1, code, { path: at(model.files[0].storagePath) });

      await expect(replaceModelFiles(owner.id, model.print.id, await download(["fetched.stl"]))).rejects.toMatchObject({
        code,
      });

      expect(await stateOf(owner, model.print.id)).toEqual(before);
      // Still broken, so still offered.
      expect((await scanMissingFiles(owner.id)).broken.map((broken) => broken.id)).toEqual([model.print.id]);
      expect((await libraryOf(owner)).map(({ rule, path: where }) => [rule, where])).toEqual(
        model.plates.map((plate) => ["file-missing", at(plate.storagePath)]),
      );
    },
  );

  it("finishes the repair when its sweep can't look at a file, and drops no row", async () => {
    const owner = await kit.user();
    const model = await kit.model(owner, { supporting: ["notes.txt", "guide.pdf"], license: "CC-BY-4.0" });
    const [note, guide, license] = model.files;
    lose(model.plates[0], guide, license);
    faults.at("fileState:repair.sweep", 1, "EIO", { path: at(note.storagePath) });

    const replaced = await replaceModelFiles(
      owner.id,
      model.print.id,
      await download(["Benchy.gcode.3mf", "shape.scad"]),
    );

    // The plates are in, so the scan won't offer the model again: what comes after the sweep ran all the same.
    expect(replaced?.plates.map((plate) => plate.filename)).toEqual(["Benchy.gcode.3mf"]);
    expect(replaced?.print.preparedMetadata).not.toBeNull();
    const files = await prisma.printFile.findMany({ where: { printId: model.print.id } });
    expect(files.map((file) => file.filename)).toContain("shape.scad");
    expect(fs.readFileSync(at(license.storagePath))).toEqual(license.bytes);
    // And no row went, the guide's included: the sweep stopped at the note.
    expect(files.map((file) => file.id)).toEqual(expect.arrayContaining([note.id, guide.id, license.id]));
  });

  it("keeps every photo when a look at one of them fails", async () => {
    const owner = await kit.user();
    const model = await kit.model(owner, { gallery: 2 });
    const [gone, unreadable] = model.previewImages;
    const photoOf = (id: string) => at(path.join(model.print.assetsPath!, `${id}.jpg`));
    lose(model.plates[0]);
    // One photo went with the plates; the disk can't answer for the other, which may be the owner's and fine.
    fs.rmSync(photoOf(gone.id));
    faults.at("fileState:repair.gallery", 1, "EIO", { path: photoOf(unreadable.id) });
    const site = installFetch(() => undefined);
    try {
      await replaceModelFiles(
        owner.id,
        model.print.id,
        await download(["fetched.stl"], {
          coverImageUrl: "https://cdn.example.com/cover.jpg",
          galleryImages: [{ url: "https://cdn.example.com/one.jpg", filename: "one.jpg" }],
        }),
      );
    } finally {
      site.restore();
    }

    const photos = await prisma.previewImage.findMany({ where: { printId: model.print.id } });
    expect(photos.map((photo) => photo.id).toSorted()).toEqual([gone.id, unreadable.id].toSorted());
    expect(fs.readFileSync(photoOf(unreadable.id)).length).toBeGreaterThan(0);
    // The site wasn't asked for its pictures.
    expect(site.calls).toEqual([]);
  });

  it("fails a model before a download is spent on it when a look at one of its files fails", async () => {
    const owner = await kit.user();
    const model = await kit.model(owner, { supporting: ["notes.txt"] });
    // From a site the server downloads from itself, which counts the downloads.
    await prisma.print.update({
      where: { id: model.print.id },
      data: { sourceProvider: "thingiverse", sourceExternalId: "9300001" },
    });
    lose(model.plates[0]);
    const before = await stateOf(owner, model.print.id);
    faults.at("fileState:repair.look", 1, "EIO", { path: at(model.files[0].storagePath) });
    const token = await getThingiverseAccessToken();
    await setThingiverseAccessToken("kit-token");
    const site = installFetch(() => undefined);
    try {
      const started = await request(app).post("/api/prints/repair").set(owner.auth).send({ action: "reimport" });
      expect(started.status).toBe(200);
      await modelRepairRunSettled(owner.id);
    } finally {
      site.restore();
      await setThingiverseAccessToken(token);
    }

    expect(currentModelRepairRun(owner.id)).toMatchObject({ failed: 1, repaired: 0 });
    expect(currentModelRepairRun(owner.id)?.lastError).toMatch(/EIO/);
    expect(site.calls).toEqual([]);
    expect(await stateOf(owner, model.print.id)).toEqual(before);
  });
});
