import fs from "node:fs/promises";
import path from "node:path";
import type { Plate, Prisma } from "@prisma/client";
import { prisma } from "../db";
import { resolvePlateFilePath } from "./printCreation";
import { walkZipEntries } from "../utils/zipReader";

/** Bump when the parser learns new fields, so stored results can be told apart from older ones. */
export const PLATE_PROFILE_VERSION = 2;

export type PlateProfile = {
  title: string | null;
  printer: string | null;
  nozzle_mm: number | null;
  layer_height_mm: number | null;
  /** Empty means unknown. */
  materials: string[];
  plates: number | null;
  /** Only in a sliced file (.gcode.3mf). */
  estimated_seconds: number | null;
  weight_g: number | null;
  /** Per sliced plate; empty means unknown (no slice_info). A value the plate doesn't give (or 0) is null. */
  plate_stats: PlateStat[];
};

export type PlateStat = {
  /** The plate number as slice_info.config writes it (Bambu Studio counts from 1). */
  index: number;
  estimated_seconds: number | null;
  weight_g: number | null;
};

/** Size and modification time of the file when its profile was read, to notice that it was edited since. */
type FileStamp = { size: number; mtime_ms: number };

/** `file` is missing on a profile stored before it was recorded; such a profile is never re-read for a changed file. */
export type StoredPlateProfile = PlateProfile & { version: number; file?: FileStamp };

const MODEL_ENTRY = "3D/3dmodel.model";
const MODEL_PREFIX_BYTES = 512 * 1024;
const SMALL_ENTRY_BYTES = 1024 * 1024;

const PRINTER_KEYS = ["printer_model", "printer_settings_id", "printer_name"];
const NOZZLE_KEYS = ["nozzle_diameter", "printer_nozzle_diameter"];
const LAYER_KEYS = ["layer_height"];
const MATERIAL_KEYS = ["filament_type"];

/** Lower-cased key to raw value (a string, or an array of them), from one settings file. */
type Settings = Map<string, unknown>;

function emptyProfile(): PlateProfile {
  return {
    title: null,
    printer: null,
    nozzle_mm: null,
    layer_height_mm: null,
    materials: [],
    plates: null,
    estimated_seconds: null,
    weight_g: null,
    plate_stats: [],
  };
}

export function hasAnyProfileValue(p: PlateProfile): boolean {
  return (
    p.title !== null ||
    p.printer !== null ||
    p.nozzle_mm !== null ||
    p.layer_height_mm !== null ||
    p.materials.length > 0 ||
    p.plates !== null ||
    p.estimated_seconds !== null ||
    p.weight_g !== null ||
    p.plate_stats.length > 0
  );
}

function codePointToString(code: number, original: string): string {
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
    ? String.fromCodePoint(code)
    : original;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]{1,6});/gi, (m, hex: string) => codePointToString(parseInt(hex, 16), m))
    .replace(/&#(\d{1,7});/g, (m, dec: string) => codePointToString(parseInt(dec, 10), m))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function cleanString(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  if (!text || /^(nil|null)$/i.test(text)) return null;
  return text;
}

/** Each element of an array, or the value itself, as trimmed strings. No splitting. */
function toStrings(value: unknown): string[] {
  const items = Array.isArray(value) ? value : [value];
  return items.map(cleanString).filter((s): s is string => s !== null);
}

/** Like toStrings, but also splits `a;b` and `a,b`, as INI files and some slicers write lists. */
function toListItems(value: unknown): string[] {
  return toStrings(value).flatMap((s) =>
    s
      .split(/[;,]/)
      .map((part) => part.trim())
      .filter(Boolean),
  );
}

