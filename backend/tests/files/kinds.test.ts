import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BRIDGE_OPENS,
  capsOf,
  extensionsOf,
  KINDS,
  kindOf,
  kindOfStored,
  LEGACY,
  type Caps,
  type FileRole,
  type Kind,
} from "../../src/files/kinds";
import { normalizeFileName } from "../../src/files/names";

// The kind table (src/files/kinds.ts): what it holds, what kindOf makes of names, that the code's older extension
// sets are views of it holding exactly what they did, and that no new one grows outside it.

const KIND_IDS: Kind[] = [
  "mesh",
  "laser",
  "sliced",
  "cad",
  "script",
  "picture",
  "document",
  "licence",
  "archive",
  "scene-part",
  "cg-scene",
  "program",
  "junk",
  "other",
];

describe("the kind table", () => {
  it("has each kind once, and each extension and name in one kind only", () => {
    expect(KINDS.map((row) => row.kind)).toEqual(KIND_IDS);
    const extensions = KINDS.flatMap((row) => row.extensions ?? []);
    expect(new Set(extensions).size).toBe(extensions.length);
    for (const ext of extensions) expect(ext).toMatch(/^\.[a-z0-9_]+(\.[a-z0-9]+)?$/);
    const names = KINDS.flatMap((row) => (row.names ?? []).map((name) => name.toLowerCase()));
    expect(new Set(names).size).toBe(names.length);
  });

  it.each([
    ["part.STL", "mesh"],
    ["scene.gltf", "mesh"],
    ["sign.lbrn2", "laser"],
    ["job.gcode.3mf", "sliced"],
    ["Model.3mf", "mesh"],
    ["Benchy.BGCODE", "sliced"],
    ["Bracket.f3d", "cad"],
    ["part.x_t", "cad"],
    ["box.scad", "script"],
    ["photo.JPG", "picture"],
    ["Manual.pdf", "document"],
    ["LICENSE.txt", "licence"],
    ["license", "licence"],
    ["notes.txt", "document"],
    ["Design.tar.gz", "archive"],
    ["scene.bin", "scene-part"],
    ["rig.fbx", "cg-scene"],
    ["setup.exe", "program"],
    [".DS_Store", "junk"],
    ["Thumbs.db", "junk"],
    ["part.amf", "other"],
    ["cloud.ply", "other"],
    ["README", "other"],
    ["Model v1.2 final", "other"],
  ] as const)("%s is %s", (name, kind) => {
    expect(kindOf(normalizeFileName(name))).toBe(kind);
  });
});

describe("the older extension sets", () => {
  // What each held before the table, written out, so a change to the table that changes one shows here.
  it.each([
    ["renderable", [".stl", ".3mf", ".step", ".stp", ".obj", ".glb"]],
    ["importAllowed", [".stl", ".3mf", ".step", ".stp", ".obj", ".glb", ".lbrn", ".lbrn2", ".zip"]],
    ["multiFilePlate", [".stl", ".3mf", ".step", ".stp", ".obj", ".glb", ".lbrn", ".lbrn2"]],
    ["zipFolder", [".stl", ".3mf", ".step", ".stp", ".obj", ".glb", ".lbrn", ".lbrn2", ".scad"]],
    ["parametricSource", [".scad"]],
    [
      "uploadable",
      [
        ".png",
        ".jpg",
        ".jpeg",
        ".webp",
        ".bmp",
        ".gif",
        ".svg",
        ".stl",
        ".step",
        ".stp",
        ".3mf",
        ".obj",
        ".glb",
        ".gltf",
        ".f3d",
        ".lbrn",
        ".lbrn2",
        ".zip",
      ],
    ],
    ["photo", [".png", ".jpg", ".jpeg", ".webp", ".bmp"]],
    ["libraryPlate", [".stl", ".3mf", ".step", ".stp", ".obj", ".glb", ".f3d", ".lbrn", ".lbrn2"]],
    ["libraryImage", [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]],
  ] as const)("%s holds what it did", (view, held) => {
    expect(new Set(LEGACY[view])).toEqual(new Set(held));
  });

  it("keeps the prepared print's suffixes in the order they're tried", () => {
    expect(LEGACY.prepared).toEqual([".gcode.3mf", ".gcode", ".gco", ".bgcode"]);
    expect(LEGACY.prepared).toEqual(extensionsOf("sliced"));
  });
});

