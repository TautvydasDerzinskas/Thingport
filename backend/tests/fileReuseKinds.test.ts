import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/app";
import { makePrint, nonce, register, sha, tempFile, uniqueBytes, uniqueImage, upload } from "./helpers/fileReuse";
import { createPrint } from "../src/services/printCreation";
import { managedPlatePath } from "../src/services/printService";
import { deleteSupportingFile, managedPrintFilePath } from "../src/services/printFileService";
import { addPreviewImage, deleteAllPreviewImages, previewImagePath } from "../src/services/previewImageService";
import {
  descriptionImagePath,
  pruneDescriptionImages,
  saveDescriptionImage,
} from "../src/services/descriptionImageService";
import { sha256OfFile } from "../src/services/fileReuse";
import { findStoredCopies } from "../src/services/storedContent";
import { setFileReuse } from "../src/services/settingsService";
import { prisma } from "../src/db";

// Supporting files and pictures are shared between users like plate files are (plateFileReuse.test.ts covers the
// plates): any kind of stored file with the same content is a clone source for any other kind. Each keeps its own row,
// hash and file, so nothing one user does to theirs reaches the other's.

const app = createApp();
let firstUserId: string;
let secondUserId: string;
let dir: string;
const { COPYFILE_EXCL, COPYFILE_FICLONE_FORCE } = fs.constants;
const realCopyFile = fsp.copyFile;

/** Every clone made, as {from, to}: `from` is the stored file it was cloned from, read off the /proc/self/fd link the
 *  clone is made through. The temp folder can't clone, so each is simulated with a plain exclusive copy, as a
 *  reflink-capable filesystem would make it. */
