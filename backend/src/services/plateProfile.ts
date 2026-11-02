import path from "node:path";
import type { Plate, Prisma } from "@prisma/client";
import { prisma } from "../db";
import { resolvePlateFilePath } from "./printCreation";
import { listZipEntries, readZipEntry, readZipEntryPrefix } from "../utils/zipReader";

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

export type StoredPlateProfile = PlateProfile & { version: number };

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
  let seconds = 0;
  let weight = 0;
  const other = new Map<string, string>();
  for (const m of startTags(text, "metadata")) {
    const attributes = parseAttributes(m[0]);
    const key = attributes.get("key")?.toLowerCase();
    const value = attributes.get("value");
    if (!key || value === undefined) continue;
    if (key === "prediction") seconds += toPositive(value) ?? 0;
    else if (key === "weight") weight += toPositive(value) ?? 0;
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

/**
 * What a 3MF says about how it was sliced, for the file list. Reads only a few small entries, never geometry.
 * 3MF isn't unified across slicers, so every field is looked up under several names and is null when none matches;
 * a broken or foreign file gives a partial or empty result, never an error.
 */
export async function readPlateProfile(filePath: string): Promise<PlateProfile> {
  const profile = emptyProfile();
  let entryNames: string[];
  try {
    entryNames = (await listZipEntries(filePath)).filter((e) => !e.isDirectory).map((e) => e.name);
  } catch {
    return profile;
  }
  const byLowerName = new Map(entryNames.map((name) => [name.toLowerCase(), name]));
  const readText = async (name: string, prefix = false): Promise<string | null> => {
    const actual = byLowerName.get(name.toLowerCase());
    if (!actual) return null;
    try {
      const buffer = prefix
        ? await readZipEntryPrefix(filePath, actual, MODEL_PREFIX_BYTES)
        : await readZipEntry(filePath, actual, SMALL_ENTRY_BYTES);
      return buffer ? buffer.toString("utf8") : null;
    } catch {
      return null;
    }
  };

  const modelText = await readText(MODEL_ENTRY, true);
  if (modelText) {
    profile.title = findProfileTitle(modelText);
  }

  const sources: Settings[] = [];
  const projectText = await readText("Metadata/project_settings.config");
  if (projectText) {
    try {
      sources.push(parseJsonSettings(projectText));
    } catch {
      // not JSON: the other sources still count
    }
  }
  for (const name of ["Metadata/Slic3r_PE.config", "Metadata/PrusaSlicer.config"]) {
    const text = await readText(name);
    if (text) sources.push(parseIniSettings(text));
  }

  const sliceText = await readText("Metadata/slice_info.config");
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
  profile.plates = plateJson || platePng || null;

  profile.estimated_seconds = slice?.seconds ?? null;
  profile.weight_g = slice?.weight ?? null;
  profile.plate_stats = slice?.plateStats ?? [];
  return profile;
}

function is3mf(filename: string): boolean {
  return path.extname(filename).toLowerCase() === ".3mf";
}

/** Reads the file's profile and saves it on the plate. */
export async function storePlateProfile(plateId: string, filePath: string): Promise<StoredPlateProfile> {
  const stored: StoredPlateProfile = { ...(await readPlateProfile(filePath)), version: PLATE_PROFILE_VERSION };
  await prisma.plate.update({
    where: { id: plateId },
    data: { profileMeta: stored as unknown as Prisma.InputJsonValue },
  });
  return stored;
}

function isCurrent(value: Prisma.JsonValue | null): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const version = (value as { version?: unknown }).version;
  return typeof version === "number" && version >= PLATE_PROFILE_VERSION;
}

/** Reads the missing or outdated profiles of 3MF plates, saves them and sets them on the given objects. A plate whose
 *  file is gone is skipped and stays unread, so it is tried again once the file is back. */
export async function ensurePlateProfiles<
  T extends Pick<Plate, "id" | "filename" | "storagePath" | "sourcePath" | "profileMeta">,
>(plates: T[]): Promise<void> {
  for (const plate of plates) {
    if (!is3mf(plate.filename) || isCurrent(plate.profileMeta)) continue;
    try {
      const filePath = resolvePlateFilePath(plate);
      if (!filePath) continue;
      plate.profileMeta = (await storePlateProfile(plate.id, filePath)) as unknown as Prisma.JsonValue;
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