describe("extension lists outside the table", () => {
  // Each file of src/ that still tests a name's extension itself, with how many such tests it has and why it can:
  // none of these decides what a file someone brings is. A new list or test anywhere else, or one more in these,
  // fails here: it belongs in the table, or here with its reason.
  const EXCEPTIONS: Record<string, [count: number, why: string]> = {
    "src/config.ts": [2, "web-page assets a link import passes over, and the order a page's links are tried in"],
    "src/adapter/format.ts": [1, "what a 3MF holds inside it, for its format"],
    "src/adapter/readers/bambuProject.ts": [1, "a 3MF's own model parts"],
    "src/adapter/readers/plainProject.ts": [1, "a 3MF's own model parts"],
    "src/services/modelPreviewRender.ts": [1, "a 3MF's own model parts"],
    "src/dto.ts": [1, "whether a plate can be read as a 3MF, for its print profile"],
    "src/routes/plates.ts": [1, "whether a plate can be read as a 3MF, for its print profile"],
    "src/services/printProfileFile.ts": [1, "whether a plate can be read as a 3MF, for its print profile"],
    "src/services/printService.ts": [1, "whether a plate can be read as a 3MF, for its plate pictures"],
    "src/services/printFileService.ts": [1, "whether a file can be read as a 3MF, for its print facts"],
    "src/services/adapted3mfCache.ts": [2, "whether a plate is a model's 3MF the adapter converts"],
    "src/services/preparedPrint.ts": [5, "which format of sliced file a prepared print is"],
    "src/services/modelPreviewCache.ts": [1, "the formats the 3D renderer reads"],
    "src/services/modelPreviewJobs.ts": [1, "the formats the 3D renderer reads"],
    "src/services/modelQualityService.ts": [1, "the formats the printability check reads"],
    "src/services/toolFormat.ts": [1, "the model formats a tool's package may hold"],
    "src/services/customWidgetFormat.ts": [4, "the picture types a widget package's screenshots may be"],
    "src/services/modelAssets.ts": [2, "Thingport's own renders and temporary files"],
    "src/services/storageInventory.ts": [3, "Thingport's own renders and temporary files"],
    "src/services/storageMoveService.ts": [2, "Thingport's own renders"],
    "src/services/tagMosaicService.ts": [1, "Thingport's own tag pictures"],
    "src/routes/icons.ts": [1, "an icon's own type"],
    "src/import/download.ts": [1, "a host name, not a file"],
    "src/utils/urlUtils.ts": [1, "a host name, not a file"],
    "src/federation/addresses.ts": [1, "host names, not files"],
    "src/providers/makerworld/pageData.ts": [1, "a site's own list of a design's files, until its pull request"],
  };
  // Double-quoted, as Prettier writes strings: a Set or an array literal opening with an extension, and an extension
  // test.
  const PATTERNS = [
    /new Set\(\[\s*"\.[A-Za-z0-9]/g,
    /(?<!Set\()\[\s*"\.[A-Za-z0-9]/g,
    /\.endsWith\(\s*"\.[A-Za-z0-9]/g,
  ];
  const root = path.join(__dirname, "..", "..");

  function sources(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const at = path.join(dir, entry.name);
      if (entry.isDirectory()) return sources(at);
      return entry.name.endsWith(".ts") && !entry.name.endsWith(".generated.ts") ? [at] : [];
    });
  }

  it("are only where a reason says they may be", () => {
    const found: Record<string, number> = {};
    for (const file of sources(path.join(root, "src"))) {
      const rel = path.relative(root, file).split(path.sep).join("/");
      // The table itself; the rest of src/files is scanned like any other folder.
      if (rel === "src/files/kinds.ts") continue;
      const text = fs.readFileSync(file, "utf8");
      const count = PATTERNS.reduce((sum, pattern) => sum + (text.match(pattern)?.length ?? 0), 0);
      if (count) found[rel] = count;
    }
    const expected = Object.fromEntries(Object.entries(EXCEPTIONS).map(([file, [count]]) => [file, count]));
    expect(found).toEqual(expected);
  });
});

describe("what a file can do (capsOf)", () => {
  const caps = (name: string, role: FileRole = "plate"): Caps => capsOf(kindOfStored(name), name, role);
  const NONE: Caps = { preview3d: false, openInSlicer: false, openInStudio: false, customize: false };

  it("draws, slices and opens in Studio a plate the viewer reads", () => {
    for (const name of ["Part.stl", "Part.3MF", "Part.step", "Part.stp", "Part.obj", "Part.glb"]) {
      expect(caps(name)).toEqual({ preview3d: true, openInSlicer: true, openInStudio: true, customize: false });
    }
  });

  it("draws a sliced 3MF plate as the 3MF it also is, and offers it to the slicer", () => {
    expect(caps("Plate 1.gcode.3mf")).toEqual({
      preview3d: true,
      openInSlicer: true,
      openInStudio: true,
      customize: false,
    });
  });

  it("offers to the slicer only what Bridge opens: no .gco, F3D, zip or picture", () => {
    expect(caps("Part.gcode").openInSlicer).toBe(true);
    expect(caps("Part.bgcode").openInSlicer).toBe(true);
    expect(caps("Laser.lbrn2").openInSlicer).toBe(true);
    for (const name of ["Part.gco", "Part.f3d", "Parts.zip", "Photo.png", "Part.amf"]) {
      expect(caps(name).openInSlicer).toBe(false);
    }
  });

  it("lets a script be customized wherever it is kept, but nothing named with a leading dot", () => {
    expect(caps("Box.scad", "supporting")).toEqual({ ...NONE, customize: true });
    expect(caps("._Box.scad", "supporting")).toEqual(NONE);
    expect(caps(".Box.scad", "supporting")).toEqual(NONE);
  });

  it("offers nothing of a file kept beside the plates but Customize, until the page shows them", () => {
    expect(caps("Part.stl", "supporting")).toEqual(NONE);
    expect(caps("Guide.pdf", "supporting")).toEqual(NONE);
  });

  it("offers a prepared print to the slicer only, and only one Bridge opens", () => {
    expect(caps("Tower.gcode", "prepared")).toEqual({ ...NONE, openInSlicer: true });
    expect(caps("Tower.gcode.3mf", "prepared")).toEqual({ ...NONE, openInSlicer: true });
    expect(caps("Tower.gco", "prepared")).toEqual(NONE);
  });

  it("reads a stored name kept before the naming rule as the rule would keep it", () => {
    expect(kindOfStored("Part.STL ")).toBe("mesh");
    expect(kindOfStored("._Part.stl")).toBe("junk");
  });

  it("is what Bridge's isModelFile opens, extension for extension", () => {
    // An installed Bridge doesn't update, so the list it was built with is what it takes.
    const main = fs.readFileSync(path.join(__dirname, "../../../bridge/cmd/thingport-bridge/main.go"), "utf8");
    const body = /func isModelFile\([^)]*\) bool \{([\s\S]*?)\n\}/.exec(main)?.[1] ?? "";
    const cases = /case ([^:]+):\s*return true/.exec(body)?.[1] ?? "";
    const opens = [...cases.matchAll(/"(\.[a-z0-9.]+)"/g)].map((match) => match[1]);
    expect(opens.length).toBeGreaterThan(0);
    expect([...BRIDGE_OPENS].toSorted()).toEqual(opens.toSorted());
  });
});
