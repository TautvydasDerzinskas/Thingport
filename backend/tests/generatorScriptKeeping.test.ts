import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/app";
import { makePrint, nonce, register, tempFile } from "./helpers/fileReuse";
import { keepGeneratorScripts } from "../src/services/printCreation";
import { prisma } from "../src/db";

// A generator script reaches a model as a supporting file, never as a plate, and reaches it once however many
// times it is offered: a model's script comes down again with every MakerOnline profile after the first (see
// importService's addProfiles), and storing each copy would leave the model holding "box.scad", "box (1).scad"
// and on, every one of them the same bytes.

const app = createApp();
let userId: string;
let dir: string;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "script-keeping-"));
  userId = (await register(app, "script-keeping", "owner")).id;
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const SCRIPT = "box_width = 40;\n";

/** The supporting files the model holds, by name. */
const filesOf = async (printId: string) =>
  (await prisma.printFile.findMany({ where: { printId }, orderBy: { createdAt: "asc" } })).map((file) => file.filename);

describe("keepGeneratorScripts", () => {
  it("keeps a script beside the model as a supporting file", async () => {
    const { print } = await makePrint(dir, userId, "Kept");

    await keepGeneratorScripts(userId, print.id, [{ filename: "box.scad", tempFilePath: tempFile(dir, SCRIPT) }]);

    expect(await filesOf(print.id)).toEqual(["box.scad"]);
    // The model's plate is untouched: a script is never one.
    expect(await prisma.plate.count({ where: { printId: print.id } })).toBe(1);
  });

  it("skips a script the model already has under that name", async () => {
    const { print } = await makePrint(dir, userId, "Twice");
    const script = () => ({ filename: "box.scad", tempFilePath: tempFile(dir, SCRIPT) });

    await keepGeneratorScripts(userId, print.id, [script()]);
    await keepGeneratorScripts(userId, print.id, [script()]);

    expect(await filesOf(print.id)).toEqual(["box.scad"]);
  });

  it("stores the first of several copies offered at once", async () => {
    const { print } = await makePrint(dir, userId, "Together");

    await keepGeneratorScripts(userId, print.id, [
      { filename: "box.scad", tempFilePath: tempFile(dir, SCRIPT) },
      { filename: "box.scad", tempFilePath: tempFile(dir, SCRIPT) },
      { filename: "lid.scad", tempFilePath: tempFile(dir, "lid = 1;\n") },
    ]);

    expect(await filesOf(print.id)).toEqual(["box.scad", "lid.scad"]);
  });

  it("compares names as they will be stored, not as they arrived", async () => {
    const { print } = await makePrint(dir, userId, "Sanitized");
    await keepGeneratorScripts(userId, print.id, [{ filename: "box.scad", tempFilePath: tempFile(dir, SCRIPT) }]);
    // A zip entry's padded name is stored trimmed, so it is the trimmed name a second copy collides with.
    await keepGeneratorScripts(userId, print.id, [{ filename: "  box.scad  ", tempFilePath: tempFile(dir, SCRIPT) }]);

    expect(await filesOf(print.id)).toEqual(["box.scad"]);
  });

  it("leaves the model made when a script won't store", async () => {
    const { print } = await makePrint(dir, userId, "Missing");

    // Nothing to read: the script is lost, but the model and its plates are what the user asked for.
    await expect(
      keepGeneratorScripts(userId, print.id, [
        { filename: "box.scad", tempFilePath: path.join(dir, `absent-${nonce()}`) },
      ]),
    ).resolves.toBeUndefined();

    expect(await filesOf(print.id)).toEqual([]);
    expect(await prisma.plate.count({ where: { printId: print.id } })).toBe(1);
  });

  it("asks nothing of the database when there are no scripts", async () => {
    const { print } = await makePrint(dir, userId, "None");

    await keepGeneratorScripts(userId, print.id, []);

    expect(await filesOf(print.id)).toEqual([]);
  });
});
