import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { createApp } from "../src/app";
import { STORAGE } from "../src/config";
import { register } from "./helpers/fileReuse";
import { createPrint } from "../src/services/printCreation";
import { managedPlatePath } from "../src/services/printService";
import { plateContentSha256 } from "../src/services/importService";
import { MIN_SHARE_BYTES, sha256OfFile } from "../src/services/fileReuse";
import { setFileReuse, type FileReuse } from "../src/services/settingsService";
import { prisma } from "../src/db";

const app = createApp();
let firstUserId: string;
let firstToken: string;
let secondUserId: string;
let userToken: string;
let adminToken: string;
let dir: string;
const { COPYFILE_EXCL, COPYFILE_FICLONE_FORCE } = fs.constants;
const realCopyFile = fsp.copyFile;

/** Whether the storage folder's filesystem can clone (btrfs, XFS, ...); tmpfs and ext4 can't. Probed as the file
 *  loads rather than in beforeAll, as it.runIf is decided then. */
const reflinks = (() => {
  fs.mkdirSync(STORAGE, { recursive: true });
  const probe = fs.mkdtempSync(path.join(STORAGE, ".reflink-probe-"));
  try {
    fs.writeFileSync(path.join(probe, "a"), "probe");
    fs.copyFileSync(path.join(probe, "a"), path.join(probe, "b"), COPYFILE_FICLONE_FORCE);
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(probe, { recursive: true, force: true });
  }
})();

/** Clones that succeeded, counted, and every clone tried, in `attempts`; where the storage folder can't clone, one is
 *  simulated with a plain exclusive copy, as a reflink-capable filesystem would make it, so the checks around it still
 *  run. `beforeClone` runs first, with the destination. */
function watchClones(beforeClone?: (target: string) => void) {
  const clones: string[] = [];
  const attempts: string[] = [];
  vi.spyOn(fsp, "copyFile").mockImplementation(async (src, target, mode) => {
    if (mode === undefined || !(mode & COPYFILE_FICLONE_FORCE)) return realCopyFile(src, target, mode);
    // Not the model's own render, which is saved in the background (as a gallery image, through a temp file) and shared
    // like any picture when two models render alike: it's no plate file.
    if (String(target).endsWith(".tmp")) return realCopyFile(src, target, reflinks ? mode : COPYFILE_EXCL);
    attempts.push(String(target));
    beforeClone?.(String(target));
    await realCopyFile(src, target, reflinks ? mode : COPYFILE_EXCL);
    clones.push(String(target));
  });
  return { clones, attempts };
}

/** An STL no other test has stored, so only the copies made here can match it. */
function uniqueStl(): string {
  const file = path.join(dir, `${crypto.randomBytes(6).toString("hex")}.stl`);
  const nonce = crypto.randomBytes(16).toString("hex");
  // A comment block takes it past MIN_SHARE_BYTES: a smaller file is never shared.
  const padding = `; ${"padding ".repeat(MIN_SHARE_BYTES / 8)}\n`;
  fs.writeFileSync(
    file,
    `solid ${nonce}\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid ${nonce}\n${padding}`,
  );
  return file;
}

/** `source` imported by `userId` as a downloaded (temp) file is. */
async function importAs(userId: string, source: string, title: string) {
  const temp = path.join(dir, `temp-${crypto.randomBytes(6).toString("hex")}.stl`);
  fs.copyFileSync(source, temp);
  const { print, plates } = await createPrint(userId, { title }, title, [
    { filename: "shared.stl", tempFilePath: temp },
  ]);
  expect(fs.existsSync(temp)).toBe(false);
  return { print, plate: plates[0], file: managedPlatePath(plates[0]) };
}

/** The same file, imported by each user in turn. */
async function importForBoth(mode: FileReuse, source: string) {
  await setFileReuse(mode);
  return [
    await importAs(firstUserId, source, `Shared ${mode}`),
    await importAs(secondUserId, source, `Shared ${mode}`),
  ];
}

