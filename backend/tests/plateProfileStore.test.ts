import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import request from "supertest";
import { Prisma } from "@prisma/client";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { createPrint, resolvePlateFilePath } from "../src/services/printCreation";
import { printOutsByIds } from "../src/services/printLoader";
import { storePlateProfile } from "../src/services/plateProfile";
import { nonce, register } from "./helpers/fileReuse";

const app = createApp();
let dir: string;
let userId: string;
let token: string;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "plate-profile-store-"));
  const user = await register(app, "profilestore", "owner");
  userId = user.id;
  token = user.token;
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const TITLE = "0.22mm layer, 2 walls, 10% infill";

async function threeMf(withProfile: boolean): Promise<string> {
  const zip = new JSZip();
  const meta = withProfile ? `<metadata name="ProfileTitle">${TITLE}</metadata>` : "";
  zip.file("3D/3dmodel.model", `<?xml version="1.0"?><model>${meta}<!-- ${nonce()} --><resources/></model>`);
  if (withProfile) {
    zip.file(
      "Metadata/project_settings.config",
      JSON.stringify({ printer_model: "Bambu Lab A1 mini", nozzle_diameter: ["0.4"], filament_type: ["PLA"] }),
    );
  }
  const file = path.join(dir, `${nonce()}.3mf`);
  fs.writeFileSync(file, await zip.generateAsync({ type: "nodebuffer" }));
  return file;
}

async function makePlate(filename: string, source: string) {
  const { print, plates } = await createPrint(userId, { title: `Profile ${nonce()}` }, "profile", [
    { filename, tempFilePath: source },
  ]);
  return { printId: print.id, plateId: plates[0].id };
}

const stored = (id: string) => prisma.plate.findUniqueOrThrow({ where: { id } });

async function getPrint(printId: string) {
  const res = await request(app)
    .get(`/api/print/${printId}`)
    .set({ Authorization: `Bearer ${token}` });
  expect(res.status).toBe(200);
  return res.body.plates[0];
}

