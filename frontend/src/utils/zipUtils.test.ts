import { describe, expect, it, vi } from "vitest";

// How often the zip's central directory is read, which readZipEntries does through unzipSync; and a streaming
// reader that fails, when `streamFails` says so.
const reads = vi.hoisted(() => ({ unzipSync: 0, streamFails: false }));
vi.mock("fflate", async (original) => {
  const actual = await original<typeof import("fflate")>();
  class FailingUnzip extends actual.Unzip {
    push(): void {
      throw new Error("the stream broke off");
    }
  }
  return {
    ...actual,
    unzipSync: (...args: Parameters<typeof actual.unzipSync>) => {
      reads.unzipSync += 1;
      return actual.unzipSync(...args);
    },
    get Unzip() {
      return reads.streamFails ? FailingUnzip : actual.Unzip;
    },
  };
});

import i18next from "i18next";
import { Zip, ZipPassThrough, zipSync } from "fflate";
import en from "../i18n/locales/en.json";
import { hasModelFolderPaths, normalizeZipPath, readZipEntries, startingSelection } from "./zipUtils";

const entries = (...paths: string[]) => paths.map((path) => ({ path }));

describe("startingSelection", () => {
  it("ticks a zip's real files", () => {
    expect([...startingSelection(entries("hull.stl", "parts/mast.3mf", "readme.txt"))]).toEqual([
      "hull.stl",
      "parts/mast.3mf",
      "readme.txt",
    ]);
  });

  it("leaves out what the OS left in it, at any depth", () => {
    const junk = entries(
      "__MACOSX/hull.stl",
      "__MACOSX/._hull.stl",
      "parts/__MACOSX/x",
      "._hull.stl",
      "parts/._mast.stl",
    );
    expect([...startingSelection(junk)]).toEqual([]);
    expect([...startingSelection(entries(".DS_Store", "parts/.DS_Store", "Thumbs.db", "parts/desktop.ini"))]).toEqual(
      [],
    );
  });

  it("doesn't take a file for junk by a name that merely looks like it", () => {
    expect([...startingSelection(entries("MACOSX/hull.stl", "my__MACOSX/a.stl", "a._b.stl"))]).toEqual([
      "MACOSX/hull.stl",
      "my__MACOSX/a.stl",
      "a._b.stl",
    ]);
  });
});

describe("readZipEntries", () => {
  it("keeps two entries that come to one path apart where their bytes differ, and once where they don't", async () => {
    const text = (body: string) => new TextEncoder().encode(body);
    const zip = zipSync({
      "./A/guide.pdf": text("first"),
      "A/guide.pdf": text("second"),
      "B/notes.txt": text("same"),
      "./B/notes.txt": text("same"),
    });
    const read = await readZipEntries(new File([zip as BlobPart], "kit.zip"));
    expect(read.entries.map((entry) => entry.path)).toEqual(["A/guide (2).pdf", "A/guide.pdf", "B/notes.txt"]);
    const { data } = read;
    expect(new TextDecoder().decode(data["A/guide.pdf"])).toBe("first");
    expect(new TextDecoder().decode(data["A/guide (2).pdf"])).toBe("second");
  });
});

