import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import sharp from "sharp";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { HttpError } from "../src/utils/fileUtils";
import { gltfFileReferences, packGltf, packGltfFiles } from "../src/services/gltfPacker";
import { glbWithoutTextures, loadGlbScene } from "../src/services/gltfScene";
import { renderModelImage } from "../src/services/modelImageRender";
import { checkModelQuality } from "../src/services/modelQualityCheck";
import { NOT_IMPORTED_DIR, consumeFolder, setConsumeSettings } from "../src/services/consumeService";

// A model whose first file is named here fails to go in, as one would on a full disk.
const failingPlates = vi.hoisted(() => new Set<string>());
vi.mock("../src/services/printCreation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/printCreation")>();
  const createPrint: typeof actual.createPrint = async (...args) => {
    if (failingPlates.has(args[3][0]?.filename)) throw new Error("No space left on device");
    return actual.createPrint(...args);
  };
  return { ...actual, createPrint };
});

const app = createApp();

// A closed cube `edge` metres wide, as a glTF exporter writes one: its geometry in a .bin, a texture beside it.
function cubeGltf({ edge = 0.02, binUri = "scene.bin", imageUri = "textures/base.png" } = {}) {
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [i & 1, (i >> 1) & 1, (i >> 2) & 1].map((v) => v * edge));
  const positions = new Float32Array(corners.flat());
  const uvs = new Float32Array(corners.flatMap(([x, y]) => [x / edge, y / edge]));
  const faces = [
    [0, 2, 3, 1],
    [4, 5, 7, 6],
    [0, 1, 5, 4],
    [2, 6, 7, 3],
    [0, 4, 6, 2],
    [1, 3, 7, 5],
  ];
  const indices = new Uint16Array(faces.flatMap(([a, b, c, d]) => [a, b, c, a, c, d]));
  const bin = Buffer.concat([Buffer.from(positions.buffer), Buffer.from(uvs.buffer), Buffer.from(indices.buffer)]);
  const json = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 }, baseColorFactor: [0.2, 0.4, 0.8, 1] } }],
    textures: [{ source: 0, sampler: 0 }],
    samplers: [{}],
    images: [{ uri: imageUri }],
    buffers: [{ uri: binUri, byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
      { buffer: 0, byteOffset: positions.byteLength, byteLength: uvs.byteLength },
      { buffer: 0, byteOffset: positions.byteLength + uvs.byteLength, byteLength: indices.byteLength },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 8, type: "VEC3", min: [0, 0, 0], max: [edge, edge, edge] },
      { bufferView: 1, componentType: 5126, count: 8, type: "VEC2" },
      { bufferView: 2, componentType: 5123, count: indices.length, type: "SCALAR" },
    ],
  };
  return { json, gltf: Buffer.from(JSON.stringify(json)), bin };
}

const png = () =>
  sharp({ create: { width: 4, height: 4, channels: 3, background: "#3366cc" } })
    .png()
    .toBuffer();

/** The JSON and binary chunks of a .glb, checking its header on the way. */
function readGlb(glb: Buffer) {
  expect(glb.readUInt32LE(0)).toBe(0x46546c67);
  expect(glb.readUInt32LE(4)).toBe(2);
  expect(glb.readUInt32LE(8)).toBe(glb.length);
  const jsonLength = glb.readUInt32LE(12);
  expect(jsonLength % 4).toBe(0);
  const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString("utf8"));
  const binStart = 20 + jsonLength;
  if (binStart === glb.length) return { json, bin: Buffer.alloc(0) };
  expect(glb.readUInt32LE(binStart + 4)).toBe(0x004e4942);
  const bin = glb.subarray(binStart + 8, binStart + 8 + glb.readUInt32LE(binStart));
  return { json, bin };
}

const reader = (files: Record<string, Buffer>) => async (uri: string) => files[uri] ?? null;