describe("the 3MF profile of a plate", () => {
  it("stores the profile when a 3MF plate is created", async () => {
    const { printId, plateId } = await makePlate("model.3mf", await threeMf(true));
    expect(await stored(plateId)).toMatchObject({ profileMeta: { version: 2, title: TITLE } });
    const plate = await getPrint(printId);
    expect(plate.profile).toMatchObject({ title: TITLE, printer: "Bambu Lab A1 mini", nozzle_mm: 0.4 });
    expect(plate.profile).not.toHaveProperty("version");
  });

  it("backfills an existing plate on GET /print/:id", async () => {
    const { printId, plateId } = await makePlate("model.3mf", await threeMf(true));
    await prisma.plate.update({ where: { id: plateId }, data: { profileMeta: Prisma.JsonNull } });
    expect((await getPrint(printId)).profile.title).toBe(TITLE);
    expect(await stored(plateId)).toMatchObject({ profileMeta: { version: 2, title: TITLE } });
  });

  it("re-reads an outdated version", async () => {
    const { printId, plateId } = await makePlate("model.3mf", await threeMf(true));
    await prisma.plate.update({ where: { id: plateId }, data: { profileMeta: { version: 0 } } });
    expect((await getPrint(printId)).profile.title).toBe(TITLE);
    expect(await stored(plateId)).toMatchObject({ profileMeta: { version: 2 } });
  });

  it("re-reads a version 1 profile, which has no plate_stats", async () => {
    const { printId, plateId } = await makePlate("model.3mf", await threeMf(true));
    await prisma.plate.update({ where: { id: plateId }, data: { profileMeta: { version: 1, title: "old" } } });
    const profile = (await getPrint(printId)).profile;
    expect(profile.title).toBe(TITLE);
    expect(profile.plate_stats).toEqual([]);
    expect(await stored(plateId)).toMatchObject({ profileMeta: { version: 2, plate_stats: [] } });
  });

  it("re-reads a plate whose file changed since the profile was stored", async () => {
    const { printId, plateId } = await makePlate("model.3mf", await threeMf(true));
    expect(await stored(plateId)).toMatchObject({ profileMeta: { file: { size: expect.any(Number) } } });
    const filePath = resolvePlateFilePath(await stored(plateId))!;
    const zip = new JSZip();
    zip.file(
      "3D/3dmodel.model",
      `<?xml version="1.0"?><model><metadata name="ProfileTitle">changed</metadata><resources/></model>`,
    );
    fs.writeFileSync(filePath, await zip.generateAsync({ type: "nodebuffer" }));
    expect((await getPrint(printId)).profile.title).toBe("changed");
  });

  it("drops the old profile when the changed file can't be read", async () => {
    const { printId, plateId } = await makePlate("model.3mf", await threeMf(true));
    const filePath = resolvePlateFilePath(await stored(plateId))!;
    fs.writeFileSync(filePath, "not a zip any more");
    expect((await getPrint(printId)).profile).toBeNull();
  });

  it("drops the old profile when the stamped file is gone, keeping the stored row", async () => {
    const { printId, plateId } = await makePlate("model.3mf", await threeMf(true));
    fs.rmSync(resolvePlateFilePath(await stored(plateId))!);
    expect((await getPrint(printId)).profile).toBeNull();
    expect(await stored(plateId)).toMatchObject({ profileMeta: { version: 2, title: TITLE } });
  });

  it("does not re-read a current profile stored without a file stamp", async () => {
    const { printId, plateId } = await makePlate("model.3mf", await threeMf(true));
    await prisma.plate.update({ where: { id: plateId }, data: { profileMeta: { version: 2, title: "kept" } } });
    expect((await getPrint(printId)).profile.title).toBe("kept");
    expect((await stored(plateId)).profileMeta).toEqual({ version: 2, title: "kept" });
  });

  it("leaves STL plates alone", async () => {
    const stl = path.join(dir, `${nonce()}.stl`);
    fs.writeFileSync(stl, `solid ${nonce()}\nendsolid\n`);
    const { printId, plateId } = await makePlate("part.stl", stl);
    expect((await getPrint(printId)).profile).toBeNull();
    expect((await stored(plateId)).profileMeta).toBeNull();
  });

  it("does not store anything when the file is missing", async () => {
    const { printId, plateId } = await makePlate("model.3mf", await threeMf(true));
    await prisma.plate.update({ where: { id: plateId }, data: { profileMeta: Prisma.JsonNull } });
    fs.rmSync(resolvePlateFilePath(await stored(plateId))!);
    expect((await getPrint(printId)).profile).toBeNull();
    expect((await stored(plateId)).profileMeta).toBeNull();
  });

  it("returns null profile for a 3MF without metadata", async () => {
    const { printId, plateId } = await makePlate("model.3mf", await threeMf(false));
    expect((await getPrint(printId)).profile).toBeNull();
    expect((await stored(plateId)).profileMeta).toMatchObject({ version: 2, title: null, materials: [] });
  });

  it("reads an unread 3MF profile on the bounded lookup by ids", async () => {
    const { printId, plateId } = await makePlate("model.3mf", await threeMf(true));
    await prisma.plate.update({ where: { id: plateId }, data: { profileMeta: Prisma.JsonNull } });
    const outs = await printOutsByIds(userId, [printId]);
    expect(outs.get(printId)!.plates[0].profile?.title).toBe(TITLE);
    expect(await stored(plateId)).toMatchObject({ profileMeta: { version: 2, title: TITLE } });
  });

  it("leaves the plates of prints the caller doesn't own unread", async () => {
    const { printId, plateId } = await makePlate("model.3mf", await threeMf(true));
    await prisma.plate.update({ where: { id: plateId }, data: { profileMeta: Prisma.JsonNull } });
    const other = await register(app, "profilestore", "stranger");
    expect((await printOutsByIds(other.id, [printId])).size).toBe(0);
    expect((await stored(plateId)).profileMeta).toBeNull();
  });

  it("does not store a profile read for a name the plate no longer has", async () => {
    const { plateId } = await makePlate("model.3mf", await threeMf(true));
    await prisma.plate.update({
      where: { id: plateId },
      data: { profileMeta: Prisma.JsonNull, filename: "notes.txt" },
    });
    const filePath = resolvePlateFilePath(await stored(plateId))!;
    expect(await storePlateProfile(plateId, "model.3mf", filePath)).toBeNull();
    expect((await stored(plateId)).profileMeta).toBeNull();
  });
});
