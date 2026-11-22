import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { STORAGE } from "../../src/config";
import { prisma } from "../../src/db";
import { createPrint } from "../../src/services/printCreation";
import { getPreviewMode, setPreviewMode, type PreviewMode } from "../../src/services/settingsService";
import type { StorageListing } from "../../src/services/storageBrowserService";
import { faults, hits } from "../harness/lifecycle";
import { nonce, register, tempFile, upload } from "../helpers/fileReuse";

// The storage browser looks at each file of the folder it lists through the file door (site browser.location): a look
// that fails shows the file as unreadable, with the error's code, and only a file that's gone, or a folder at its path,
// as missing. A pictures folder the disk can't list is listed as unreadable rather than left out, and a tool's plate is
// looked at where its file is, never at the path it was given.

const app = createApp();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thingport-door-browser-"));
const toolFolder = path.join(STORAGE, "tools", `door-browser-${nonce()}`);
let admin: { id: string; token: string };
let previousPreviews: PreviewMode;

const stored = (relative: string) => path.join(STORAGE, relative);
const LOOK = "fileState:browser.location";

async function browse(folder: string): Promise<StorageListing> {
  const res = await request(app)
    .get("/api/admin/storage/browse")
    .query({ path: folder.split(path.sep).join("/") })
    .set({ Authorization: `Bearer ${admin.token}` });
  expect(res.status).toBe(200);
  return res.body;
}

const fileNamed = (listing: StorageListing, name: string) => listing.files.find((file) => file.name === name);

/** A model of the admin's with a plate and a supporting file beside it, in a folder of its own, and its pictures
 *  folder (chosen with it, though nothing is in it yet). */
async function model() {
  const { print, plates } = await createPrint(
    admin.id,
    { title: `Browsed ${nonce()}` },
    "Browsed",
    [{ filename: "part.stl", tempFilePath: tempFile(dir, `solid ${nonce()}\nendsolid\n`) }],
    { describe: false, classify: false },
  );
  const file = await upload(dir, admin.id, print.id, "notes.txt", `notes ${nonce()}`);
  const folder = path.dirname(plates[0].storagePath);
  expect(path.dirname(file.storagePath)).toBe(folder);
  const { assetsPath } = await prisma.print.findUniqueOrThrow({ where: { id: print.id } });
  return { plate: plates[0], file, folder, pictures: assetsPath! };
}

beforeAll(async () => {
  // Nothing here waits for a preview, so none is made behind a test's back.
  previousPreviews = await getPreviewMode();
  await setPreviewMode("disabled");
  admin = await register(app, "door-browser", "Admin");
  await prisma.user.update({ where: { id: admin.id }, data: { role: "ADMIN" } });
});

afterAll(async () => {
  await setPreviewMode(previousPreviews);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(toolFolder, { recursive: true, force: true });
});

describe("the storage browser's look at a file", () => {
  it("shows a file whose look fails as unreadable with the error's code, and as missing only once it's gone", async () => {
    const { plate, file, folder } = await model();
    faults.at(LOOK, 1, "EIO", { path: stored(plate.storagePath) });
    faults.at(LOOK, 1, "EACCES", { path: stored(file.storagePath) });
    const failing = await browse(folder);
    expect(fileNamed(failing, "part.stl")).toMatchObject({ location: "unreadable", error_code: "EIO" });
    expect(fileNamed(failing, "notes.txt")).toMatchObject({ location: "unreadable", error_code: "EACCES" });

    const answered = await browse(folder);
    expect(fileNamed(answered, "part.stl")).toMatchObject({ location: "managed", error_code: null });
    expect(fileNamed(answered, "notes.txt")).toMatchObject({ location: "managed", error_code: null });

    fs.rmSync(stored(plate.storagePath));
    fs.rmSync(stored(file.storagePath));
    const gone = await browse(folder);
    expect(fileNamed(gone, "part.stl")).toMatchObject({ location: "missing", error_code: null });
    expect(fileNamed(gone, "notes.txt")).toMatchObject({ location: "missing", error_code: null });

    // Only the files of the folder being looked at are looked at: the one above holds none of its own.
    const looked = hits(LOOK);
    await browse(path.dirname(folder));
    expect(hits(LOOK)).toBe(looked);
  });

  it("shows a folder at a row's path as missing, not as its file", async () => {
    const { plate, file, folder } = await model();
    for (const row of [plate, file]) {
      fs.rmSync(stored(row.storagePath));
      fs.mkdirSync(stored(row.storagePath));
    }
    const listing = await browse(folder);
    expect(fileNamed(listing, "part.stl")).toMatchObject({ location: "missing", error_code: null });
    expect(fileNamed(listing, "notes.txt")).toMatchObject({ location: "missing", error_code: null });
  });
});