describe("readZipEntries of entries with one name", () => {
  /** A zip that names one path more than once, as a tool that adds to an archive leaves one: zipSync can't, as it
   *  takes its entries by name. */
  const zipOf = (named: [string, string][]) => {
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    const zip = new Zip((err, chunk) => {
      if (err) throw err;
      chunks.push(chunk);
    });
    for (const [name, body] of named) {
      const entry = new ZipPassThrough(name);
      zip.add(entry);
      entry.push(new TextEncoder().encode(body), true);
    }
    zip.end();
    return new File(chunks, "kit.zip");
  };

  it("keeps each of two entries of one name, numbering the second, and two the same once", async () => {
    const {
      entries: listed,
      data,
      numbered,
    } = await readZipEntries(
      zipOf([
        ["A/guide.pdf", "first"],
        ["A/guide.pdf", "second"],
        ["A/guide.pdf", "first"],
      ]),
    );
    expect(listed.map((entry) => entry.path).toSorted()).toEqual(["A/guide (2).pdf", "A/guide.pdf"]);
    expect(numbered).toEqual({ "A/guide (2).pdf": "A/guide.pdf" });
    expect(new TextDecoder().decode(data["A/guide.pdf"])).toBe("first");
    expect(new TextDecoder().decode(data["A/guide (2).pdf"])).toBe("second");
  });

  it("tells many copies of one length apart by their bytes, keeping each once, whichever came first", async () => {
    const { data, numbered } = await readZipEntries(
      zipOf([
        ["part.bin", "copy-1"],
        ["part.bin", "copy-2"],
        ["part.bin", "copy-3"],
        ["part.bin", "copy-2"],
        ["part.bin", "copy-1"],
        ["part.bin", "long copy"],
        ["part.bin", "copy-3"],
        ["part.bin", "long copy"],
      ]),
    );
    const text = (path: string) => new TextDecoder().decode(data[path]);
    expect(Object.keys(numbered).toSorted()).toEqual(["part (2).bin", "part (3).bin", "part (4).bin"]);
    expect(["part.bin", "part (2).bin", "part (3).bin", "part (4).bin"].map(text)).toEqual([
      "copy-1",
      "copy-2",
      "copy-3",
      "long copy",
    ]);
  });
});

describe("readZipEntries of an unusual zip", () => {
  const zipOf = (named: [string, string][]) => {
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    const zip = new Zip((err, chunk) => {
      if (err) throw err;
      chunks.push(chunk);
    });
    for (const [name, body] of named) {
      const entry = new ZipPassThrough(name);
      zip.add(entry);
      entry.push(new TextEncoder().encode(body), true);
    }
    zip.end();
    return new File(chunks, "kit.zip");
  };

  it("keeps an entry named __proto__, which an object can't key", async () => {
    const { data } = await readZipEntries(
      zipOf([
        ["__proto__", "proto"],
        ["notes.txt", "n"],
      ]),
    );
    expect(Object.keys(data).toSorted()).toEqual(["__proto__", "notes.txt"]);
    expect(new TextDecoder().decode(data["__proto__"])).toBe("proto");
  });

  /** `raw` with the compression method of each record named `name` set to `method`, local header and directory both. */
  const withMethod = async (file: File, name: string, method: number) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const view = new DataView(bytes.buffer);
    const target = new TextEncoder().encode(name);
    const named = (at: number, length: number) =>
      length === target.length && target.every((byte, index) => bytes[at + index] === byte);
    for (let at = 0; at + 46 < bytes.length; at++) {
      const signature = view.getUint32(at, true);
      if (signature === 0x04034b50 && named(at + 30, view.getUint16(at + 26, true)))
        view.setUint16(at + 8, method, true);
      if (signature === 0x02014b50 && named(at + 46, view.getUint16(at + 28, true)))
        view.setUint16(at + 10, method, true);
    }
    return new File([bytes], file.name);
  };

  it("keeps every entry it's to keep, though one it leaves out is in a compression it can't unpack", async () => {
    const zip = await withMethod(
      zipOf([
        ["A/x.txt", "first"],
        ["__MACOSX/._x.txt", "what the OS left"],
        ["A/x.txt", "second"],
        ["__proto__", "proto"],
      ]),
      "__MACOSX/._x.txt",
      99,
    );
    const { data } = await readZipEntries(zip);
    expect(Object.keys(data).toSorted()).toEqual(["A/x (2).txt", "A/x.txt", "__proto__"]);
    expect(new TextDecoder().decode(data["A/x (2).txt"])).toBe("second");
  });

  it("says so, rather than leave copies out, when it can't read a zip's entries apart", async () => {
    await i18next.init({ lng: "en", ns: ["app"], resources: { en: { app: en.app } } });
    reads.streamFails = true;
    try {
      await expect(
        readZipEntries(
          zipOf([
            ["A/x.txt", "first"],
            ["A/x.txt", "second"],
          ]),
        ),
      ).rejects.toThrow("This zip names a file more than once in a way that can't be read apart.");
    } finally {
      reads.streamFails = false;
    }
  });

  it("reads its directory once however many times it repeats a folder or a file", async () => {
    const folders = Array.from({ length: 300 }, (): [string, string] => ["A/", ""]);
    reads.unzipSync = 0;
    const read = await readZipEntries(zipOf([...folders, ["A/x.txt", "x"]]));
    expect(read.entries.map((entry) => entry.path)).toEqual(["A/x.txt"]);
    expect(reads.unzipSync).toBe(1);
    reads.unzipSync = 0;
    const copies = Array.from({ length: 50 }, (_, n): [string, string] => ["A/x.txt", `copy ${n}`]);
    const again = await readZipEntries(zipOf(copies));
    expect(again.entries).toHaveLength(50);
    expect(reads.unzipSync).toBe(1);
  });
});

