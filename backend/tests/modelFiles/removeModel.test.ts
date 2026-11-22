import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { STORAGE } from "../../src/config";
import { prisma } from "../../src/db";
import { removeModel } from "../../src/modelFiles/removeModel";
import { deleteAllPrintsForUser } from "../../src/services/adminService";
import { discardPrintOrThrow } from "../../src/services/printCreation";
import { deletePrint } from "../../src/services/printEditService";
import { checkLibraryInvariants, faults, pauseAt, useStorageKit, type KitModel, type KitUser } from "../harness";

// The one delete (src/modelFiles/removeModel.ts): every way a model goes leaves nothing of it, a tool's file stays, a
// failure before its rows go removes nothing, and one after them leaves only the file it couldn't remove.

const app = createApp();
const kit = useStorageKit(app);
const at = (relative: string) => path.join(STORAGE, relative);
const WHOLE = {
  supporting: ["notes.txt"],
  prepared: "Tower.gcode",
  license: "CC-BY-4.0",
  gallery: 1,
  descriptionImages: 1,
};

/** Nothing of the model left: no row, no file, not its folder, and nothing of its owner's that no row owns. */
async function expectGone(model: KitModel) {
  expect(await prisma.print.count({ where: { id: model.print.id } })).toBe(0);
  expect(await prisma.printFile.count({ where: { printId: model.print.id } })).toBe(0);
  for (const plate of model.plates) expect(fs.existsSync(at(plate.storagePath))).toBe(false);
  expect(fs.existsSync(path.dirname(at(model.plates[0].storagePath)))).toBe(false);
  expect(await checkLibraryInvariants(kit.scope())).toEqual([]);
}

describe("removing a model", () => {
  it.each([
    [
      "its owner's delete",
      async (owner: KitUser, model: KitModel) => {
        const res = await request(app).delete(`/api/print/${model.print.id}`).set(owner.auth);
        expect(res.status).toBeLessThan(300);
      },
    ],
    ["an admin's delete of all of a user's models", (owner: KitUser) => deleteAllPrintsForUser(owner.id)],
    [
      "the discard of one that couldn't be made",
      (_owner: KitUser, model: KitModel) => discardPrintOrThrow(model.print.id),
    ],
  ])("by %s leaves nothing of it, and another's files stay", async (_way, remove) => {
    const owner = await kit.user();
    const model = await kit.model(owner, WHOLE);
    const other = await kit.model(await kit.user(), WHOLE);

    await remove(owner, model);

    await expectGone(model);
    for (const file of [...other.plates, ...other.files])
      expect(fs.readFileSync(at(file.storagePath))).toEqual(file.bytes);
  });

  it("keeps a tool's file, and a file put at its plate's place, when the model goes", async () => {
    const owner = await kit.user();
    const tool = await kit.toolModel(owner);
    const reserved = at(tool.plates[0].storagePath);
    fs.mkdirSync(path.dirname(reserved), { recursive: true });
    fs.writeFileSync(reserved, "not the model's");
    try {
      await deletePrint(owner.id, tool.print.id, { quiet: true });

      for (const source of tool.sources) expect(fs.readFileSync(source.path)).toEqual(source.bytes);
      expect(fs.readFileSync(reserved, "utf8")).toBe("not the model's");
    } finally {
      fs.rmSync(reserved, { force: true });
    }
  });

  it("removes nothing when a look at one of its files fails first", async () => {
    const owner = await kit.user();
    const model = await kit.model(owner, WHOLE);
    faults.at("fileState:delete.look", 2, "EIO");

    await expect(removeModel(model.print.id)).rejects.toMatchObject({ code: "EIO" });

    expect(await prisma.printFile.count({ where: { printId: model.print.id } })).toBe(model.files.length);
    expect(await checkLibraryInvariants(kit.scope())).toEqual([]);
  });

  it("leaves the model whole when the database refuses to take its rows", async () => {
    const owner = await kit.user();
    const model = await kit.model(owner, WHOLE);
    // The database refuses the deletion of this model's photos, as a dropped connection would, after its files' rows
    // went in the same transaction.
    await prisma.$executeRawUnsafe(`CREATE FUNCTION remove_test_refuse() RETURNS trigger AS $$ BEGIN
      IF OLD."printId" = '${model.print.id}' THEN RAISE EXCEPTION 'connection lost'; END IF; RETURN OLD; END $$
      LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER remove_test_refuse BEFORE DELETE ON "PreviewImage"
      FOR EACH ROW EXECUTE FUNCTION remove_test_refuse()`);
    try {
      await expect(removeModel(model.print.id)).rejects.toThrow(/connection lost/);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER remove_test_refuse ON "PreviewImage"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION remove_test_refuse()`);
    }

    expect(await prisma.printFile.count({ where: { printId: model.print.id } })).toBe(model.files.length);
    expect(await checkLibraryInvariants(kit.scope())).toEqual([]);
  });

  it("goes on past a file it can't remove once the rows are gone, leaving only that one", async () => {
    const owner = await kit.user();
    const model = await kit.model(owner, WHOLE);
    const stuck = at(model.files[0].storagePath);
    faults.at("remove:delete.unlink", 1, "EIO", { path: stuck });

    expect(await removeModel(model.print.id)).toMatchObject({ userId: owner.id });

    expect(await prisma.print.count({ where: { id: model.print.id } })).toBe(0);
    expect(await checkLibraryInvariants(kit.scope())).toEqual([
      expect.objectContaining({ rule: "unowned", path: stuck }),
    ]);
    fs.rmSync(stuck);
  });

  it("goes on with an admin's delete when models went meanwhile", async () => {
    const owner = await kit.user();
    const models = [await kit.model(owner), await kit.model(owner)];
    const gate = pauseAt("fileState:delete.look");
    const all = kit.start(() => deleteAllPrintsForUser(owner.id));
    await gate.reachedBy(all);
    // Both go another way while the first is being looked at.
    for (const model of models) await removeModel(model.print.id).catch(() => undefined);
    gate.release();

    expect(await all).toBe(2);
    expect(await prisma.print.count({ where: { userId: owner.id } })).toBe(0);
  });

  it("takes an author only the discarded model named", async () => {
    const owner = await kit.user();
    const model = await kit.model(owner);
    const author = await prisma.author.create({
      data: { id: kit.nonce(), provider: "test", externalId: kit.nonce(), name: "Maker" },
    });
    await prisma.print.update({ where: { id: model.print.id }, data: { authorId: author.id } });

    await discardPrintOrThrow(model.print.id);

    expect(await prisma.author.count({ where: { id: author.id } })).toBe(0);
  });
});