let tmp: string;
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gltf-test-"));
});
afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("packing a .gltf into a .glb", () => {
  it("lists the files a .gltf points at, but not data URIs or web addresses", () => {
    const { json } = cubeGltf();
    json.buffers.push({ uri: "data:application/octet-stream;base64,AAAA", byteLength: 3 });
    json.images.push({ uri: "https://example.com/remote.png" }, { uri: "textures/base.png" });
    expect(gltfFileReferences(Buffer.from(JSON.stringify(json)))).toEqual(["scene.bin", "textures/base.png"]);
  });

  it("embeds the buffer and texture, with every view moved to where its bytes now are", async () => {
    const { gltf, bin } = cubeGltf();
    const texture = await png();
    const glb = await packGltf(gltf, "scene.gltf", reader({ "scene.bin": bin, "textures/base.png": texture }));
    const { json, bin: packedBin } = readGlb(glb);

    expect(json.buffers).toEqual([{ byteLength: packedBin.length }]);
    expect(json.buffers[0].uri).toBeUndefined();
    expect(packedBin.subarray(0, bin.length).equals(bin)).toBe(true);
    // The texture after the geometry, on a 4-byte boundary, in a view of its own.
    expect(json.images).toEqual([{ bufferView: 3, mimeType: "image/png" }]);
    const view = json.bufferViews[3];
    expect(view.byteOffset % 4).toBe(0);
    expect(packedBin.subarray(view.byteOffset, view.byteOffset + view.byteLength).equals(texture)).toBe(true);
    expect(json.bufferViews.every((v: { buffer: number }) => v.buffer === 0)).toBe(true);
  });

  it("joins several buffers into one, padding each so the next starts aligned", async () => {
    const { json, bin } = cubeGltf();
    // Three bytes of nothing first, so the real buffer would start misaligned if it weren't padded.
    json.buffers.unshift({ uri: "pad.bin", byteLength: 3 });
    for (const view of json.bufferViews) view.buffer = 1;
    const glb = await packGltf(
      Buffer.from(JSON.stringify(json)),
      "scene.gltf",
      reader({ "pad.bin": Buffer.from([1, 2, 3]), "scene.bin": bin }),
    );
    const { json: packed, bin: packedBin } = readGlb(glb);
    expect(packed.bufferViews[0].byteOffset).toBe(4);
    expect(packedBin.subarray(4, 4 + bin.length).equals(bin)).toBe(true);
  });

  it("reads buffers and images given inline as data URIs", async () => {
    const { json, bin } = cubeGltf();
    const texture = await png();
    json.buffers[0].uri = `data:application/octet-stream;base64,${bin.toString("base64")}`;
    json.images[0].uri = `data:image/png;base64,${texture.toString("base64")}`;
    const { json: packed, bin: packedBin } = readGlb(
      await packGltf(Buffer.from(JSON.stringify(json)), "scene.gltf", reader({})),
    );
    expect(packedBin.subarray(0, bin.length).equals(bin)).toBe(true);
    expect(packed.images[0]).toEqual({ bufferView: 3, mimeType: "image/png" });
  });

  it("refuses a .gltf whose .bin isn't there, naming the file it needs", async () => {
    const { gltf } = cubeGltf();
    const packing = packGltf(gltf, "scene.gltf", reader({}));
    await expect(packing).rejects.toBeInstanceOf(HttpError);
    await expect(packing).rejects.toThrow("scene.gltf needs scene.bin, which wasn't uploaded with it");
  });

  it("refuses a .bin shorter than the .gltf says, and a file that isn't glTF at all", async () => {
    const { gltf, bin } = cubeGltf();
    await expect(packGltf(gltf, "scene.gltf", reader({ "scene.bin": bin.subarray(0, 10) }))).rejects.toThrow("shorter");
    await expect(packGltf(Buffer.from("not json"), "broken.gltf", reader({}))).rejects.toThrow(
      "broken.gltf isn't a readable glTF file",
    );
    await expect(packGltf(Buffer.from("[]"), "list.gltf", reader({}))).rejects.toThrow("isn't a readable glTF");
  });

  it("treats a garbled inline data URI as missing: a 400 for a buffer, a skipped texture for an image", async () => {
    const { json, bin } = cubeGltf();
    json.buffers[0].uri = "data:,%";
    const packing = packGltf(Buffer.from(JSON.stringify(json)), "scene.gltf", reader({}));
    await expect(packing).rejects.toBeInstanceOf(HttpError);
    await expect(packing).rejects.toThrow("scene.gltf needs data:,%");

    const { json: withImage } = cubeGltf();
    withImage.images[0].uri = "data:image/png,%E0%A4%A";
    const { json: packed } = readGlb(
      await packGltf(Buffer.from(JSON.stringify(withImage)), "scene.gltf", reader({ "scene.bin": bin })),
    );
    expect(packed.images).toEqual([{ uri: "data:image/png,%E0%A4%A" }]);
  });

  it("keeps the scene when a texture is missing, still pointing where it did", async () => {
    const { gltf, bin } = cubeGltf();
    const { json } = readGlb(await packGltf(gltf, "scene.gltf", reader({ "scene.bin": bin })));
    expect(json.images).toEqual([{ uri: "textures/base.png" }]);
  });

  it("never reads a web address, even for a buffer", async () => {
    const { gltf } = cubeGltf({ binUri: "https://example.com/scene.bin" });
    let asked = false;
    await expect(
      packGltf(gltf, "scene.gltf", async () => {
        asked = true;
        return Buffer.alloc(1000);
      }),
    ).rejects.toThrow("needs https://example.com/scene.bin");
    expect(asked).toBe(false);
  });
});