function toPositive(text: string | undefined | null): number | null {
  if (text == null) return null;
  const n = parseFloat(text);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function firstNumber(values: string[]): number | null {
  for (const v of values) {
    const n = toPositive(v);
    if (n !== null) return n;
  }
  return null;
}

/** The raw values for the keys, key order first, then source order. */
function lookup(sources: Settings[], keys: string[]): unknown[] {
  const found: unknown[] = [];
  for (const key of keys) {
    for (const source of sources) {
      if (source.has(key)) found.push(source.get(key));
    }
  }
  return found;
}

function parseJsonSettings(text: string): Settings {
  const settings: Settings = new Map();
  const parsed: unknown = JSON.parse(text);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    for (const [key, value] of Object.entries(parsed)) settings.set(key.toLowerCase(), value);
  }
  return settings;
}

/** `; key = value` (PrusaSlicer trailer) or `key = value`. The first occurrence of a key wins. */
function parseIniSettings(text: string): Settings {
  const settings: Settings = new Map();
  for (const line of text.split(/\r?\n/)) {
    // Split at the first `=` instead of one regex over the whole line, so a long line costs one scan.
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    let key = line.slice(0, eq).trim();
    if (key.startsWith(";")) key = key.slice(1).trim();
    if (!/^[A-Za-z0-9_]+$/.test(key)) continue;
    key = key.toLowerCase();
    if (!settings.has(key)) settings.set(key, line.slice(eq + 1).trim());
  }
  return settings;
}

function parseAttributes(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  // The name must follow whitespace, so a long tag without `=` is scanned in linear time.
  for (const m of tag.matchAll(/\s([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attributes.set(m[1].toLowerCase(), decodeEntities(m[2] ?? m[3]));
  }
  return attributes;
}

/** The start tags `<tag ..>` of a text. `[^<>]` keeps a tag that never ends from being rescanned from every `<`. */
function startTags(text: string, tag: string): IterableIterator<RegExpMatchArray> {
  return text.matchAll(new RegExp(`<${tag}\\b[^<>]{0,4096}>`, "gi"));
}

/** The text between each `<tag ..>` and its `</tag>`. Stops at the first tag without an end: none after it has one. */
function elementBodies(text: string, tag: string): string[] {
  const open = new RegExp(`<${tag}\\b[^<>]{0,4096}>`, "gi");
  const close = new RegExp(`</${tag}\\s*>`, "gi");
  const bodies: string[] = [];
  for (let start = open.exec(text); start; start = open.exec(text)) {
    close.lastIndex = open.lastIndex;
    const end = close.exec(text);
    if (!end) break;
    bodies.push(text.slice(open.lastIndex, end.index));
    open.lastIndex = close.lastIndex;
  }
  return bodies;
}

/** `<metadata name="ProfileTitle">..</metadata>`, whatever the attribute order or quotes. */
function findProfileTitle(modelText: string): string | null {
  const close = /<\/metadata\s*>/gi;
  for (const start of startTags(modelText, "metadata")) {
    if (start[0].endsWith("/>") || parseAttributes(start[0]).get("name")?.toLowerCase() !== "profiletitle") continue;
    const bodyStart = (start.index ?? 0) + start[0].length;
    close.lastIndex = bodyStart;
    const end = close.exec(modelText);
    return end ? cleanString(decodeEntities(modelText.slice(bodyStart, end.index))) : null;
  }
  return null;
}

type SliceInfo = {
  nozzle: number | null;
  layerHeight: number | null;
  materials: string[];
  seconds: number | null;
  weight: number | null;
  plateStats: PlateStat[];
};

/** slice_info.config: `<metadata key=".." value=".."/>` per plate, `<filament type=".."/>` per used filament. */
function parseSliceInfo(text: string): SliceInfo {
  let looseSeconds = 0;
  let looseWeight = 0;
  const other = new Map<string, string>();
  for (const m of startTags(text, "metadata")) {
    const attributes = parseAttributes(m[0]);
    const key = attributes.get("key")?.toLowerCase();
    const value = attributes.get("value");
    if (!key || value === undefined) continue;
    if (key === "prediction") looseSeconds += toPositive(value) ?? 0;
    else if (key === "weight") looseWeight += toPositive(value) ?? 0;
    else if (!other.has(key)) other.set(key, value);
  }
  const plateStats: PlateStat[] = [];
  let position = 0;
  for (const block of elementBodies(text, "plate")) {
    position += 1;
    const values = new Map<string, string>();
    for (const m of startTags(block, "metadata")) {
      const attributes = parseAttributes(m[0]);
      const key = attributes.get("key")?.toLowerCase();
      const value = attributes.get("value");
      if (key && value !== undefined && !values.has(key)) values.set(key, value);
    }
    const index = toPositive(values.get("index"));
    const plateSeconds = toPositive(values.get("prediction"));
    const plateWeight = toPositive(values.get("weight"));
    plateStats.push({
      index: index !== null && Number.isInteger(index) ? index : position,
      estimated_seconds: plateSeconds,
      weight_g: plateWeight !== null ? Math.round(plateWeight * 100) / 100 : null,
    });
  }
  // The plates' own values make the total; a file without plates adds up every such tag instead.
  const seconds = plateStats.length > 0 ? sumOf(plateStats.map((p) => p.estimated_seconds)) : looseSeconds;
  const weight = plateStats.length > 0 ? sumOf(plateStats.map((p) => p.weight_g)) : looseWeight;
  const materials: string[] = [];
  for (const m of startTags(text, "filament")) {
    const type = cleanString(parseAttributes(m[0]).get("type"));
    if (type) materials.push(type);
  }
  return {
    nozzle: firstNumber(toListItems(other.get("nozzle_diameters"))),
    layerHeight: toPositive(other.get("layer_height")),
    materials,
    seconds: seconds > 0 ? seconds : null,
    weight: weight > 0 ? Math.round(weight * 100) / 100 : null,
    plateStats,
  };
}

function sumOf(values: (number | null)[]): number {
  return values.reduce<number>((sum, v) => sum + (v ?? 0), 0);
}

function uniqueUpperCase(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const upper = value.toUpperCase();
    if (!seen.has(upper)) {
      seen.add(upper);
      result.push(upper);
    }
  }
  return result;
}

/** The entries read from a 3MF, found whatever the case of their names. */
const WANTED_ENTRIES = new Map(
  [
    MODEL_ENTRY,
    "Metadata/project_settings.config",
    "Metadata/Slic3r_PE.config",
    "Metadata/PrusaSlicer.config",
    "Metadata/slice_info.config",
  ].map((name) => [name.toLowerCase(), name]),
);

type ReadResult = {
  profile: PlateProfile;
  /** False when the file or one of the entries couldn't be read as a whole, so the profile may miss values. */
  complete: boolean;
};

/** At most maxBytes of a stream, and whether it had more. Stops reading (and closes the stream) at the cap. */
async function readUpTo(
  stream: NodeJS.ReadableStream,
  maxBytes: number,
): Promise<{ data: Buffer; truncated: boolean }> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.from(chunk);
    chunks.push(buffer);
    total += buffer.length;
    if (total > maxBytes) break;
  }
  return { data: Buffer.concat(chunks).subarray(0, maxBytes), truncated: total > maxBytes };
}

