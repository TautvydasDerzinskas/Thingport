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
import { attachmentDisposition } from "../src/utils/fileUtils";
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

/** The zip a download makes, saved, and its entries' names in the order they're written. */
async function fetchZip(body: Record<string, unknown>): Promise<{ file: string; names: string[] }> {
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
  const names = (await listZipEntries(file)).filter((entry) => !entry.isDirectory).map((entry) => entry.name);
  return { file, names };
}

/** The zip a download makes, as its entries' names. */
async function zipOf(body: Record<string, unknown>): Promise<string[]> {
  return (await fetchZip(body)).names;
}

beforeAll(async () => {
  const res = await request(app)
    .post("/api/register")
    .send({ displayName: "Downloads", email: `downloads-${stamp}@example.com`, password: "password123" });
  token = res.body.token;
  userId = res.body.user.id;
});

// Names a download has to carry whole: what separates a header's parts, a quote, and names beyond ASCII and Latin-1.
const STEMS = ["Parts list", "a;b,c", 'say "hi"', "Ünïcödé notes", "Šuniukas", "零件", "plain"];

/** What a download says it's called: as a browser reads it (`filename*` first), and as a client that reads only
 *  `filename` does, as `curl -OJ` does, which has to be ASCII that decodes to the name, so two names never come out as
 *  one. */
function namedAs(res: request.Response) {
  const header = String(res.headers["content-disposition"]);
  const plain = /;\s*filename=(?:"([^"]*)"|([^;\s]*))/i.exec(header);
  const fallback = plain?.[1] ?? plain?.[2] ?? "";
  return {
    status: res.status,
    browser: parseDisposition(header).parameters.filename,
    plain: decodeURIComponent(fallback),
    ascii: /^[\x20-\x7e]+$/.test(fallback),
  };
}

const named = (name: string) => ({ status: 200, browser: name, plain: name, ascii: true });

