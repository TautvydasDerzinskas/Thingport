import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import sharp from "sharp";
import JSZip from "jszip";
import { Prisma, PrismaClient } from "@prisma/client";
import { createApp } from "../src/app";
import { STORAGE } from "../src/config";
import { prisma } from "../src/db";
import { buildZipEntries } from "../src/services/downloadZip";
import { normalizeZipEntryPath } from "../src/services/zipService";
import {
  removeAbandonedPrintFileSaves,
  renameSupportingFile,
  saveFileFromTemp,
} from "../src/services/printFileService";
import { createPrint } from "../src/services/printCreation";
import { relocatePrint } from "../src/services/printService";
import { withStorageLock } from "../src/utils/storageLock";
import { makePrint, nonce, register, tempFile, upload } from "./helpers/fileReuse";

// A model's supporting files on its page: listed with it, shown in the browser where that's safe, renamed, and zipped.

const app = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Waits for every one of `work` before failing on the first that did: none goes on after its test, using the
 *  database or the storage lock while the next one runs. */
async function allSettledOrThrow(work: Promise<unknown>[]): Promise<void> {
  const failed = (await Promise.allSettled(work)).find((result) => result.status === "rejected");
  if (failed) throw (failed as PromiseRejectedResult).reason;
}

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
    expect(listed).toMatchObject({ supporting_file_count: 2 });
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
    // Blank is no name either, rather than the one sanitising makes up for none.
    expect((await request(app).patch(route).set(auth(owner.token)).send({ filename: "   " })).status).toBe(400);
    expect((await prisma.printFile.findUniqueOrThrow({ where: { id: guide.id } })).filename).toBe("20231105_7f3a.pdf");

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

  it("give renames at once to one name a name each", async () => {
    const model = await makePrint(dir, owner.id, "Raced");
    const files = [];
    for (const name of ["a.txt", "b.txt", "c.txt", "d.txt"])
      files.push(await upload(dir, owner.id, model.print.id, name, name));
    await allSettledOrThrow(files.map((file) => renameSupportingFile(owner.id, model.print.id, file.id, "notes")));
    const after = await prisma.printFile.findMany({ where: { id: { in: files.map((file) => file.id) } } });
    expect(after.map((file) => file.filename).toSorted()).toEqual([
      "notes (2).txt",
      "notes (3).txt",
      "notes (4).txt",
      "notes.txt",
    ]);
  });

  it("aren't renamed once they're another model's, though they were this one's when the rename began", async () => {
    const model = await makePrint(dir, owner.id, "Given away");
    const taker = await makePrint(dir, owner.id, "Taken in");
    const file = await upload(dir, owner.id, model.print.id, "notes.txt", "notes");
    // Read as this model's, then made the other's, as a merge that ran while the rename waited for the lock would.
    const findUnique = prisma.printFile.findUnique.bind(prisma.printFile);
    const spy = vi.spyOn(prisma.printFile, "findUnique").mockImplementationOnce((async (
      args: Parameters<typeof prisma.printFile.findUnique>[0],
    ) => {
      const row = await findUnique(args);
      await prisma.printFile.update({ where: { id: file.id }, data: { printId: taker.print.id } });
      return row;
    }) as never);
    let renamed: unknown;
    try {
      renamed = await renameSupportingFile(owner.id, model.print.id, file.id, "guide").catch((err: unknown) => err);
    } finally {
      spy.mockRestore();
    }
    expect(renamed).toMatchObject({ status: 404 });
    expect((await prisma.printFile.findUniqueOrThrow({ where: { id: file.id } })).filename).toBe("notes.txt");
  });

  it("are renamed into the folder the model's name puts them in now, though it changed while the rename waited", async () => {
    const model = await makePrint(dir, owner.id, "Waited");
    const file = await upload(dir, owner.id, model.print.id, "notes.txt", "notes");
    const name = `Edited ${nonce()}`;
    // The model renamed once this rename has read it, as an edit made while the rename waits for the storage lock is.
    const findMany = prisma.printFile.findMany.bind(prisma.printFile);
    const spy = vi.spyOn(prisma.printFile, "findMany").mockImplementationOnce((async (
      args: Parameters<typeof prisma.printFile.findMany>[0],
    ) => {
      await prisma.print.update({ where: { id: model.print.id }, data: { name } });
      return findMany(args);
    }) as never);
    try {
      await renameSupportingFile(owner.id, model.print.id, file.id, "guide");
    } finally {
      spy.mockRestore();
    }
    const row = await prisma.printFile.findUniqueOrThrow({ where: { id: file.id } });
    expect(row.filename).toBe("guide.txt");
    expect(path.basename(path.dirname(row.storagePath))).toBe(name);
    expect(fs.readFileSync(path.join(STORAGE, row.storagePath), "utf8")).toBe("notes");
  });

  it("stay where their names say, the model's files too, when moves of one model run at once", async () => {
    // A few rounds: each move picks its files' places while the others are moving them.
    for (let round = 0; round < 3; round++) {
      const { print } = await createPrint(
        owner.id,
        { title: `Shuffled ${nonce()}` },
        `Shuffled ${nonce()}`,
        ["a", "b", "c", "d"].map((name) => ({
          filename: `${name}.stl`,
          tempFilePath: tempFile(dir, `solid ${nonce()}\nendsolid\n`),
        })),
      );
      const files = [];
      for (const name of ["a.txt", "b.txt", "c.txt", "d.txt"])
        files.push(await upload(dir, owner.id, print.id, name, name));
      // Each rename moves every file of the model, all at once.
      await allSettledOrThrow(
        files.map((file, n) => renameSupportingFile(owner.id, print.id, file.id, `part ${n + 1}`)),
      );
      // And four times at once to a new folder, as changes to the model's name would.
      const moved = await prisma.print.update({
        where: { id: print.id },
        data: { name: `Moved ${nonce()}` },
        include: { plates: true },
      });
      await allSettledOrThrow([1, 2, 3, 4].map(() => relocatePrint(moved, moved.plates)));

      const rows = [
        ...(await prisma.plate.findMany({ where: { printId: print.id } })),
        ...(await prisma.printFile.findMany({ where: { printId: print.id } })),
      ];
      expect(rows).toHaveLength(8);
      for (const row of rows) {
        // Neither numbered nor set aside in a folder named after the model, as a file in another's place is.
        expect(path.basename(row.storagePath)).toBe(row.filename);
        expect(path.basename(path.dirname(row.storagePath))).toBe(moved.name);
        expect(fs.existsSync(path.join(STORAGE, row.storagePath))).toBe(true);
      }
    }
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
    // The row it names holds what was just sent, not the earlier file of its name.
    const named = await prisma.printFile.findUniqueOrThrow({ where: { id: added.body.file_id } });
    expect(named.printId).toBe(model.print.id);
    expect(fs.readFileSync(path.join(STORAGE, named.storagePath), "utf8")).toBe("later");

    const sliced = await request(app)
      .post(route)
      .set(auth(owner.token))
      .attach("file", Buffer.from("; sliced\nG28\n"), "sliced.gcode");
    const { preparedFileId } = await prisma.print.findUniqueOrThrow({ where: { id: model.print.id } });
    expect(sliced.body.file_id).toBe(preparedFileId);
  });

  it("keep a prepared print an earlier one of several added in turn took, when asked to", async () => {
    const model = await makePrint(dir, owner.id, "Two slices");
    const route = `/api/print/${model.print.id}/files`;
    const add = (name: string, keepPrepared: boolean) => {
      const req = request(app).post(route).set(auth(owner.token));
      return (keepPrepared ? req.field("keep_prepared", "1") : req).attach(
        "file",
        Buffer.from("; sliced\nG28\n"),
        name,
      );
    };
    const first = await add("A.gcode", false);
    expect(first.body.prepared).toBe(true);
    const second = await add("B.gcode", true);
    expect(second.body.prepared).toBe(false);
    const files = await prisma.printFile.findMany({ where: { printId: model.print.id }, orderBy: { filename: "asc" } });
    expect(files.map((file) => [file.filename, file.role])).toEqual([
      ["A.gcode", "PREPARED"],
      ["B.gcode", "SUPPORTING"],
    ]);
    // Alone, a sliced print still takes the model's prepared print from the one it had.
    const third = await add("C.gcode", false);
    expect(third.body.prepared).toBe(true);
    const left = await prisma.printFile.findMany({ where: { printId: model.print.id }, orderBy: { filename: "asc" } });
    expect(left.map((file) => [file.filename, file.role])).toEqual([
      ["B.gcode", "SUPPORTING"],
      ["C.gcode", "PREPARED"],
    ]);
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

  it("leave the file another save put at a failed save's place, once the failed one's row was taken", async () => {
    const model = await makePrint(dir, owner.id, "Place taken");
    let place = "";
    let theirs: string | null = null;
    // Its last step fails, once its row and file were taken away and another save's file put at the place they left.
    const spy = vi.spyOn(PrismaClient.prototype, "$transaction").mockImplementationOnce((async () => {
      const row = await prisma.printFile.findFirstOrThrow({
        where: { printId: model.print.id, filename: "guide.pdf" },
      });
      place = row.storagePath;
      await prisma.printFile.delete({ where: { id: row.id } });
      fs.writeFileSync(path.join(STORAGE, place), "another save's");
      theirs = (
        await prisma.printFile.create({
          data: {
            printId: model.print.id,
            filename: "guide.pdf",
            mime: "application/pdf",
            role: "SUPPORTING",
            storagePath: place,
            size: 14,
            ready: true,
          },
        })
      ).id;
      throw new Error("Connection terminated unexpectedly");
    }) as never);
    try {
      await expect(
        saveFileFromTemp(owner.id, model.print.id, tempFile(dir, "%PDF-1.4 mine"), "guide.pdf", null),
      ).rejects.toThrow("Connection terminated unexpectedly");
      expect(theirs).not.toBeNull();
      expect(fs.readFileSync(path.join(STORAGE, place), "utf8")).toBe("another save's");
    } finally {
      spy.mockRestore();
      if (theirs) await prisma.printFile.deleteMany({ where: { id: theirs } });
      if (place) fs.rmSync(path.join(STORAGE, place), { force: true });
    }
  });

  it("keep a replaced prepared print's row while its file won't go, for the clean-up at startup to take", async () => {
    const model = await makePrint(dir, owner.id, "Replaced, stuck");
    await saveFileFromTemp(owner.id, model.print.id, tempFile(dir, "G1 X0\n"), "old.gcode", null);
    const old = await prisma.printFile.findFirstOrThrow({ where: { printId: model.print.id, filename: "old.gcode" } });
    const oldPath = path.resolve(STORAGE, old.storagePath);
    // The disk refuses to remove the replaced print's file.
    const rm = fsPromises.rm.bind(fsPromises);
    const spy = vi.spyOn(fsPromises, "rm").mockImplementation((async (where: fs.PathLike, options?: fs.RmOptions) => {
      if (path.resolve(String(where)) === oldPath) {
        throw Object.assign(new Error("EBUSY: resource busy"), { code: "EBUSY" });
      }
      return rm(where, options);
    }) as never);
    try {
      await saveFileFromTemp(owner.id, model.print.id, tempFile(dir, "G1 X9\n"), "new.gcode", null);
    } finally {
      spy.mockRestore();
    }
    try {
      expect((await prisma.printFile.findUnique({ where: { id: old.id } }))?.ready).toBe(false);
      expect(fs.existsSync(oldPath)).toBe(true);
      // Once it will go, the clean-up at startup takes both.
      await removeAbandonedPrintFileSaves();
      expect(await prisma.printFile.count({ where: { id: old.id } })).toBe(0);
      expect(fs.existsSync(oldPath)).toBe(false);
    } finally {
      await prisma.printFile.deleteMany({ where: { id: old.id } });
      fs.rmSync(oldPath, { force: true });
    }
  });

  it("keep a replaced print's row at startup while its file can't be looked at", async () => {
    const model = await makePrint(dir, owner.id, "Unreadable at startup");
    const storagePath = `unreadable-${nonce()}/old.gcode`;
    const where = path.join(STORAGE, storagePath);
    fs.mkdirSync(path.dirname(where), { recursive: true });
    fs.writeFileSync(where, "G1 X1\n");
    const row = await prisma.printFile.create({
      data: {
        printId: model.print.id,
        filename: "old.gcode",
        mime: "text/x-gcode",
        role: "PREPARED",
        storagePath,
        size: 6,
        ready: false,
      },
    });
    const lstat = fsPromises.lstat.bind(fsPromises);
    const spy = vi.spyOn(fsPromises, "lstat").mockImplementation((async (at: fs.PathLike) => {
      if (path.resolve(String(at)) === path.resolve(where)) {
        throw Object.assign(new Error("EIO: i/o error"), { code: "EIO" });
      }
      return lstat(at);
    }) as never);
    try {
      try {
        await removeAbandonedPrintFileSaves();
        expect(await prisma.printFile.count({ where: { id: row.id } })).toBe(1);
        expect(fs.existsSync(where)).toBe(true);
      } finally {
        spy.mockRestore();
      }
      // Once it can be, the clean-up takes both.
      await removeAbandonedPrintFileSaves();
      expect(await prisma.printFile.count({ where: { id: row.id } })).toBe(0);
      expect(fs.existsSync(where)).toBe(false);
    } finally {
      await prisma.printFile.deleteMany({ where: { id: row.id } });
      fs.rmSync(path.dirname(where), { recursive: true, force: true });
    }
  });

  it("stay where a later rename took them when an earlier rename's move comes after it", async () => {
    const model = await makePrint(dir, owner.id, "Renamed twice");
    await upload(dir, owner.id, model.print.id, "guide.pdf", "%PDF-1.4 guide");
    const photo = await request(app)
      .post(`/api/print/${model.print.id}/preview-images`)
      .set(auth(owner.token))
      .attach(
        "files",
        await sharp({ create: { width: 8, height: 8, channels: 3, background: "#cc0000" } })
          .png()
          .toBuffer(),
        "photo.png",
      );
    expect(photo.status).toBe(200);
    const stamp = nonce();
    const rename = (name: string) =>
      prisma.print.update({
        where: { id: model.print.id },
        data: { name, nameNormalized: name.toLowerCase() },
        include: { plates: true },
      });
    // The first rename's move reads the model, and waits there while the second rename is saved and its move runs to
    // its end; only then does it go on.
    const first = await rename(`Earlier ${stamp}`);
    const findUnique = prisma.print.findUnique.bind(prisma.print);
    let read = () => {};
    const hasRead = new Promise<void>((resolve) => (read = resolve));
    let goOn = () => {};
    const gate = new Promise<void>((resolve) => (goOn = resolve));
    let held = false;
    const spy = vi.spyOn(prisma.print, "findUnique").mockImplementation(((
      args: Parameters<typeof prisma.print.findUnique>[0],
    ) => {
      if (held || args.where.id !== model.print.id) return findUnique(args);
      held = true;
      return findUnique(args).then(async (row) => {
        read();
        await gate;
        return row;
      });
    }) as never);
    let moving: Promise<number> | null = null;
    try {
      moving = relocatePrint(first, first.plates);
      await hasRead;
      const second = await rename(`Later ${stamp}`);
      await relocatePrint(second, second.plates);
    } finally {
      goOn();
      spy.mockRestore();
      await moving;
    }
    const plate = await prisma.plate.findFirstOrThrow({ where: { printId: model.print.id } });
    const file = await prisma.printFile.findFirstOrThrow({ where: { printId: model.print.id, filename: "guide.pdf" } });
    const print = await prisma.print.findUniqueOrThrow({ where: { id: model.print.id } });
    expect(print.assetsPath).not.toBeNull();
    for (const stored of [plate.storagePath, file.storagePath, print.assetsPath!]) {
      expect(stored).toContain(`Later ${stamp}`);
      expect(fs.existsSync(path.join(STORAGE, stored))).toBe(true);
    }
  });

  it("keep a 3MF's kind read on its page only when no other file had its place while it was read", async () => {
    const threeMf = (marker: string) =>
      new JSZip()
        .file("3D/3dmodel.model", '<?xml version="1.0"?><model unit="millimeter"></model>')
        .file(marker, "x")
        .generateAsync({ type: "nodebuffer" });
    const { print, plates } = await createPrint(
      owner.id,
      { title: `Read while moved ${nonce()}` },
      "Read while moved",
      [{ filename: "part.3mf", tempFilePath: tempFile(dir, await threeMf("Metadata/Slic3r_PE.config")) }],
    );
    // As a 3MF stored before formats were: read on the model's page.
    await prisma.plate.update({ where: { id: plates[0].id }, data: { format: Prisma.DbNull } });
    const where = path.join(STORAGE, plates[0].storagePath);
    const swapped = await threeMf("Cura/settings.json");
    // While it's read, two turns at the lock move it away with another 3MF put in its place, and then back.
    const stat = fsPromises.stat.bind(fsPromises);
    let looks = 0;
    const spy = vi.spyOn(fsPromises, "stat").mockImplementation((async (at: fs.PathLike, ...rest: never[]) => {
      const seen = await stat(at, ...rest);
      if (path.resolve(String(at)) !== path.resolve(where)) return seen;
      looks += 1;
      if (looks === 1) {
        await withStorageLock(async () => {
          fs.renameSync(where, `${where}.away`);
          fs.writeFileSync(where, swapped);
        });
      } else if (looks === 2) {
        await withStorageLock(async () => fs.renameSync(`${where}.away`, where));
        return stat(at, ...rest);
      }
      return seen;
    }) as never);
    try {
      const res = await request(app).get(`/api/print/${print.id}?record=false`).set(auth(owner.token));
      expect(res.status).toBe(200);
      expect(looks).toBeGreaterThanOrEqual(2);
    } finally {
      spy.mockRestore();
      if (fs.existsSync(`${where}.away`)) fs.renameSync(`${where}.away`, where);
    }
    const plate = await prisma.plate.findUniqueOrThrow({ where: { id: plates[0].id } });
    expect((plate.format as { kind?: string } | null)?.kind).toBe("prusa");
  });

  it("never take a model file's place in a zip", async () => {
    const model = await makePrint(dir, owner.id, "Beside");
    const beside = await upload(dir, owner.id, model.print.id, "own.stl", "kept beside");
    const print = await prisma.print.findUniqueOrThrow({
      where: { id: model.print.id },
      include: { plates: true, category: true },
    });
    // A model file in a folder named "supporting" sits where a supporting file of its name would.
    const plates = print.plates.map((plate) => ({ ...plate, folder: "supporting" }));
    const entries = await buildZipEntries([{ ...print, plates }]);
    const arcnames = entries.map((entry) => entry.arcname);
    expect(new Set(arcnames).size).toBe(arcnames.length);
    // The plate keeps the name, and the supporting file is the one numbered.
    const at = (suffix: string) =>
      entries
        .filter((entry) => entry.arcname.endsWith(suffix))
        .map((entry) => ("filePath" in entry ? entry.filePath : null));
    expect(at("/supporting/own.stl")).toEqual([path.join(STORAGE, model.plate.storagePath)]);
    expect(at("/supporting/own (2).stl")).toEqual([path.join(STORAGE, beside.storagePath)]);
  });

  it("never make a file and a folder of one path in a zip", async () => {
    const model = await makePrint(dir, owner.id, "File or folder");
    const guide = await upload(dir, owner.id, model.print.id, "guide.pdf", "%PDF-1.4 guide");
    // A supporting file in a folder called as a plate in a folder named "supporting" is. Only its row says so: put
    // back after, as a storage move over every model would find a folder of a file's name where none can be made.
    await prisma.printFile.update({ where: { id: guide.id }, data: { folder: "Own.STL" } });
    try {
      const print = await prisma.print.findUniqueOrThrow({
        where: { id: model.print.id },
        include: { plates: true, category: true },
      });
      const [own] = print.plates;
      // And among plates: one in a folder called as another plate, and one called as another's folder.
      const plates = [
        { ...own, id: `${own.id}-1`, position: 0, folder: "supporting", filename: "own.stl" },
        { ...own, id: `${own.id}-2`, position: 1, folder: null, filename: "lid.stl" },
        { ...own, id: `${own.id}-3`, position: 2, folder: "lid.stl", filename: "inner.stl" },
        { ...own, id: `${own.id}-4`, position: 3, folder: "parts", filename: "base.stl" },
        { ...own, id: `${own.id}-5`, position: 4, folder: null, filename: "parts" },
      ];
      const arcnames = (await buildZipEntries([{ ...print, plates }])).map((entry) => entry.arcname);
      const prefix = arcnames[0].split("/supporting/")[0];
      expect(arcnames.map((arcname) => arcname.slice(prefix.length + 1))).toEqual([
        "supporting/own.stl",
        "lid.stl",
        "lid.stl (2)/inner.stl",
        "parts/base.stl",
        "parts (2)",
        "supporting/Own.STL (2)/guide.pdf",
      ]);
      // Each path a file, and none a folder above another's.
      const lower = arcnames.map((arcname) => arcname.toLowerCase());
      for (const arcname of lower) expect(lower.some((each) => each.startsWith(`${arcname}/`))).toBe(false);
    } finally {
      await prisma.printFile.update({ where: { id: guide.id }, data: { folder: null } });
    }
  });

  it("number a folder called as a file onto a path no other folder has, the same one for each of its files", async () => {
    const model = await makePrint(dir, owner.id, "Folder numbered");
    const first = await upload(dir, owner.id, model.print.id, "first.pdf", "%PDF-1.4 first");
    const second = await upload(dir, owner.id, model.print.id, "second.pdf", "%PDF-1.4 second");
    const third = await upload(dir, owner.id, model.print.id, "third.pdf", "%PDF-1.4 third");
    // Supporting files in a folder called as a plate in a folder named "supporting" is, and one in the folder it would
    // be numbered to. Only their rows say so: put back after, as a storage move over every model would find a folder
    // of a file's name where none can be made.
    const folders: [string, string][] = [
      [first.id, "own.stl"],
      [second.id, "own.stl"],
      [third.id, "own.stl (2)"],
    ];
    for (const [id, folder] of folders) await prisma.printFile.update({ where: { id }, data: { folder } });
    try {
      const print = await prisma.print.findUniqueOrThrow({
        where: { id: model.print.id },
        include: { plates: true, category: true },
      });
      const [own] = print.plates;
      // And among plates: two in a folder called as another plate, and one in the folder that would be numbered to.
      const plates = [
        { ...own, id: `${own.id}-1`, position: 0, folder: "supporting", filename: "own.stl" },
        { ...own, id: `${own.id}-2`, position: 1, folder: null, filename: "lid.stl" },
        { ...own, id: `${own.id}-3`, position: 2, folder: "lid.stl", filename: "a.stl" },
        { ...own, id: `${own.id}-4`, position: 3, folder: "lid.stl (2)", filename: "b.stl" },
        { ...own, id: `${own.id}-5`, position: 4, folder: "lid.stl", filename: "c.stl" },
      ];
      const arcnames = (await buildZipEntries([{ ...print, plates }])).map((entry) => entry.arcname);
      const prefix = arcnames[0].split("/supporting/")[0];
      expect(arcnames.map((arcname) => arcname.slice(prefix.length + 1)).toSorted()).toEqual(
        [
          "supporting/own.stl",
          "lid.stl",
          "lid.stl (3)/a.stl",
          "lid.stl (2)/b.stl",
          "lid.stl (3)/c.stl",
          "supporting/own.stl (3)/first.pdf",
          "supporting/own.stl (3)/second.pdf",
          "supporting/own.stl (2)/third.pdf",
        ].toSorted(),
      );
    } finally {
      for (const [id] of folders) await prisma.printFile.update({ where: { id }, data: { folder: null } });
    }
  });

  it("keep to their own model's folder in a zip, though their categories' names differ only by which slash they hold", async () => {
    const stamp = nonce();
    const models = [];
    for (const categoryName of [`A/B ${stamp}`, `A\\B ${stamp}`]) {
      const model = await makePrint(dir, owner.id, "Base");
      const category = await prisma.category.create({ data: { userId: owner.id, name: categoryName } });
      await prisma.print.update({
        where: { id: model.print.id },
        data: { name: `Base ${stamp}`, nameNormalized: `base ${stamp}`, categoryId: category.id },
      });
      models.push(model);
    }
    const prints = await prisma.print.findMany({
      where: { id: { in: models.map((model) => model.print.id) } },
      include: { plates: true, category: true },
    });
    // As the zip stores them: a backslash is a slash there.
    const arcnames = (await buildZipEntries(prints)).map((entry) => entry.arcname.replace(/\\/g, "/"));
    expect(new Set(arcnames.map((arcname) => arcname.toLowerCase())).size).toBe(arcnames.length);
    expect(arcnames.filter((arcname) => arcname.endsWith("/own.stl"))).toHaveLength(2);
  });

  it("keep to a folder of their own in a zip when a category or a model is called . or ..", async () => {
    const model = await makePrint(dir, owner.id, "Dots");
    const category = await prisma.category.create({ data: { userId: owner.id, name: ".." } });
    await prisma.print.update({
      where: { id: model.print.id },
      data: { name: ".", nameNormalized: ".", categoryId: category.id },
    });
    const print = await prisma.print.findUniqueOrThrow({
      where: { id: model.print.id },
      include: { plates: true, category: true },
    });
    const arcnames = (await buildZipEntries([print])).map((entry) => entry.arcname);
    expect(arcnames).toContain("__/_/own.stl");
    // Each comes back whole through Thingport's own import, which drops a file under "..".
    for (const arcname of arcnames) expect(normalizeZipEntryPath(arcname)).toBe(arcname);
  });

  it("leave a model's licence its own place in a zip, numbering a plate of its name", async () => {
    const model = await makePrint(dir, owner.id, "Licensed");
    const print = await prisma.print.findUniqueOrThrow({
      where: { id: model.print.id },
      include: { plates: true, category: true },
    });
    // A model of text files is all plates, LICENSE.txt among them.
    const plates = print.plates.map((plate) => ({ ...plate, folder: null, filename: "LICENSE.txt" }));
    const names = async (license: Prisma.JsonValue) =>
      (await buildZipEntries([{ ...print, plates, license }])).map((entry) => entry.arcname.split("/").pop());
    expect(await names({ id: "CC-BY-4.0", source: "user" })).toEqual(["LICENSE (2).txt", "LICENSE.txt"]);
    expect(await names(null)).toEqual(["LICENSE.txt"]);
  });

  it("each keep a path of their own in a zip, though two plates' differ only in case", async () => {
    const model = await makePrint(dir, owner.id, "Cased");
    const print = await prisma.print.findUniqueOrThrow({
      where: { id: model.print.id },
      include: { plates: true, category: true },
    });
    const [own] = print.plates;
    // A folder keeps the case it's given and a plate's name is told apart within its folder only, so these can all be
    // one model's; the third is already called what the second would become.
    const plates = [
      { ...own, id: `${own.id}-1`, position: 0, folder: "Parts", filename: "lid.stl" },
      { ...own, id: `${own.id}-2`, position: 1, folder: "parts", filename: "lid.stl" },
      { ...own, id: `${own.id}-3`, position: 2, folder: "parts", filename: "lid (2).stl" },
    ];
    const arcnames = (await buildZipEntries([{ ...print, plates }]))
      .map((entry) => entry.arcname)
      .filter((arcname) => arcname.endsWith(".stl"));
    expect(arcnames.map((arcname) => arcname.split("/").slice(-2).join("/"))).toEqual([
      "Parts/lid.stl",
      "parts/lid (3).stl",
      "parts/lid (2).stl",
    ]);
  });

  it("keep to their own model's folder in a zip, though another model has its name", async () => {
    const name = `Base ${nonce()}`;
    const models = [];
    // Two categories can each hold a "Base", and a download across them leaves the categories out; a third model is
    // already called what the second would become.
    for (const [label, modelName] of [
      ["Kitchen", name],
      ["Garage", name],
      ["Shed", `${name} (2)`],
    ]) {
      const model = await makePrint(dir, owner.id, label);
      const category = await prisma.category.create({ data: { userId: owner.id, name: `${label} ${nonce()}` } });
      await prisma.print.update({
        where: { id: model.print.id },
        data: { name: modelName, nameNormalized: modelName.toLowerCase(), categoryId: category.id },
      });
      await upload(dir, owner.id, model.print.id, "notes.txt", label);
      models.push(model);
    }
    const prints = await prisma.print.findMany({
      where: { id: { in: models.map((model) => model.print.id) } },
      include: { plates: true, category: true },
    });
    const ordered = models.map((model) => prints.find((print) => print.id === model.print.id)!);
    const entries = await buildZipEntries(ordered, { flatten: true });
    const arcnames = entries.map((entry) => entry.arcname);
    expect(new Set(arcnames.map((arcname) => arcname.toLowerCase())).size).toBe(arcnames.length);
    expect(arcnames.filter((arcname) => arcname.endsWith("/supporting/notes.txt")).toSorted()).toEqual([
      `${name} (2)/supporting/notes.txt`,
      `${name} (3)/supporting/notes.txt`,
      `${name}/supporting/notes.txt`,
    ]);
    // The one already called "(2)" keeps its folder: the second "Base" steps around it. Each folder holds its own
    // model's files, told apart by the notes each was given.
    expect(arcnames).toContain(`${name} (2)/own.stl`);
    expect(arcnames).toContain(`${name} (3)/own.stl`);
    const notesIn = (folder: string) => {
      const entry = entries.find((each) => each.arcname === `${folder}/supporting/notes.txt`);
      return entry && "filePath" in entry ? fs.readFileSync(entry.filePath, "utf8") : null;
    };
    expect([notesIn(name), notesIn(`${name} (2)`), notesIn(`${name} (3)`)]).toEqual(["Kitchen", "Shed", "Garage"]);
  });
});