const stored = (id: string) => prisma.plate.findUnique({ where: { id } });

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "plate-reuse-"));
  const first = await register(app, "reuse", "first");
  firstUserId = first.id;
  firstToken = first.token;
  const second = await register(app, "reuse", "second");
  secondUserId = second.id;
  userToken = second.token;
  const admin = await register(app, "reuse", "admin");
  await prisma.user.update({ where: { id: admin.id }, data: { role: "ADMIN" } });
  // Tokens carry the role from when they were issued.
  adminToken = (await request(app).post("/api/login").send({ email: admin.email, password: "password123" })).body.token;
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma.setting.deleteMany({ where: { key: "file_reuse" } });
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("reusing identical plate files", () => {
  it("gives the second user the right file, hashed, whether or not the filesystem can clone", async () => {
    const source = uniqueStl();
    const [first, second] = await importForBoth("reflink", source);
    expect(second.file).not.toBe(first.file);
    expect(fs.statSync(second.file).ino).not.toBe(fs.statSync(first.file).ino);
    expect(first.plate.contentSha256).toBe(await sha256OfFile(source));
    expect(second.plate.contentSha256).toBe(first.plate.contentSha256);
    expect(second.plate.size).toBe(fs.statSync(source).size);
    expect(fs.readFileSync(second.file, "utf8")).toBe(fs.readFileSync(source, "utf8"));

    // Edited on disk outside Thingport: the other user's file stays as it was.
    fs.appendFileSync(first.file, "changed\n");
    expect(fs.readFileSync(second.file, "utf8")).toBe(fs.readFileSync(source, "utf8"));
  });

  it.runIf(reflinks)(
    "really clones it where the storage folder can, and a deleted model takes only its own copy",
    async () => {
      const { clones } = watchClones();
      const source = uniqueStl();
      const [first, second] = await importForBoth("reflink", source);
      expect(clones).toEqual([second.file]);
      expect(fs.readFileSync(second.file, "utf8")).toBe(fs.readFileSync(source, "utf8"));

      fs.appendFileSync(second.file, "changed\n");
      expect(fs.readFileSync(first.file, "utf8")).toBe(fs.readFileSync(source, "utf8"));
      fs.writeFileSync(second.file, fs.readFileSync(source));

      const res = await request(app)
        .delete(`/api/print/${first.print.id}`)
        .set({ Authorization: `Bearer ${firstToken}` });
      expect(res.status).toBe(200);
      expect(fs.existsSync(first.file)).toBe(false);
      expect(fs.readFileSync(second.file, "utf8")).toBe(fs.readFileSync(source, "utf8"));
    },
  );

  it("leaves the second user's file when the first user deletes the model", async () => {
    const source = uniqueStl();
    const [first, second] = await importForBoth("reflink", source);
    const res = await request(app)
      .delete(`/api/print/${first.print.id}`)
      .set({ Authorization: `Bearer ${firstToken}` });
    expect(res.status).toBe(200);
    expect(fs.existsSync(first.file)).toBe(false);
    expect(fs.readFileSync(second.file, "utf8")).toBe(fs.readFileSync(source, "utf8"));
    expect((await stored(second.plate.id))?.contentSha256).toBe(await sha256OfFile(source));
  });

  it("falls back to its own copy when the stored one is gone", async () => {
    const source = uniqueStl();
    await setFileReuse("reflink");
    const gone = await importAs(firstUserId, source, "Gone");
    fs.rmSync(gone.file);

    const second = await importAs(secondUserId, source, "Gone again");
    expect(fs.readFileSync(second.file, "utf8")).toBe(fs.readFileSync(source, "utf8"));
    expect((await stored(gone.plate.id))?.contentSha256).toBeNull();
  });

  it("doesn't reuse a stored copy edited on disk since it was hashed, and stops offering it", async () => {
    const { clones } = watchClones();
    const source = uniqueStl();
    await setFileReuse("reflink");
    const first = await importAs(firstUserId, source, "Edited");
    // Edited in place outside Thingport, keeping its size, so only its content tells.
    fs.writeFileSync(first.file, fs.readFileSync(first.file, "utf8").replace("solid", "SOLID"));

    const second = await importAs(secondUserId, source, "Again");
    // It was cloned, read back, found to differ and dropped; the file was then stored as usual.
    expect(clones).toEqual([second.file]);
    expect(fs.readFileSync(second.file, "utf8")).toBe(fs.readFileSync(source, "utf8"));
    expect((await stored(first.plate.id))?.contentSha256).toBeNull();
    expect(fs.readFileSync(first.file, "utf8")).toContain("SOLID");
  });

  it("stores each copy on its own, unhashed, when turned off", async () => {
    const [first, second] = await importForBoth("off", uniqueStl());
    expect(fs.statSync(second.file).ino).not.toBe(fs.statSync(first.file).ino);
    expect(first.plate.contentSha256).toBeNull();
    expect(second.plate.contentSha256).toBeNull();
  });

  it("doesn't share files that only have the same size", async () => {
    const { attempts } = watchClones();
    await setFileReuse("reflink");
    const a = uniqueStl();
    const b = uniqueStl();
    expect(fs.statSync(a).size).toBe(fs.statSync(b).size);
    await createPrint(firstUserId, { title: "A" }, "A", [{ filename: "a.stl", copyFromPath: a }]);
    const { plates: two } = await createPrint(secondUserId, { title: "B" }, "B", [
      { filename: "b.stl", copyFromPath: b },
    ]);
    expect(fs.readFileSync(managedPlatePath(two[0]), "utf8")).toBe(fs.readFileSync(b, "utf8"));
    expect(fs.existsSync(b)).toBe(true);
    expect(attempts).toEqual([]);
  });

  it("leaves a file saved at the destination meanwhile untouched, reporting a conflict", async () => {
    const source = uniqueStl();
    await setFileReuse("reflink");
    await importAs(firstUserId, source, "Taken");
    let taken: string | undefined;
    watchClones((target) => {
      // Someone else's file, there before the clone.
      taken = target;
      fs.writeFileSync(target, "someone else's");
    });
    const temp = path.join(dir, `temp-${crypto.randomBytes(6).toString("hex")}.stl`);
    fs.copyFileSync(source, temp);
    await expect(
      createPrint(secondUserId, { title: "Taken again" }, "Taken again", [
        { filename: "shared.stl", tempFilePath: temp },
      ]),
    ).rejects.toMatchObject({ status: 409 });
    expect(taken).toBeDefined();
    expect(fs.readFileSync(taken!, "utf8")).toBe("someone else's");
    fs.rmSync(taken!);
  });

  it("stores as usual, hash recorded, when the stored copies can't be looked up", async () => {
    const { attempts } = watchClones();
    const source = uniqueStl();
    await setFileReuse("reflink");
    await importAs(firstUserId, source, "Lookup");
    const realFindMany = prisma.plate.findMany.bind(prisma.plate);
    // Only the lookup by content fails.
    vi.spyOn(prisma.plate, "findMany").mockImplementation(((args: any) =>
      args?.where?.contentSha256 ? Promise.reject(new Error("db")) : realFindMany(args)) as any);
    const second = await importAs(secondUserId, source, "Lookup again");
    expect(attempts).toEqual([]);
    expect(fs.readFileSync(second.file, "utf8")).toBe(fs.readFileSync(source, "utf8"));
    expect((await stored(second.plate.id))?.contentSha256).toBe(await sha256OfFile(source));
  });
});

