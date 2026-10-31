import fs from "node:fs/promises";
import type { PreviewRefusal } from "./modelPreviewRender";

// A .glb's shape, for the pictures and printability check drawn from it on the server.
//
// three's GLTFLoader decodes textures through the browser's image APIs, which Node doesn't have. Nothing here needs
// them, so the scene's images and textures are taken out before it's parsed, leaving the geometry and each
// material's own colour. glTF is in metres and Y-up; the scene is scaled to millimetres, as print files are, and
// left Y-up.
//
// Runs in a worker thread (modelPreviewWorker.ts); keep it free of config/db imports.

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
// Extensions that change how the geometry is stored, and that GLTFLoader reads here. Draco would need a decoder this
// server doesn't carry.
const GEOMETRY_EXTENSIONS = new Set(["EXT_meshopt_compression", "KHR_mesh_quantization", "EXT_mesh_gpu_instancing"]);
const METRES_TO_MM = 1000;

type Json = Record<string, unknown> & {
  meshes?: { primitives?: Record<string, unknown>[] }[];
  materials?: (Record<string, unknown> & { pbrMetallicRoughness?: Record<string, unknown> })[];
  extensionsUsed?: string[];
  extensionsRequired?: string[];
  extensions?: Record<string, unknown>;
};

/** The .glb without its pictures, or null when it isn't a .glb or needs what can't be read here. */
export function glbWithoutTextures(glb: Buffer): ArrayBuffer | null {
  if (glb.length < 20 || glb.readUInt32LE(0) !== GLB_MAGIC || glb.readUInt32LE(4) !== 2) return null;
  const jsonLength = glb.readUInt32LE(12);
  if (glb.readUInt32LE(16) !== CHUNK_JSON || 20 + jsonLength > glb.length) return null;
  let json: Json;
  try {
    json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString("utf8")) as Json;
  } catch {
    return null;
  }
  // What's required for textures and materials goes with them; anything else (Draco, unknown ones) can't be read.
  const required = json.extensionsRequired ?? [];
  if (required.some((name) => !GEOMETRY_EXTENSIONS.has(name) && !/^KHR_(texture|materials)_/.test(name))) return null;

  delete json.images;
  delete json.textures;
  delete json.samplers;
  for (const material of json.materials ?? []) {
    for (const key of ["normalTexture", "occlusionTexture", "emissiveTexture", "extensions"]) delete material[key];
    delete material.pbrMetallicRoughness?.baseColorTexture;
    delete material.pbrMetallicRoughness?.metallicRoughnessTexture;
  }
  // Draco's compressed copy and material variants live here; neither is read without its extension.
  for (const mesh of json.meshes ?? []) for (const primitive of mesh.primitives ?? []) delete primitive.extensions;
  if (json.extensions) delete json.extensions.KHR_materials_variants;
  json.extensionsUsed = (json.extensionsUsed ?? []).filter(
    (name) => GEOMETRY_EXTENSIONS.has(name) || name === "KHR_lights_punctual",
  );
  json.extensionsRequired = (json.extensionsRequired ?? []).filter((name) => GEOMETRY_EXTENSIONS.has(name));

  const jsonBytes = Buffer.from(JSON.stringify(json), "utf8");
  const jsonChunk = Buffer.concat([jsonBytes, Buffer.alloc((4 - (jsonBytes.length % 4)) % 4, 0x20)]);
  const rest = glb.subarray(20 + jsonLength);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + jsonChunk.length + rest.length, 8);
  header.writeUInt32LE(jsonChunk.length, 12);
  header.writeUInt32LE(CHUNK_JSON, 16);
  const out = Buffer.concat([header, jsonChunk, rest]);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

/** The scene in the .glb at `srcPath`, in millimetres and Y-up, without textures. */
export async function loadGlbScene(srcPath: string): Promise<import("three").Object3D | PreviewRefusal> {
  const data = glbWithoutTextures(await fs.readFile(srcPath));
  if (!data) return "unsupported";
  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  const { MeshoptDecoder } = await import("meshoptimizer");
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(data, "");
  const scene = gltf.scene;
  scene.scale.multiplyScalar(METRES_TO_MM);
  scene.updateMatrixWorld(true);
  return scene;
}
