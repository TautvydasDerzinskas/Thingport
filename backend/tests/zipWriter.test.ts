import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { writeZip } from "../src/utils/zipWriter";
import { listZipEntries, readZipEntry } from "../src/utils/zipReader";

// Zip downloads name entries after models, categories and files, which are often not ASCII. A reader only
// decodes a name as UTF-8 when the entry is flagged as such, so the round trip goes through the app's own
// reader, the one behind zip imports and the consume folder.

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thingport-zip-writer-"));

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("writeZip", () => {
  it("keeps non-ASCII names when the zip is read back", async () => {
    const source = path.join(dir, "benchy.stl");
    fs.writeFileSync(source, "solid benchy endsolid");
    const names = [
      "Gyvūnai/Šuniukas – Benchy/šuniukas.stl",
      "Unassigned/哨子/哨子.3mf",
      "Figurines/Pokémon Pikachu/supporting/notes.txt",
      "Tools/Cable clip/clip.stl",
    ];
    const zipPath = path.join(dir, "names.zip");
    await writeZip(
      zipPath,
      names.map((arcname) => ({ arcname, filePath: source })),
    );

    expect((await listZipEntries(zipPath)).map((e) => e.name)).toEqual(names);
    expect((await readZipEntry(zipPath, names[0], 1024))?.toString()).toBe("solid benchy endsolid");
  });
});
