import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { PENDING_STORAGE_PATH } from "../src/modelFiles/pending";
import { makePrint, register, upload } from "./helpers/fileReuse";

// Each file's kind and what it can do (files/kinds.ts capsOf), on a model's detail, its file list and the list of
// models: the files kept beside the plates on the detail only, and none still being saved anywhere.

const app = createApp();
let dir: string;
let owner: { id: string; token: string };
let printId: string;
const auth = () => ({ Authorization: `Bearer ${owner.token}` });
const NONE = { preview3d: false, openInSlicer: false, openInStudio: false, customize: false };

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "file-kinds-"));
  owner = await register(app, "kinds", "Kinds");
  printId = (await makePrint(dir, owner.id, "Kinds")).print.id;
  await upload(dir, owner.id, printId, "Guide.pdf", "%PDF-1.4\n");
  await upload(dir, owner.id, printId, "Box.scad", "cube(10);\n");
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: owner.id } });
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("a model's files and what each can do", () => {
  it("gives each plate its kind and what the web app may offer of it", async () => {
    const print = (await request(app).get(`/api/print/${printId}`).set(auth())).body;
    expect(
      print.plates.map((plate: { content_kind: string; caps: unknown }) => [plate.content_kind, plate.caps]),
    ).toEqual([["mesh", { preview3d: true, openInSlicer: true, openInStudio: true, customize: false }]]);
  });

  it("lists the files kept beside the plates on the detail, by name, as GET /files does", async () => {
    const print = (await request(app).get(`/api/print/${printId}`).set(auth())).body;
    const files = (await request(app).get(`/api/print/${printId}/files`).set(auth())).body;
    const shown = (list: { filename: string; content_kind: string; caps: unknown }[]) =>
      list.map((file) => [file.filename, file.content_kind, file.caps]);

    expect(shown(print.supporting_files)).toEqual([
      ["Box.scad", "script", { ...NONE, customize: true }],
      ["Guide.pdf", "document", NONE],
    ]);
    expect(files).toEqual(print.supporting_files);
    expect(print.supporting_file_count).toBe(2);
    expect(print.generator_scripts.map((script: { filename: string }) => script.filename)).toEqual(["Box.scad"]);
  });

  it("gives a list of models the count, not the files", async () => {
    const list = (await request(app).get("/api/prints?limit=100").set(auth())).body;
    const listed = list.find((item: { id: string }) => item.id === printId);

    expect(listed.supporting_file_count).toBe(2);
    expect(listed).not.toHaveProperty("supporting_files");
    expect(listed.plates[0].content_kind).toBe("mesh");
  });

  it("shows no file still being saved: not on the detail, in GET /files, the count or the size", async () => {
    const before = (await request(app).get(`/api/print/${printId}`).set(auth())).body;
    // A save under way: its row is made before its place is claimed.
    const pending = await prisma.printFile.create({
      data: {
        printId,
        role: "SUPPORTING",
        filename: "Coming.txt",
        mime: "text/plain",
        size: 9,
        storagePath: PENDING_STORAGE_PATH,
      },
    });
    try {
      const print = (await request(app).get(`/api/print/${printId}`).set(auth())).body;
      const files = (await request(app).get(`/api/print/${printId}/files`).set(auth())).body;
      const list = (await request(app).get("/api/prints?limit=100").set(auth())).body;

      expect(print.supporting_files).toEqual(before.supporting_files);
      expect(files).toEqual(before.supporting_files);
      expect([print.supporting_file_count, print.total_size]).toEqual([2, before.total_size]);
      expect(list.find((item: { id: string }) => item.id === printId).supporting_file_count).toBe(2);
    } finally {
      await prisma.printFile.delete({ where: { id: pending.id } });
    }
  });
});