/** The names of all entries and the text of the wanted ones, in one pass over the file. */
async function readEntries(
  filePath: string,
): Promise<{ names: string[]; texts: Map<string, string>; complete: boolean }> {
  const names: string[] = [];
  const texts = new Map<string, string>();
  let complete = true;
  let requested = 0;
  let opened = 0;
  const isModel = (key: string) => key === MODEL_ENTRY.toLowerCase();
  await walkZipEntries(
    filePath,
    (entry) => {
      names.push(entry.name);
      const key = entry.name.toLowerCase();
      if (!WANTED_ENTRIES.has(key)) return false;
      if (!isModel(key) && entry.size > SMALL_ENTRY_BYTES) {
        complete = false;
        return false;
      }
      requested += 1;
      return true;
    },
    async (entry, stream) => {
      opened += 1;
      const key = entry.name.toLowerCase();
      try {
        // Only the start of the model file is wanted; any other entry over the cap isn't read.
        const { data, truncated } = await readUpTo(stream, isModel(key) ? MODEL_PREFIX_BYTES : SMALL_ENTRY_BYTES);
        if (truncated && !isModel(key)) complete = false;
        else texts.set(key, data.toString("utf8"));
      } catch {
        complete = false;
      }
    },
  );
  // An entry whose stream can't be opened (an unsupported compression, say) is skipped by the walker unseen.
  if (opened < requested) complete = false;
  return { names, texts, complete };
}

