import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { createApp } from "../src/app";
import { createPrint } from "../src/services/printCreation";
import { managedPlatePath } from "../src/services/printService";
import { setPlateFileReuse, type PlateFileReuse } from "../src/services/settingsService";
import { prisma } from "../src/db";

const app = createApp();
let firstUserId: string;
let secondUserId: string;
let userToken: string;
let adminToken: string;
let dir: string;

async function register(name: string) {
  const email = `reuse-${name}-${Date.now()}@example.com`;
  const res = await request(app).post("/api/register").send({ displayName: name, email, password: "password123" });
  return { id: res.body.user.id as string, token: res.body.token as string, email };
}

/** An STL no other test has stored, so only the copies made here can match it. */
function uniqueStl(): string {
  const file = path.join(dir, `${crypto.randomBytes(6).toString("hex")}.stl`);
  const nonce = crypto.randomBytes(16).toString("hex");
  fs.writeFileSync(
    file,
    `solid ${nonce}\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid ${nonce}\n`,
  );
  return file;
}

/** The same file, imported by each user in turn, as a downloaded (temp) file is. */
async function importForBoth(mode: PlateFileReuse, source: string) {
  await setPlateFileReuse(mode);
  const plates = [];
  for (const userId of [firstUserId, secondUserId]) {
    const temp = path.join(dir, `temp-${crypto.randomBytes(6).toString("hex")}.stl`);
    fs.copyFileSync(source, temp);
    const { plates: created } = await createPrint(userId, { title: `Shared ${mode}` }, "Shared", [
      { filename: "shared.stl", tempFilePath: temp },
    ]);
    expect(fs.existsSync(temp)).toBe(false);
    plates.push(created[0]);
  }
  return plates.map((plate) => ({ plate, file: managedPlatePath(plate) }));
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "plate-reuse-"));
  firstUserId = (await register("first")).id;
  const second = await register("second");
  secondUserId = second.id;
  userToken = second.token;
  const admin = await register("admin");
  await prisma.user.update({ where: { id: admin.id }, data: { role: "ADMIN" } });
  // Tokens carry the role from when they were issued.
  adminToken = (await request(app).post("/api/login").send({ email: admin.email, password: "password123" })).body.token;
});

afterAll(async () => {
  await prisma.setting.deleteMany({ where: { key: "plate_file_reuse" } });
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("reusing identical plate files", () => {
  it("hard-links a file another user already stored", async () => {
    const source = uniqueStl();
    const [first, second] = await importForBoth("hardlink", source);
    expect(second.file).not.toBe(first.file);
    expect(fs.statSync(second.file).ino).toBe(fs.statSync(first.file).ino);
    expect(second.plate.contentSha256).toBe(first.plate.contentSha256);
    expect(second.plate.size).toBe(fs.statSync(source).size);

    // Deleting one user's copy leaves the other's.
    fs.rmSync(first.file);
    expect(fs.readFileSync(second.file, "utf8")).toBe(fs.readFileSync(source, "utf8"));
  });

  it("clones it as an independent copy, or stores it as usual where the filesystem can't", async () => {
    const source = uniqueStl();
    const [first, second] = await importForBoth("reflink", source);
    expect(fs.statSync(second.file).ino).not.toBe(fs.statSync(first.file).ino);
    expect(second.plate.contentSha256).toBe(first.plate.contentSha256);
    expect(fs.readFileSync(second.file, "utf8")).toBe(fs.readFileSync(source, "utf8"));

    fs.appendFileSync(first.file, "changed\n");
    expect(fs.readFileSync(second.file, "utf8")).toBe(fs.readFileSync(source, "utf8"));
  });

  it("falls back to its own copy when the stored one is gone", async () => {
    const source = uniqueStl();
    await setPlateFileReuse("hardlink");
    const temp = path.join(dir, "gone.stl");
    fs.copyFileSync(source, temp);
    const { plates } = await createPrint(firstUserId, { title: "Gone" }, "Gone", [
      { filename: "gone.stl", tempFilePath: temp },
    ]);
    fs.rmSync(managedPlatePath(plates[0]));

    const [, second] = await importForBoth("hardlink", source);
    expect(fs.readFileSync(second.file, "utf8")).toBe(fs.readFileSync(source, "utf8"));
  });

  it("stores each copy on its own, unhashed, when turned off", async () => {
    const [first, second] = await importForBoth("off", uniqueStl());
    expect(fs.statSync(second.file).ino).not.toBe(fs.statSync(first.file).ino);
    expect(second.plate.contentSha256).toBeNull();
  });

  it("doesn't share files that only have the same size", async () => {
    await setPlateFileReuse("hardlink");
    const a = uniqueStl();
    const b = uniqueStl();
    expect(fs.statSync(a).size).toBe(fs.statSync(b).size);
    const { plates: one } = await createPrint(firstUserId, { title: "A" }, "A", [
      { filename: "a.stl", copyFromPath: a },
    ]);
    const { plates: two } = await createPrint(secondUserId, { title: "B" }, "B", [
      { filename: "b.stl", copyFromPath: b },
    ]);
    expect(fs.statSync(managedPlatePath(two[0])).ino).not.toBe(fs.statSync(managedPlatePath(one[0])).ino);
    expect(fs.existsSync(b)).toBe(true);
  });
});

describe("file reuse setting", () => {
  it("is admin-only", async () => {
    const res = await request(app)
      .get("/api/settings/file-reuse")
      .set({ Authorization: `Bearer ${userToken}` });
    expect(res.status).toBe(403);
  });

  it("reports and saves the mode", async () => {
    const admin = { Authorization: `Bearer ${adminToken}` };
    await prisma.setting.deleteMany({ where: { key: "plate_file_reuse" } });
    expect((await request(app).get("/api/settings/file-reuse").set(admin)).body.mode).toBe("reflink");
    const res = await request(app).post("/api/settings/file-reuse").set(admin).send({ mode: "hardlink" });
    expect(res.status).toBe(200);
    expect((await request(app).get("/api/settings/file-reuse").set(admin)).body.mode).toBe("hardlink");
  });

  it("rejects an unknown mode", async () => {
    const admin = { Authorization: `Bearer ${adminToken}` };
    expect((await request(app).post("/api/settings/file-reuse").set(admin).send({ mode: "symlink" })).status).toBe(400);
  });
});
