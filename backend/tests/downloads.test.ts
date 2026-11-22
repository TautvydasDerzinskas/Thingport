import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseDisposition } from "content-disposition";
import fc from "fast-check";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { STORAGE } from "../src/config";
import { prisma } from "../src/db";
import { remoteZipPaths } from "../src/federation/remoteFiles";
import { ZipPaths } from "../src/files/zipPaths";
import { createPrint } from "../src/services/printCreation";
import { listZipEntries, readZipEntry } from "../src/utils/zipReader";

// What a download is called, and where each file goes in a zip of models (services/downloadZip.ts, files/zipPaths.ts).

const app = createApp();
const stamp = Date.now();
let token: string;
let userId: string;
const auth = () => ({ Authorization: `Bearer ${token}` });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "thingport-downloads-"));
const STL = (seed: string) => `solid ${seed}\nendsolid ${seed}\n`;

function tempFile(contents: string): string {
  const file = path.join(tmp, `${Math.random().toString(36).slice(2)}.tmp`);
  fs.writeFileSync(file, contents);
  return file;
}

async function upload(files: { name: string; body: string }[], fields: Record<string, string> = {}) {
  const req = request(app).post("/api/upload").set(auth());
  if (files.length > 1) req.field("mode", "multiplate");
  for (const [name, value] of Object.entries(fields)) req.field(name, value);
  for (const file of files) req.attach("files", Buffer.from(file.body), { filename: file.name });
  const res = await req;
  expect(res.status).toBe(200);
  return res.body.prints[0].id as string;
}

async function attach(printId: string, name: string) {
  const res = await request(app)
    .post(`/api/print/${printId}/files`)
    .set(auth())
    .attach("file", Buffer.from(`${name}\n`), { filename: name });
  expect(res.status).toBe(200);
}

/** The zip a download makes, as its entries' names. */
async function zipOf(body: Record<string, unknown>): Promise<string[]> {
  const res = await request(app)
    .post("/api/download/zip")
    .set(auth())
    .send(body)
    .buffer(true)
    .parse((stream, done) => {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => done(null, Buffer.concat(chunks)));
    });
  expect(res.status).toBe(200);
  const file = path.join(tmp, `${Math.random().toString(36).slice(2)}.zip`);
  fs.writeFileSync(file, res.body as Buffer);
  return (await listZipEntries(file)).filter((entry) => !entry.isDirectory).map((entry) => entry.name);
}

beforeAll(async () => {
  const res = await request(app)
    .post("/api/register")
    .send({ displayName: "Downloads", email: `downloads-${stamp}@example.com`, password: "password123" });
  token = res.body.token;
  userId = res.body.user.id;
});

describe("a file's download", () => {
  it.each(["Parts list.csv", "a;b,c.txt", 'say "hi".txt', "Ünïcödé notes.pdf", "plain.txt"])(
    "is called %s",
    async (name) => {
      const printId = await upload([{ name: `Holder ${name}.stl`, body: STL(name) }]);
      await attach(printId, name);
      const [file] = (await request(app).get(`/api/print/${printId}/files`).set(auth())).body as { id: string }[];
      const res = await request(app).get(`/api/print/${printId}/files/${file.id}`).set(auth());
      expect(res.status).toBe(200);
      expect(parseDisposition(res.headers["content-disposition"]).parameters.filename).toBe(name);
    },
  );

  it("names a plate as it's called, spaces and all", async () => {
    const printId = await upload([{ name: "Parts list.stl", body: STL("plate") }]);
    const [plate] = await prisma.plate.findMany({ where: { printId } });
    const res = await request(app).get(`/api/print/${printId}/plate/${plate.id}/file/download`).set(auth());
    expect(res.status).toBe(200);
    expect(parseDisposition(res.headers["content-disposition"]).parameters.filename).toBe("Parts list.stl");
  });

  it("never breaks its header on a name stored with a line break, from before names were cleaned", async () => {
    const printId = await upload([{ name: "Old.stl", body: STL("old") }]);
    await attach(printId, "old.txt");
    await prisma.printFile.updateMany({ where: { printId }, data: { filename: "old\r\nname.txt" } });
    const [file] = (await request(app).get(`/api/print/${printId}/files`).set(auth())).body as { id: string }[];
    const res = await request(app).get(`/api/print/${printId}/files/${file.id}`).set(auth());
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).not.toMatch(/[\r\n]/);
  });
});

