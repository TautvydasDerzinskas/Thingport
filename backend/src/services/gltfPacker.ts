import fs from "node:fs/promises";
import path from "node:path";
import { HttpError } from "../utils/fileUtils";

// A .gltf is a JSON scene whose geometry sits in .bin files and whose textures sit in image files beside it, found by
// relative path. Thingport stores a model's files apart and serves them by id, so those paths would lead nowhere: a
// .gltf is packed here with the files it uses into one .glb, the same scene in a single file, and that is what's kept.

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ktx2": "image/ktx2",
};

type GltfJson = {
  buffers?: { uri?: string; byteLength: number }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number }[];
  images?: { uri?: string; bufferView?: number; mimeType?: string }[];
  [key: string]: unknown;
};

export const isGltfName = (name: string) => path.extname(name).toLowerCase() === ".gltf";

const isDataUri = (uri: string) => uri.startsWith("data:");
const isRemoteUri = (uri: string) => /^[a-z][a-z0-9+.-]*:/i.test(uri) && !isDataUri(uri);

function decodeDataUri(uri: string): { bytes: Buffer; mime: string } | null {
  const match = /^data:([^;,]*)((?:;[^;,]*)*?),(.*)$/s.exec(uri);
  if (!match) return null;
  const base64 = match[2].split(";").includes("base64");
  try {
    const bytes = base64 ? Buffer.from(match[3], "base64") : Buffer.from(decodeURIComponent(match[3]), "utf8");
    return { bytes, mime: match[1] };
  } catch {
    // A stray % in the payload: unreadable, as a missing file is.
    return null;
  }
}

function parseGltf(bytes: Buffer, name: string): GltfJson {
  try {
    const json = JSON.parse(bytes.toString("utf8").replace(/^﻿/, "")) as GltfJson;
    if (json && typeof json === "object" && !Array.isArray(json)) return json;
  } catch {
    // Falls through to the error below.
  }
  throw new HttpError(400, `${name} isn't a readable glTF file`);
}

/** The files a .gltf points at (its .bin buffers and textures), as written in it: relative paths, not data URIs. */
export function gltfFileReferences(bytes: Buffer, name = "scene.gltf"): string[] {
  const json = parseGltf(bytes, name);
  const uris = [...(json.buffers ?? []), ...(json.images ?? [])]
    .map((entry) => entry.uri)
    .filter((uri): uri is string => typeof uri === "string" && !isDataUri(uri) && !isRemoteUri(uri));
  return [...new Set(uris)];
}

const pad4 = (length: number) => (4 - (length % 4)) % 4;

/**
 * The .gltf in `bytes` as one .glb, with every buffer and texture it points at read through `read` (a relative URI
 * in, the file's bytes out, or null when it isn't there). A missing buffer is an error, since the scene has no
 * geometry without it; a missing texture is left pointing where it did, and the scene shows without it.
 */
