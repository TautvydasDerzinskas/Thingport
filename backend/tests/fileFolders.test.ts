import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { buildZipEntries, resolvePrintsForDownload } from "../src/services/downloadZip";
import { modelFilesFromZip, parametricSourcesFromZip } from "../src/services/importService";
import { createPrint, renamePlate } from "../src/services/printCreation";
import { getStorageTemplate, setStorageTemplate } from "../src/services/printService";
import { isZipJunk, joinFolders, normalizeFolder, withoutSharedTop } from "../src/utils/fileFolder";
import { grabcadFolderFrom } from "../src/providers/grabcad/api";

// The folders a model's files came in -- a site's, a zip's, a partner's -- kept on each file, and what they decide:
// which names may repeat, where each file is stored, and what a zip of the model holds.

const app = createApp();
const stamp = Date.now();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thingport-folders-"));
let userId: string;
let token: string;
let previousTemplate: string;

function tmpFile(name: string, contents = `solid ${name} endsolid`): string {
  const file = path.join(fs.mkdtempSync(path.join(dir, "f-")), name);
  fs.writeFileSync(file, contents);
  return file;
}

async function zipOf(entries: Record<string, string | Buffer>): Promise<string> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(entries)) zip.file(name, content);
  const zipPath = path.join(fs.mkdtempSync(path.join(dir, "z-")), "all.zip");
  fs.writeFileSync(zipPath, await zip.generateAsync({ type: "nodebuffer" }));
  return zipPath;
}

const placesOf = (files: { filename: string; folder?: string | null }[]) =>
  files.map((file) => (file.folder ? `${file.folder}/${file.filename}` : file.filename));

beforeAll(async () => {
  // The database is shared across files: the template goes back afterwards.
  previousTemplate = await getStorageTemplate();
  await setStorageTemplate("{category-or-folder}/{model}/{filename}");
  const res = await request(app)
    .post("/api/register")
    .send({ displayName: "Folder Tester", email: `folders-${stamp}@example.com`, password: "password123" });
  userId = res.body.user.id;
  token = res.body.token;
});

