import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { createApp } from "../src/app";
import {
  makePrint,
  nonce,
  openedPath,
  register,
  sha,
  tempFile,
  uniqueBytes,
  uniqueImage,
  upload,
} from "./helpers/fileReuse";
import { STORAGE } from "../src/config";
import { managedPlatePath, relocatePrint } from "../src/services/printService";
import { managedPrintFilePath } from "../src/services/printFileService";
import { createPrint } from "../src/services/printCreation";
import { addPreviewImage, previewImagePath } from "../src/services/previewImageService";
import { saveDescriptionImage, descriptionImagePath } from "../src/services/descriptionImageService";
import {
  currentFileReuseBackfill,
  resumeFileReuseBackfill,
  startFileReuseBackfill,
} from "../src/services/fileReuseBackfill";
import { startStorageMove } from "../src/services/storageMoveService";
import { setFileReuse } from "../src/services/settingsService";
import { withStorageLock } from "../src/utils/storageLock";
import { prisma } from "../src/db";
import { delegate, managedPathOf, STORED } from "../src/services/storedContent";

// The backfill replaces files already stored by clones of identical ones, in place. What matters most is that it never
// loses or changes a file: the checks below are each a way the swap must refuse or recover.

const app = createApp();
let firstUserId: string;
let secondUserId: string;
let adminToken: string;
let dir: string;
const { COPYFILE_EXCL, COPYFILE_FICLONE_FORCE } = fs.constants;
const realCopyFile = fsp.copyFile;
const realOpen = fsp.open;

type CloneOptions = { unsupported?: boolean; afterClone?: (target: string) => Promise<void> | void };

/** Clones as a reflink-capable filesystem would make them (the temp folder can't): a plain exclusive copy. `afterClone`
 *  runs once the clone exists and before the backfill checks and swaps it -- where a concurrent change is staged. */
function mockClones(options: CloneOptions = {}) {
  const clones: { from: string; to: string }[] = [];
  vi.spyOn(fsp, "copyFile").mockImplementation(async (src, target, mode) => {
    if (mode === undefined || !(mode & COPYFILE_FICLONE_FORCE)) return realCopyFile(src, target, mode);
    if (options.unsupported) throw Object.assign(new Error("EOPNOTSUPP"), { code: "EOPNOTSUPP" });
    await realCopyFile(src, target, COPYFILE_EXCL);
    // The probe's own files aren't a file's clone.
    if (!path.basename(String(target)).endsWith(".reuse.tmp")) return;
    clones.push({ from: openedPath(src), to: String(target) });
    await options.afterClone?.(String(target));
  });
  return clones;
}

const printFileRow = (id: string) => prisma.printFile.findUniqueOrThrow({ where: { id } });

/** Supporting files with the same content for two users, stored while the switch was off, so no hash is recorded. */
async function stored(count = 2) {
  await setFileReuse("off");
  const bytes = uniqueBytes();
  const users = [firstUserId, secondUserId, firstUserId, secondUserId];
  const files = [];
  for (let i = 0; i < count; i++) {
    const made = await makePrint(dir, users[i], "Backfill");
    // Created a moment apart, so which is the oldest (the donor) is settled.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const row = await upload(dir, users[i], made.print.id, "dup.pdf", bytes);
    files.push({ ...made, row, file: managedPrintFilePath(row) });
  }
  return { bytes, files };
}

/** `fn` for the clone made for `file` only: the run replaces every duplicate there is, and a hook is staged for one. */
const onlyFor = (file: string, fn: () => Promise<void> | void) => async (clone: string) => {
  if (path.dirname(clone) === fs.realpathSync(path.dirname(file))) await fn();
};

/** Whether a clone was made for a file in `file`'s folder. */
const clonedFor = (clones: { to: string }[], file: string) =>
  clones.some((c) => path.dirname(c.to) === fs.realpathSync(path.dirname(file)));

/** Polls, for state another task changes. */
const until = async (done: () => boolean) => {
  while (!done()) await sleep(10);
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Turns the switch on and runs the backfill to its end. */
async function backfill() {
  await setFileReuse("reflink");
  const state = startFileReuseBackfill(null)!;
  expect(state).not.toBeNull();
  while (state.running) await sleep(20);
  return state;
}

/** Every dot-temp the backfill may leave, under the storage folder. */
function leftoverTemps(): string[] {
  const found: string[] = [];
  const walk = (folder: string) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(folder, entry.name));
      else if (entry.name.endsWith(".reuse.tmp")) found.push(path.join(folder, entry.name));
    }
  };
  walk(STORAGE);
  return found;
}

/** Drops every stored-file row whose file isn't there to read, whoever's it is. */
async function dropUnreadableRows() {
  for (const kind of ["plate", "printFile", "previewImage", "descriptionImage"] as const) {
    const rows = await delegate(kind).findMany({ where: STORED[kind].managed, select: STORED[kind].select });
    const gone = rows
      .filter((row) => {
        const file = managedPathOf(STORED[kind].toRow(row));
        return file && !fs.statSync(file, { throwIfNoEntry: false })?.isFile();
      })
      .map((row) => row.id as string);
    if (gone.length) {
      await (prisma[kind] as unknown as { deleteMany(args: object): Promise<unknown> }).deleteMany({
        where: { id: { in: gone } },
      });
    }
  }
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "reuse-backfill-"));
  firstUserId = (await register(app, "backfill", "first")).id;
  secondUserId = (await register(app, "backfill", "second")).id;
  const admin = await register(app, "backfill", "admin");
  await prisma.user.update({ where: { id: admin.id }, data: { role: "ADMIN" } });
  adminToken = (await request(app).post("/api/login").send({ email: admin.email, password: "password123" })).body.token;
  // Whatever earlier test files left, settled once, so each run below sees only its own files. Rows whose file those
  // files removed on purpose can't be settled: the backfill would skip them on every run, so they go first.
  await dropUnreadableRows();
  mockClones();
  await backfill();
  vi.restoreAllMocks();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await prisma.setting.deleteMany({
    where: { key: { in: ["file_reuse_backfill_pending", "file_reuse_backfill_tmp"] } },
  });
  // Each test's models go, so the next run sees only its own files and its counts are exact.
  await prisma.print.deleteMany({ where: { userId: { in: [firstUserId, secondUserId] } } });
});