describe("a file's download", () => {
  it.each(STEMS)("of a supporting file is called %s", async (stem) => {
    const printId = await upload([{ name: `Holder ${stem}.stl`, body: STL(stem) }]);
    await attach(printId, `${stem}.txt`);
    const [file] = (await request(app).get(`/api/print/${printId}/files`).set(auth())).body as { id: string }[];
    const res = await request(app).get(`/api/print/${printId}/files/${file.id}`).set(auth());
    expect(namedAs(res)).toEqual(named(`${stem}.txt`));
  });

  it.each(STEMS)("of a plate is called %s", async (stem) => {
    const printId = await upload([{ name: `${stem}.stl`, body: STL(stem) }]);
    const [plate] = await prisma.plate.findMany({ where: { printId } });
    const res = await request(app).get(`/api/print/${printId}/plate/${plate.id}/file/download`).set(auth());
    expect(namedAs(res)).toEqual(named(`${stem}.stl`));
  });

  it.each(STEMS)("of a prepared print is called %s", async (stem) => {
    const printId = await upload([{ name: `Tower ${stem}.stl`, body: STL(stem) }]);
    await attach(printId, `${stem}.gcode`);
    const res = await request(app).get(`/api/print/${printId}/prepared-print`).set(auth());
    expect(namedAs(res)).toEqual(named(`${stem}.gcode`));
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

describe("a download's plain filename", () => {
  const plain = (name: string) => {
    const match = /;\s*filename=(?:"([^"]*)"|([^;\s]*))/i.exec(attachmentDisposition(name));
    return match?.[1] ?? match?.[2] ?? "";
  };

  it("keeps an ASCII name as it is, and tells an encoded name from one that only looks encoded", () => {
    expect(plain("100% done.stl")).toBe("100% done.stl");
    expect(plain("é.stl")).toBe("%C3%A9.stl");
    expect(plain("%C3%A9.stl")).toBe("%25C3%25A9.stl");
  });

  it("fits a long name on a disk, its extension kept and two long names kept apart", () => {
    const first = `${"零".repeat(60)}.stl`;
    const second = `${"零".repeat(59)}部.stl`;
    for (const name of [first, second]) {
      expect(plain(name)).toMatch(/^[\x20-\x7e]{1,240}$/);
      expect(plain(name)).toMatch(/~[0-9a-f]{8}\.stl$/);
      expect(parseDisposition(attachmentDisposition(name)).parameters.filename).toBe(name);
    }
    expect(plain(first)).not.toBe(plain(second));
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
      { filename: "part.stl", tempFilePath: tempFile(STL("third")), folder: "prepared" },
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
    const zip = await fetchZip({ print_ids: [print.id] });
    // The plates first, as they're ordered, then the licence, the supporting files and the prepared print.
    expect(zip.names).toEqual([
      `${prefix}/part.stl`,
      `${prefix}/supporting (2)/part.stl`,
      `${prefix}/LICENSE (2).txt`,
      `${prefix}/prepared (2)/part.stl`,
      `${prefix}/LICENSE.txt`,
      `${prefix}/supporting/notes.txt`,
      `${prefix}/prepared/Tower.gcode`,
    ]);
    const text = async (name: string) => (await readZipEntry(zip.file, `${prefix}/${name}`, 100_000))?.toString();
    expect(await text("LICENSE.txt")).toContain("CC0");
    expect(await text("LICENSE (2).txt")).toBe("a creator's own licence\n");
  });

  it("unzips whole into a folder that ignores case", async () => {
    const { print } = await createPrint(userId, { title: `Cases ${stamp}` }, "Cases", [
      { filename: "part.stl", tempFilePath: tempFile(STL("upper")), folder: "STL" },
      { filename: "part.stl", tempFilePath: tempFile(STL("lower")), folder: "stl" },
    ]);
    const { file: zipFile, names: entries } = await fetchZip({ print_ids: [print.id] });
    expect(new Set(entries.map((name) => name.toLowerCase())).size).toBe(entries.length);
    // Written out one by one, as an unzip tool does: none lands on another, whatever the disk folds.
    const out = fs.mkdtempSync(path.join(tmp, "unzipped-"));
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
  /** A path as a disk that ignores case compares it: "ΦΙΛΟΣ" and "φιλος" are one name on a Mac and on Windows, as are
   *  "µ" (micro) and "μ" (mu). */
  const onDisk = (at: string) => at.toUpperCase().toLowerCase().normalize("NFD");
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
      "ΦΙΛΟΣ",
      "φιλος",
      "µ",
      "μ",
      "x".repeat(130),
      "é".repeat(130),
      "零".repeat(90),
      `${".".repeat(120)}x`,
      `${".".repeat(120)}abcdefghijklmnop`,
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
        const folded = files.map(onDisk);
        expect(new Set(folded).size).toBe(folded.length);
        const folderPaths = new Set(folders.slice(1).map(onDisk));
        for (const file of folded) expect(folderPaths.has(file)).toBe(false);
        // Every level a name of its own: none empty, none "." or "..", and none past a path segment's cap.
        for (const at of [...files, ...folders.slice(1)]) {
          const levels = at.split("/");
          expect(levels.filter((level) => ["", ".", ".."].includes(level.trim()))).toEqual([]);
          expect(levels.filter((level) => level.length > 120 || Buffer.byteLength(level) > 240)).toEqual([]);
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

  it.each([
    ["ΦΙΛΟΣ.stl", "φιλος.stl", "M/φιλος (2).stl"],
    ["Filter 5µm.stl", "Filter 5μm.stl", "M/Filter 5μm (2).stl"],
    ["Clasp ſ.stl", "Clasp s.stl", "M/Clasp s (2).stl"],
    ["J\u030Cig.stl", "\u01F0ig.stl", "M/\u01F0ig (2).stl"],
  ])("numbers %s and %s apart, as a Mac or Windows takes them as one name", (first, second, numbered) => {
    const zip = new ZipPaths();
    expect(zip.file("M", first)).toBe(`M/${first}`);
    expect(zip.file("M", second)).toBe(numbered);
  });

  it("never lets a folder take a file's name in another case", () => {
    const zip = new ZipPaths();
    expect(zip.file("M", "ΒΑΣΗ ΦΑΚΟΣ")).toBe("M/ΒΑΣΗ ΦΑΚΟΣ");
    expect(zip.folder("M", "βαση φακοσ", "model")).toBe("M/βαση φακοσ (2)");
  });

  it("keeps a numbered name within a path segment's cap, the number and extension whole", () => {
    const zip = new ZipPaths();
    const long = "x".repeat(120);
    expect(zip.folder("", long, "one")).toBe(long);
    expect(zip.folder("", long, "two")).toBe(`${"x".repeat(116)} (2)`);
    const accented = "é".repeat(120);
    expect(zip.folder("", accented, "one")).toBe(accented);
    const second = zip.folder("", accented, "two");
    expect([second.endsWith(" (2)"), Buffer.byteLength(second) <= 240]).toEqual([true, true]);
    const name = `${"a".repeat(116)}.stl`;
    expect(zip.file("M", name)).toBe(`M/${name}`);
    expect(zip.file("M", name)).toBe(`M/${"a".repeat(112)} (2).stl`);
    expect(zip.file("M", `${"b".repeat(200)}.stl`)).toBe(`M/${"b".repeat(116)}.stl`);
    // A folder has no extension: its number goes at the end.
    expect(zip.folder("", "Benchy v1.2", "one")).toBe("Benchy v1.2");
    expect(zip.folder("", "Benchy v1.2", "two")).toBe("Benchy v1.2 (2)");
  });

  it("never leaves a level empty when a cut takes all of a name", () => {
    const zip = new ZipPaths();
    const folder = zip.folder("C", `${".".repeat(120)}x`, "one");
    expect(folder).toBe("C/imported-file");
    expect(zip.file(folder, `${".".repeat(120)}abcdefghijklmnop`)).toBe("C/imported-file/imported-file");
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