describe("finding what a .gltf points at among files", () => {
  const write = (name: string, data: Buffer) => {
    const p = path.join(tmp, `${Math.random().toString(36).slice(2)}-${path.basename(name)}`);
    fs.writeFileSync(p, data);
    return { name, path: p };
  };
  const tempPath = () => path.join(tmp, `${Math.random().toString(36).slice(2)}.glb`);
  const made = (_: unknown, glbPath: string, glbName: string) => ({ name: glbName, path: glbPath });

  it("follows the paths from the .gltf's own folder, URL-encoded names included", async () => {
    const { gltf, bin } = cubeGltf({ imageUri: "tex%20folder/base%20color.png" });
    const files = [
      write("Laptop/scene.gltf", gltf),
      write("Laptop/scene.bin", bin),
      write("Laptop/tex folder/base color.png", await png()),
      write("Laptop/license.txt", Buffer.from("CC-BY")),
    ];
    const { files: left, packed } = await packGltfFiles(files, tempPath, made);
    expect(left.map((f) => f.name)).toEqual(["Laptop/scene.glb", "Laptop/license.txt"]);
    expect(packed.map((f) => f.name).toSorted()).toEqual([
      "Laptop/scene.bin",
      "Laptop/scene.gltf",
      "Laptop/tex folder/base color.png",
    ]);
    const { json } = readGlb(fs.readFileSync(left[0].path));
    expect(json.images[0].uri).toBeUndefined();
  });

  it("matches by file name alone when the files came without folders, as an upload's do", async () => {
    const { gltf, bin } = cubeGltf();
    const files = [write("scene.gltf", gltf), write("scene.bin", bin), write("base.png", await png())];
    const { files: left } = await packGltfFiles(files, tempPath, made);
    expect(left.map((f) => f.name)).toEqual(["scene.glb"]);
  });

  it("leaves a texture out when two files share its name and neither is on its path", async () => {
    const { gltf, bin } = cubeGltf({ imageUri: "base.png" });
    const files = [
      write("Model/scene.gltf", gltf),
      write("Model/scene.bin", bin),
      write("Model/a/base.png", await png()),
      write("Model/b/base.png", await png()),
    ];
    const { files: left } = await packGltfFiles(files, tempPath, made);
    expect(left.map((f) => f.name)).toEqual(["Model/scene.glb", "Model/a/base.png", "Model/b/base.png"]);
  });

  it("doesn't take a file of the same name from another model's folder", async () => {
    const { gltf, bin } = cubeGltf({ imageUri: "base.png" });
    const files = [write("Shelf/scene.gltf", gltf), write("Shelf/scene.bin", bin), write("Desk/base.png", await png())];
    const { files: left } = await packGltfFiles(files, tempPath, made);
    expect(left.map((f) => f.name)).toEqual(["Shelf/scene.glb", "Desk/base.png"]);
    expect(readGlb(fs.readFileSync(left[0].path)).json.images).toEqual([{ uri: "base.png" }]);
  });

  it("doesn't reach outside the files it's given for a path climbing out of the folder", async () => {
    const outside = path.join(tmp, "outside.bin");
    const { gltf, bin } = cubeGltf({ binUri: "../outside.bin" });
    fs.writeFileSync(outside, bin);
    await expect(packGltfFiles([write("Model/scene.gltf", gltf)], tempPath, made)).rejects.toThrow(
      "needs ../outside.bin",
    );
  });

  it("returns the files untouched when there is no .gltf", async () => {
    const files = [write("a.stl", Buffer.from("solid a endsolid"))];
    expect(await packGltfFiles(files, tempPath, made)).toEqual({ files, packed: [] });
  });
});

