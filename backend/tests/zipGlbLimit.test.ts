import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { packGltf, packGltfFiles } from "../src/services/gltfPacker";
import { extractZipEntriesToFolderModels } from "../src/services/zipService";

// A 2000-byte import limit, so a zip's picked entries may come to 8000 bytes in all, and the .glbs its scenes are
// packed into as much again.
vi.mock("../src/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/config")>()),
  IMPORT_MAX_BYTES: 2000,
}));

let userId: string;
let dir: string;
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "zip-glb-"));
  const res = await request(createApp())
    .post("/api/register")
    .send({ displayName: "Scenes", email: `zip-glb-${Date.now()}@example.com`, password: "password123" });
  userId = res.body.user.id;
});
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

// A scene of one triangle whose buffer, at `bin`, is 1900 bytes long, most of them unused.
const BIN = 1900;
const positions = Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer);
const scene = (bin: string) =>
  JSON.stringify({
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [{ uri: bin, byteLength: BIN }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.length }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] }],
  });

describe("the .glbs a zip's scenes are packed into", () => {
  it("come to no more than the zip's picked entries may, and the model that would go past that isn't made", async () => {
    // Four scenes sharing one buffer: each .glb holds all of it, so the fourth would take them past 8000 bytes.
    const bin = Buffer.alloc(BIN);
    positions.copy(bin);
    const files: Record<string, string | Buffer> = { "Shared/mesh.bin": bin };
    for (const name of ["S1", "S2", "S3", "S4"]) files[`Models/${name}/scene.gltf`] = scene("../../Shared/mesh.bin");
    const zip = new JSZip();
    for (const [name, contents] of Object.entries(files)) zip.file(name, contents);
    const zipPath = path.join(dir, "scenes.zip");
    fs.writeFileSync(zipPath, await zip.generateAsync({ type: "nodebuffer" }));
    const { prints, failed } = await extractZipEntriesToFolderModels(userId, zipPath, Object.keys(files), {});
    expect(prints.map((print) => print.title).toSorted()).toEqual(["S1", "S2", "S3"]);
    expect(failed).toEqual(["Models/S4"]);
  });
});

describe("packing scenes within what an import may write", () => {
  const bin = Buffer.alloc(BIN);
  positions.copy(bin);
  // One scene naming the same buffer `times` times over, as a small .gltf can.
  const repeated = (times: number) => {
    const json = JSON.parse(scene("mesh.bin"));
    json.buffers = Array.from({ length: times }, () => ({ uri: "mesh.bin", byteLength: BIN }));
    return Buffer.from(JSON.stringify(json));
  };
  const write = (name: string, data: string | Buffer) => {
    const at = path.join(fs.mkdtempSync(path.join(dir, "pack-")), path.basename(name));
    fs.writeFileSync(at, data);
    return { name, path: at };
  };
  const made = (_: unknown, glbPath: string, glbName: string) => ({ name: glbName, path: glbPath });
  const tempPath = () => path.join(dir, `${Math.random().toString(36).slice(2)}.glb`);

  it("stops at the buffer that takes a scene past it, never holding the rest", async () => {
    let reads = 0;
    const packing = packGltf(
      repeated(64),
      "scene.gltf",
      async () => {
        reads += 1;
        return bin;
      },
      8000,
    );
    await expect(packing).rejects.toMatchObject({ status: 413 });
    // Four of 1900 bytes fit in 8000; the fifth is never read.
    expect(reads).toBe(4);
  });

  // Each file opened or read whole while `run` packs, by name, and how many of its bytes were read, through a handle
  // it opened too.
  const readsDuring = async (run: () => Promise<unknown>) => {
    const reads: string[] = [];
    const bytes: Record<string, number> = {};
    const count = (file: unknown, read: number) => {
      const name = path.basename(String(file));
      bytes[name] = (bytes[name] ?? 0) + read;
    };
    const open = fsPromises.open.bind(fsPromises);
    const readFile = fsPromises.readFile.bind(fsPromises);
    const spies = [
      vi.spyOn(fsPromises, "open").mockImplementation((async (file: string, ...rest: [never]) => {
        reads.push(`part of ${path.basename(String(file))}`);
        const handle = await open(file, ...rest);
        const read = handle.read.bind(handle);
        const readWhole = handle.readFile.bind(handle);
        handle.read = (async (...args: Parameters<typeof read>) => {
          const result = await read(...args);
          count(file, result.bytesRead);
          return result;
        }) as typeof handle.read;
        handle.readFile = (async (...args: Parameters<typeof readWhole>) => {
          const result = await readWhole(...args);
          reads.push(`all of ${path.basename(String(file))}`);
          count(file, result.length);
          return result;
        }) as typeof handle.readFile;
        return handle;
      }) as never),
      vi.spyOn(fsPromises, "readFile").mockImplementation((async (file: string, ...rest: [never]) => {
        const result = await readFile(file, ...rest);
        reads.push(`all of ${path.basename(String(file))}`);
        count(file, (result as Buffer).length);
        return result;
      }) as never),
    ];
    try {
      await run();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    return { reads: reads.filter((read) => !read.endsWith(".gltf")), bytes };
  };

  it("reads a file a scene names again and again once", async () => {
    const files = [write("scene.gltf", repeated(64)), write("mesh.bin", bin)];
    const { bytes } = await readsDuring(() => packGltfFiles(files, tempPath, made, { bytes: 1_000_000 }));
    expect(bytes["mesh.bin"]).toBe(BIN);
  });

  it("reads of a large file only what a scene's buffers use, and all of it for a texture", async () => {
    // A mebibyte, of which the buffers use 1900 bytes, three times over.
    const large = Buffer.alloc(1024 * 1024);
    bin.copy(large);
    const json = JSON.parse(scene("large.png"));
    json.buffers = Array.from({ length: 3 }, () => ({ uri: "large.png", byteLength: BIN }));
    const files = [write("scene.gltf", JSON.stringify(json)), write("large.png", large)];
    let packed: Awaited<ReturnType<typeof packGltfFiles>> | null = null;
    const only = await readsDuring(async () => (packed = await packGltfFiles(files, tempPath, made)));
    expect(only.reads).toEqual(["part of large.png"]);
    expect(only.bytes["large.png"]).toBeLessThanOrEqual(BIN);
    expect(fs.statSync(packed!.files[0].path).size).toBeLessThan(3 * BIN + 2000);
    // The same file as the scene's texture is read whole, once more.
    json.images = [{ uri: "large.png" }];
    const textured = [write("scene.gltf", JSON.stringify(json)), write("large.png", large)];
    const again = await readsDuring(async () => (packed = await packGltfFiles(textured, tempPath, made)));
    expect(again.reads).toEqual(["part of large.png", "all of large.png"]);
    expect(again.bytes["large.png"]).toBe(BIN + large.length);
    expect(fs.statSync(packed!.files[0].path).size).toBeGreaterThan(large.length);
  });

  it("gives back what a packing that fails took, for the next model's scenes", async () => {
    const room = { bytes: 8000 };
    const files = [
      write("A/one.gltf", scene("mesh.bin")),
      write("A/mesh.bin", bin),
      // Its buffer wasn't picked: the packing fails once the first scene is in.
      write("A/two.gltf", scene("gone.bin")),
    ];
    await expect(packGltfFiles(files, tempPath, made, room)).rejects.toMatchObject({ status: 400 });
    expect(room.bytes).toBe(8000);
  });
});
