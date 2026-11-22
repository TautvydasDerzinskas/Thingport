import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { STORAGE_SITES } from "../../src/modelFiles/storageFs";

// The file door's rules, kept by reading the code: storage code asks the disk about a stored file only through
// src/modelFiles/storageFs.ts, the existsSync calls still left are each listed with the step that removes them, every
// call site of the door has a test that fails it, and only the harness sets the checkpoint hook.

const root = path.join(__dirname, "..", "..");

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const at = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sources(at);
    return entry.name.endsWith(".ts") ? [at] : [];
  });
}
const rel = (file: string) => path.relative(root, file).split(path.sep).join("/");

describe("the file door", () => {
  it("is the only file in src/modelFiles that imports fs", () => {
    const importers = sources(path.join(root, "src", "modelFiles"))
      .filter((file) =>
        /from\s+["'](node:)?fs(\/promises)?["']|require\(\s*["'](node:)?fs/.test(fs.readFileSync(file, "utf8")),
      )
      .map(rel);
    expect(importers).toEqual(["src/modelFiles/storageFs.ts"]);
  });

  // Each file of src/ that still calls existsSync, with how many calls and the step that removes them; none of them
  // decides whether a model's own file is there. One more call, or one in another file, fails here: go through
  // fileState instead, or list it with its reason.
  const EXISTS_SYNC_LEFT: Record<string, [count: number, why: string]> = {
    "src/services/printCreation.ts": [1, "whether to make a new plate's pictures: PR 12"],
    "src/routes/prints.ts": [4, "the picture routes (PR 12) and an upload's temp file (PR 16)"],
    "src/routes/plates.ts": [4, "a plate's thumbnail, 3D preview and render (PR 12) and an upload's temp file (PR 16)"],
    "src/services/modelPreviewCache.ts": [9, "render markers and cached renders: PR 12"],
    "src/services/previewImageService.ts": [3, "the card picture and its copies: PR 12"],
    "src/services/buildPlatePreviewCache.ts": [2, "a build-plate preview ready or failed: PR 12"],
    "src/services/modelAssets.ts": [5, "where a picture is (PR 12), and relocation adopting a legacy one (PR 11)"],
    "src/services/printService.ts": [1, "the prune climbing while a folder is there: PR 19"],
    "src/routes/printFiles.ts": [1, "an upload's temp file: PR 16"],
    "src/services/importService.ts": [5, "temp files: PR 16"],
    "src/services/toolsService.ts": [2, "a tool's model picture (PR 14), and the tools checkout, which isn't storage"],
    "src/services/customWidgetsService.ts": [1, "the widgets checkout, which isn't storage"],
    "src/services/consumeService.ts": [1, "a free name in the consume folder, which isn't storage"],
    "src/printers/catalogue.ts": [1, "bundled printer data, which isn't storage"],
  };

  it("leaves existsSync only where a reason says it may be", () => {
    const found: Record<string, number> = {};
    for (const file of sources(path.join(root, "src"))) {
      const count = fs.readFileSync(file, "utf8").match(/\bexistsSync\(/g)?.length ?? 0;
      if (count) found[rel(file)] = count;
    }
    expect(found).toEqual(Object.fromEntries(Object.entries(EXISTS_SYNC_LEFT).map(([file, [count]]) => [file, count])));
  });

  it("has a test that fails each of its call sites", () => {
    // A site counts once a test file that plants faults names one of its checkpoints, inline or in a constant.
    const failed = new Set<string>();
    for (const file of sources(path.join(root, "tests"))) {
      const text = fs.readFileSync(file, "utf8");
      if (!file.endsWith(".test.ts") || !text.includes("faults.at(")) continue;
      for (const match of text.matchAll(/["'`](?:fileState|open|opened|remove):([a-z.]+)["'`]/g)) failed.add(match[1]);
    }
    expect(STORAGE_SITES.filter((site) => !failed.has(site))).toEqual([]);
  });

  it("lets only the harness set the checkpoint hook", () => {
    const setters = [...sources(path.join(root, "src")), ...sources(path.join(root, "tests"))]
      .filter((file) => fs.readFileSync(file, "utf8").includes("setCheckpointHookForTest"))
      .map(rel)
      // The definition, the harness, and this test, which names it to look for it.
      .filter(
        (file) =>
          file !== "src/modelFiles/checkpoints.ts" &&
          file !== "tests/modelFiles/door.test.ts" &&
          !file.startsWith("tests/harness/"),
      );
    expect(setters).toEqual([]);
  });
});