export async function packGltf(
  bytes: Buffer,
  name: string,
  read: (uri: string) => Promise<Buffer | null>,
): Promise<Buffer> {
  const json = parseGltf(bytes, name);
  const parts: Buffer[] = [];
  let length = 0;
  const append = (data: Buffer) => {
    const offset = length;
    parts.push(data);
    length += data.length;
    const padding = pad4(data.length);
    if (padding) {
      parts.push(Buffer.alloc(padding));
      length += padding;
    }
    return offset;
  };

  const bufferOffsets: number[] = [];
  for (const buffer of json.buffers ?? []) {
    const uri = buffer.uri;
    let data: Buffer | null = null;
    if (typeof uri === "string") {
      data = isDataUri(uri) ? (decodeDataUri(uri)?.bytes ?? null) : isRemoteUri(uri) ? null : await read(uri);
    }
    if (!data) {
      throw new HttpError(400, `${name} needs ${uri ?? "a buffer"}, which wasn't uploaded with it`);
    }
    if (data.length < buffer.byteLength) {
      throw new HttpError(400, `${uri} is shorter than ${name} says it is`);
    }
    bufferOffsets.push(append(data.subarray(0, buffer.byteLength)));
  }

  const bufferViews = json.bufferViews ?? [];
  for (const view of bufferViews) {
    const base = bufferOffsets[view.buffer];
    if (base === undefined) throw new HttpError(400, `${name} isn't a readable glTF file`);
    view.byteOffset = base + (view.byteOffset ?? 0);
    view.buffer = 0;
  }

  for (const image of json.images ?? []) {
    const uri = image.uri;
    if (typeof uri !== "string" || isRemoteUri(uri)) continue;
    const decoded = isDataUri(uri) ? decodeDataUri(uri) : null;
    const data = decoded ? decoded.bytes : isDataUri(uri) ? null : await read(uri);
    if (!data) continue;
    const mimeType =
      image.mimeType || decoded?.mime || IMAGE_MIME[path.extname(uri.split(/[?#]/)[0]).toLowerCase()] || "image/png";
    bufferViews.push({ buffer: 0, byteOffset: append(data), byteLength: data.length });
    image.bufferView = bufferViews.length - 1;
    image.mimeType = mimeType;
    delete image.uri;
  }

  if (bufferViews.length) json.bufferViews = bufferViews;
  if (length) json.buffers = [{ byteLength: length }];
  else delete json.buffers;

  const jsonBytes = Buffer.from(JSON.stringify(json), "utf8");
  const jsonChunk = Buffer.concat([jsonBytes, Buffer.alloc(pad4(jsonBytes.length), 0x20)]);
  const binChunk = Buffer.concat(parts);
  const total = 12 + 8 + jsonChunk.length + (length ? 8 + binChunk.length : 0);

  const header = Buffer.alloc(12);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  const chunkHeader = (size: number, type: number) => {
    const out = Buffer.alloc(8);
    out.writeUInt32LE(size, 0);
    out.writeUInt32LE(type, 4);
    return out;
  };
  return Buffer.concat([
    header,
    chunkHeader(jsonChunk.length, CHUNK_JSON),
    jsonChunk,
    ...(length ? [chunkHeader(binChunk.length, CHUNK_BIN), binChunk] : []),
  ]);
}

/** A file among others, as its relative path (or bare name) and where its bytes are on disk. */
export type PackableFile = { name: string; path: string };

/** `uri`, as written in the .gltf at `gltfName`, among `files`: by its path from the .gltf's folder, else by its
 *  file name alone, when only one file in that folder or below has it (an upload carries names, not folders), so a
 *  scene doesn't take a file that belongs to another model's folder. */
function findReferenced<T extends PackableFile>(files: T[], gltfName: string, uri: string): T | undefined {
  let decoded = uri;
  try {
    decoded = decodeURIComponent(uri);
  } catch {
    // A stray % in a file name: match it as written.
  }
  const folder = path.posix.dirname(gltfName.replace(/\\/g, "/"));
  const wanted = path.posix.normalize(path.posix.join(folder, decoded));
  const pathOf = (file: T) => path.posix.normalize(file.name.replace(/\\/g, "/"));
  const byPath = files.find((file) => pathOf(file) === wanted);
  if (byPath) return byPath;
  const base = path.posix.basename(wanted).toLowerCase();
  const byName = files.filter(
    (file) =>
      path.posix.basename(pathOf(file)).toLowerCase() === base &&
      (folder === "." || pathOf(file).startsWith(`${folder}/`)),
  );
  return byName.length === 1 ? byName[0] : undefined;
}

/**
 * Packs each .gltf among `files` with the files it points at. Returns what's left: the files no .gltf used, and for
 * each .gltf a .glb written to a new path from `tempPath`, named as the .gltf was (`made` gives it the rest of its
 * shape). The packed files leave the list but stay on disk, for the caller to clean up with the rest.
 */
/** The files among `files` the .gltf `gltf` points at, found as packing finds them; none when it can't be read. */
export async function gltfReferencedFiles<T extends PackableFile>(files: T[], gltf: T): Promise<T[]> {
  let uris: string[];
  try {
    uris = gltfFileReferences(await fs.readFile(gltf.path), path.basename(gltf.name));
  } catch {
    return [];
  }
  const found = uris.map((uri) => findReferenced(files, gltf.name, uri));
  return [...new Set(found.filter((file): file is T => !!file && !isGltfName(file.name)))];
}

export async function packGltfFiles<T extends PackableFile>(
  files: T[],
  tempPath: () => string,
  made: (gltf: T, glbPath: string, glbName: string) => T,
): Promise<{ files: T[]; packed: T[] }> {
  const gltfs = files.filter((file) => isGltfName(file.name));
  if (!gltfs.length) return { files, packed: [] };

  const used = new Set<T>(gltfs);
  const glbs = new Map<T, T>();
  const written: string[] = [];
  try {
    for (const gltf of gltfs) {
      const bytes = await fs.readFile(gltf.path);
      const glb = await packGltf(bytes, path.basename(gltf.name), async (uri) => {
        const file = findReferenced(files, gltf.name, uri);
        if (!file || isGltfName(file.name)) return null;
        used.add(file);
        return fs.readFile(file.path);
      });
      const glbPath = tempPath();
      await fs.writeFile(glbPath, glb);
      written.push(glbPath);
      glbs.set(gltf, made(gltf, glbPath, gltf.name.replace(/\.gltf$/i, ".glb")));
    }
  } catch (err) {
    await Promise.all(written.map((file) => fs.rm(file, { force: true }).catch(() => undefined)));
    throw err;
  }
  return {
    files: files.flatMap((file) => (glbs.has(file) ? [glbs.get(file)!] : used.has(file) ? [] : [file])),
    packed: [...used],
  };
}