/**
 * What a 3MF says about how it was sliced, for the file list. Reads only a few small entries, never geometry.
 * 3MF isn't unified across slicers, so every field is looked up under several names and is null when none matches;
 * a broken or foreign file gives a partial or empty result, never an error. `complete` tells a result that is
 * partial because the file couldn't be read from one that is simply empty.
 */
export async function readPlateProfileChecked(filePath: string): Promise<ReadResult> {
  const profile = emptyProfile();
  let entries: Awaited<ReturnType<typeof readEntries>>;
  try {
    entries = await readEntries(filePath);
  } catch {
    return { profile, complete: false };
  }
  const { names: entryNames, texts } = entries;
  const readText = (name: string) => texts.get(name.toLowerCase()) ?? null;

  const modelText = readText(MODEL_ENTRY);
  if (modelText) {
    profile.title = findProfileTitle(modelText);
  }

  const sources: Settings[] = [];
  const projectText = readText("Metadata/project_settings.config");
  if (projectText) {
    try {
      sources.push(parseJsonSettings(projectText));
    } catch {
      // not JSON: the other sources still count
    }
  }
  for (const name of ["Metadata/Slic3r_PE.config", "Metadata/PrusaSlicer.config"]) {
    const text = readText(name);
    if (text) sources.push(parseIniSettings(text));
  }

  const sliceText = readText("Metadata/slice_info.config");
  const slice = sliceText ? parseSliceInfo(sliceText) : null;

  profile.printer = lookup(sources, PRINTER_KEYS).flatMap(toStrings)[0] ?? null;
  profile.nozzle_mm = firstNumber(lookup(sources, NOZZLE_KEYS).flatMap(toListItems)) ?? slice?.nozzle ?? null;
  profile.layer_height_mm = firstNumber(lookup(sources, LAYER_KEYS).flatMap(toListItems)) ?? slice?.layerHeight ?? null;

  // The filaments a sliced file really uses beat the project's full list of AMS slots.
  let materials = slice?.materials ?? [];
  if (materials.length === 0) materials = lookup(sources, MATERIAL_KEYS).flatMap(toListItems);
  if (materials.length === 0) {
    materials = lookup(sources, ["filament_settings_id"])
      .flatMap(toStrings)
      .map((s) => s.split("@")[0].trim())
      .filter(Boolean);
  }
  profile.materials = uniqueUpperCase(materials);

  const plateJson = entryNames.filter((n) => /^Metadata\/plate_\d+\.json$/i.test(n)).length;
  const platePng = entryNames.filter((n) => /^Metadata\/plate_\d+\.png$/i.test(n)).length;
  profile.plates = plateJson || platePng || (slice && slice.plateStats.length > 0 ? slice.plateStats.length : null);

  profile.estimated_seconds = slice?.seconds ?? null;
  profile.weight_g = slice?.weight ?? null;
  profile.plate_stats = slice?.plateStats ?? [];
  return { profile, complete: entries.complete };
}

/** See readPlateProfileChecked: whatever could be read, never an error. */
export async function readPlateProfile(filePath: string): Promise<PlateProfile> {
  return (await readPlateProfileChecked(filePath)).profile;
}

function is3mf(filename: string): boolean {
  return path.extname(filename).toLowerCase() === ".3mf";
}

async function fileStamp(filePath: string): Promise<FileStamp> {
  const stat = await fs.stat(filePath);
  return { size: stat.size, mtime_ms: Math.trunc(stat.mtimeMs) };
}

/**
 * Reads the file's profile and saves it on the plate. Null, and nothing saved, when the file couldn't be read as a
 * whole: a profile that missed values for that reason would be taken for the file's real one and never read again.
 */
