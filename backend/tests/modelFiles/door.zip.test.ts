import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { STORAGE } from "../../src/config";
import { prisma } from "../../src/db";
import { createExportToken, revokeExportToken } from "../../src/services/migrate/export";
import { createPrint } from "../../src/services/printCreation";
import { saveFileFromTemp } from "../../src/services/printFileService";
import { makeFileGrant } from "../../src/services/sendTargetService";
import { getPreviewMode, setPreviewMode, type PreviewMode } from "../../src/services/settingsService";
import { listZipEntries, readZipEntry } from "../../src/utils/zipReader";
import { writeZip } from "../../src/utils/zipWriter";
import { faults, hits, pauseAt, reached, track } from "../harness/lifecycle";
import { nonce, register } from "../helpers/fileReuse";

// The zip, Send to and Migrate's export through the file door (docs/STORAGE_DEVELOPMENT.md, Fs 1 and Fs 2): a file
// that can't be looked at or opened is an error, never "missing"; one that's gone, or a folder in its place, is still
// missing; and what goes out is the file that was opened, while its row still names it.

const app = createApp();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "thingport-door-zip-"));
let owner: { id: string; token: string };
let adminId: string;
let exportToken: string;
let previews: PreviewMode;
let destination: http.Server;
let base: string;
let linkTarget: string;
let uploadTarget: string;
/** What the upload destination was sent, last first. */
const uploads: Buffer[] = [];

const auth = () => ({ Authorization: `Bearer ${owner.token}` });

/** The whole body, as bytes, whatever its type. */
const binary = (res: NodeJS.ReadableStream, done: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on("data", (chunk: Buffer) => chunks.push(chunk));
  res.on("end", () => done(null, Buffer.concat(chunks)));
};

const detailOf = (body: Buffer) => (JSON.parse(body.toString("utf8")) as { detail?: string }).detail;