describe("a tool's plate in the storage browser", () => {
  it("is looked at where its file is, never at the path it was given", async () => {
    const source = path.join(toolFolder, "files", "bracket.stl");
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(source, `solid ${nonce()}\nendsolid\n`);
    const { plates } = await createPrint(
      admin.id,
      { title: `Tool ${nonce()}` },
      "Tool",
      [{ filename: "bracket.stl", sourcePath: source }],
      { describe: false, classify: false },
    );
    const plate = plates[0];
    const folder = path.dirname(plate.storagePath);
    expect(fileNamed(await browse(folder), "bracket.stl")).toMatchObject({ location: "source", error_code: null });

    // A file at the path it was given isn't its file: with its own look failing it's unreadable, with its own gone
    // it's missing, whatever is there. One look each time, at its source.
    fs.writeFileSync(stored(plate.storagePath), "someone else's bytes");
    faults.at(LOOK, 1, "EIO", { path: source });
    const looked = hits(LOOK);
    expect(fileNamed(await browse(folder), "bracket.stl")).toMatchObject({ location: "unreadable", error_code: "EIO" });
    expect(hits(LOOK)).toBe(looked + 1);
    fs.rmSync(source);
    expect(fileNamed(await browse(folder), "bracket.stl")).toMatchObject({ location: "missing", error_code: null });
  });
});

describe("a pictures folder the disk can't list", () => {
  // Root lists any folder, so the disk's refusal can't be made there.
  const asRoot = process.getuid?.() === 0;

  // The listing is read with readdir, which the file door doesn't take yet, so the disk refuses it for real here.
  it.skipIf(asRoot)("is listed as unreadable with the error's code, rather than left out", async () => {
    const { folder, pictures } = await model();
    expect(path.dirname(pictures)).toBe(folder);
    const home = stored(pictures);
    // A model with no pictures yet has no pictures folder, and none is shown.
    expect((await browse(folder)).folders).toEqual([]);

    const thumbnails = path.join(home, "Thumbnails");
    fs.mkdirSync(thumbnails, { recursive: true });
    fs.writeFileSync(path.join(thumbnails, "thumb.jpg"), "picture");
    fs.chmodSync(thumbnails, 0o000);
    try {
      expect((await browse(pictures)).folders).toEqual([
        expect.objectContaining({ name: "Thumbnails", files: 0, error_code: "EACCES" }),
      ]);
      // Asked for itself, it says the disk couldn't read it, not that it isn't there.
      const itself = await request(app)
        .get("/api/admin/storage/browse")
        .query({ path: path.join(pictures, "Thumbnails").split(path.sep).join("/") })
        .set({ Authorization: `Bearer ${admin.token}` });
      expect([itself.status, itself.body.code]).toEqual([500, "folder_unreadable"]);
      // The folder above it could be listed: it's shown, though nothing else is in it, and without an error.
      expect((await browse(folder)).folders).toEqual([
        expect.objectContaining({ name: path.basename(pictures), pictures: true, error_code: null }),
      ]);

      fs.chmodSync(home, 0o000);
      expect((await browse(folder)).folders).toEqual([
        expect.objectContaining({ name: path.basename(pictures), pictures: true, files: 0, error_code: "EACCES" }),
      ]);
    } finally {
      fs.chmodSync(home, 0o755);
      fs.chmodSync(thumbnails, 0o755);
    }
    // Listed again, it's the folder it was.
    expect((await browse(pictures)).folders).toEqual([
      expect.objectContaining({ name: "Thumbnails", files: 1, error_code: null }),
    ]);
  });
});