afterAll(async () => {
  await prisma.setting.deleteMany({ where: { key: "file_reuse" } });
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("recording hashes", () => {
  it("fills in every kind, and leaves a missing file, a FIFO and a link alone", async () => {
    await setFileReuse("off");
    const [a, b] = [await makePrint(dir, firstUserId, "Backfill"), await makePrint(dir, firstUserId, "Backfill")];
    const printFile = await upload(dir, firstUserId, a.print.id, "doc.pdf", uniqueBytes());
    const gone = await upload(dir, firstUserId, a.print.id, "gone.pdf", uniqueBytes());
    const fifo = await upload(dir, firstUserId, a.print.id, "fifo.pdf", uniqueBytes());
    const link = await upload(dir, firstUserId, a.print.id, "link.pdf", uniqueBytes());
    const image = (await addPreviewImage(a.print.id, await uniqueImage()))!;
    const description = (await saveDescriptionImage(a.print.id, await uniqueImage(), null))!;
    const home = (await prisma.print.findUniqueOrThrow({ where: { id: a.print.id } })).assetsPath;
    await prisma.previewImage.update({ where: { id: image.id }, data: { size: null } });
    expect((await prisma.plate.findUniqueOrThrow({ where: { id: b.plate.id } })).contentSha256).toBeNull();

    fs.rmSync(managedPrintFilePath(gone));
    fs.rmSync(managedPrintFilePath(fifo));
    execFileSync("mkfifo", [managedPrintFilePath(fifo)]);
    const outside = tempFile(dir, "outside");
    fs.rmSync(managedPrintFilePath(link));
    fs.symlinkSync(outside, managedPrintFilePath(link));

    mockClones();
    const state = await backfill();

    const bytesOf = (file: string) => sha(fs.readFileSync(file));
    expect((await printFileRow(printFile.id)).contentSha256).toBe(bytesOf(managedPrintFilePath(printFile)));
    expect((await prisma.plate.findUniqueOrThrow({ where: { id: b.plate.id } })).contentSha256).toBe(
      bytesOf(managedPlatePath(b.plate)),
    );
    const imageFile = previewImagePath(image.id, home);
    expect(await prisma.previewImage.findUniqueOrThrow({ where: { id: image.id } })).toMatchObject({
      contentSha256: bytesOf(imageFile),
      size: fs.statSync(imageFile).size,
    });
    expect((await prisma.descriptionImage.findUniqueOrThrow({ where: { id: description.id } })).contentSha256).toBe(
      bytesOf(descriptionImagePath(description, home)),
    );
    for (const row of [gone, fifo, link]) expect((await printFileRow(row.id)).contentSha256).toBeNull();
    expect(state.hashed).toBeGreaterThanOrEqual(5);
    expect(state.skipped).toBeGreaterThanOrEqual(3);
    expect(fs.readFileSync(outside, "utf8")).toBe("outside");
    expect(fs.lstatSync(managedPrintFilePath(link)).isSymbolicLink()).toBe(true);
  });

  it("hashes without cloning where the filesystem can't clone", async () => {
    const { bytes, files } = await stored();
    const inos = files.map((f) => fs.statSync(f.file).ino);
    mockClones({ unsupported: true });
    const state = await backfill();
    expect(state).toMatchObject({ unsupported: true, cloned: 0, running: false, stopped: false });
    for (const f of files) expect((await printFileRow(f.row.id)).contentSha256).toBe(sha(bytes));
    expect(files.map((f) => fs.statSync(f.file).ino)).toEqual(inos);
    expect(fs.readdirSync(STORAGE).filter((n) => n.startsWith(".reflink-probe-"))).toEqual([]);
  });
});

describe("replacing duplicates by clones", () => {
  it("replaces the newer file by a clone of the oldest, keeping bytes, mode, times and the row", async () => {
    const { bytes, files } = await stored();
    const [donor, target] = files;
    fs.chmodSync(target.file, 0o640);
    const past = new Date("2024-03-04T05:06:07.000Z");
    fs.utimesSync(target.file, past, past);
    const before = fs.statSync(target.file);
    const donorBefore = fs.statSync(donor.file);
    const rowBefore = await printFileRow(target.row.id);
    const clones = mockClones();

    const state = await backfill();

    expect(state).toMatchObject({ stopped: false, unsupported: false });
    expect(state.cloned).toBeGreaterThanOrEqual(1);
    expect(state.reclaimedBytes).toBeGreaterThanOrEqual(bytes.length);
    const mine = clones.filter((c) => path.dirname(c.to) === fs.realpathSync(path.dirname(target.file)));
    expect(mine).toHaveLength(1);
    expect(mine[0].from).toBe(donor.file);
    const after = fs.statSync(target.file);
    expect(after.ino).not.toBe(before.ino);
    expect(after.ino).not.toBe(donorBefore.ino);
    expect(after.nlink).toBe(1);
    expect(fs.readFileSync(target.file).equals(bytes)).toBe(true);
    expect(after.mode & 0o7777).toBe(0o640);
    expect(Math.abs(after.mtimeMs - past.getTime())).toBeLessThan(2);
    // The donor is untouched, and the row is exactly as it was apart from the hash.
    expect(fs.statSync(donor.file).ino).toBe(donorBefore.ino);
    expect(await printFileRow(target.row.id)).toEqual({
      ...rowBefore,
      contentSha256: sha(bytes),
      reuseIno: BigInt(after.ino),
      reuseCtimeNs: expect.any(BigInt),
    });
    expect(leftoverTemps()).toEqual([]);
    expect(await prisma.setting.findUnique({ where: { key: "file_reuse_backfill_tmp" } })).toBeNull();
    expect(await prisma.setting.findUnique({ where: { key: "file_reuse_backfill_pending" } })).toBeNull();

    // Independent files: an edit to one doesn't reach the other.
    fs.appendFileSync(target.file, "edited outside Thingport");
    expect(fs.readFileSync(donor.file).equals(bytes)).toBe(true);
  });

  it("clones a gallery picture of the same bytes as another user's", async () => {
    await setFileReuse("off");
    const image = await uniqueImage();
    const [a, b] = [await makePrint(dir, firstUserId, "Backfill"), await makePrint(dir, secondUserId, "Backfill")];
    const first = (await addPreviewImage(a.print.id, image))!;
    const second = (await addPreviewImage(b.print.id, image))!;
    const homes = await Promise.all(
      [a, b].map(async (m) => (await prisma.print.findUniqueOrThrow({ where: { id: m.print.id } })).assetsPath),
    );
    const files = [previewImagePath(first.id, homes[0]), previewImagePath(second.id, homes[1])];
    const clones = mockClones();
    const state = await backfill();
    expect(state.cloned).toBeGreaterThanOrEqual(1);
    expect(clones.find((c) => c.to.startsWith(path.dirname(files[1])))?.from).toBe(files[0]);
    expect(fs.statSync(files[1]).ino).not.toBe(fs.statSync(files[0]).ino);
  });

  it("skips a file with another hard link, on another filesystem, or of another size", async () => {
    const { bytes, files } = await stored(4);
    const [, linked, other, longer] = files;
    fs.linkSync(linked.file, `${linked.file}.hardlink`);
    fs.appendFileSync(longer.file, "more");
    // Another filesystem: what the open file says its device is.
    vi.spyOn(fsp, "open").mockImplementation(async (...args) => {
      const handle = await realOpen(...(args as Parameters<typeof realOpen>));
      if (String(args[0]) === fs.realpathSync(other.file)) {
        const stat = handle.stat.bind(handle);
        (handle as any).stat = async (opts?: any) => {
          const s: any = await stat(opts);
          return new Proxy(s, { get: (t, k) => (k === "dev" ? t.dev + 1n : (t[k].bind?.(t) ?? t[k])) });
        };
      }
      return handle;
    });
    const inos = [linked, other, longer].map((f) => fs.statSync(f.file).ino);
    const clones = mockClones();

    await backfill();

    for (const f of [linked, other, longer]) expect(clonedFor(clones, f.file)).toBe(false);
    expect([linked, other, longer].map((f) => fs.statSync(f.file).ino)).toEqual(inos);
    expect(fs.readFileSync(linked.file).equals(bytes)).toBe(true);
    expect(fs.readFileSync(longer.file, "utf8")).toMatch(/more$/);
    expect(leftoverTemps()).toEqual([]);
  });

  it("records the new hash of a file edited since it was hashed, without cloning it", async () => {
    const { bytes, files } = await stored();
    const [, edited] = files;
    // Hash on record, then the file edited on disk to different bytes of the same size.
    await prisma.printFile.update({ where: { id: edited.row.id }, data: { contentSha256: sha(bytes) } });
    const changed = Buffer.from(bytes);
    changed[0] = changed[0] === 120 ? 121 : 120;
    fs.writeFileSync(edited.file, changed);
    const clones = mockClones();
    await backfill();
    expect(clonedFor(clones, edited.file)).toBe(false);
    expect((await printFileRow(edited.row.id)).contentSha256).toBe(sha(changed));
    expect(fs.readFileSync(edited.file).equals(changed)).toBe(true);
  });

  it("never works in a folder that's a link out of storage, or on a model with no folder of its own", async () => {
    const { bytes, files } = await stored(3);
    const [, linked, unhomed] = files;
    const folder = path.dirname(linked.file);
    const outside = fs.mkdtempSync(path.join(dir, "outside-"));
    fs.cpSync(folder, outside, { recursive: true });
    fs.rmSync(folder, { recursive: true });
    fs.symlinkSync(outside, folder);
    const outsideFile = path.join(outside, path.basename(linked.file));
    const outsideIno = fs.statSync(outsideFile).ino;
    const description = (await saveDescriptionImage(unhomed.print.id, await uniqueImage(), null))!;
    await prisma.print.update({ where: { id: unhomed.print.id }, data: { assetsPath: null } });
    const clones = mockClones();

    await backfill();

    expect(fs.statSync(outsideFile).ino).toBe(outsideIno);
    expect(fs.readdirSync(outside).filter((n) => n.endsWith(".tmp"))).toEqual([]);
    expect(clones.every((c) => path.dirname(c.to) !== outside)).toBe(true);
    expect(fs.readFileSync(outsideFile).equals(bytes)).toBe(true);
    expect(
      (await prisma.descriptionImage.findUniqueOrThrow({ where: { id: description.id } })).contentSha256,
    ).toBeNull();
    fs.rmSync(folder);
  });
});

describe("changes made while a file is being replaced", () => {
  it("doesn't swap a file edited between the clone and the swap", async () => {
    const { files } = await stored();
    const target = files[1];
    let ino = 0;
    const clones = mockClones({
      afterClone: onlyFor(target.file, () => {
        ino = fs.statSync(target.file).ino;
        fs.appendFileSync(target.file, " edited meanwhile");
      }),
    });
    ino = fs.statSync(target.file).ino;
    await backfill();
    expect(clonedFor(clones, target.file)).toBe(true);
    expect(fs.statSync(target.file).ino).toBe(ino);
    expect(fs.readFileSync(target.file, "utf8")).toMatch(/ edited meanwhile$/);
    expect(leftoverTemps()).toEqual([]);
  });

  it("doesn't swap a file that was moved, and puts nothing at its old path", async () => {
    const { files } = await stored();
    const target = files[1];
    let moved = false;
    const clones = mockClones({
      afterClone: onlyFor(target.file, async () => {
        const print = await prisma.print.findUniqueOrThrow({
          where: { id: target.print.id },
          include: { plates: true },
        });
        // A template that puts the file elsewhere.
        moved = (await relocatePrint(print, print.plates, "{creator}/{model}/{filename}")) > 0;
      }),
    });
    const ino = fs.statSync(target.file).ino;
    await backfill();
    expect(moved).toBe(true);
    expect(clonedFor(clones, target.file)).toBe(true);
    expect(fs.existsSync(target.file)).toBe(false);
    const row = await printFileRow(target.row.id);
    expect(fs.statSync(managedPrintFilePath(row)).ino).toBe(ino);
    expect(leftoverTemps()).toEqual([]);
  });

  it("doesn't swap a file whose row was deleted, and leaves no clone behind", async () => {
    const { files } = await stored();
    const target = files[1];
    const ino = fs.statSync(target.file).ino;
    const clones = mockClones({
      afterClone: onlyFor(
        target.file,
        async () => void (await prisma.printFile.delete({ where: { id: target.row.id } })),
      ),
    });
    await backfill();
    expect(clonedFor(clones, target.file)).toBe(true);
    expect(fs.statSync(target.file).ino).toBe(ino);
    expect(leftoverTemps()).toEqual([]);
  });

  it("waits for the storage lock before swapping, as a move of files holds it", async () => {
    const { files } = await stored();
    const target = files[1];
    let release!: () => void;
    let held: Promise<void> | null = null;
    mockClones({
      // Taken after the clone is made and before the swap asks for it, as a move of this model's files would have.
      afterClone: onlyFor(target.file, () => {
        held = withStorageLock(() => new Promise<void>((resolve) => (release = resolve)));
      }),
    });
    const before = fs.statSync(target.file).ino;
    await setFileReuse("reflink");
    const state = startFileReuseBackfill(null)!;
    await until(() => held !== null);
    await sleep(150);
    expect(state.running).toBe(true);
    expect(fs.statSync(target.file).ino).toBe(before);
    release();
    await held;
    while (state.running) await sleep(20);
    expect(fs.statSync(target.file).ino).not.toBe(before);
  });

  it("stops when the switch is turned off mid-run, replacing nothing more", async () => {
    const { files } = await stored(3);
    const inos = files.map((f) => fs.statSync(f.file).ino);
    mockClones({ afterClone: async () => void (await setFileReuse("off")) });
    const state = await backfill();
    expect(state).toMatchObject({ stopped: true, cloned: 0, running: false });
    expect(files.map((f) => fs.statSync(f.file).ino)).toEqual(inos);
    expect(leftoverTemps()).toEqual([]);
    expect(await prisma.setting.findUnique({ where: { key: "file_reuse_backfill_pending" } })).toBeNull();
  });

  it("puts back what was written to the original after the swap", async () => {
    const { bytes, files } = await stored();
    const target = files[1];
    // Something holding the file open, as an editor or a sync client may.
    const fd = fs.openSync(target.file, "r+");
    const realRename = fsp.rename;
    let wrote = false;
    vi.spyOn(fsp, "rename").mockImplementation(async (from, to) => {
      await realRename(from, to);
      if (!wrote && String(to) === fs.realpathSync(path.dirname(target.file)) + path.sep + path.basename(target.file)) {
        wrote = true;
        fs.writeSync(fd, " late edit", bytes.length);
      }
    });
    const copies = mockClones();
    // Putting the original back needs no space: no plain copy is made for it, so a full disk can't lose the bytes.
    const plain = vi.mocked(fsp.copyFile);
    await backfill();
    fs.closeSync(fd);
    expect(wrote).toBe(true);
    expect(copies.length).toBeGreaterThan(0);
    expect(plain.mock.calls.filter(([, , mode]) => !((mode ?? 0) & COPYFILE_FICLONE_FORCE))).toEqual([]);
    // The path holds the edited bytes again, not the clone's.
    expect(fs.readFileSync(target.file).equals(Buffer.concat([bytes, Buffer.from(" late edit")]))).toBe(true);
    expect(leftoverTemps()).toEqual([]);
    expect(await prisma.setting.findUnique({ where: { key: "file_reuse_backfill_tmp" } })).toBeNull();
  });
});

describe("after a crash", () => {
  const journal = (tmp: string) =>
    prisma.setting.upsert({
      where: { key: "file_reuse_backfill_tmp" },
      create: { key: "file_reuse_backfill_tmp", value: { path: tmp } },
      update: { value: { path: tmp } },
    });

  it("removes the journalled temp file, and only that", async () => {
    const { files } = await stored(1);
    const folder = fs.realpathSync(path.dirname(files[0].file));
    const left = path.join(folder, `.dup.pdf.${"0123456789ab"}.reuse.tmp`);
    fs.writeFileSync(left, "half a clone");
    const bystander = path.join(folder, `.other.pdf.${"ba9876543210"}.reuse.tmp`);
    fs.writeFileSync(bystander, "not journalled");
    await journal(left);
    mockClones();
    await backfill();
    expect(fs.existsSync(left)).toBe(false);
    expect(fs.existsSync(bystander)).toBe(true);
    fs.rmSync(bystander);
    expect(await prisma.setting.findUnique({ where: { key: "file_reuse_backfill_tmp" } })).toBeNull();
  });

  it("keeps a journalled path that isn't one of its temp files, or that a row owns", async () => {
    const { files } = await stored(2);
    const [plain, owned] = files;
    await journal(plain.file);
    mockClones();
    await backfill();
    expect(fs.existsSync(plain.file)).toBe(true);

    const rel = path.join(path.dirname(owned.row.storagePath), `.dup.pdf.${"0123456789ab"}.reuse.tmp`);
    fs.renameSync(owned.file, path.join(STORAGE, rel));
    await prisma.printFile.update({ where: { id: owned.row.id }, data: { storagePath: rel } });
    await journal(path.join(STORAGE, rel));
    await backfill();
    expect(fs.existsSync(path.join(STORAGE, rel))).toBe(true);
    // Not hashed away as a leftover either: it's the row's file.
    expect(await printFileRow(owned.row.id)).toMatchObject({ storagePath: rel });
    fs.rmSync(path.join(STORAGE, rel));
  });
});

describe("running again", () => {
  const markers = async (id: string) => {
    const row = await printFileRow(id);
    return { ino: row.reuseIno, ctime: row.reuseCtimeNs };
  };

  it("leaves files it already made share alone, and counts nothing for them", async () => {
    const { files } = await stored();
    const [donor, target] = files;
    mockClones();
    const first = await backfill();
    expect(first.cloned).toBe(1);
    const inos = files.map((f) => fs.statSync(f.file).ino);
    // Recorded for the replaced file and for the donor it shares with.
    expect(await markers(target.row.id)).toEqual({ ino: BigInt(inos[1]), ctime: expect.any(BigInt) });
    expect((await markers(donor.row.id)).ino).toBe(BigInt(inos[0]));

    const clones = mockClones();
    const second = await backfill();
    expect(second).toMatchObject({ cloned: 0, reclaimedBytes: 0, failed: false });
    expect(clones).toEqual([]);
    expect(files.map((f) => fs.statSync(f.file).ino)).toEqual(inos);
  });

  it("replaces a file again once something changed it since", async () => {
    const { files } = await stored();
    const target = files[1];
    mockClones();
    await backfill();
    const ino = fs.statSync(target.file).ino;
    // A new ctime: the record no longer says what the file is.
    fs.chmodSync(target.file, 0o600);
    const clones = mockClones();
    const again = await backfill();
    expect(clonedFor(clones, target.file)).toBe(true);
    expect(again.cloned).toBe(1);
    expect(fs.statSync(target.file).ino).not.toBe(ino);
    expect(fs.statSync(target.file).mode & 0o7777).toBe(0o600);
  });

  it("brings a new duplicate in line without touching the group's earlier members", async () => {
    const { bytes, files } = await stored();
    mockClones();
    await backfill();
    const inos = files.map((f) => fs.statSync(f.file).ino);
    await setFileReuse("off");
    const made = await makePrint(dir, firstUserId, "Backfill");
    const row = await upload(dir, firstUserId, made.print.id, "dup.pdf", bytes);
    const file = managedPrintFilePath(row);
    const clones = mockClones();
    const state = await backfill();
    expect(state.cloned).toBe(1);
    expect(clones.filter((c) => c.from === files[0].file)).toHaveLength(1);
    expect(files.map((f) => fs.statSync(f.file).ino)).toEqual(inos);
    expect(fs.readFileSync(file).equals(bytes)).toBe(true);
  });
});

describe("what an import already cloned", () => {
  it.each(["edited", "replaced"])("does not mark a clone %s after verification", async (change) => {
    await setFileReuse("reflink");
    mockClones();
    const bytes = uniqueBytes();
    const changed = Buffer.alloc(bytes.length, 0x79);
    const plateOf = async (userId: string) => {
      const { plates } = await createPrint(userId, { title: `Imported ${nonce()}` }, "Imported", [
        { filename: "shared.stl", tempFilePath: tempFile(dir, bytes) },
      ]);
      return plates[0];
    };
    await plateOf(firstUserId);
    const realChmod = fsp.chmod;
    // cloneFrom verifies the bytes before applying permissions. An external writer changes the
    // destination afterwards, before the import samples its reuse marker.
    const chmod = vi.spyOn(fsp, "chmod").mockImplementation(async (file, mode) => {
      await realChmod(file, mode);
      if (change === "replaced") await fsp.rename(tempFile(dir, changed), file);
      else await fsp.writeFile(file, changed);
    });
    const copy = await plateOf(secondUserId);
    chmod.mockRestore();
    expect(copy.reuseIno).toBeNull();
    expect(copy.reuseCtimeNs).toBeNull();
    expect(fs.readFileSync(managedPlatePath(copy))).toEqual(changed);
    await backfill();
    expect((await prisma.plate.findUniqueOrThrow({ where: { id: copy.id } })).contentSha256).toBe(sha(changed));
    expect(fs.readFileSync(managedPlatePath(copy))).toEqual(changed);
  });

  it("leaves a plate cloned at import alone, counting nothing for it", async () => {
    await setFileReuse("reflink");
    mockClones();
    const bytes = uniqueBytes();
    const plateOf = async (userId: string) => {
      const { plates } = await createPrint(userId, { title: `Imported ${nonce()}` }, "Imported", [
        { filename: "shared.stl", tempFilePath: tempFile(dir, bytes) },
      ]);
      return plates[0];
    };
    const donor = await plateOf(firstUserId);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const copy = await plateOf(secondUserId);
    // Only a file that was kept as a clone has the marker; the plain store before it has none.
    expect(donor.reuseIno).toBeNull();
    expect(copy.reuseIno).not.toBeNull();
    const file = managedPlatePath(copy);
    const ino = fs.statSync(file).ino;
    expect(copy.reuseIno).toBe(BigInt(ino));

    const clones = mockClones();
    const state = await backfill();
    expect(state).toMatchObject({ cloned: 0, reclaimedBytes: 0, skipped: 0, failed: false });
    expect(clones).toEqual([]);
    expect(fs.statSync(file).ino).toBe(ino);
    // The donor that was never marked is now, so the next run is a plain look.
    expect((await prisma.plate.findUniqueOrThrow({ where: { id: donor.id } })).reuseIno).toBe(
      BigInt(fs.statSync(managedPlatePath(donor)).ino),
    );
  });

  it("leaves a gallery picture cloned at import alone, marked after its rename into place", async () => {
    await setFileReuse("reflink");
    mockClones();
    const image = await uniqueImage("jpeg");
    const first = await makePrint(dir, firstUserId, "Gallery");
    const second = await makePrint(dir, secondUserId, "Gallery");
    const donor = (await addPreviewImage(first.print.id, image))!;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const copy = (await addPreviewImage(second.print.id, image))!;
    expect(donor.reuseIno).toBeNull();
    const home = (await prisma.print.findUniqueOrThrow({ where: { id: second.print.id } })).assetsPath;
    const file = previewImagePath(copy.id, home);
    const stat = fs.statSync(file, { bigint: true });
    // Taken of the final file: the rename changed its ctime.
    expect(copy).toMatchObject({ reuseIno: stat.ino, reuseCtimeNs: stat.ctimeNs });

    const clones = mockClones();
    const state = await backfill();
    expect(state).toMatchObject({ cloned: 0, reclaimedBytes: 0, skipped: 0, failed: false });
    expect(clones).toEqual([]);
    expect(fs.statSync(file, { bigint: true }).ino).toBe(stat.ino);
  });

  it("leaves a supporting file and a description image cloned at import alone", async () => {
    await setFileReuse("reflink");
    mockClones();
    const bytes = uniqueBytes();
    const image = await uniqueImage("png");
    const first = await makePrint(dir, firstUserId, "Both");
    const second = await makePrint(dir, secondUserId, "Both");
    await upload(dir, firstUserId, first.print.id, "dup.pdf", bytes);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const file = await upload(dir, secondUserId, second.print.id, "dup.pdf", bytes);
    await saveDescriptionImage(first.print.id, image, null);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const picture = (await saveDescriptionImage(second.print.id, image, null))!;
    const pictureRow = await prisma.descriptionImage.findUniqueOrThrow({ where: { id: picture.id } });
    expect(file.reuseIno).not.toBeNull();
    expect(pictureRow.reuseIno).not.toBeNull();
    const home = (await prisma.print.findUniqueOrThrow({ where: { id: second.print.id } })).assetsPath;
    const files = () => [managedPrintFilePath(file), descriptionImagePath(pictureRow, home)];
    const inos = files().map((f) => fs.statSync(f).ino);

    const clones = mockClones();
    const state = await backfill();
    expect(state).toMatchObject({ cloned: 0, reclaimedBytes: 0, skipped: 0, failed: false });
    expect(clones).toEqual([]);
    expect(files().map((f) => fs.statSync(f).ino)).toEqual(inos);
  });
});

describe("hashing progress on resume", () => {
  it("counts only the rows still to visit, so it ends at the total", async () => {
    await setFileReuse("off");
    // Plates (an earlier kind) and some of the supporting files sit before the cursor, and are never visited again.
    const made = await Promise.all([1, 2, 3].map(() => makePrint(dir, firstUserId, "Resume")));
    const rows = [];
    for (const m of made) rows.push(await upload(dir, firstUserId, m.print.id, "resume.pdf", uniqueBytes()));
    const ids = rows.map((row) => row.id).toSorted();
    await prisma.setting.upsert({
      where: { key: "file_reuse_backfill_pending" },
      create: { key: "file_reuse_backfill_pending", value: { userId: null, phase: "hashing", cursor: `1:${ids[0]}` } },
      update: { value: { userId: null, phase: "hashing", cursor: `1:${ids[0]}` } },
    });
    await setFileReuse("reflink");
    // No cloning, so the total stays the hashing phase's.
    mockClones({ unsupported: true });
    await resumeFileReuseBackfill();
    const state = currentFileReuseBackfill()!;
    await until(() => !state.running);
    expect(state).toMatchObject({ phase: "hashing", total: 2, done: 2, hashed: 2, failed: false });
    expect((await printFileRow(ids[0])).contentSha256).toBeNull();
  });
});

describe("what the original keeps through a swap", () => {
  const folderOf = (file: string) => fs.realpathSync(path.dirname(file));

  it("is a second name beside it, until the rename is done and nothing was written to it", async () => {
    const { bytes, files } = await stored();
    const target = files[1];
    const seen: { nlink: number; backups: string[] }[] = [];
    const journals: { entry: any; backups: string[] }[] = [];
    const realRename = fsp.rename;
    vi.spyOn(fsp, "rename").mockImplementation(async (from, to) => {
      if (String(from).endsWith(".reuse.tmp") && String(to).endsWith(path.basename(target.file))) {
        const backups = fs
          .readdirSync(folderOf(target.file))
          .filter((n) => n.endsWith(".reuse.tmp") && path.join(folderOf(target.file), n) !== String(from));
        seen.push({ nlink: fs.statSync(target.file).nlink, backups });
        // The journal knows both names, so a crash right here is recoverable.
        const entry = (await prisma.setting.findUniqueOrThrow({ where: { key: "file_reuse_backfill_tmp" } }))
          .value as any;
        journals.push({ entry, backups });
      }
      return realRename(from, to);
    });
    mockClones();
    await backfill();
    expect(journals).toHaveLength(1);
    expect(journals[0].entry).toMatchObject({ kind: "printFile", id: target.row.id, sha: sha(bytes) });
    expect(path.basename(journals[0].entry.backup)).toBe(journals[0].backups[0]);
    expect(seen).toEqual([{ nlink: 2, backups: [expect.stringMatching(/\.reuse\.tmp$/)] }]);
    expect(leftoverTemps()).toEqual([]);
  });

  it("is put back by a rename, so a full disk can't lose a late write", async () => {
    const { bytes, files } = await stored();
    const target = files[1];
    const original = fs.statSync(target.file).ino;
    const fd = fs.openSync(target.file, "r+");
    const realRename = fsp.rename;
    let wrote = false;
    vi.spyOn(fsp, "rename").mockImplementation(async (from, to) => {
      await realRename(from, to);
      if (!wrote && String(from).endsWith(".reuse.tmp")) {
        wrote = true;
        fs.writeSync(fd, " late", bytes.length);
        // Nothing can be written from here on: only a rename, not a copy, may put the original back.
        vi.spyOn(fsp, "copyFile").mockRejectedValue(Object.assign(new Error("full"), { code: "ENOSPC" }));
        vi.spyOn(fsp, "writeFile").mockRejectedValue(Object.assign(new Error("full"), { code: "ENOSPC" }));
      }
    });
    mockClones();
    const state = await backfill();
    fs.closeSync(fd);
    expect(wrote).toBe(true);
    expect(fs.readFileSync(target.file).equals(Buffer.concat([bytes, Buffer.from(" late")]))).toBe(true);
    expect(fs.statSync(target.file).ino).toBe(original);
    expect(state.cloned).toBe(0);
    expect(leftoverTemps()).toEqual([]);
    // Not recorded as shared: it isn't.
    expect((await printFileRow(target.row.id)).reuseIno).toBeNull();
  });

  it("is removed with the clone when the file's row was deleted just before the rename", async () => {
    const { files } = await stored();
    const target = files[1];
    const realRename = fsp.rename;
    vi.spyOn(fsp, "rename").mockImplementation(async (from, to) => {
      if (String(from).endsWith(".reuse.tmp") && String(to).endsWith(path.basename(target.file))) {
        // A delete: the file removed and its row gone, as the rename is about to put one back.
        fs.rmSync(target.file);
        await prisma.printFile.delete({ where: { id: target.row.id } });
      }
      return realRename(from, to);
    });
    mockClones();
    await backfill();
    expect(fs.existsSync(target.file)).toBe(false);
    expect(leftoverTemps()).toEqual([]);
  });

  it("keeps a new upload saved at the path the deleted file freed, which waits for the swap", async () => {
    const { files } = await stored();
    const target = files[1];
    const fresh = uniqueBytes();
    const realRename = fsp.rename;
    let saving: Promise<unknown> | null = null;
    vi.spyOn(fsp, "rename").mockImplementation(async (from, to) => {
      if (!saving && String(from).endsWith(".reuse.tmp") && String(to).endsWith(path.basename(target.file))) {
        // A delete lands after the swap's checks (file removed, row gone), and an upload of the same name -- which
        // takes the freed path -- is saved while the swap is still about to rename. Given time to place its file,
        // were it not made to wait for the swap.
        fs.rmSync(target.file);
        await prisma.printFile.delete({ where: { id: target.row.id } });
        saving = upload(dir, target.print.userId, target.print.id, "dup.pdf", fresh);
        await sleep(300);
      }
      return realRename(from, to);
    });
    mockClones();
    await backfill();
    await saving;
    const row = await prisma.printFile.findFirstOrThrow({ where: { printId: target.print.id, filename: "dup.pdf" } });
    expect(managedPrintFilePath(row)).toBe(target.file);
    expect(fs.readFileSync(target.file).equals(fresh)).toBe(true);
    expect(leftoverTemps()).toEqual([]);
  });

  it("leaves no empty folder behind when the model was deleted while its clone was made", async () => {
    const { files } = await stored();
    const target = files[1];
    const folder = folderOf(target.file);
    mockClones({
      afterClone: onlyFor(target.file, async () => {
        // Everything of the model but the clone: files and rows.
        for (const name of fs.readdirSync(folder)) if (!name.endsWith(".reuse.tmp")) fs.rmSync(path.join(folder, name));
        await prisma.print.delete({ where: { id: target.print.id } });
      }),
    });
    await backfill();
    expect(fs.existsSync(folder)).toBe(false);
  });
});

describe("after a crash during a swap", () => {
  const journal = (value: object) =>
    prisma.setting.upsert({
      where: { key: "file_reuse_backfill_tmp" },
      create: { key: "file_reuse_backfill_tmp", value },
      update: { value },
    });
  const named = (file: string) =>
    path.join(fs.realpathSync(path.dirname(file)), `.dup.pdf.${nonce().slice(0, 12)}.reuse.tmp`);

  /** One stored file with its hash on record, a clone beside it, and a journal that says a swap was under way. */
  async function crashed() {
    const { bytes, files } = await stored(1);
    const [only] = files;
    await prisma.printFile.update({ where: { id: only.row.id }, data: { contentSha256: sha(bytes) } });
    const tmp = named(only.file);
    const backup = named(only.file);
    const entry = { path: tmp, backup, kind: "printFile", id: only.row.id, sha: sha(bytes) };
    return { bytes, file: only.file, row: only.row, tmp, backup, entry };
  }

  /** The state after the rename: the original under its second name only, the path holding the clone. */
  function renamed(c: Awaited<ReturnType<typeof crashed>>) {
    fs.linkSync(c.file, c.backup);
    fs.writeFileSync(c.tmp, c.bytes);
    fs.renameSync(c.tmp, c.file);
  }

  const run = async () => {
    mockClones({ unsupported: true });
    await backfill();
  };

  it("after the link, before the rename: removes the second name and the clone, keeping the original", async () => {
    const c = await crashed();
    const ino = fs.statSync(c.file).ino;
    fs.linkSync(c.file, c.backup);
    fs.writeFileSync(c.tmp, c.bytes);
    await journal(c.entry);
    await run();
    expect(fs.existsSync(c.backup)).toBe(false);
    expect(fs.existsSync(c.tmp)).toBe(false);
    expect(fs.statSync(c.file)).toMatchObject({ ino, nlink: 1 });
    expect(fs.readFileSync(c.file).equals(c.bytes)).toBe(true);
  });

  it("after the rename, original unchanged: removes the second name, the clone stays", async () => {
    const c = await crashed();
    renamed(c);
    await journal(c.entry);
    await run();
    expect(fs.existsSync(c.backup)).toBe(false);
    expect(fs.readFileSync(c.file).equals(c.bytes)).toBe(true);
    expect(leftoverTemps()).toEqual([]);
    expect(await prisma.setting.findUnique({ where: { key: "file_reuse_backfill_tmp" } })).toBeNull();
  });

  it("after the rename, original written to since: puts it back over the clone", async () => {
    const c = await crashed();
    renamed(c);
    const changed = Buffer.concat([c.bytes, Buffer.from(" written late")]);
    fs.writeFileSync(c.backup, changed);
    await journal(c.entry);
    await run();
    expect(fs.existsSync(c.backup)).toBe(false);
    expect(fs.readFileSync(c.file).equals(changed)).toBe(true);
  });

  it("after the rename, clone edited since: keeps the edit, removes the unchanged original", async () => {
    const c = await crashed();
    renamed(c);
    const edited = Buffer.concat([c.bytes, Buffer.from(" edited later")]);
    fs.writeFileSync(c.file, edited);
    await journal(c.entry);
    await run();
    expect(fs.existsSync(c.backup)).toBe(false);
    expect(fs.readFileSync(c.file).equals(edited)).toBe(true);
  });

  it("after the rename, both changed: keeps both, never deleting bytes it can't account for", async () => {
    const c = await crashed();
    renamed(c);
    const original = Buffer.concat([c.bytes, Buffer.from(" a")]);
    const clone = Buffer.concat([c.bytes, Buffer.from(" b")]);
    fs.writeFileSync(c.backup, original);
    fs.writeFileSync(c.file, clone);
    await journal(c.entry);
    await run();
    expect(fs.readFileSync(c.backup).equals(original)).toBe(true);
    expect(fs.readFileSync(c.file).equals(clone)).toBe(true);
    fs.rmSync(c.backup);
  });

  it("with the path gone and its row still there: links the original back", async () => {
    const c = await crashed();
    fs.linkSync(c.file, c.backup);
    fs.rmSync(c.file);
    await journal(c.entry);
    await run();
    expect(fs.readFileSync(c.file).equals(c.bytes)).toBe(true);
    expect(fs.existsSync(c.backup)).toBe(false);
  });

  it("with the row deleted: removes the second name with it", async () => {
    const c = await crashed();
    renamed(c);
    await journal(c.entry);
    await prisma.printFile.delete({ where: { id: c.row.id } });
    await run();
    expect(fs.existsSync(c.backup)).toBe(false);
  });

  it("trusts the journal no further than its own temp names inside storage", async () => {
    const c = await crashed();
    renamed(c);
    const plain = tempFile(dir, "not ours");
    await journal({ ...c.entry, backup: plain });
    await run();
    expect(fs.existsSync(plain)).toBe(true);
    fs.rmSync(c.backup);
  });

  it("recovers a swap that really stopped after the rename", async () => {
    const { bytes, files } = await stored();
    const target = files[1];
    const realRm = fsp.rm;
    let died = false;
    // As if the process died after the rename, before the original's second name was removed.
    vi.spyOn(fsp, "rm").mockImplementation(async (p, options) => {
      if (!died && String(p).endsWith(".reuse.tmp")) {
        died = true;
        throw new Error("crash");
      }
      return realRm(p, options);
    });
    mockClones();
    await backfill();
    expect(died).toBe(true);
    expect(leftoverTemps().length).toBe(1);
    const entry = (await prisma.setting.findUniqueOrThrow({ where: { key: "file_reuse_backfill_tmp" } })).value as any;
    expect(fs.existsSync(entry.backup)).toBe(true);
    vi.restoreAllMocks();
    // The next start settles it before anything else.
    mockClones();
    await backfill();
    expect(leftoverTemps()).toEqual([]);
    expect(fs.readFileSync(target.file).equals(bytes)).toBe(true);
  });

  it("settles what a run left even when the switch is off at start-up", async () => {
    const c = await crashed();
    renamed(c);
    await journal(c.entry);
    await prisma.setting.create({
      data: { key: "file_reuse_backfill_pending", value: { userId: null, phase: "hashing", cursor: "" } },
    });
    await setFileReuse("off");
    await resumeFileReuseBackfill();
    expect(fs.existsSync(c.backup)).toBe(false);
    expect(fs.readFileSync(c.file).equals(c.bytes)).toBe(true);
    expect(await prisma.setting.findUnique({ where: { key: "file_reuse_backfill_pending" } })).toBeNull();
    expect(await prisma.setting.findUnique({ where: { key: "file_reuse_backfill_tmp" } })).toBeNull();
  });
});

describe("failures and what's left out", () => {
  it("flags a run that hit an error, and says so in the admin route", async () => {
    const { files } = await stored();
    mockClones();
    await setFileReuse("reflink");
    vi.spyOn(prisma.setting, "upsert").mockRejectedValue(new Error("database went away"));
    const state = startFileReuseBackfill(null)!;
    while (state.running) await sleep(20);
    expect(state).toMatchObject({ failed: true, running: false });
    vi.restoreAllMocks();
    const res = await request(app)
      .get("/api/settings/file-reuse")
      .set({ Authorization: `Bearer ${adminToken}` });
    expect(res.body.backfill).toMatchObject({ failed: true });
    expect(fs.existsSync(files[1].file)).toBe(true);
    mockClones();
    expect((await backfill()).failed).toBe(false);
  });

  it("leaves the legacy shared folder (bundles/) out of hashing and sharing", async () => {
    const { bytes, files } = await stored(1);
    const folder = path.join(STORAGE, "bundles");
    fs.mkdirSync(folder, { recursive: true });
    const legacy = path.join(folder, `${nonce()}.pdf`);
    fs.writeFileSync(legacy, bytes);
    const row = await prisma.printFile.create({
      data: {
        printId: files[0].print.id,
        role: "SUPPORTING",
        filename: "dup.pdf",
        mime: "application/pdf",
        size: bytes.length,
        storagePath: path.relative(STORAGE, legacy),
        // Hashed as can be done by an older version: it must still never be a member of a group.
        contentSha256: sha(bytes),
      },
    });
    const ino = fs.statSync(legacy).ino;
    const clones = mockClones();
    await backfill();
    expect(fs.statSync(legacy).ino).toBe(ino);
    expect(clones.filter((c) => c.to.startsWith(folder))).toEqual([]);
    expect(clonedFor(clones, files[0].file)).toBe(false);
    await prisma.printFile.delete({ where: { id: row.id } });
    fs.rmSync(legacy);
  });

  it("probes for clones the way every clone is made, from the open file's handle path", async () => {
    const sources: string[] = [];
    vi.spyOn(fsp, "copyFile").mockImplementation(async (src, _to, mode) => {
      if ((mode ?? 0) & COPYFILE_FICLONE_FORCE) sources.push(String(src));
      throw Object.assign(new Error("EOPNOTSUPP"), { code: "EOPNOTSUPP" });
    });
    const state = await backfill();
    expect(state.unsupported).toBe(true);
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.every((src) => /^\/(proc\/self|dev)\/fd\/\d+$/.test(src))).toBe(true);
  });
});

describe("the admin routes", () => {
  const admin = () => ({ Authorization: `Bearer ${adminToken}` });

  it("starts a run when the switch is turned on, and again on request", async () => {
    mockClones();
    await setFileReuse("off");
    let res = await request(app).post("/api/settings/file-reuse").set(admin()).send({ mode: "reflink" });
    expect(res.status).toBe(200);
    expect(res.body.backfill).toMatchObject({ phase: expect.any(String), skipped: expect.any(Number) });
    while (currentFileReuseBackfill()?.running) await sleep(20);
    res = await request(app).get("/api/settings/file-reuse").set(admin());
    expect(res.body.backfill).toMatchObject({ running: false, stopped: false });
    res = await request(app).post("/api/settings/file-reuse/backfill").set(admin());
    expect(res.status).toBe(200);
    while (currentFileReuseBackfill()?.running) await sleep(20);
    const log = await prisma.log.findFirst({ where: { action: "file_reuse_backfill_started" } });
    expect(log).not.toBeNull();
  });

  it("refuses to run again with the switch off, or while model files are moving, and the other way round", async () => {
    mockClones();
    await setFileReuse("off");
    let res = await request(app).post("/api/settings/file-reuse/backfill").set(admin());
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("file_reuse_off");

    await setFileReuse("reflink");
    // A storage move in the run state; started on the template already saved, so it moves nothing it shouldn't.
    const template = await request(app).get("/api/settings/storage").set(admin());
    const move = startStorageMove(null, template.body.template);
    res = await request(app).post("/api/settings/file-reuse/backfill").set(admin());
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("storage_moving");
    await until(() => !move?.running);

    // The other way: saving a storage structure while the backfill runs.
    let release!: () => void;
    const held = withStorageLock(() => new Promise<void>((resolve) => (release = resolve)));
    await setFileReuse("reflink");
    const running = startFileReuseBackfill(null);
    expect(running).not.toBeNull();
    res = await request(app).post("/api/settings/storage").set(admin()).send({ template: template.body.template });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("file_reuse_running");
    release();
    await held;
    await until(() => !running?.running);
  });
  it("starts a new run once a stopped one has ended, when turned on again meanwhile", async () => {
    const { files } = await stored(3);
    let first = true;
    mockClones({
      afterClone: async () => {
        // Once: the switch is turned off mid-run, and the run is left winding down.
        if (first) await setFileReuse("off");
        first = false;
      },
    });
    // Held where the run clears its journal on the way out, after it has noticed the switch is off.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const realDelete = prisma.setting.deleteMany.bind(prisma.setting);
    let old: ReturnType<typeof startFileReuseBackfill> = null;
    vi.spyOn(prisma.setting, "deleteMany").mockImplementation(((args: any) =>
      (async () => {
        if (old?.stopped) await gate;
        return realDelete(args);
      })()) as any);
    await setFileReuse("reflink");
    old = startFileReuseBackfill(null)!;
    await until(() => old!.stopped);
    expect(old!.running).toBe(true);

    // Turned on again while the old run is still ending: remembered, and shown as such.
    const res = await request(app).post("/api/settings/file-reuse").set(admin()).send({ mode: "reflink" });
    expect(res.status).toBe(200);
    expect(res.body.backfill).toMatchObject({ running: true, stopped: true, restart_queued: true });
    expect(startFileReuseBackfill(null)).toBeNull();

    release();
    await until(() => !old!.running && !!currentFileReuseBackfill() && currentFileReuseBackfill() !== old);
    const next = currentFileReuseBackfill()!;
    await until(() => !next.running);
    expect(next).toMatchObject({ stopped: false, failed: false, cloned: 2 });
    expect(files.every((f) => fs.readFileSync(f.file).length > 0)).toBe(true);
  });

  it("drops a queued start when the switch is off again by the time the old run ends", async () => {
    await stored(3);
    mockClones({ afterClone: async () => void (await setFileReuse("off")) });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const realDelete = prisma.setting.deleteMany.bind(prisma.setting);
    let old: ReturnType<typeof startFileReuseBackfill> = null;
    vi.spyOn(prisma.setting, "deleteMany").mockImplementation(((args: any) =>
      (async () => {
        if (old?.stopped) await gate;
        return realDelete(args);
      })()) as any);
    await setFileReuse("reflink");
    old = startFileReuseBackfill(null)!;
    await until(() => old!.stopped);
    expect(old!.running).toBe(true);
    startFileReuseBackfill(null);
    release();
    await until(() => !old!.running && !old!.restartQueued);
    expect(currentFileReuseBackfill()).toBe(old);
    expect(old.restartQueued).toBe(false);
  });
});