export async function storePlateProfile(
  plateId: string,
  filename: string,
  filePath: string,
): Promise<StoredPlateProfile | null> {
  // Taken before reading, so a change while reading shows up as a difference next time.
  const file = await fileStamp(filePath);
  const { profile, complete } = await readPlateProfileChecked(filePath);
  if (!complete) return null;
  const stored: StoredPlateProfile = { ...profile, version: PLATE_PROFILE_VERSION, file };
  // Only while the plate still has the name it had when the file was read: a rename during the read must not get the
  // old 3MF's profile.
  const { count } = await prisma.plate.updateMany({
    where: { id: plateId, filename },
    data: { profileMeta: stored as unknown as Prisma.InputJsonValue },
  });
  return count ? stored : null;
}

function isCurrentVersion(value: Prisma.JsonValue | null): value is Prisma.JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const version = (value as { version?: unknown }).version;
  return typeof version === "number" && version >= PLATE_PROFILE_VERSION;
}

function storedStamp(value: Prisma.JsonObject): FileStamp | null {
  const file = value.file;
  if (!file || typeof file !== "object" || Array.isArray(file)) return null;
  const { size, mtime_ms } = file;
  return typeof size === "number" && typeof mtime_ms === "number" ? { size, mtime_ms } : null;
}

/** Reads the missing or outdated profiles of 3MF plates, and those of files changed since, saves them and sets them on
 *  the given objects. A plate whose file is gone or unreadable stores nothing, so it is tried again; one that had a profile
 *  shows none, since that profile describes a file that is no longer there. */
export async function ensurePlateProfiles<
  T extends Pick<Plate, "id" | "filename" | "storagePath" | "sourcePath" | "profileMeta">,
>(plates: T[]): Promise<void> {
  for (const plate of plates) {
    if (!is3mf(plate.filename)) continue;
    const current = isCurrentVersion(plate.profileMeta);
    const stamp = current ? storedStamp(plate.profileMeta as Prisma.JsonObject) : null;
    // Stored before the stamp existed: left as it is, so an upgrade doesn't re-read every file.
    if (current && !stamp) continue;
    try {
      const filePath = resolvePlateFilePath(plate);
      if (!filePath) {
        if (stamp) plate.profileMeta = null;
        continue;
      }
      if (stamp) {
        const now = await fileStamp(filePath);
        if (now.size === stamp.size && now.mtime_ms === stamp.mtime_ms) continue;
      }
      const stored = await storePlateProfile(plate.id, plate.filename, filePath);
      if (stored) plate.profileMeta = stored as unknown as Prisma.JsonValue;
      // The file changed and can't be read now: the old profile describes a file that is gone.
      else if (stamp) plate.profileMeta = null;
    } catch (err) {
      console.error(`Reading the 3MF profile of plate ${plate.id} failed:`, err);
    }
  }
}

/** The stored profile as the API shows it; null when none was read or it holds nothing. */
export function plateProfileOut(profileMeta: Prisma.JsonValue | null): PlateProfile | null {
  if (!profileMeta || typeof profileMeta !== "object" || Array.isArray(profileMeta)) return null;
  const m = profileMeta as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const profile: PlateProfile = {
    title: str(m.title),
    printer: str(m.printer),
    nozzle_mm: num(m.nozzle_mm),
    layer_height_mm: num(m.layer_height_mm),
    materials: Array.isArray(m.materials) ? m.materials.filter((v): v is string => typeof v === "string" && !!v) : [],
    plates: num(m.plates),
    estimated_seconds: num(m.estimated_seconds),
    weight_g: num(m.weight_g),
    plate_stats: Array.isArray(m.plate_stats)
      ? m.plate_stats.flatMap((v): PlateStat[] => {
          if (!v || typeof v !== "object") return [];
          const o = v as Record<string, unknown>;
          const index = num(o.index);
          return index === null
            ? []
            : [{ index, estimated_seconds: num(o.estimated_seconds), weight_g: num(o.weight_g) }];
        })
      : [],
  };
  return hasAnyProfileValue(profile) ? profile : null;
}
