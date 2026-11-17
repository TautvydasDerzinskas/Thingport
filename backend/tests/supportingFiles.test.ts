import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { STORAGE } from "../src/config";
import { prisma } from "../src/db";
import { buildZipEntries } from "../src/services/downloadZip";
import { makePrint, register, upload } from "./helpers/fileReuse";

// A model's supporting files on its page: listed with it, shown in the browser where that's safe, renamed, and zipped.

const app = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

let dir: string;
let owner: { id: string; token: string };
let other: { id: string; token: string };

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "thingport-supporting-files-"));
  owner = await register(app, "supporting-files", "Owner");
  other = await register(app, "supporting-files", "Other");
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("supporting files", () => {
  it("come with the model's page, by name, but not with a list of models", async () => {
    const model = await makePrint(dir, owner.id, "Listed");
    await upload(dir, owner.id, model.print.id, "b-notes.txt", "notes");
    await upload(dir, owner.id, model.print.id, "A guide.pdf", "%PDF-1.4\n");

    const page = await request(app).get(`/api/print/${model.print.id}`).set(auth(owner.token));
    expect(page.status).toBe(200);
    expect(page.body.supporting_file_count).toBe(2);
    expect(page.body.supporting_files.map((file: { filename: string }) => file.filename)).toEqual([
      "A guide.pdf",
      "b-notes.txt",
    ]);
    expect(page.body.supporting_files[0]).toMatchObject({ mime: "application/pdf", size: 9 });

    const list = await request(app).get("/api/prints").set(auth(owner.token));
    const listed = (list.body as { id: string; supporting_files?: unknown }[]).find((p) => p.id === model.print.id);
    expect(listed?.supporting_files).toBeUndefined();
  });

  it("are shown in the browser only where their type is safe to, and downloaded otherwise", async () => {
    const model = await makePrint(dir, owner.id, "Inline");
    const pdf = await upload(dir, owner.id, model.print.id, "guide.pdf", "%PDF-1.4\n");
    const text = await upload(dir, owner.id, model.print.id, "README.md", "# Hello");
    const page = await upload(dir, owner.id, model.print.id, "page.html", "<script>alert(1)</script>");
    const vector = await upload(dir, owner.id, model.print.id, "logo.svg", "<svg onload=alert(1)></svg>");
    const fileUrl = (id: string, inline: boolean) =>
      `/api/print/${model.print.id}/files/${id}${inline ? "?inline=1" : ""}`;

    const shownPdf = await request(app).get(fileUrl(pdf.id, true)).set(auth(owner.token));
    expect(shownPdf.status).toBe(200);
    expect(shownPdf.headers["content-type"]).toBe("application/pdf");
    expect(shownPdf.headers["content-disposition"]).toMatch(/^inline;/);
    expect(shownPdf.headers["x-content-type-options"]).toBe("nosniff");
    // The browser's own PDF viewer won't run in a sandbox.
    expect(shownPdf.headers["content-security-policy"]).toBeUndefined();

    const shownText = await request(app).get(fileUrl(text.id, true)).set(auth(owner.token));
    expect(shownText.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(shownText.headers["content-disposition"]).toMatch(/^inline;/);
    expect(shownText.headers["content-security-policy"]).toBe("sandbox");
    expect(shownText.text).toBe("# Hello");

    // HTML and SVG would run their scripts on the instance's own origin.
    for (const unsafe of [page, vector]) {
      const res = await request(app).get(fileUrl(unsafe.id, true)).set(auth(owner.token));
      expect(res.status).toBe(200);
      expect(res.headers["content-disposition"]).toMatch(/^attachment;/);
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
    }
    const downloaded = await request(app).get(fileUrl(pdf.id, false)).set(auth(owner.token));
    expect(downloaded.headers["content-disposition"]).toMatch(/^attachment;/);
  });

  it("download under their own names, spaces and all", async () => {
    const model = await makePrint(dir, owner.id, "Named");
    const list = await upload(dir, owner.id, model.print.id, "Parts list.csv", "part,qty\n");
    const res = await request(app).get(`/api/print/${model.print.id}/files/${list.id}`).set(auth(owner.token));
    // Percent-escaped in a plain filename, it was saved as "Parts%20list.csv".
    expect(res.headers["content-disposition"]).toBe('attachment; filename="Parts list.csv"');
    const plate = await request(app)
      .get(`/api/print/${model.print.id}/plate/${model.plate.id}/file/own.stl`)
      .set(auth(owner.token));
    // A plain name needs no quotes.
    expect(plate.headers["content-disposition"]).toBe("attachment; filename=own.stl");
  });

  it("are renamed by their owner, moving the file, keeping the extension and stepping around a taken name", async () => {
    const model = await makePrint(dir, owner.id, "Renamed");
    const guide = await upload(dir, owner.id, model.print.id, "20231105_7f3a.pdf", "%PDF-1.4\n");
    await upload(dir, owner.id, model.print.id, "Assembly guide.pdf", "%PDF-1.4 other\n");
    const route = `/api/print/${model.print.id}/files/${guide.id}`;

    // Only the owner, and only with a name.
    expect((await request(app).patch(route).set(auth(other.token)).send({ filename: "x.pdf" })).status).toBe(404);
    expect((await request(app).patch(route).set(auth(owner.token)).send({ filename: "" })).status).toBe(400);

    const renamed = await request(app).patch(route).set(auth(owner.token)).send({ filename: "Assembly guide" });
    expect(renamed.status).toBe(200);
    const after = await prisma.printFile.findUniqueOrThrow({ where: { id: guide.id } });
    expect(after.filename).toBe("Assembly guide (2).pdf");
    expect(path.basename(after.storagePath)).toBe("Assembly guide (2).pdf");
    expect(fs.existsSync(path.join(STORAGE, after.storagePath))).toBe(true);
    expect(fs.existsSync(path.join(STORAGE, guide.storagePath))).toBe(false);
    expect(renamed.body.print.supporting_files.map((file: { filename: string }) => file.filename).toSorted()).toEqual([
      "Assembly guide (2).pdf",
      "Assembly guide.pdf",
    ]);

    // A plate is not a supporting file.
    const plateRoute = `/api/print/${model.print.id}/files/${model.plate.id}`;
    expect((await request(app).patch(plateRoute).set(auth(owner.token)).send({ filename: "y.stl" })).status).toBe(404);
  });

  it("say which file an upload stored, though the model has another of its name, and a sliced one too", async () => {
    const model = await makePrint(dir, owner.id, "Identified");
    await upload(dir, owner.id, model.print.id, "notes.txt", "earlier");
    const route = `/api/print/${model.print.id}/files`;
    const added = await request(app)
      .post(route)
      .set(auth(owner.token))
      .attach("file", Buffer.from("later"), "notes.txt");
    expect(added.status).toBe(200);
    const newest = await prisma.printFile.findFirstOrThrow({
      where: { printId: model.print.id },
      orderBy: { createdAt: "desc" },
    });
    expect(added.body.file_id).toBe(newest.id);

    const sliced = await request(app)
      .post(route)
      .set(auth(owner.token))
      .attach("file", Buffer.from("; sliced\nG28\n"), "sliced.gcode");
    const { preparedFileId } = await prisma.print.findUniqueOrThrow({ where: { id: model.print.id } });
    expect(sliced.body.file_id).toBe(preparedFileId);
  });

  it("each keep their own place in a zip, even when two share a name", async () => {
    const model = await makePrint(dir, owner.id, "Zipped");
    await upload(dir, owner.id, model.print.id, "notes.txt", "first");
    // A merge brings each model's files along, names and all.
    const second = await upload(dir, owner.id, model.print.id, "notes-second.txt", "second");
    await prisma.printFile.update({ where: { id: second.id }, data: { filename: "notes.txt" } });

    const print = await prisma.print.findUniqueOrThrow({
      where: { id: model.print.id },
      include: { plates: true, category: true },
    });
    const supporting = (await buildZipEntries([print])).filter((entry) => entry.arcname.includes("/supporting/"));
    expect(supporting.map((entry) => path.basename(entry.arcname)).toSorted()).toEqual(["notes (2).txt", "notes.txt"]);
  });

  it("never take a model file's place in a zip", async () => {
    const model = await makePrint(dir, owner.id, "Beside");
    await upload(dir, owner.id, model.print.id, "own.stl", "kept beside");
    const print = await prisma.print.findUniqueOrThrow({
      where: { id: model.print.id },
      include: { plates: true, category: true },
    });
    // A model file in a folder named "supporting" sits where a supporting file of its name would.
    const plates = print.plates.map((plate) => ({ ...plate, folder: "supporting" }));
    const arcnames = (await buildZipEntries([{ ...print, plates }])).map((entry) => entry.arcname);
    expect(new Set(arcnames).size).toBe(arcnames.length);
    expect(arcnames.filter((name) => name.endsWith("/supporting/own.stl"))).toHaveLength(1);
    expect(arcnames.filter((name) => name.endsWith("/supporting/own (2).stl"))).toHaveLength(1);
  });
});