describe("readZipEntries numbering", () => {
  it("gives a second entry of a path a number no entry of the zip has, and keeps .gcode.3mf whole", async () => {
    const text = (body: string) => new TextEncoder().encode(body);
    const zip = zipSync({
      "./A/mesh.bin": text("first"),
      "A/mesh.bin": text("second"),
      "A/mesh (2).bin": text("its own"),
      "./B/job.gcode.3mf": text("one"),
      "B/job.gcode.3mf": text("two"),
    });
    const { data } = await readZipEntries(new File([zip as BlobPart], "kit.zip"));
    const read = (path: string) => (data[path] ? new TextDecoder().decode(data[path]) : null);
    expect(read("A/mesh.bin")).toBe("first");
    // The zip's own "mesh (2).bin" keeps its name: a scene that names it gets its bytes.
    expect(read("A/mesh (2).bin")).toBe("its own");
    expect(read("A/mesh (3).bin")).toBe("second");
    expect(read("B/job (2).gcode.3mf")).toBe("two");
  });

  it("keeps .gcode.3mf whole for a sliced print named with a space after it", async () => {
    const text = (body: string) => new TextEncoder().encode(body);
    const zip = zipSync({ "./job.gcode.3mf ": text("one"), "job.gcode.3mf ": text("two") });
    const { data } = await readZipEntries(new File([zip as BlobPart], "kit.zip"));
    expect(Object.keys(data).toSorted()).toEqual(["job (2).gcode.3mf ", "job.gcode.3mf "]);
  });
});

describe("hasModelFolderPaths", () => {
  it("finds a model file in a folder, a .gltf scene's included", () => {
    expect(hasModelFolderPaths(["A/scene.gltf", "A/scene.bin", "B/scene.gltf", "B/scene.bin"])).toBe(true);
    expect(hasModelFolderPaths(["readme.txt", "parts/mast.3mf"])).toBe(true);
  });

  it("finds none when the model files are loose, or the folders hold none", () => {
    expect(hasModelFolderPaths(["hull.stl", "scene.gltf", "docs/guide.pdf", "docs/scene.bin"])).toBe(false);
    // What the OS left in the zip is no folder of models, though it's been ticked.
    expect(hasModelFolderPaths(["hull.stl", "__MACOSX/._hull.stl"])).toBe(false);
  });
});

describe("normalizeZipPath", () => {
  it('drops the folders a "." names, so ./A and A are one folder, and still refuses climbing out', () => {
    expect(normalizeZipPath("./A/body.stl")).toBe("A/body.stl");
    expect(normalizeZipPath("A/./docs/guide.pdf")).toBe("A/docs/guide.pdf");
    expect(normalizeZipPath("A/../x.stl")).toBeNull();
  });
});