describe("reading a .glb on the server", () => {
  async function cubeGlb(edge = 0.02) {
    const { gltf, bin } = cubeGltf({ edge });
    const glbPath = path.join(tmp, `cube-${edge}.glb`);
    fs.writeFileSync(
      glbPath,
      await packGltf(gltf, "scene.gltf", reader({ "scene.bin": bin, "textures/base.png": await png() })),
    );
    return glbPath;
  }

  it("drops the pictures but keeps the geometry and the materials' own colours", async () => {
    const glb = fs.readFileSync(await cubeGlb());
    const { json } = readGlb(Buffer.from(glbWithoutTextures(glb)!));
    expect(json.images).toBeUndefined();
    expect(json.textures).toBeUndefined();
    expect(json.materials).toEqual([{ pbrMetallicRoughness: { baseColorFactor: [0.2, 0.4, 0.8, 1] } }]);
    expect(json.meshes[0].primitives[0].material).toBe(0);
  });

  it("loads the scene in millimetres", async () => {
    const THREE = await import("three");
    const scene = await loadGlbScene(await cubeGlb());
    expect(typeof scene).not.toBe("string");
    const size = new THREE.Box3().setFromObject(scene as import("three").Object3D).getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(20);
    expect(size.y).toBeCloseTo(20);
  });

  it("refuses what it can't decode here, and what isn't a .glb", async () => {
    const { gltf, bin } = cubeGltf();
    const json = JSON.parse(gltf.toString());
    json.extensionsUsed = json.extensionsRequired = ["KHR_draco_mesh_compression"];
    const draco = path.join(tmp, "draco.glb");
    fs.writeFileSync(
      draco,
      await packGltf(Buffer.from(JSON.stringify(json)), "draco.gltf", reader({ "scene.bin": bin })),
    );
    expect(await loadGlbScene(draco)).toBe("unsupported");

    const notGlb = path.join(tmp, "plain.glb");
    fs.writeFileSync(notGlb, gltf);
    expect(await loadGlbScene(notGlb)).toBe("unsupported");
  });

  it("draws a picture of it", async () => {
    const out = path.join(tmp, "cube.png");
    expect(await renderModelImage(await cubeGlb(), out, ".glb", { size: 64, color: "#888888" })).toMatchObject({
      status: "ok",
    });
    const { width, height } = await sharp(out).metadata();
    expect([width, height]).toEqual([64, 64]);
  });

  it("checks it at its size in millimetres, so a glTF in metres isn't called too small", async () => {
    const report = await checkModelQuality(await cubeGlb(), ".glb");
    expect(typeof report).not.toBe("string");
    if (typeof report === "string") return;
    expect(report.size.map((v) => Math.round(v))).toEqual([20, 20, 20]);
    expect(report.issues.map((issue) => issue.code)).not.toContain("tooSmall");
  });

  it("calls a garbled .glb unreadable", async () => {
    const garbled = path.join(tmp, "garbled.glb");
    const glb = fs.readFileSync(await cubeGlb());
    // Cut inside the geometry: the texture at the end is dropped on the server anyway.
    fs.writeFileSync(garbled, glb.subarray(0, 20 + glb.readUInt32LE(12) + 8 + 50));
    const report = await checkModelQuality(garbled, ".glb");
    expect(typeof report === "string" ? report : report.issues.map((i) => i.code)).toEqual(["unreadable"]);
  });
});

