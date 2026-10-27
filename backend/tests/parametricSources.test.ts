import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import { modelFilesFromZip, parametricSourcesFromZip } from "../src/services/importService";
import { PARAMETRIC_SOURCE_EXTS, RENDERABLE_MODEL_EXTS, IMPORT_EXT_PRIORITY } from "../src/config";

// A MakerWorld model built with Parametric Model Maker downloads as a zip of its .scad sources, sometimes with
// meshes beside them. The script is what the model can be generated from again, but it holds no geometry until
// something runs it, so it must never be taken for a plate.

const made: string[] = [];

async function zipOf(entries: Record<string, string>): Promise<string> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(entries)) zip.file(name, content);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "thingport-scad-test-"));
  const zipPath = path.join(dir, "all.zip");
  await fs.writeFile(zipPath, await zip.generateAsync({ type: "nodebuffer" }));
  made.push(dir);
  return zipPath;
}

afterEach(async () => {
  for (const dir of made.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

describe("parametric sources in a raw-files zip", () => {
  it("takes the .scad files and leaves the meshes to the plates", async () => {
    const zipPath = await zipOf({
      "keychain.scad": "base_width = 80;\n",
      "keychain.stl": "solid keychain\nendsolid keychain\n",
      "notes.txt": "ignore me",
    });

    const sources = await parametricSourcesFromZip(zipPath);
    expect(sources.map((s) => s.filename)).toEqual(["keychain.scad"]);
    expect(sources[0].mime).toBe("application/octet-stream");
  });

  it("never lets a .scad become a plate", async () => {
    const zipPath = await zipOf({ "generator.scad": "x = 1;\n", "part.stl": "solid part\nendsolid part\n" });

    const plates = await modelFilesFromZip(zipPath);
    expect(plates.map((p) => p.filename)).toEqual(["part.stl"]);
  });

  it("keeps a .scad out of the sets that decide what a model file is", () => {
    expect(PARAMETRIC_SOURCE_EXTS.has(".scad")).toBe(true);
    expect(RENDERABLE_MODEL_EXTS.has(".scad")).toBe(false);
    expect(IMPORT_EXT_PRIORITY).not.toContain(".scad");
  });

  it("names files alike in different folders after their folder, as plates are", async () => {
    const zipPath = await zipOf({ "v1/box.scad": "a = 1;\n", "v2/box.scad": "a = 2;\n" });

    const sources = await parametricSourcesFromZip(zipPath);
    expect(sources.map((s) => s.filename).toSorted()).toEqual(["v1 - box.scad", "v2 - box.scad"]);
  });

  it("finds nothing in the empty zip a withheld source downloads as", async () => {
    expect(await parametricSourcesFromZip(await zipOf({}))).toEqual([]);
  });
});