describe("plateContentSha256", () => {
  it("hashes the file as it is now, not as it was recorded, and updates the record", async () => {
    const source = uniqueStl();
    await setFileReuse("reflink");
    const { plate, file } = await importAs(firstUserId, source, "Rehash");
    expect(plate.contentSha256).toBe(await sha256OfFile(source));

    fs.writeFileSync(file, "edited outside Thingport");
    const now = await sha256OfFile(file);
    expect(await plateContentSha256(plate)).toBe(now);
    expect((await stored(plate.id))?.contentSha256).toBe(now);

    fs.rmSync(file);
    expect(await plateContentSha256(plate)).toBeNull();
  });

  it("doesn't overwrite a hash recorded by someone else meanwhile", async () => {
    const source = uniqueStl();
    await setFileReuse("reflink");
    const { plate, file } = await importAs(firstUserId, source, "Meanwhile");
    fs.writeFileSync(file, "edited again outside Thingport");
    const meanwhile = "f".repeat(64);
    await prisma.plate.update({ where: { id: plate.id }, data: { contentSha256: meanwhile } });

    // `plate` still has the hash from before.
    expect(await plateContentSha256(plate)).toBe(await sha256OfFile(file));
    expect((await stored(plate.id))?.contentSha256).toBe(meanwhile);
  });
});

describe("file reuse setting", () => {
  const admin = () => ({ Authorization: `Bearer ${adminToken}` });

  it("is admin-only", async () => {
    const res = await request(app)
      .get("/api/settings/file-reuse")
      .set({ Authorization: `Bearer ${userToken}` });
    expect(res.status).toBe(403);
  });

  it("is off by default, and reports and saves each mode", async () => {
    await prisma.setting.deleteMany({ where: { key: "file_reuse" } });
    expect((await request(app).get("/api/settings/file-reuse").set(admin())).body.mode).toBe("off");
    for (const mode of ["reflink", "off"]) {
      const res = await request(app).post("/api/settings/file-reuse").set(admin()).send({ mode });
      expect(res.status).toBe(200);
      expect((await request(app).get("/api/settings/file-reuse").set(admin())).body.mode).toBe(mode);
    }
  });

  it("rejects an unknown mode, hard links included", async () => {
    for (const mode of ["symlink", "hardlink"])
      expect((await request(app).post("/api/settings/file-reuse").set(admin()).send({ mode })).status).toBe(400);
  });

  it("reads a stored hard-link mode, from before it was removed, as off", async () => {
    await prisma.setting.upsert({
      where: { key: "file_reuse" },
      create: { key: "file_reuse", value: "hardlink" },
      update: { value: "hardlink" },
    });
    expect((await request(app).get("/api/settings/file-reuse").set(admin())).body.mode).toBe("off");
  });
});
