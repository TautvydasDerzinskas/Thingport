import { isModelFile, isSystemFile, type UploadEntry } from "./uploadTree";

export type ZipEntry = {
  path: string;
  size: number;
};

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".stl": "model/stl",
  ".3mf": "model/3mf",
  ".step": "model/step",
  ".stp": "model/step",
  ".obj": "model/obj",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
};

function normalizePath(path: string) {
  return (path || "").replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

export function normalizeZipPath(path: string): string | null {
  const raw = (path || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!raw || raw.endsWith("/")) return null;
  const cleaned = normalizePath(raw);
  if (!cleaned) return null;
  // "./A/body.stl" is "A/body.stl": a "." names no folder, so it mustn't make one apart from "A".
  const parts = cleaned.split("/").filter((part) => part && part !== ".");
  if (!parts.length || parts.some((part) => part === "..")) return null;
  return parts.join("/");
}

export function guessMimeType(name: string) {
  const lower = (name || "").toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot === -1) return "";
  const ext = lower.slice(dot);
  return MIME_BY_EXT[ext] || "";
}

// macOS zips carry resource forks under __MACOSX/, plus the same OS metadata a folder pick drops.
function isArchiveJunk(path: string) {
  const parts = path.split("/");
  return parts.includes("__MACOSX") || isSystemFile(parts[parts.length - 1]);
}

/** Some path is a model file in a folder, so a model per folder means something: a folder uploadFoldersAsModels
 *  makes a model of, a .gltf's included. Not one the OS left in the zip (__MACOSX/._hull.stl), though it's ticked. */
export function hasModelFolderPaths(paths: Iterable<string>) {
  for (const path of paths) if (!isArchiveJunk(path) && path.includes("/") && isModelFile(path)) return true;
  return false;
}

/** What starts ticked when picking from a zip: everything but what the OS left in it, which still shows, to tick. */
export function startingSelection(entries: Pick<ZipEntry, "path">[]): Set<string> {
  return new Set(entries.map((entry) => entry.path).filter((path) => !isArchiveJunk(path)));
}

export function isZipFile(name: string) {
  return (name || "").toLowerCase().endsWith(".zip");
}

export async function readZipEntries(file: File): Promise<{ entries: ZipEntry[]; data: Record<string, Uint8Array> }> {
  const { unzipSync } = await import("fflate");
  const raw = new Uint8Array(await file.arrayBuffer());
  const zipEntries = unzipSync(raw);
  const found: [string, Uint8Array][] = [];
  for (const [rawPath, content] of Object.entries(zipEntries)) {
    const normalized = normalizeZipPath(rawPath);
    if (normalized && !isArchiveJunk(normalized)) found.push([normalized, content]);
  }
  // Each path to the first entry that has it. Without a prototype, so an entry named "__proto__" is one like any other.
  const data: Record<string, Uint8Array> = Object.create(null);
  const later: [string, Uint8Array][] = [];
  for (const [path, content] of found) {
    if (Object.hasOwn(data, path)) later.push([path, content]);
    else data[path] = content;
  }
  // Two entries can come to one path ("./A/guide.pdf" and "A/guide.pdf"): the same bytes are one file, and others are
  // another, listed under a number rather than lost behind the first or uploaded under its name. Numbered once every
  // entry has its own path, so the number is one no entry of the zip is called by.
  const copies = new Map<string, Uint8Array[]>();
  for (const [path, content] of later) {
    const held = [data[path], ...(copies.get(path) ?? [])];
    if (held.some((each) => sameBytes(each, content))) continue;
    data[numberedPath(path, data)] = content;
    copies.set(path, [...(copies.get(path) ?? []), content]);
  }
  const entries = Object.keys(data)
    .toSorted((a, b) => a.localeCompare(b))
    .map((path) => ({ path, size: data[path].length }));
  return { entries, data };
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** `path` as "guide (2).pdf", with the first number no entry has. A sliced print keeps all of ".gcode.3mf" after the
 *  number, as that's what says it's one. */
function numberedPath(path: string, taken: Record<string, unknown>): string {
  const slash = path.lastIndexOf("/");
  const name = path.slice(slash + 1);
  const sliced = name.toLowerCase().endsWith(".gcode.3mf") ? name.length - ".gcode.3mf".length : -1;
  const dot = sliced > 0 ? sliced : name.lastIndexOf(".");
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  for (let n = 2; ; n++) {
    const next = `${path.slice(0, slash + 1)}${stem} (${n})${ext}`;
    if (!Object.hasOwn(taken, next)) return next;
  }
}

export function buildUploadEntriesFromZip(
  data: Record<string, Uint8Array>,
  selected: string[],
  basePath = "",
): UploadEntry[] {
  const entries: UploadEntry[] = [];
  const normalizedBase = normalizePath(basePath);
  const seen = new Set<string>();
  for (const raw of selected) {
    const path = normalizeZipPath(raw);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    const content = data[path];
    if (!content) continue;
    const parts = path.split("/");
    const filename = parts[parts.length - 1];
    const type = guessMimeType(filename);
    const file = new File([content as Uint8Array<ArrayBuffer>], filename, type ? { type } : undefined);
    const relativePath = normalizedBase ? `${normalizedBase}/${path}` : path;
    entries.push({ file, relativePath });
  }
  return entries;
}
