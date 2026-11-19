import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterAll, describe, expect, it } from "vitest";
import { read3mfThumbnails } from "../src/services/printService";

// The pictures a 3MF names as its thumbnail, read before one is tried: as many as an archive names, they're held to a
// few, and to so much in all.

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "threemf-thumbnails-"));
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

async function threeMfWith(pictures: Record<string, Buffer>): Promise<string> {
  const zip = new JSZip();
  zip.file("3D/3dmodel.model", "<model/>");
  for (const [name, bytes] of Object.entries(pictures)) zip.file(name, bytes);
  const file = path.join(dir, `${Math.random().toString(36).slice(2)}.3mf`);
  fs.writeFileSync(file, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  return file;
}

describe("a 3MF's thumbnail pictures", () => {
  it("are read best first, and no more than four of them", async () => {
    const names = [
      "Metadata/thumbnail.png",
      "3D/thumbnail.png",
      "thumbnail.png",
      "a/thumbnail.png",
      "b/thumbnail.png",
      "c/thumbnail.png",
    ];
    const file = await threeMfWith(
      Object.fromEntries(names.map((name, index) => [name, Buffer.from(`picture ${index}`)])),
    );
    const pictures = await read3mfThumbnails(file);
    expect(pictures.map((each) => each.toString())).toEqual(["picture 0", "picture 1", "picture 2", "picture 3"]);
  });

  it("come to no more than 32 MiB in all, however large the archive says each is", async () => {
    const big = Buffer.alloc(12 * 1024 * 1024);
    const file = await threeMfWith({ "Metadata/thumbnail.png": big, "3D/thumbnail.png": big, "thumbnail.png": big });
    expect(await read3mfThumbnails(file)).toHaveLength(2);
  });
});
