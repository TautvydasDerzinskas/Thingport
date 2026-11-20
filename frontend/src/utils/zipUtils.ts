import i18next from "i18next";
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

export async function readZipEntries(
  file: File,
): Promise<{ entries: ZipEntry[]; data: Record<string, Uint8Array>; numbered: Record<string, string> }> {
  const fflate = await import("fflate");
  const raw = new Uint8Array(await file.arrayBuffer());
  const found = everyEntry(fflate, raw);
  // Each path to the first entry that has it. Without a prototype, so an entry named "__proto__" is one like any other.
  const data: Record<string, Uint8Array> = Object.create(null);
  const later: [string, Uint8Array][] = [];
  for (const [path, content] of found) {
    if (Object.hasOwn(data, path)) later.push([path, content]);
    else data[path] = content;
  }
  // Two entries can come to one path ("./A/guide.pdf" and "A/guide.pdf", or two of one name): the same bytes are one
  // file, and others are another, listed under a number rather than lost behind the first or uploaded under its name.
  // Numbered once every entry has its own path, so the number is one no entry of the zip is called by. Each numbered
  // one is listed with the path it had too, which a scene naming that path could mean (uploadTree's gltfBundles).
  const copies = new Map<string, DistinctCopies>();
  const numbered: Record<string, string> = Object.create(null);
  for (const [path, content] of later) {
    let held = copies.get(path);
    if (!held) copies.set(path, (held = new DistinctCopies(data[path])));
    if (!held.add(content)) continue;
    const next = numberedPath(path, data);
    data[next] = content;
    numbered[next] = path;
  }
  const entries = Object.keys(data)
    .toSorted((a, b) => a.localeCompare(b))
    .map((path) => ({ path, size: data[path].length }));
  return { entries, data, numbered };
}

/** Every entry the zip lists that's kept (not a folder, nor what the OS left in it), in its order, at its path made
 *  one. The central directory is read as most zips are read, one entry a name; where it names a path twice, or one an
 *  object can't hold ("__proto__"), the zip is read once more, entry by entry. Where that finds other than the
 *  directory lists, it throws, rather than leave the copies out unsaid. */
function everyEntry(fflate: typeof import("fflate"), raw: Uint8Array): [string, Uint8Array][] {
  const kept = (name: string) => {
    const path = normalizeZipPath(name);
    return path && !isArchiveJunk(path) ? path : null;
  };
  let listed = 0;
  const seen = new Set<string>();
  let oneByOne = false;
  const firsts = fflate.unzipSync(raw, {
    // Folders and what the OS left aren't read at all.
    filter: (entry) => {
      if (!kept(entry.name)) return false;
      listed += 1;
      if (seen.has(entry.name) || entry.name === "__proto__") oneByOne = true;
      if (seen.has(entry.name)) return false;
      seen.add(entry.name);
      return true;
    },
  });
  const byName = [...seen].flatMap((name): [string, Uint8Array][] =>
    Object.hasOwn(firsts, name) ? [[kept(name)!, firsts[name]]] : [],
  );
  if (!oneByOne) return byName;
  const each = entryByEntry(fflate, raw, kept);
  if (each && each.length === listed) return each;
  throw new Error(i18next.t("zipImport.repeatsUnreadable", { ns: "app" }));
}

/** The kept entries of the zip read in one pass, each apart, by fflate's streaming reader; null where that fails. The
 *  others aren't started, so one fflate can't unpack (a compression it doesn't know, in __MACOSX) costs nothing. */
function entryByEntry(
  fflate: typeof import("fflate"),
  raw: Uint8Array,
  kept: (name: string) => string | null,
): [string, Uint8Array][] | null {
  const out: [string, Uint8Array][] = [];
  try {
    const unzip = new fflate.Unzip((entry) => {
      const path = kept(entry.name);
      if (!path) return;
      const chunks: Uint8Array[] = [];
      entry.ondata = (err, chunk, final) => {
        if (err) throw err;
        chunks.push(chunk);
        if (final) out.push([path, joined(chunks)]);
      };
      entry.start();
    });
    unzip.register(fflate.UnzipInflate);
    unzip.push(raw, true);
  } catch {
    return null;
  }
  return out;
}

function joined(chunks: Uint8Array[]): Uint8Array {
  const all = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.length;
  }
  return all;
}

/** One path's distinct contents, told apart by length, then, among those of one length, by a hash of their bytes worked
 *  out once each: a copy is compared byte by byte only with those it could be, not with every one before it. The hash
 *  is FNV-1a, as crypto.subtle isn't there on a plain-HTTP instance; equal hashes are still compared in full. */
class DistinctCopies {
  private readonly byLength = new Map<number, { only: Uint8Array } | { byHash: Map<number, Uint8Array[]> }>();

  constructor(first: Uint8Array) {
    this.byLength.set(first.length, { only: first });
  }

  /** False when `content` is one held already; held from then on when it isn't. */
  add(content: Uint8Array): boolean {
    const group = this.byLength.get(content.length);
    if (!group) {
      this.byLength.set(content.length, { only: content });
      return true;
    }
    // Most paths a zip repeats have one or two copies: those are only compared, never hashed.
    if ("only" in group) {
      if (sameBytes(group.only, content)) return false;
      this.byLength.set(content.length, { byHash: new Map([[hashBytes(group.only), [group.only]]]) });
      return this.add(content);
    }
    const hash = hashBytes(content);
    const same = group.byHash.get(hash) ?? [];
    if (same.some((each) => sameBytes(each, content))) return false;
    group.byHash.set(hash, [...same, content]);
    return true;
  }
}

function hashBytes(bytes: Uint8Array): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) hash = Math.imul(hash ^ bytes[i], 0x01000193);
  return hash >>> 0;
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

/** `numbered`: each numbered copy's path to the one the zip gave it (readZipEntries), which its entry carries. */
export function buildUploadEntriesFromZip(
  data: Record<string, Uint8Array>,
  selected: string[],
  basePath = "",
  numbered: Record<string, string> = {},
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
    const inBase = (each: string) => (normalizedBase ? `${normalizedBase}/${each}` : each);
    const zipPath = Object.hasOwn(numbered, path) ? numbered[path] : null;
    entries.push({ file, relativePath: inBase(path), ...(zipPath ? { zipPath: inBase(zipPath) } : {}) });
  }
  return entries;
}
