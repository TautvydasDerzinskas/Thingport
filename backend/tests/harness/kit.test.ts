import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { STORAGE } from "../../src/config";
import { prisma } from "../../src/db";
import { checkLibraryInvariants, useStorageKit, type KitUser, type ModelSpec, type Rule } from ".";

// The invariants' own tests: a whole library made with the kit passes every rule, and each rule catches the one thing
// planted to break it, alone. Each test checks its own user's library only, so what one plants never reaches another.

const kit = useStorageKit(createApp());
const at = (relative: string) => path.join(STORAGE, relative);
const libraryOf = (owner: KitUser) => checkLibraryInvariants({ userIds: [owner.id] });

// Every kind of file a model keeps, two of them in folders, and a picture plate, whose thumbnail is made from it.
const WHOLE: ModelSpec = {
  plates: ["Base.stl", { name: "Lid.3mf", folder: "Parts" }, "Photo.png"],
  supporting: ["Guide.pdf", { name: "notes.txt", folder: "Docs" }],
  prepared: "Base.gcode",
  license: "CC-BY-4.0",
  gallery: 2,
  descriptionImages: 1,
};

describe("a whole library", () => {
  it("gives two files of one name in different folders bytes of their own", async () => {
    const owner = await kit.user();
    const model = await kit.model(owner, { supporting: ["notes.txt", { name: "notes.txt", folder: "Docs" }] });
    expect(model.files[0].bytes.equals(model.files[1].bytes)).toBe(false);
  });

  it("breaks no rule, with a tool's model in it", async () => {
    const owner = await kit.user();
    const model = await kit.model(owner, WHOLE);
    const tool = await kit.toolModel(owner);

    // There is something of every kind to judge: passing an empty library would prove nothing.
    expect(model.files.map((file) => file.role)).toEqual(["SUPPORTING", "SUPPORTING", "PREPARED", "LICENSE"]);
    expect(model.print.preparedFileId).toBe(model.files[2].id);
    const pictures = at(model.print.assetsPath!);
    expect(fs.readdirSync(path.join(pictures, "Thumbnails"))).toEqual([`${model.plates[2].id}.jpg`]);
    expect(fs.readdirSync(path.join(pictures, "Description"))).toHaveLength(1);
    expect(tool.plates[0].sourcePath).toBe(tool.sources[0].path);

    expect(await libraryOf(owner)).toEqual([]);
  });
});

describe("a file nobody owns", () => {
  it("is caught, and a picture named by one of its model's ids is not", async () => {
    const owner = await kit.user();
    const model = await kit.model(owner, { gallery: 1 });
    const pictures = at(model.print.assetsPath!);
    const orphan = path.join(path.dirname(at(model.plates[0].storagePath)), "orphan.stl");
    const foreign = path.join(pictures, `${kit.nonce()}.jpg`);
    fs.writeFileSync(orphan, kit.distinctBytes());
    fs.writeFileSync(foreign, kit.distinctBytes());
    // The model's own: a picture of its plate in the folder, and one of its photo in a subfolder of it.
    fs.writeFileSync(path.join(pictures, `${model.plates[0].id}.jpg`), kit.distinctBytes());
    fs.mkdirSync(path.join(pictures, "Renders"), { recursive: true });
    fs.writeFileSync(path.join(pictures, "Renders", `${model.previewImages[0].id}.render.v4.png`), kit.distinctBytes());

    const found = await libraryOf(owner);
    expect(found.toSorted((a, b) => a.path!.localeCompare(b.path!))).toEqual(
      [orphan, foreign].toSorted().map((file) => ({ rule: "unowned", path: file })),
    );
  });
});

/** Breaks one rule on the owner's library; undoes what would get in other suites' way. */
type Planting = (owner: KitUser) => Promise<(() => Promise<unknown>) | void>;

const PLANTINGS: [Rule, string, Planting][] = [
  [
    "file-missing",
    "a supporting file gone from the disk",
    async (owner) => {
      const { files } = await kit.model(owner, { supporting: ["Guide.pdf"] });
      fs.rmSync(at(files[0].storagePath));
    },
  ],
  [
    "not-a-file",
    "a folder at a file's path",
    async (owner) => {
      const { files } = await kit.model(owner, { supporting: ["Guide.pdf"] });
      fs.rmSync(at(files[0].storagePath));
      fs.mkdirSync(at(files[0].storagePath));
    },
  ],
  [
    "size",
    "a plate's file a byte longer than its row says",
    async (owner) => {
      const { plates } = await kit.model(owner);
      fs.appendFileSync(at(plates[0].storagePath), "x");
    },
  ],
  [
    "pending",
    "a file's row left at the placeholder a save starts from",
    async (owner) => {
      const { print } = await kit.model(owner);
      const row = await prisma.printFile.create({
        data: {
          printId: print.id,
          filename: "late.txt",
          mime: "text/plain",
          role: "SUPPORTING",
          storagePath: "pending",
        },
      });
      // One placeholder for every model: left there, it would stop every other suite's saves.
      return () => prisma.printFile.delete({ where: { id: row.id } });
    },
  ],
  [
    "shared-path",
    "a file's row on a plate's path",
    async (owner) => {
      const { print, plates } = await kit.model(owner);
      const row = await prisma.printFile.create({
        data: {
          printId: print.id,
          filename: "copy.stl",
          mime: "model/stl",
          role: "SUPPORTING",
          storagePath: plates[0].storagePath,
          size: plates[0].size,
        },
      });
      return () => prisma.printFile.delete({ where: { id: row.id } });
    },
  ],
  [
    "plate-name",
    "A.stl and a.stl in one folder",
    async (owner) => {
      const { plates } = await kit.model(owner, { plates: ["A.stl", "B.stl"] });
      await prisma.plate.update({ where: { id: plates[1].id }, data: { filename: "a.stl" } });
    },
  ],
  [
    "positions",
    "a gap in the plates' positions",
    async (owner) => {
      const { plates } = await kit.model(owner, { plates: ["A.stl", "B.stl"] });
      await prisma.plate.update({ where: { id: plates[1].id }, data: { position: 2 } });
    },
  ],
  [
    "prepared-slot",
    "a prepared slot naming another model's prepared print",
    async (owner) => {
      const mine = await kit.model(owner);
      const theirs = await kit.model(owner, { prepared: "Ready.gcode" });
      await prisma.print.update({ where: { id: theirs.print.id }, data: { preparedFileId: null } });
      await prisma.print.update({ where: { id: mine.print.id }, data: { preparedFileId: theirs.files[0].id } });
    },
  ],
  [
    "tool-plate",
    "a file at the path a tool's plate reserves",
    async (owner) => {
      const { plates } = await kit.toolModel(owner);
      fs.mkdirSync(path.dirname(at(plates[0].storagePath)), { recursive: true });
      fs.writeFileSync(at(plates[0].storagePath), kit.distinctBytes());
    },
  ],
  [
    "tool-plate",
    "a tool's own file gone",
    async (owner) => {
      const { sources } = await kit.toolModel(owner);
      fs.rmSync(sources[0].path);
    },
  ],
];

describe("each other rule", () => {
  it.each(PLANTINGS)("%s: catches %s, and only that", async (rule, _what, plant) => {
    const owner = await kit.user();
    const undo = await plant(owner);
    try {
      const found = await libraryOf(owner);
      expect(found.map((violation) => violation.rule)).toEqual([rule]);
    } finally {
      await undo?.();
    }
  });
});
