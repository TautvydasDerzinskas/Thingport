import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
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