function watchClones() {
  const clones: { from: string; to: string }[] = [];
  vi.spyOn(fsp, "copyFile").mockImplementation(async (src, target, mode) => {
    if (mode === undefined || !(mode & COPYFILE_FICLONE_FORCE)) return realCopyFile(src, target, mode);
    const from = fs.readlinkSync(String(src));
    await realCopyFile(src, target, COPYFILE_EXCL);
    clones.push({ from, to: String(target) });
  });
  return clones;
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "reuse-kinds-"));
  firstUserId = (await register(app, "kinds", "first")).id;
  secondUserId = (await register(app, "kinds", "second")).id;
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma.setting.deleteMany({ where: { key: "file_reuse" } });
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("supporting files", () => {
  it("clones a stored supporting file for another user, recording both hashes", async () => {
    await setFileReuse("reflink");
    const clones = watchClones();
    const bytes = uniqueBytes();
    const [a, b] = [await makePrint(dir, firstUserId, "Kinds"), await makePrint(dir, secondUserId, "Kinds")];
    const first = await upload(dir, firstUserId, a.print.id, "guide.pdf", bytes);
    const second = await upload(dir, secondUserId, b.print.id, "guide.pdf", bytes);

    expect(first.contentSha256).toBe(sha(bytes));
    expect(second.contentSha256).toBe(sha(bytes));
    expect(second.size).toBe(bytes.length);
    const [firstPath, secondPath] = [managedPrintFilePath(first), managedPrintFilePath(second)];
    expect(clones.filter((c) => c.to === secondPath)).toEqual([{ from: firstPath, to: secondPath }]);
    expect(secondPath).not.toBe(firstPath);
    expect(fs.statSync(secondPath).ino).not.toBe(fs.statSync(firstPath).ino);
    expect(fs.readFileSync(secondPath).equals(bytes)).toBe(true);
    // Rows stay each user's own.
    expect(first.printId).toBe(a.print.id);
    expect(second.printId).toBe(b.print.id);
    expect(second.storagePath).not.toBe(first.storagePath);
  });

  it("clones from a stored plate file: the kinds look each other up", async () => {
    await setFileReuse("reflink");
    const clones = watchClones();
    const bytes = uniqueBytes();
    const owner = await createPrint(firstUserId, { title: `Plate ${nonce()}` }, "Plate", [
      { filename: "model.stl", tempFilePath: tempFile(dir, bytes) },
    ]);
    const plateFile = managedPlatePath(owner.plates[0]);
    expect(owner.plates[0].contentSha256).toBe(sha(bytes));

    const other = await makePrint(dir, secondUserId, "Kinds");
    const file = await upload(dir, secondUserId, other.print.id, "same-as-a-plate.stl", bytes);
    expect(clones.filter((c) => c.to === managedPrintFilePath(file))).toEqual([
      { from: plateFile, to: managedPrintFilePath(file) },
    ]);
    expect(fs.readFileSync(managedPrintFilePath(file)).equals(bytes)).toBe(true);
  });

  it("shares a prepared print file like any other, and the later plate can use it too", async () => {
    await setFileReuse("reflink");
    const clones = watchClones();
    const bytes = uniqueBytes();
    const [a, b] = [await makePrint(dir, firstUserId, "Kinds"), await makePrint(dir, secondUserId, "Kinds")];
    const first = await upload(dir, firstUserId, a.print.id, "ready.bgcode", bytes);
    const second = await upload(dir, secondUserId, b.print.id, "ready.bgcode", bytes);
    expect([first.role, second.role]).toEqual(["PREPARED", "PREPARED"]);
    expect(clones.map((c) => c.to)).toContain(managedPrintFilePath(second));

    // A plate imported afterwards finds the prepared file as its source.
    const third = await createPrint(secondUserId, { title: `Later ${nonce()}` }, "Later", [
      { filename: "later.stl", tempFilePath: tempFile(dir, bytes) },
    ]);
    expect(clones.some((c) => c.to === managedPlatePath(third.plates[0]))).toBe(true);
    expect(third.plates[0].contentSha256).toBe(sha(bytes));
  });

  it("records no hash and clones nothing while the switch is off", async () => {
    await setFileReuse("off");
    const clones = watchClones();
    const bytes = uniqueBytes();
    const [a, b] = [await makePrint(dir, firstUserId, "Kinds"), await makePrint(dir, secondUserId, "Kinds")];
    const first = await upload(dir, firstUserId, a.print.id, "off.pdf", bytes);
    const second = await upload(dir, secondUserId, b.print.id, "off.pdf", bytes);
    expect([first.contentSha256, second.contentSha256]).toEqual([null, null]);
    expect(clones).toEqual([]);
    expect(fs.readFileSync(managedPrintFilePath(second)).equals(bytes)).toBe(true);
  });

  it("hashes a file under a block but never shares it", async () => {
    await setFileReuse("reflink");
    const clones = watchClones();
    const bytes = Buffer.from(`tiny ${nonce()}`);
    const [a, b] = [await makePrint(dir, firstUserId, "Kinds"), await makePrint(dir, secondUserId, "Kinds")];
    const first = await upload(dir, firstUserId, a.print.id, "tiny.txt", bytes);
    const second = await upload(dir, secondUserId, b.print.id, "tiny.txt", bytes);
    expect(first.contentSha256).toBe(sha(bytes));
    expect(second.contentSha256).toBe(sha(bytes));
    expect(clones).toEqual([]);
  });

  it("never clones from a plate left where it was found, or one with another content than recorded", async () => {
    await setFileReuse("reflink");
    const clones = watchClones();
    const bytes = uniqueBytes();
    // A no-copy plate: its file isn't in managed storage, so isn't ours to share even with a hash on record.
    const left = path.join(dir, `left-${nonce()}.stl`);
    fs.writeFileSync(left, bytes);
    const owner = await createPrint(firstUserId, { title: `Left ${nonce()}` }, "Left", [
      { filename: "left.stl", sourcePath: left },
    ]);
    await prisma.plate.update({
      where: { id: owner.plates[0].id },
      data: { contentSha256: sha(bytes), size: bytes.length },
    });
    expect(await findStoredCopies({ contentSha256: sha(bytes), size: bytes.length })).toEqual([]);

    const other = await makePrint(dir, secondUserId, "Kinds");
    const file = await upload(dir, secondUserId, other.print.id, "left.stl", bytes);
    expect(clones).toEqual([]);
    expect(file.contentSha256).toBe(sha(bytes));
    expect(fs.readFileSync(left).equals(bytes)).toBe(true);
  });

  it("drops the hash of a stored copy edited on disk, and stores the new file as usual", async () => {
    await setFileReuse("reflink");
    const clones = watchClones();
    const bytes = uniqueBytes();
    const [a, b] = [await makePrint(dir, firstUserId, "Kinds"), await makePrint(dir, secondUserId, "Kinds")];
    const first = await upload(dir, firstUserId, a.print.id, "edited.pdf", bytes);
    // Same size, other bytes: only reading it tells.
    const edited = Buffer.from(bytes);
    edited[0] = edited[0] ^ 1;
    fs.writeFileSync(managedPrintFilePath(first), edited);

    const second = await upload(dir, secondUserId, b.print.id, "edited.pdf", bytes);
    // The clone was tried and read back, not kept: what's there is the new file, not the edited one.
    expect(clones.filter((c) => c.to === managedPrintFilePath(second))).toHaveLength(1);
    expect(fs.readFileSync(managedPrintFilePath(second)).equals(bytes)).toBe(true);
    expect((await prisma.printFile.findUnique({ where: { id: first.id } }))?.contentSha256).toBeNull();
    expect(second.contentSha256).toBe(sha(bytes));
  });

  it("keeps the files apart: an edit or a delete of one never reaches the other", async () => {
    await setFileReuse("reflink");
    watchClones();
    const bytes = uniqueBytes();
    const [a, b] = [await makePrint(dir, firstUserId, "Kinds"), await makePrint(dir, secondUserId, "Kinds")];
    const first = await upload(dir, firstUserId, a.print.id, "apart.pdf", bytes);
    const second = await upload(dir, secondUserId, b.print.id, "apart.pdf", bytes);

    fs.appendFileSync(managedPrintFilePath(first), "appended outside Thingport");
    expect(fs.readFileSync(managedPrintFilePath(second)).equals(bytes)).toBe(true);

    await deleteSupportingFile(firstUserId, a.print.id, first.id);
    expect(fs.existsSync(managedPrintFilePath(first))).toBe(false);
    expect(fs.readFileSync(managedPrintFilePath(second)).equals(bytes)).toBe(true);
    expect(await prisma.printFile.findUnique({ where: { id: second.id } })).toMatchObject({ printId: b.print.id });
  });
});