beforeAll(async () => {
  owner = await register(app, "door-zip", "owner");
  const admin = await prisma.user.create({
    data: { email: `door-zip-admin-${nonce()}@example.com`, displayName: "Door Admin", role: "ADMIN" },
  });
  adminId = admin.id;
  exportToken = (await createExportToken(adminId)).token;
  // Off: nothing here waits for a model's previews, and one being made would read a plate a test is changing.
  previews = await getPreviewMode();
  await setPreviewMode("disabled");
  destination = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      uploads.unshift(Buffer.concat(chunks));
      res.writeHead(201).end("{}");
    });
  });
  await new Promise<void>((resolve) => destination.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(destination.address() as AddressInfo).port}`;
  const target = async (how: object) =>
    (await request(app).post("/api/me/send-targets").set(auth()).send({ name: "Door", how })).body.id as string;
  linkTarget = await target({ type: "link", url: "https://slicer.lan/?load={file_url}" });
  uploadTarget = await target({ type: "request", method: "PUT", url: `${base}/upload`, body: "raw" });
});

afterAll(async () => {
  await setPreviewMode(previews);
  await revokeExportToken(adminId);
  await new Promise((resolve) => destination.close(resolve));
  await prisma.user.deleteMany({ where: { id: { in: [owner.id, adminId] } } });
  fs.rmSync(tmp, { recursive: true, force: true });
});

function temp(bytes: Buffer): string {
  const abs = path.join(tmp, `temp-${nonce()}`);
  fs.writeFileSync(abs, bytes);
  return abs;
}

type Stored = { id: string; abs: string; bytes: Buffer };
type Model = { printId: string; plate: Stored; files: Record<string, Stored> };

/** A model of the owner's with one plate, Base.stl, and the files named: a .gcode is its prepared print, the others
 *  supporting files. Each holds bytes no other file has. */
async function model(names: string[] = []): Promise<Model> {
  const plateBytes = Buffer.from(`solid ${nonce()}\nendsolid\n`);
  const { print, plates } = await createPrint(
    owner.id,
    { title: `Door ${nonce()}` },
    "door",
    [{ filename: "Base.stl", tempFilePath: temp(plateBytes) }],
    { describe: false, classify: false },
  );
  const files: Record<string, Stored> = {};
  for (const name of names) {
    const bytes = Buffer.from(`${name} ${nonce()}\n`);
    await saveFileFromTemp(owner.id, print.id, temp(bytes), name, null);
    const row = await prisma.printFile.findFirstOrThrow({ where: { printId: print.id, filename: name } });
    files[name] = { id: row.id, abs: path.join(STORAGE, row.storagePath), bytes };
  }
  const plate = { id: plates[0].id, abs: path.join(STORAGE, plates[0].storagePath), bytes: plateBytes };
  return { printId: print.id, plate, files };
}

/** Other bytes of the same size put at `abs` by a rename, as a save or a move does; a file already open stays the old
 *  one. */
function renameOnto(abs: string, like: Buffer): Buffer {
  const other = Buffer.alloc(like.length, "x");
  const next = `${abs}.next`;
  fs.writeFileSync(next, other);
  fs.renameSync(next, abs);
  return other;
}

/** The zip of a model: its status, and its files' bytes by their path under the model's folder. */
async function zipOf(printId: string): Promise<{ status: number; detail?: string; files: Map<string, Buffer> }> {
  const res = await request(app)
    .post("/api/download/zip")
    .set(auth())
    .send({ print_ids: [printId] })
    .buffer(true)
    .parse(binary);
  const body = res.body as Buffer;
  if (res.status !== 200) return { status: res.status, detail: detailOf(body), files: new Map() };
  const file = path.join(tmp, `${nonce()}.zip`);
  fs.writeFileSync(file, body);
  const files = new Map<string, Buffer>();
  for (const entry of await listZipEntries(file)) {
    if (entry.isDirectory) continue;
    // unassigned/<model>/...: the model is in no category.
    files.set(entry.name.split("/").slice(2).join("/"), (await readZipEntry(file, entry.name, 1 << 20))!);
  }
  return { status: 200, files };
}

const send = async (printId: string, targetId: string, file: string) =>
  request(app).post(`/api/print/${printId}/send/${targetId}`).set(auth()).send({ file });

/** A Send to link's download, as whatever follows the link makes it: no sign-in. */
const follow = async (printId: string, fileKey: string) => {
  const res = await request(app)
    .get(`/api/send-file/${makeFileGrant(owner.id, printId, fileKey)}/file`)
    .buffer(true)
    .parse(binary);
  return { status: res.status, body: res.body as Buffer };
};

const exported = async (relative: string) =>
  request(app)
    .get("/api/migrate-export/file")
    .query({ path: relative })
    .set({ Authorization: `Bearer ${exportToken}` });
const missingOf = async (paths: string[]) =>
  request(app)
    .post("/api/migrate-export/missing")
    .set({ Authorization: `Bearer ${exportToken}` })
    .send({ paths });

/** The files this process has open, by their real paths: /proc on Linux, lsof elsewhere. */
function openPaths(): string[] {
  if (process.platform === "linux") {
    return fs.readdirSync("/proc/self/fd").flatMap((fd) => {
      try {
        return [fs.readlinkSync(`/proc/self/fd/${fd}`)];
      } catch {
        // Closed since it was listed.
        return [];
      }
    });
  }
  return execFileSync("lsof", ["-p", String(process.pid), "-Fn"], { encoding: "utf8" })
    .split("\n")
    .filter((line) => line.startsWith("n"))
    .map((line) => line.slice(1));
}

describe("the download zip", () => {
  it.each(["EIO", "EACCES"] as const)(
    "fails, rather than leave a supporting file out, when looking at it answers %s",
    async (code) => {
      const { printId, files } = await model(["Guide.pdf"]);
      faults.at("fileState:zip.entry", 1, code, { path: files["Guide.pdf"].abs });
      expect((await zipOf(printId)).status).toBe(500);
      expect(fs.readFileSync(files["Guide.pdf"].abs)).toEqual(files["Guide.pdf"].bytes);
    },
  );

  it("fails, rather than leave the prepared print out, when looking at it fails", async () => {
    const { printId, files } = await model(["Print.gcode"]);
    faults.at("fileState:zip.entry", 1, "EIO", { path: files["Print.gcode"].abs });
    expect((await zipOf(printId)).status).toBe(500);
  });

  it("fails when a file it's writing can't be opened, or read once it's open", async () => {
    const { printId, plate, files } = await model(["Guide.pdf"]);
    const temps = () => fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith("thingport-zip-")).length;
    const before = temps();
    faults.at("open:zip.entry", 1, "EIO", { path: plate.abs });
    expect((await zipOf(printId)).status).toBe(500);
    faults.at("opened:zip.entry", 1, "EIO", { path: files["Guide.pdf"].abs });
    expect((await zipOf(printId)).status).toBe(500);
    // Failed half-written, neither is left in the temp folder.
    expect(temps()).toBe(before);
  });

  it("still leaves out a file that's gone, or a folder in its place, and keeps the rest", async () => {
    const { printId, plate, files } = await model(["Guide.pdf", "Notes.txt", "Print.gcode"]);
    fs.rmSync(files["Guide.pdf"].abs);
    fs.rmSync(files["Notes.txt"].abs);
    fs.mkdirSync(files["Notes.txt"].abs);
    reached("fileState:zip.entry");

    const zip = await zipOf(printId);

    expect(zip.status).toBe(200);
    expect([...zip.files.keys()]).toEqual(["Base.stl", "prepared/Print.gcode"]);
    expect(zip.files.get("Base.stl")).toEqual(plate.bytes);
    expect(zip.files.get("prepared/Print.gcode")).toEqual(files["Print.gcode"].bytes);
  });

  it("leaves out a file that went between its look and its open", async () => {
    const { printId, files } = await model(["Guide.pdf"]);
    faults.at("open:zip.entry", 1, "ENOENT", { path: files["Guide.pdf"].abs });
    const zip = await zipOf(printId);
    expect(zip.status).toBe(200);
    expect([...zip.files.keys()]).toEqual(["Base.stl"]);
  });

  it("looks only at the files that go in, not at a prepared print the model no longer names", async () => {
    const { printId } = await model(["Guide.pdf", "Old.gcode"]);
    await prisma.print.update({ where: { id: printId }, data: { preparedFileId: null } });
    const zip = await zipOf(printId);
    expect([...zip.files.keys()]).toEqual(["Base.stl", "supporting/Guide.pdf"]);
    expect(hits("fileState:zip.entry")).toBe(1);
  });

  it("says No files available for download when none of its files is left", async () => {
    const { printId, plate, files } = await model(["Guide.pdf"]);
    fs.rmSync(plate.abs);
    fs.rmSync(files["Guide.pdf"].abs);
    expect(await zipOf(printId)).toMatchObject({ status: 404, detail: "No files available for download" });
  });
});

describe("a zip entry, by the handle it was opened with", () => {
  it("holds the bytes it opened, never a file renamed onto its path after", async () => {
    const { printId, plate } = await model();
    const gate = pauseAt("opened:zip.entry");
    const pending = track(zipOf(printId));
    await gate.reachedBy(pending);
    const other = renameOnto(plate.abs, plate.bytes);
    gate.release();

    const zip = await pending;

    expect(zip.status).toBe(200);
    expect(zip.files.get("Base.stl")).toEqual(plate.bytes);
    expect(fs.readFileSync(plate.abs)).toEqual(other);
  });

  it("leaves out a file whose row went, or names another path, by the time it's open", async () => {
    const gone = await model(["Guide.pdf"]);
    // The plate is opened first, then the guide.
    let gate = pauseAt("opened:zip.entry", 2);
    let pending = track(zipOf(gone.printId));
    await gate.reachedBy(pending);
    await prisma.printFile.delete({ where: { id: gone.files["Guide.pdf"].id } });
    gate.release();
    expect([...(await pending).files.keys()]).toEqual(["Base.stl"]);

    const moved = await model(["Guide.pdf"]);
    const guide = await prisma.printFile.findUniqueOrThrow({ where: { id: moved.files["Guide.pdf"].id } });
    gate = pauseAt("opened:zip.entry", 2);
    pending = track(zipOf(moved.printId));
    await gate.reachedBy(pending);
    // Its row went elsewhere, and another file's row took the path.
    await prisma.printFile.update({ where: { id: guide.id }, data: { storagePath: `${guide.storagePath}.moved` } });
    await prisma.printFile.create({
      data: {
        printId: guide.printId,
        role: "SUPPORTING",
        filename: "Other.pdf",
        mime: guide.mime,
        storagePath: guide.storagePath,
      },
    });
    gate.release();
    expect([...(await pending).files.keys()]).toEqual(["Base.stl"]);
  });

  it("leaves out a prepared print that isn't the model's by the time it's open", async () => {
    const { printId } = await model(["Print.gcode"]);
    const gate = pauseAt("opened:zip.entry", 2);
    const pending = track(zipOf(printId));
    await gate.reachedBy(pending);
    await prisma.print.update({ where: { id: printId }, data: { preparedFileId: null } });
    gate.release();
    expect([...(await pending).files.keys()]).toEqual(["Base.stl"]);
  });
});

describe("the zip writer", () => {
  it("closes every file it opened, when an entry is written, left out, or fails the zip", async () => {
    const { plate, files } = await model(["Guide.pdf"]);
    const stored = (abs: string, stillNames: () => Promise<boolean>) => ({
      arcname: path.basename(abs),
      filePath: abs,
      site: "zip.entry" as const,
      stillNames,
    });
    reached("opened:zip.entry");
    await writeZip(path.join(tmp, `${nonce()}.zip`), [
      stored(plate.abs, async () => true),
      stored(files["Guide.pdf"].abs, async () => false),
    ]);
    await expect(
      writeZip(path.join(tmp, `${nonce()}.zip`), [
        stored(plate.abs, async () => {
          throw new Error("The database went away");
        }),
      ]),
    ).rejects.toThrow(/database went away/);
    const open = openPaths();
    expect([plate.abs, files["Guide.pdf"].abs].filter((abs) => open.includes(abs))).toEqual([]);
  });

  it("fails on a file of its own it can't read, and leaves out only one that's gone", async () => {
    // A link to itself: ELOOP, which isn't missing.
    const loop = path.join(tmp, `loop-${nonce()}`);
    fs.symlinkSync(loop, loop);
    await expect(
      writeZip(path.join(tmp, `${nonce()}.zip`), [{ arcname: "loop", filePath: loop }]),
    ).rejects.toMatchObject({ code: "ELOOP" });

    const kept = temp(Buffer.from("kept"));
    const zipPath = path.join(tmp, `${nonce()}.zip`);
    await writeZip(zipPath, [
      { arcname: "gone", filePath: path.join(tmp, `gone-${nonce()}`) },
      { arcname: "kept", filePath: kept },
    ]);
    expect((await listZipEntries(zipPath)).map((entry) => entry.name)).toEqual(["kept"]);
  });
});

describe("Send to", () => {
  it("answers an error, not No such file, when looking at the prepared print fails", async () => {
    const { printId, files } = await model(["Print.gcode"]);
    faults.at("fileState:send.file", 1, "EIO", { path: files["Print.gcode"].abs });
    expect((await send(printId, linkTarget, "prepared")).status).toBe(500);
  });

  it("answers an error, not Not found, on a link whose look fails", async () => {
    const { printId, files } = await model(["Print.gcode"]);
    faults.at("fileState:send.file", 1, "EIO", { path: files["Print.gcode"].abs });
    expect((await follow(printId, `prepared:${files["Print.gcode"].id}`)).status).toBe(500);
  });

  it("answers an error when the file can't be opened, or read once it's open, to go by link or upload", async () => {
    const { printId, plate } = await model();
    faults.at("open:send.file", 1, "EIO", { path: plate.abs });
    expect((await follow(printId, plate.id)).status).toBe(500);
    faults.at("opened:send.file", 1, "EIO", { path: plate.abs });
    expect((await follow(printId, plate.id)).status).toBe(500);
    const sent = uploads.length;
    faults.at("open:send.file", 1, "EIO", { path: plate.abs });
    expect((await send(printId, uploadTarget, plate.id)).status).toBe(500);
    expect(uploads.length).toBe(sent);
  });

  it("still says No such file, and Not found, for a prepared print that's gone or a folder in its place", async () => {
    const { printId, files } = await model(["Print.gcode"]);
    const prepared = files["Print.gcode"];
    fs.rmSync(prepared.abs);
    for (const state of ["gone", "a folder"]) {
      if (state === "a folder") fs.mkdirSync(prepared.abs);
      const sent = await send(printId, linkTarget, "prepared");
      expect({ state, status: sent.status, detail: sent.body.detail }).toEqual({
        state,
        status: 404,
        detail: "No such file",
      });
      const link = await follow(printId, `prepared:${prepared.id}`);
      expect({ state, status: link.status, detail: detailOf(link.body) }).toEqual({
        state,
        status: 404,
        detail: "Not found",
      });
    }
  });

  it("says Not found, or No such file, when the file went before it's open, or its row changed by then", async () => {
    const { printId, plate, files } = await model(["Print.gcode"]);
    const prepared = files["Print.gcode"];
    faults.at("open:send.file", 1, "ENOENT", { path: prepared.abs });
    expect((await follow(printId, `prepared:${prepared.id}`)).status).toBe(404);
    faults.at("open:send.file", 1, "ENOENT", { path: plate.abs });
    expect((await send(printId, uploadTarget, plate.id)).body.detail).toBe("No such file");

    // The model's prepared print is no longer this one.
    let gate = pauseAt("opened:send.file");
    let pending = track(follow(printId, `prepared:${prepared.id}`));
    await gate.reachedBy(pending);
    await prisma.print.update({ where: { id: printId }, data: { preparedFileId: null } });
    gate.release();
    expect((await pending).status).toBe(404);

    // The plate's row went elsewhere.
    gate = pauseAt("opened:send.file");
    pending = track(follow(printId, plate.id));
    await gate.reachedBy(pending);
    await prisma.plate.update({ where: { id: plate.id }, data: { storagePath: `${plate.id}-moved.stl` } });
    gate.release();
    expect((await pending).status).toBe(404);
  });
});

describe("Send to, by the handle it opened", () => {
  it("serves a link the bytes it opened, never a file renamed onto its path after", async () => {
    const { printId, plate } = await model();
    const gate = pauseAt("opened:send.file");
    const pending = track(follow(printId, plate.id));
    await gate.reachedBy(pending);
    const other = renameOnto(plate.abs, plate.bytes);
    gate.release();

    const link = await pending;

    expect(link.status).toBe(200);
    expect(link.body).toEqual(plate.bytes);
    expect(fs.readFileSync(plate.abs)).toEqual(other);
  });

  it("uploads the bytes it opened, never a file renamed onto its path after", async () => {
    const { printId, plate } = await model();
    const gate = pauseAt("opened:send.file");
    const pending = track(send(printId, uploadTarget, plate.id));
    await gate.reachedBy(pending);
    const other = renameOnto(plate.abs, plate.bytes);
    gate.release();

    expect((await pending).body).toMatchObject({ ok: true, status: 201 });

    expect(uploads[0]).toEqual(plate.bytes);
    expect(fs.readFileSync(plate.abs)).toEqual(other);
  });
});

describe("Migrate's export", () => {
  it("answers an error, not missing, when looking at a file fails", async () => {
    const { plate } = await model();
    const relative = path.relative(STORAGE, plate.abs);
    faults.at("fileState:migrate.export", 1, "EIO", { path: plate.abs });
    expect((await exported(relative)).status).toBe(500);
    faults.at("fileState:migrate.export", 1, "EIO", { path: plate.abs });
    expect((await missingOf([relative])).status).toBe(500);
  });

  it("answers an error for a link that loops, rather than call it missing", async () => {
    const name = `loop-${nonce()}.stl`;
    fs.symlinkSync(path.join(STORAGE, name), path.join(STORAGE, name));
    try {
      expect((await exported(name)).status).toBe(500);
      expect((await missingOf([name])).status).toBe(500);
    } finally {
      fs.unlinkSync(path.join(STORAGE, name));
    }
  });

  it("still says missing for a file that's gone, a folder, or a path through a file", async () => {
    const { plate } = await model();
    const relative = path.relative(STORAGE, plate.abs);
    const folder = path.dirname(relative);
    const gone = path.join(folder, `gone-${nonce()}.stl`);
    const through = path.join(relative, "inside.stl");
    reached("fileState:migrate.export");
    for (const absent of [gone, folder, through]) expect((await exported(absent)).status).toBe(404);
    expect((await exported(relative)).status).toBe(200);
    expect((await missingOf([gone, relative, folder, through])).body).toEqual({ missing: [gone, folder, through] });
  });
});
