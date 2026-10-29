import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { STORAGE } from "../src/config";
import { prisma } from "../src/db";
import { makePrint, register, tempFile, upload } from "./helpers/fileReuse";
import { modelFilesMissing, scanMissingFiles } from "../src/services/missingFilesService";
import { replaceModelPlates } from "../src/services/modelFilesReplace";

// Finding the models whose files are gone, and the repair that deletes them. Re-importing is not covered here: it
// talks to the providers, which the import suites stand up their own servers for.

const app = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

let dir: string;
let owner: { id: string; token: string };

async function waitForRun(token: string) {
  for (let i = 0; i < 200; i++) {
    const res = await request(app).get("/api/prints/repair/run").set(auth(token));
    if (!res.body.run?.running) return res;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("the repair run did not finish");
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "thingport-missing-files-"));
  owner = await register(app, "missing-files", "Owner");
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("models whose files are gone", () => {
  it("counts only the models with no file left, and says they have nothing to fetch from", async () => {
    const broken = await makePrint(dir, owner.id, "Broken");
    const whole = await makePrint(dir, owner.id, "Whole");
    // The accident: the file goes, the row stays.
    fs.rmSync(path.join(STORAGE, broken.plate.storagePath), { force: true });

    const scan = await scanMissingFiles(owner.id);
    expect(scan.broken.map((model) => model.id)).toEqual([broken.print.id]);
    expect(scan.total).toBeGreaterThanOrEqual(2);
    // An upload has no provider to ask for its file again.
    expect(scan.broken[0].route).toBe("none");
    expect(scan.broken[0].sourceUrl).toBeNull();

    expect(await modelFilesMissing([whole.plate])).toBe(false);
    expect(await modelFilesMissing([])).toBe(false);
  });

  it("reports the count over the API, and prompts only once it's a fair share of the library", async () => {
    const res = await request(app).get("/api/prints/missing-files?refresh=1").set(auth(owner.token));
    expect(res.status).toBe(200);
    expect(res.body.broken).toBe(1);
    expect(res.body.no_source).toBe(1);
    expect(res.body.by_provider).toEqual([{ provider: null, count: 1 }]);
    // One model of two is a fair share, but one lost file is not an accident worth interrupting over.
    expect(res.body.prompt).toBe(false);
  });

  it("deletes the models with no files and leaves the rest alone", async () => {
    const before = await prisma.print.count({ where: { userId: owner.id } });
    const started = await request(app).post("/api/prints/repair").set(auth(owner.token)).send({ action: "delete" });
    expect(started.status).toBe(200);
    expect(started.body.run.action).toBe("delete");

    const finished = await waitForRun(owner.token);
    expect(finished.body.run.deleted).toBe(1);
    expect(finished.body.run.failed).toBe(0);
    expect(await prisma.print.count({ where: { userId: owner.id } })).toBe(before - 1);

    const after = await request(app).get("/api/prints/missing-files").set(auth(owner.token));
    expect(after.body.broken).toBe(0);
  });

  it("puts the plates back when a replacement fails halfway, so the model is still found", async () => {
    const model = await makePrint(dir, owner.id, "Halfway");
    // A model can lose its plate files alone: its supporting files are still there, and still its own afterwards.
    const note = await upload(dir, owner.id, model.print.id, "notes.txt", "keep me");
    fs.rmSync(path.join(STORAGE, model.plate.storagePath), { force: true });

    await expect(
      replaceModelPlates(owner.id, model.print.id, [
        { filename: "first.stl", tempFilePath: tempFile(dir, "solid first\nendsolid\n") },
        // Nothing at this path, so the second plate throws where the first has already been stored.
        { filename: "second.stl", tempFilePath: path.join(dir, "not-here.stl") },
      ]),
    ).rejects.toThrow(/ENOENT/);

    const plates = await prisma.plate.findMany({ where: { printId: model.print.id } });
    expect(plates.map((plate) => plate.id)).toEqual([model.plate.id]);
    expect(plates[0].storagePath).toBe(model.plate.storagePath);
    expect(await prisma.printFile.findUnique({ where: { id: note.id } })).not.toBeNull();
    expect(fs.existsSync(path.join(STORAGE, note.storagePath))).toBe(true);
    // As broken as it was, rather than a model with no plates at all -- which the scan passes over, leaving it
    // beyond repair.
    const scan = await scanMissingFiles(owner.id);
    expect(scan.broken.map((broken) => broken.id)).toContain(model.print.id);
  });

  it("refuses an action it doesn't know, and a request with no sign-in", async () => {
    const bad = await request(app).post("/api/prints/repair").set(auth(owner.token)).send({ action: "shred" });
    expect(bad.status).toBe(400);
    const anonymous = await request(app).get("/api/prints/missing-files");
    expect(anonymous.status).toBe(401);
  });
});