describe("uploading and consuming a .gltf", () => {
  let token: string;
  let userId: string;
  const auth = (req: request.Test) => req.set("Authorization", `Bearer ${token}`);

  beforeAll(async () => {
    const res = await request(app)
      .post("/api/register")
      .send({ displayName: "glTF", email: `gltf-${Date.now()}@example.com`, password: "password123" });
    token = res.body.token;
    userId = res.body.user.id;
  });

  afterAll(async () => {
    await prisma.setting.deleteMany({ where: { key: { in: ["consume_mode", "consume_user_id"] } } });
  });

  function upload(name: string, data: Buffer) {
    // supertest names the upload after the file, so each one gets a folder of its own.
    const p = path.join(fs.mkdtempSync(path.join(tmp, "upload-")), name);
    fs.writeFileSync(p, data);
    return p;
  }

  it("makes one model with a .glb plate from a .gltf uploaded with its files", async () => {
    const { gltf, bin } = cubeGltf();
    const res = await auth(request(app).post("/api/upload"))
      .field("mode", "multiplate")
      .attach("files", upload("scene.gltf", gltf))
      .attach("files", upload("scene.bin", bin))
      .attach("files", upload("base.png", await png()))
      .attach("files", upload("license.txt", Buffer.from("CC-BY-4.0")));
    expect(res.status).toBe(200);
    expect(res.body.prints).toHaveLength(1);
    const print = await prisma.print.findUniqueOrThrow({
      where: { id: res.body.prints[0].id },
      include: { plates: true, files: true },
    });
    expect(print.plates.map((p) => p.filename)).toEqual(["scene.glb"]);
    expect(print.files.filter((f) => f.role === "SUPPORTING").map((f) => f.filename)).toEqual(["license.txt"]);

    const file = await auth(request(app).get(`/api${res.body.prints[0].plates[0].url}`))
      .buffer(true)
      .parse((stream, done) => {
        const chunks: Buffer[] = [];
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("end", () => done(null, Buffer.concat(chunks)));
      });
    expect(file.status).toBe(200);
    const { json } = readGlb(file.body as Buffer);
    expect(json.images).toEqual([{ bufferView: 3, mimeType: "image/png" }]);
  });

  it("fails the upload, saying what's missing, when the .bin was left behind", async () => {
    const { gltf } = cubeGltf();
    const before = await prisma.print.count({ where: { userId } });
    const res = await auth(request(app).post("/api/upload")).attach("files", upload("scene.gltf", gltf));
    expect(res.status).toBe(400);
    expect(res.body.detail).toContain("scene.gltf needs scene.bin");
    expect(await prisma.print.count({ where: { userId } })).toBe(before);
  });

  it("consumes a downloaded glTF folder as one model, its texture folder with it", async () => {
    const dir = fs.mkdtempSync(path.join(tmp, "consume-"));
    const put = (rel: string, data: Buffer) => {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), data);
    };
    const { gltf, bin } = cubeGltf();
    put("Laptop/scene.gltf", gltf);
    put("Laptop/scene.bin", bin);
    put("Laptop/textures/base.png", await png());
    put("Laptop/license.txt", Buffer.from("CC-BY-4.0"));
    await setConsumeSettings({ userId, mode: "folder" });

    const summary = await consumeFolder(dir);
    expect(summary).toMatchObject({ models: 1, failed: [] });
    const [laptop] = await prisma.print.findMany({
      where: { userId, name: "Laptop" },
      include: { plates: true, files: true, previewImages: true },
    });
    expect(laptop.plates.map((p) => p.filename)).toEqual(["scene.glb"]);
    expect(laptop.files.filter((f) => f.role === "SUPPORTING").map((f) => f.filename)).toEqual(["license.txt"]);
    // The texture is in the .glb, not the gallery.
    expect(laptop.previewImages).toHaveLength(0);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("doesn't make the textures models of their own in one-model-per-file mode", async () => {
    const dir = fs.mkdtempSync(path.join(tmp, "consume-"));
    const { gltf, bin } = cubeGltf();
    fs.mkdirSync(path.join(dir, "Desk/textures"), { recursive: true });
    fs.writeFileSync(path.join(dir, "Desk/scene.gltf"), gltf);
    fs.writeFileSync(path.join(dir, "Desk/scene.bin"), bin);
    fs.writeFileSync(path.join(dir, "Desk/textures/base.png"), await png());
    await setConsumeSettings({ userId, mode: "separate" });

    const summary = await consumeFolder(dir);
    expect(summary).toMatchObject({ models: 1, failed: [] });
    const created = await prisma.print.findMany({
      where: { id: { in: summary!.printIds } },
      include: { plates: true },
    });
    expect(created.map((p) => p.plates.map((plate) => plate.filename))).toEqual([["scene.glb"]]);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("gives a .bin two scenes share to both, follows ../, and leaves another folder's files alone", async () => {
    const dir = fs.mkdtempSync(path.join(tmp, "consume-"));
    const put = (rel: string, data: Buffer | string) => {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), data);
    };
    const lamp = cubeGltf({ binUri: "lamp.bin", imageUri: "lamp.png" });
    put("Lamp/on.gltf", lamp.gltf);
    put("Lamp/off.gltf", lamp.gltf);
    put("Lamp/lamp.bin", lamp.bin);
    put("Lamp/lamp.png", await png());
    // Its .bin one folder up; its texture missing, though a file of that name sits in another model's folder.
    const shelf = cubeGltf({ binUri: "../shared.bin", imageUri: "base.png" });
    put("Shelf/Top/top.gltf", shelf.gltf);
    put("Shelf/shared.bin", shelf.bin);
    put("Desk/desk.stl", "solid d endsolid d\n");
    put("Desk/base.png", await png());
    await setConsumeSettings({ userId, mode: "folder" });

    const summary = await consumeFolder(dir);
    expect(summary).toMatchObject({ models: 3, failed: [] });
    const created = await prisma.print.findMany({
      where: { id: { in: summary!.printIds } },
      include: { plates: true, previewImages: true },
    });
    const byName = Object.fromEntries(created.map((p) => [p.name, p]));
    expect(byName.Lamp.plates.map((p) => p.filename).toSorted()).toEqual(["off.glb", "on.glb"]);
    expect(byName.Lamp.previewImages).toHaveLength(0);
    expect(byName.Top.plates.map((p) => p.filename)).toEqual(["top.glb"]);
    expect(byName.Desk.previewImages).toHaveLength(1);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("sets a failed scene aside with the files it shares, once, while the scene that went in keeps them", async () => {
    const dir = fs.mkdtempSync(path.join(tmp, "consume-"));
    const put = (rel: string, data: Buffer | string) => {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), data);
    };
    // One of two scenes sharing a .bin and a texture fails; both of two others do.
    const lamp = cubeGltf({ binUri: "lamp.bin", imageUri: "lamp.png" });
    put("Lamp/on.gltf", lamp.gltf);
    put("Lamp/off.gltf", lamp.gltf);
    put("Lamp/lamp.bin", lamp.bin);
    put("Lamp/lamp.png", await png());
    const shelf = cubeGltf({ binUri: "shelf.bin", imageUri: "tex/shelf.png" });
    put("Shelf/left.gltf", shelf.gltf);
    put("Shelf/right.gltf", shelf.gltf);
    put("Shelf/shelf.bin", shelf.bin);
    put("Shelf/tex/shelf.png", await png());
    await setConsumeSettings({ userId, mode: "separate" });

    failingPlates.add("off.glb").add("left.glb").add("right.glb");
    let summary;
    try {
      summary = await consumeFolder(dir);
    } finally {
      failingPlates.clear();
    }

    expect(summary).toMatchObject({ models: 1 });
    expect(summary!.failed.toSorted()).toEqual([
      "Lamp/lamp.bin",
      "Lamp/lamp.png",
      "Lamp/off.gltf",
      "Shelf/left.gltf",
      "Shelf/right.gltf",
      "Shelf/shelf.bin",
      "Shelf/tex/shelf.png",
    ]);
    const aside = path.join(dir, NOT_IMPORTED_DIR);
    expect(fs.readdirSync(path.join(aside, "Lamp")).toSorted()).toEqual(["lamp.bin", "lamp.png", "off.gltf"]);
    expect(fs.readdirSync(path.join(aside, "Shelf")).toSorted()).toEqual([
      "left.gltf",
      "right.gltf",
      "shelf.bin",
      "tex",
    ]);
    expect(fs.readdirSync(path.join(aside, "Shelf/tex"))).toEqual(["shelf.png"]);
    expect(fs.readFileSync(path.join(aside, "Lamp/lamp.bin")).equals(lamp.bin)).toBe(true);
    // What's set aside packs as it was meant to.
    const files = ["off.gltf", "lamp.bin", "lamp.png"].map((name) => ({ name, path: path.join(aside, "Lamp", name) }));
    const repacked = await packGltfFiles(
      files,
      () => path.join(tmp, `repack-${Date.now()}.glb`),
      (_, glbPath, name) => ({ name, path: glbPath }),
    );
    expect(repacked.packed.map((file) => file.name).toSorted()).toEqual(["lamp.bin", "lamp.png", "off.gltf"]);
    // Nothing else is left behind to be taken in again.
    expect(fs.readdirSync(dir)).toEqual([NOT_IMPORTED_DIR]);
  });

  it("sets a .gltf it can't pack aside and imports the rest as usual", async () => {
    const dir = fs.mkdtempSync(path.join(tmp, "consume-"));
    const { gltf } = cubeGltf();
    fs.mkdirSync(path.join(dir, "Broken"), { recursive: true });
    fs.writeFileSync(path.join(dir, "Broken/scene.gltf"), gltf);
    fs.writeFileSync(path.join(dir, "Broken/clip.stl"), "solid c endsolid c\n");
    await setConsumeSettings({ userId, mode: "separate" });

    const summary = await consumeFolder(dir);
    expect(summary).toMatchObject({ models: 1, failed: ["Broken/scene.gltf"] });
    expect(fs.existsSync(path.join(dir, NOT_IMPORTED_DIR, "Broken/scene.gltf"))).toBe(true);
  });
});
