import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import fc from "fast-check";
import { afterAll, describe, expect, it } from "vitest";
import { writeZip, ZIP_MAX_ENTRIES, zipExtent, zipFits } from "../src/utils/zipWriter";
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

describe("what a zip holds", () => {
  /** Bytes that don't compress, the same for a seed: deflate makes them bigger, as it does a packed file. */
  function noise(size: number, seed: number): Buffer {
    const bytes = Buffer.alloc(size);
    let x = seed | 1;
    for (let i = 0; i < size; i++) {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      bytes[i] = x & 0xff;
    }
    return bytes;
  }

  it("never writes past what zipExtent allows for", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            name: fc.string({ unit: "grapheme", minLength: 1, maxLength: 12 }),
            size: fc.nat(600_000),
            seed: fc.integer(),
            packed: fc.boolean(),
          }),
          { minLength: 1, maxLength: 4 },
        ),
        async (files) => {
          const entries = files.map(({ name, size, seed, packed }, i) => ({
            arcname: `${i}/${name}`,
            content: packed ? noise(size, seed) : Buffer.alloc(size, 7),
          }));
          const zipPath = path.join(dir, "extent.zip");
          await writeZip(zipPath, entries);
          const zip = fs.readFileSync(zipPath);
          const end = zip.subarray(zip.length - 22);
          const { data, central } = zipExtent(entries);
          // Where the central directory starts, and how long it is, as the end record says.
          expect(end.readUInt32LE(16)).toBeLessThanOrEqual(data);
          expect(end.readUInt32LE(12)).toBeLessThanOrEqual(central);
        },
      ),
      { seed: 20261122, numRuns: 40 },
    );
  });

  it("takes as many entries as a zip without ZIP64 holds, and not one more", () => {
    const empty = (count: number) =>
      Array.from({ length: count }, (_, i) => ({ arcname: `${i}`, content: Buffer.alloc(0) }));
    expect(ZIP_MAX_ENTRIES).toBe(0xfffe);
    expect(zipFits(empty(ZIP_MAX_ENTRIES))).toBe(true);
    expect(zipFits(empty(ZIP_MAX_ENTRIES + 1))).toBe(false);
  });

  it("takes a file just under 4 GiB, and not one of 4 GiB", () => {
    // Sparse: the size is there, the disk barely used.
    const file = path.join(dir, "sparse.bin");
    fs.writeFileSync(file, "");
    fs.truncateSync(file, 4_250_000_000);
    expect(zipFits([{ arcname: "big.bin", filePath: file }])).toBe(true);
    fs.truncateSync(file, 2 ** 32);
    expect(zipFits([{ arcname: "big.bin", filePath: file }])).toBe(false);
    fs.rmSync(file);
    // One that's gone counts as empty, as writeZip leaves it out.
    expect(zipFits([{ arcname: "gone.bin", filePath: file }])).toBe(true);
  });
});