describe("gallery images", () => {
  it("clones the re-encoded picture for another user, recording its size and hash", async () => {
    await setFileReuse("reflink");
    const clones = watchClones();
    const download = await uniqueImage();
    const [a, b] = [await makePrint(dir, firstUserId, "Kinds"), await makePrint(dir, secondUserId, "Kinds")];
    const first = (await addPreviewImage(a.print.id, download))!;
    const second = (await addPreviewImage(b.print.id, download))!;

    const firstPath = previewImagePath(
      first.id,
      (await prisma.print.findUnique({ where: { id: a.print.id } }))!.assetsPath,
    );
    const secondPath = previewImagePath(
      second.id,
      (await prisma.print.findUnique({ where: { id: b.print.id } }))!.assetsPath,
    );
    const stored = fs.readFileSync(firstPath);
    // The hash is of what's on disk (sharp's output), not of the download.
    expect(first.contentSha256).toBe(sha(stored));
    expect(first.size).toBe(stored.length);
    expect(second).toMatchObject({ contentSha256: first.contentSha256, size: first.size });
    const row = await prisma.previewImage.findUnique({ where: { id: second.id } });
    expect(row).toMatchObject({ contentSha256: first.contentSha256, size: first.size });

    // Cloned via the temp name it's renamed from, so the file only ever appears whole.
    expect(clones).toHaveLength(1);
    expect(clones[0].from).toBe(firstPath);
    expect(clones[0].to).toMatch(/\.tmp$/);
    expect(secondPath).not.toBe(firstPath);
    expect(fs.readFileSync(secondPath).equals(stored)).toBe(true);
    expect(fs.statSync(secondPath).ino).not.toBe(fs.statSync(firstPath).ino);
    expect(fs.readdirSync(path.dirname(secondPath)).filter((name) => name.endsWith(".tmp"))).toEqual([]);

    // Deleting one user's pictures leaves the other's.
    await deleteAllPreviewImages(a.print.id);
    expect(fs.existsSync(firstPath)).toBe(false);
    expect(fs.readFileSync(secondPath).equals(stored)).toBe(true);
  });

  it("records the size but no hash and clones nothing while the switch is off", async () => {
    await setFileReuse("off");
    const clones = watchClones();
    const download = await uniqueImage();
    const [a, b] = [await makePrint(dir, firstUserId, "Kinds"), await makePrint(dir, secondUserId, "Kinds")];
    const first = (await addPreviewImage(a.print.id, download))!;
    const second = (await addPreviewImage(b.print.id, download))!;
    expect([first.contentSha256, second.contentSha256]).toEqual([null, null]);
    expect(second.size).toBeGreaterThan(0);
    expect(clones).toEqual([]);
  });

  it("stores the picture as usual when the clone can't be made", async () => {
    await setFileReuse("reflink");
    const download = await uniqueImage();
    const [a, b] = [await makePrint(dir, firstUserId, "Kinds"), await makePrint(dir, secondUserId, "Kinds")];
    await addPreviewImage(a.print.id, download);
    vi.spyOn(fsp, "copyFile").mockImplementation(async (src, target, mode) => {
      if (mode !== undefined && mode & COPYFILE_FICLONE_FORCE)
        throw Object.assign(new Error("EXDEV"), { code: "EXDEV" });
      return realCopyFile(src, target, mode);
    });
    const second = (await addPreviewImage(b.print.id, download))!;
    const home = (await prisma.print.findUnique({ where: { id: b.print.id } }))!.assetsPath;
    expect(fs.readFileSync(previewImagePath(second.id, home)).length).toBe(second.size);
    expect(second.contentSha256).not.toBeNull();
  });

  it("never clones from a picture of a model with no folder of its own", async () => {
    await setFileReuse("reflink");
    const clones = watchClones();
    const download = await uniqueImage();
    const [a, b] = [await makePrint(dir, firstUserId, "Kinds"), await makePrint(dir, secondUserId, "Kinds")];
    const first = (await addPreviewImage(a.print.id, download))!;
    // Its picture is in an old shared folder, as before the model's own was made: not ours to share.
    await prisma.print.update({ where: { id: a.print.id }, data: { assetsPath: null } });
    expect(await findStoredCopies({ contentSha256: first.contentSha256!, size: first.size! })).toEqual([]);
    await addPreviewImage(b.print.id, download);
    expect(clones).toEqual([]);
  });

  it("returns null and leaves no file when its row is deleted before the file is recorded", async () => {
    await setFileReuse("off");
    const print = await makePrint(dir, firstUserId, "Kinds");
    const realUpdateMany = prisma.previewImage.updateMany.bind(prisma.previewImage);
    let savedId: string | null = null;
    vi.spyOn(prisma.previewImage, "updateMany").mockImplementationOnce(async (args) => {
      // The row goes while the picture is being saved, as when its print is removed meanwhile.
      savedId = String(args.where?.id);
      await prisma.previewImage.delete({ where: { id: savedId } });
      return realUpdateMany(args);
    });
    expect(await addPreviewImage(print.print.id, await uniqueImage())).toBeNull();
    expect(savedId).not.toBeNull();
    const home = (await prisma.print.findUnique({ where: { id: print.print.id } }))!.assetsPath;
    expect(fs.existsSync(previewImagePath(savedId!, home))).toBe(false);
    expect(await prisma.previewImage.count({ where: { printId: print.print.id } })).toBe(0);
  });

  it("removes the file from the model's own folder when the whole print is deleted meanwhile", async () => {
    await setFileReuse("off");
    const print = await makePrint(dir, firstUserId, "Kinds");
    const home = (await prisma.print.findUnique({ where: { id: print.print.id } }))!.assetsPath;
    const realUpdateMany = prisma.previewImage.updateMany.bind(prisma.previewImage);
    let savedId: string | null = null;
    vi.spyOn(prisma.previewImage, "updateMany").mockImplementationOnce(async (args) => {
      // The print goes (its rows with it) while the picture is being saved; its folder is left on disk.
      savedId = String(args.where?.id);
      await prisma.print.delete({ where: { id: print.print.id } });
      return realUpdateMany(args);
    });
    expect(await addPreviewImage(print.print.id, await uniqueImage())).toBeNull();
    expect(fs.existsSync(previewImagePath(savedId!, home))).toBe(false);
  });

  it("returns null, and leaves no file or row, when recording the file fails", async () => {
    await setFileReuse("off");
    const print = await makePrint(dir, firstUserId, "Kinds");
    const home = (await prisma.print.findUnique({ where: { id: print.print.id } }))!.assetsPath;
    let savedId: string | null = null;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(prisma.previewImage, "updateMany").mockImplementationOnce(async (args) => {
      savedId = String(args.where?.id);
      throw new Error("db down");
    });
    expect(await addPreviewImage(print.print.id, await uniqueImage())).toBeNull();
    expect(fs.existsSync(previewImagePath(savedId!, home))).toBe(false);
    expect(await prisma.previewImage.count({ where: { printId: print.print.id } })).toBe(0);
  });
});

