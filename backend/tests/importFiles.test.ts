import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { expect, it } from "vitest";
import { modelFilesFromZip } from "../src/services/importFiles";

it("acquires model files from a ZIP with folder names for duplicate filenames", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "thingport-import-files-"));
  const zipPath = path.join(directory, "model.zip");
  const zip = new JSZip();
  zip.file("top/part.stl", "top model");
  zip.file("bottom/part.stl", "bottom model");
  zip.file("instructions.txt", "not a model");
  await fs.writeFile(zipPath, await zip.generateAsync({ type: "nodebuffer" }));
  const inputs: Awaited<ReturnType<typeof modelFilesFromZip>> = [];
  try {
    inputs.push(...(await modelFilesFromZip(zipPath)));
    expect(inputs.map((input) => input.filename)).toEqual(["top - part.stl", "bottom - part.stl"]);
    expect(await Promise.all(inputs.map((input) => fs.readFile(input.tempFilePath!, "utf8")))).toEqual([
      "top model",
      "bottom model",
    ]);
    expect(await fs.stat(zipPath)).toBeDefined();
  } finally {
    await Promise.all(inputs.map((input) => fs.rm(input.tempFilePath!, { force: true })));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