describe("a zip of models", () => {
  it("gives two models of one name a folder each", async () => {
    const tag = `twins-${stamp}`;
    const shelves = await Promise.all(
      ["Shelf A", "Shelf B"].map(async (name) => {
        const res = await request(app)
          .post("/api/categories")
          .set(auth())
          .send({ name: `${name} ${stamp}` });
        return res.body.id as string;
      }),
    );
    const ids: string[] = [];
    for (const shelf of shelves) {
      ids.push(
        await upload([{ name: "Base.stl", body: STL(shelf) }], { title: "Base", category_id: shelf, tags: tag }),
      );
    }
    // A tag spans categories, so the zip leaves them out and the two models' folders would be one. By the tag as the
    // library keeps it.
    const [stored] = (await prisma.print.findUniqueOrThrow({ where: { id: ids[0] } })).tags;
    const entries = await zipOf({ tag: stored });
    expect(entries.filter((name) => name.endsWith(".stl")).toSorted()).toEqual(["Base (2)/Base.stl", "Base/Base.stl"]);
  });

  it("keeps supporting/, prepared/ and LICENSE.txt for what they hold, numbering a plate named like them", async () => {
    const { print } = await createPrint(userId, { title: `Layout ${stamp}` }, "Layout", [
      { filename: "part.stl", tempFilePath: tempFile(STL("part")) },
      { filename: "part.stl", tempFilePath: tempFile(STL("other")), folder: "supporting" },
      { filename: "LICENSE.txt", tempFilePath: tempFile("a creator's own licence\n") },
    ]);
    await attach(print.id, "notes.txt");
    const estimate = async () =>
      (
        await request(app)
          .post("/api/download/zip/summary")
          .set(auth())
          .send({ print_ids: [print.id] })
      ).body.size_bytes as number;
    const before = await estimate();
    await attach(print.id, "Tower.gcode");
    // The prepared print is in the zip, so in the size it's said to be before it's made.
    expect((await estimate()) - before).toBe(Buffer.byteLength("Tower.gcode\n"));
    await request(app).post(`/api/print/${print.id}/meta`).set(auth()).send({ license: "CC0-1.0" });
    const prefix = `unassigned/${print.name}`;
    expect((await zipOf({ print_ids: [print.id] })).toSorted()).toEqual(
      [
        `${prefix}/LICENSE (2).txt`,
        `${prefix}/LICENSE.txt`,
        `${prefix}/part.stl`,
        `${prefix}/prepared/Tower.gcode`,
        `${prefix}/supporting (2)/part.stl`,
        `${prefix}/supporting/notes.txt`,
      ].toSorted(),
    );
  });

  it("unzips whole into a folder that ignores case", async () => {
    const { print } = await createPrint(userId, { title: `Cases ${stamp}` }, "Cases", [
      { filename: "part.stl", tempFilePath: tempFile(STL("upper")), folder: "STL" },
      { filename: "part.stl", tempFilePath: tempFile(STL("lower")), folder: "stl" },
    ]);
    const entries = await zipOf({ print_ids: [print.id] });
    expect(new Set(entries.map((name) => name.toLowerCase())).size).toBe(entries.length);
    // Written out one by one, as an unzip tool does: none lands on another, whatever the disk folds.
    const out = fs.mkdtempSync(path.join(tmp, "unzipped-"));
    const res = await request(app)
      .post("/api/download/zip")
      .set(auth())
      .send({ print_ids: [print.id] })
      .buffer(true)
      .parse((stream, done) => {
        const chunks: Buffer[] = [];
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("end", () => done(null, Buffer.concat(chunks)));
      });
    const zipFile = path.join(tmp, `cases-${stamp}.zip`);
    fs.writeFileSync(zipFile, res.body as Buffer);
    for (const name of entries) {
      const target = path.join(out, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, (await readZipEntry(zipFile, name, 1_000_000))!);
    }
    const written = (dir: string): number =>
      fs
        .readdirSync(dir, { withFileTypes: true })
        .reduce((sum, entry) => sum + (entry.isDirectory() ? written(path.join(dir, entry.name)) : 1), 0);
    expect(written(out)).toBe(entries.length);
  });

  it("is refused, before it's written, past what a zip holds", async () => {
    const printId = await upload([{ name: "Huge.stl", body: STL("huge") }]);
    const [plate] = await prisma.plate.findMany({ where: { printId } });
    const file = path.join(STORAGE, plate.storagePath);
    // 4 GiB, sparse: the size is there, the disk barely used. Where the limits lie is zipWriter.test.ts's.
    fs.truncateSync(file, 2 ** 32);
    try {
      const res = await request(app)
        .post("/api/download/zip")
        .set(auth())
        .send({ print_ids: [printId] });
      expect(res.status).toBe(413);
      expect(res.body.code).toBe("zip_too_large");
    } finally {
      fs.truncateSync(file, 0);
    }
  });
});