describe("description images", () => {
  it("clones the downloaded bytes for another user, and a prune only removes its own", async () => {
    await setFileReuse("reflink");
    const clones = watchClones();
    const download = await uniqueImage("png");
    const [a, b] = [await makePrint(dir, firstUserId, "Kinds"), await makePrint(dir, secondUserId, "Kinds")];
    const first = (await saveDescriptionImage(a.print.id, download, "https://example.com/step.png"))!;
    const second = (await saveDescriptionImage(b.print.id, download, "https://example.com/step.png"))!;
    expect(first.id).not.toBe(second.id);

    // Kept byte for byte, so it's the download that's hashed.
    expect(first.size).toBe(download.length);
    const rows = await prisma.descriptionImage.findMany({ where: { id: { in: [first.id, second.id] } } });
    expect(rows.map((r) => r.contentSha256)).toEqual([sha(download), sha(download)]);

    const homeOf = async (printId: string) => (await prisma.print.findUnique({ where: { id: printId } }))!.assetsPath;
    const firstPath = descriptionImagePath(first, await homeOf(a.print.id));
    const secondPath = descriptionImagePath(second, await homeOf(b.print.id));
    expect(clones).toEqual([{ from: firstPath, to: secondPath }]);
    expect(fs.statSync(secondPath).ino).not.toBe(fs.statSync(firstPath).ino);
    expect(fs.readFileSync(secondPath).equals(download)).toBe(true);

    // A's notes reference nothing: its image goes, B's file and row stay.
    await prisma.print.update({ where: { id: a.print.id }, data: { notes: "an edit that drops the image" } });
    await pruneDescriptionImages(a.print.id);
    expect(fs.existsSync(firstPath)).toBe(false);
    expect(await prisma.descriptionImage.findUnique({ where: { id: first.id } })).toBeNull();
    expect(fs.readFileSync(secondPath).equals(download)).toBe(true);
    expect(await prisma.descriptionImage.findUnique({ where: { id: second.id } })).not.toBeNull();
  });

  it("removes the file as well as the row when recording its hash fails", async () => {
    await setFileReuse("reflink");
    const print = await makePrint(dir, firstUserId, "Kinds");
    const home = (await prisma.print.findUnique({ where: { id: print.print.id } }))!.assetsPath;
    let image: { id: string; mime: string } | null = null;
    vi.spyOn(prisma.descriptionImage, "update").mockImplementationOnce((async (args: { where: { id: string } }) => {
      image = (await prisma.descriptionImage.findUnique({ where: { id: args.where.id } }))!;
      throw new Error("db down");
    }) as never);
    expect(await saveDescriptionImage(print.print.id, await uniqueImage("png"), null)).toBeNull();
    expect(fs.existsSync(descriptionImagePath(image!, home))).toBe(false);
    expect(await prisma.descriptionImage.count({ where: { printId: print.print.id } })).toBe(0);
  });

  it("records no hash and clones nothing while the switch is off", async () => {
    await setFileReuse("off");
    const clones = watchClones();
    const download = await uniqueImage("png");
    const [a, b] = [await makePrint(dir, firstUserId, "Kinds"), await makePrint(dir, secondUserId, "Kinds")];
    await saveDescriptionImage(a.print.id, download, null);
    const second = (await saveDescriptionImage(b.print.id, download, null))!;
    expect(second.contentSha256).toBeNull();
    expect(clones).toEqual([]);
  });
});

describe("across kinds", () => {
  it("finds a gallery picture's bytes for a supporting file, and the other way round", async () => {
    await setFileReuse("reflink");
    const clones = watchClones();
    const a = await makePrint(dir, firstUserId, "Kinds");
    const picture = (await addPreviewImage(a.print.id, await uniqueImage()))!;
    const home = (await prisma.print.findUnique({ where: { id: a.print.id } }))!.assetsPath;
    const pictureBytes = fs.readFileSync(previewImagePath(picture.id, home));

    const b = await makePrint(dir, secondUserId, "Kinds");
    const file = await upload(dir, secondUserId, b.print.id, "picture.jpg", pictureBytes);
    expect(
      clones.some((c) => c.to === managedPrintFilePath(file) && c.from === previewImagePath(picture.id, home)),
    ).toBe(true);
    expect(await sha256OfFile(managedPrintFilePath(file))).toBe(picture.contentSha256);
  });
});
