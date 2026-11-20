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

  it("reads a file a scene names again and again once", async () => {
    const files = [write("scene.gltf", repeated(64)), write("mesh.bin", bin)];
    const readFile = fsPromises.readFile.bind(fsPromises);
    const reads: string[] = [];
    const spy = vi.spyOn(fsPromises, "readFile").mockImplementation(((
      file: Parameters<typeof fsPromises.readFile>[0],
      ...rest: [never]
    ) => {
      reads.push(path.basename(String(file)));
      return readFile(file, ...rest);
    }) as never);
    try {
      await expect(packGltfFiles(files, tempPath, made, { bytes: 1_000_000 })).resolves.toBeTruthy();
    } finally {
      spy.mockRestore();
    }
    expect(reads.filter((name) => name === "mesh.bin")).toHaveLength(1);
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