describe("ZipPaths", () => {
  type Step = { folder: boolean; parent: number; name: string; owner: string };
  const step = fc.record({
    folder: fc.boolean(),
    parent: fc.nat(20),
    name: fc.constantFrom(
      "a",
      "A",
      "b.stl",
      "B.STL",
      "supporting",
      "Supporting",
      "LICENSE.txt",
      "x (2)",
      "..",
      "a/b",
      " ",
    ),
    owner: fc.constantFrom("one", "two"),
  });

  it("never gives two files one path, ignoring case, nor a path that's both a file and a folder, nor one outside", () => {
    fc.assert(
      fc.property(fc.array(step, { maxLength: 60 }), (steps: Step[]) => {
        const zip = new ZipPaths();
        const folders = [""];
        const files: string[] = [];
        for (const { folder, parent, name, owner } of steps) {
          const at = folders[parent % folders.length];
          if (folder) folders.push(zip.folder(at, name, owner));
          else files.push(zip.file(at, name));
        }
        const lower = files.map((file) => file.toLowerCase());
        expect(new Set(lower).size).toBe(lower.length);
        const folderPaths = new Set(folders.slice(1).map((folder) => folder.toLowerCase()));
        for (const file of lower) expect(folderPaths.has(file)).toBe(false);
        // Every level a name of its own: none empty, none "." or "..".
        for (const at of [...files, ...folders.slice(1)]) {
          expect(at.split("/").filter((level) => ["", ".", ".."].includes(level.trim()))).toEqual([]);
        }
      }),
      { seed: 20261122, numRuns: 500 },
    );
  });

  it("gives a folder back to its owner, and numbers it for anyone else", () => {
    const zip = new ZipPaths();
    expect(zip.folder("", "Base", "one")).toBe("Base");
    expect(zip.folder("", "base", "one")).toBe("Base");
    expect(zip.folder("", "Base", "two")).toBe("Base (2)");
    expect(zip.file("Base", "part.stl")).toBe("Base/part.stl");
    expect(zip.file("Base", "PART.stl")).toBe("Base/PART (2).stl");
  });

  it("makes a category's name one folder, by the name rule", () => {
    const zip = new ZipPaths();
    expect(zip.folder("", "Tools/Parts", "categories")).toBe("Tools_Parts");
    expect(zip.folder("", "..", "categories")).toBe("imported-file");
  });
});

describe("a partner's model as a zip", () => {
  it("keeps each file in its folder, every path once ignoring case", () => {
    expect(
      remoteZipPaths([
        { name: "Part.stl" },
        { name: "part.stl" },
        { name: "Base" },
        { name: "arm.stl", folder: "Base" },
        { name: "notes.txt", folder: "Docs/Extra" },
        { name: "job.gcode.3mf", folder: "Docs/Extra" },
        { name: "JOB.gcode.3mf", folder: "docs/extra" },
      ]),
    ).toEqual([
      "Part.stl",
      "part (2).stl",
      "Base",
      "Base (2)/arm.stl",
      "Docs/Extra/notes.txt",
      "Docs/Extra/job.gcode.3mf",
      "Docs/Extra/JOB (2).gcode.3mf",
    ]);
  });
});
