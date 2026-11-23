import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { STORAGE } from "../../src/config";
import { prisma } from "../../src/db";
import { NAME_MAX_BYTES } from "../../src/files/names";
import { stl, threeMf } from "../providers/support";

// What the name rule changes for a file someone uploads: the name it's kept under and where it's stored.

const app = createApp();
let token: string;

beforeAll(async () => {
  const res = await request(app)
    .post("/api/register")
    .send({ displayName: "Names", email: `names-${Date.now()}@example.com`, password: "password123" });
  token = res.body.token;
});

async function upload(files: { name: string; bytes: Buffer }[]) {
  const req = request(app)
    .post("/api/upload")
    .set({ Authorization: `Bearer ${token}` });
  if (files.length > 1) req.field("mode", "multiplate");
  for (const file of files) req.attach("files", file.bytes, { filename: file.name });
  const res = await req;
  expect(res.status).toBe(200);
  return prisma.plate.findMany({ where: { printId: res.body.prints[0].id }, orderBy: { position: "asc" } });
}

describe("a name as it comes in", () => {
  it("loses a trailing space, so the file is still an STL", async () => {
    const [plate] = await upload([{ name: "part.STL ", bytes: stl("part") }]);
    expect(plate.filename).toBe("part.STL");
    expect(plate.storagePath.endsWith("part.STL")).toBe(true);
  });

  it("numbers a second file of a name before its whole extension", async () => {
    const plates = await upload([
      { name: "job.gcode.3mf", bytes: await threeMf("first job") },
      { name: "job.gcode.3mf", bytes: await threeMf("second job") },
    ]);
    expect(plates.map((plate) => plate.filename)).toEqual(["job.gcode.3mf", "job (2).gcode.3mf"]);
  });

  it("stores a name longer than a file system holds, cut before its extension", async () => {
    const [plate] = await upload([{ name: `${"組".repeat(100)}.stl`, bytes: stl("long") }]);
    expect(plate.filename).toBe(`${"組".repeat(78)}.stl`);
    const stored = path.basename(plate.storagePath);
    expect(Buffer.byteLength(stored)).toBeLessThanOrEqual(NAME_MAX_BYTES);
    expect(stored.endsWith(".stl")).toBe(true);
    expect(fs.existsSync(path.join(STORAGE, plate.storagePath))).toBe(true);
  });
});