afterAll(async () => {
  await setStorageTemplate(previousTemplate);
  await prisma.print.deleteMany({ where: { userId } });
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("a folder as it's kept", () => {
  it("is its levels, tidied, with nothing that climbs out of it", () => {
    expect(normalizeFolder("  USB C version  20mm ")).toBe("USB C version 20mm");
    expect(normalizeFolder("a\\b/../c/./d")).toBe("a/b/c/d");
    expect(normalizeFolder(["Pack", "Big\u0000 Brother", ""])).toBe("Pack/Big Brother");
    expect(normalizeFolder(Array.from({ length: 12 }, (_, i) => `L${i}`))).toBe("L0/L1/L2/L3/L4/L5/L6/L7");
    for (const none of [null, undefined, "", "/", "..", " . / .. "]) expect(normalizeFolder(none)).toBeNull();
    expect(joinFolders("Variant", null, "Base/Arms")).toBe("Variant/Base/Arms");
  });

  it("loses the top levels every file shares, and only those", () => {
    const folders = (...each: (string | null)[]) => withoutSharedTop(each.map((folder) => ({ folder })));
    expect(folders("Pack/supported", "Pack/unsupported")).toEqual([{ folder: "supported" }, { folder: "unsupported" }]);
    expect(folders("Pack/Hero/supported", "Pack/Hero/unsupported")).toEqual([
      { folder: "supported" },
      { folder: "unsupported" },
    ]);
    // A file at the top keeps everything below it as it is.
    expect(folders(null, "Pack/supported")).toEqual([{ folder: null }, { folder: "Pack/supported" }]);
    expect(folders("STL", "STL")).toEqual([{ folder: null }, { folder: null }]);
  });

  it("knows what macOS leaves in a zip", () => {
    expect(isZipJunk("__MACOSX/Pack/._Arm.stl")).toBe(true);
    expect(isZipJunk("Pack/._Arm.stl")).toBe(true);
    expect(isZipJunk("Pack/.DS_Store")).toBe(true);
    expect(isZipJunk("Pack/Arm.stl")).toBe(false);
  });
});

describe("a zip's files", () => {
  it("keep their folders, less the one the whole pack is in, and the same name in two of them", async () => {
    const zipPath = await zipOf({
      "Pack/supported/Arm.stl": "solid a endsolid",
      "Pack/no supports/Arm.stl": "solid b endsolid",
      "Pack/Base.stl": "solid c endsolid",
      "__MACOSX/Pack/._Base.stl": "resource fork",
      "Pack/.DS_Store": "junk",
    });
    const files = await modelFilesFromZip(zipPath);
    expect(placesOf(files).toSorted()).toEqual(["Base.stl", "no supports/Arm.stl", "supported/Arm.stl"]);
  });

  it("keep zips side by side apart by their names, and one zip wrapped in another adds none", async () => {
    const inner = async (entries: Record<string, string>) => fs.readFileSync(await zipOf(entries));
    const sideBySide = await zipOf({
      "Pack/32mm.zip": await inner({ "Body.stl": "solid a endsolid" }),
      "Pack/75mm.zip": await inner({ "Body.stl": "solid b endsolid" }),
    });
    expect(placesOf(await modelFilesFromZip(sideBySide)).toSorted()).toEqual(["32mm/Body.stl", "75mm/Body.stl"]);
    const wrapped = await zipOf({
      "Designer/model/model-v1.1.zip": await inner({ "Parts/Body.stl": "solid c endsolid" }),
    });
    expect(placesOf(await modelFilesFromZip(wrapped))).toEqual(["Body.stl"]);
  });

  it("give a model's plates and its scripts the same folders", async () => {
    const zipPath = await zipOf({
      "Model/STL/box.stl": "solid box endsolid",
      "Model/SCAD/box.scad": "cube(10);",
    });
    expect(placesOf(await modelFilesFromZip(zipPath))).toEqual(["STL/box.stl"]);
    expect(placesOf(await parametricSourcesFromZip(zipPath))).toEqual(["SCAD/box.scad"]);
  });

  // Read twice over, a zip wrapped in another must still lose the same levels for both: here the script stays beside
  // the "parts" folder it would read from, rather than the part losing it.
  // The files beside a zip count too: a script at the top keeps the folder the zip of its parts gives them.
  it("keep a zip's folder for its files when a script sits beside it", async () => {
    const parts = await zipOf({ "part.stl": "solid p endsolid" });
    const zipPath = await zipOf({ "main.scad": 'import("parts/part.stl");', "parts.zip": fs.readFileSync(parts) });
    expect(placesOf(await modelFilesFromZip(zipPath))).toEqual(["parts/part.stl"]);
    expect(placesOf(await parametricSourcesFromZip(zipPath))).toEqual(["main.scad"]);
  });

  it("give a wrapped zip's plates and scripts the same folders too", async () => {
    const inner = await zipOf({
      "pack/main.scad": 'import("parts/part.stl");',
      "pack/parts/part.stl": "solid p endsolid",
    });
    const zipPath = await zipOf({ "bundle.zip": fs.readFileSync(inner) });
    expect(placesOf(await modelFilesFromZip(zipPath))).toEqual(["parts/part.stl"]);
    expect(placesOf(await parametricSourcesFromZip(zipPath))).toEqual(["main.scad"]);
  });
});

describe("a model's files in folders", () => {
  it("may share a name in different folders, and are stored in them", async () => {
    const { print, plates } = await createPrint(
      userId,
      { title: `Bandit ${stamp}` },
      "bandit",
      [
        { filename: "Top.stl", folder: "Supported", tempFilePath: tmpFile("Top.stl") },
        { filename: "Top.stl", folder: "Unsupported", tempFilePath: tmpFile("Top.stl") },
        { filename: "Top.stl", folder: "Supported", tempFilePath: tmpFile("Top.stl") },
        { filename: "Base.stl", tempFilePath: tmpFile("Base.stl") },
        { filename: "Render.stl", folder: "Images", tempFilePath: tmpFile("Render.stl") },
      ],
      { describe: false, classify: false },
    );
    expect(placesOf(plates)).toEqual([
      "Supported/Top.stl",
      "Unsupported/Top.stl",
      "Supported/Top (2).stl",
      "Base.stl",
      "Images/Render.stl",
    ]);
    const stored = plates.map((plate) => plate.storagePath.split(path.sep).slice(1).join("/"));
    // Uncategorized, as the template's first level says.
    expect(stored).toEqual([
      `Unassigned/${print.name}/Supported/Top.stl`,
      `Unassigned/${print.name}/Unsupported/Top.stl`,
      `Unassigned/${print.name}/Supported/Top (2).stl`,
      `Unassigned/${print.name}/Base.stl`,
      // The model's pictures have its Images folder.
      `Unassigned/${print.name}/Images (files)/Render.stl`,
    ]);

    // Renamed, a name is still only checked against its own folder's.
    expect(await renamePlate(print, plates[3].id, "Top.stl")).toBe("Top.stl");
    expect(await renamePlate(print, plates[2].id, "Top.stl")).toBe("Top (2).stl");
  });

  it("go in a folder beside the model's files under a template that keeps models side by side", async () => {
    await setStorageTemplate("{category-or-folder}/{model} - {filename}");
    try {
      const { print, plates } = await createPrint(
        userId,
        { title: `Gadget ${stamp}` },
        "gadget",
        [{ filename: "Plug.stl", folder: "Plugs/Small", tempFilePath: tmpFile("Plug.stl") }],
        { describe: false, classify: false },
      );
      expect(plates[0].storagePath.split(path.sep).slice(1).join("/")).toBe(
        `Unassigned/${print.name} - Plugs/Small/${print.name} - Plug.stl`,
      );
    } finally {
      await setStorageTemplate("{category-or-folder}/{model}/{filename}");
    }
  });

  it("download in their folders, all of them or one folder's", async () => {
    const { print } = await createPrint(
      userId,
      { title: `Organizer ${stamp}` },
      "organizer",
      [
        { filename: "Lid.stl", folder: "USB C", tempFilePath: tmpFile("Lid.stl") },
        { filename: "Lid.stl", folder: "USB C/Handles", tempFilePath: tmpFile("Lid.stl") },
        { filename: "Lid.stl", folder: "USB A", tempFilePath: tmpFile("Lid.stl") },
        { filename: "Box.stl", tempFilePath: tmpFile("Box.stl") },
      ],
      { describe: false, classify: false },
    );
    const prints = await resolvePrintsForDownload(userId, { print_ids: [print.id] });
    const names = async (folder?: string) =>
      (await buildZipEntries(prints, { flatten: true, folder })).map((entry) => entry.arcname);
    expect(await names()).toEqual([
      `${print.name}/USB C/Lid.stl`,
      `${print.name}/USB C/Handles/Lid.stl`,
      `${print.name}/USB A/Lid.stl`,
      `${print.name}/Box.stl`,
    ]);
    expect(await names("USB C")).toEqual([`${print.name}/USB C/Lid.stl`, `${print.name}/USB C/Handles/Lid.stl`]);
    // A folder's name is a whole level: "USB" holds neither.
    expect(await names("USB")).toEqual([]);

    // One that names no folder at all is refused, rather than taken to mean every file.
    for (const folder of ["..", "./"]) {
      const res = await request(app)
        .post("/api/download/zip")
        .set({ Authorization: `Bearer ${token}` })
        .send({ print_ids: [print.id], folder });
      expect(res.status).toBe(400);
    }
    const one = await request(app)
      .post("/api/download/zip")
      .set({ Authorization: `Bearer ${token}` })
      .send({ print_ids: [print.id], folder: "USB A" });
    expect(one.status).toBe(200);
  });
});

describe("GrabCAD's folders", () => {
  it("are each folder's path below the model's own", () => {
    const row = {
      name: "part.stl",
      system: "STL",
      download_url: "https://grabcad.com/community/api/v1/models/x/files/download?cadid=1",
    };
    const folder = grabcadFolderFrom({
      folder_path: [
        { id: 1, name: "Creality Ender 5 Pro" },
        { id: 2, name: "parts" },
        { id: 3, name: "x-axis-assem" },
      ],
      folders: [],
      files: [row],
    });
    expect(folder?.files.map((file) => file.folder)).toEqual(["parts/x-axis-assem"]);
    expect(
      grabcadFolderFrom({ folder_path: [{ id: 1, name: "Model" }], folders: [], files: [row] })?.files[0].folder,
    ).toBeNull();
  });
});
