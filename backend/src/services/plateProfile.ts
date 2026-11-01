import { listZipEntries, readZipEntry, readZipEntryPrefix } from "../utils/zipReader";

/** Bump when the parser learns new fields, so stored results can be told apart from older ones. */
export const PLATE_PROFILE_VERSION = 1;

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
};

export type StoredPlateProfile = PlateProfile & { version: number };

const MODEL_ENTRY = "3D/3dmodel.model";
const MODEL_PREFIX_BYTES = 64 * 1024;
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
    p.weight_g !== null
  );
}

function decodeEntities(text: string): string {
  return text
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
    const match = /^\s*;?\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    const key = match[1].toLowerCase();
    if (!settings.has(key)) settings.set(key, match[2]);
  }
  return settings;
}

function parseAttributes(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const m of tag.matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*"([^"]*)"/g)) {
    attributes.set(m[1].toLowerCase(), decodeEntities(m[2]));
  }
  return attributes;
}

type SliceInfo = {
  printer: string | null;
  nozzle: number | null;
  layerHeight: number | null;
  materials: string[];
  seconds: number | null;
  weight: number | null;
};

/** slice_info.config: `<metadata key=".." value=".."/>` per plate, `<filament type=".."/>` per used filament. */
function parseSliceInfo(text: string): SliceInfo {
  let seconds = 0;
  let weight = 0;
  const other = new Map<string, string>();
  for (const m of text.matchAll(/<metadata\b[^>]*>/gi)) {
    const attributes = parseAttributes(m[0]);
    const key = attributes.get("key")?.toLowerCase();
    const value = attributes.get("value");
    if (!key || value === undefined) continue;
    if (key === "prediction") seconds += toPositive(value) ?? 0;
    else if (key === "weight") weight += toPositive(value) ?? 0;
    else if (!other.has(key)) other.set(key, value);
  }
  const materials: string[] = [];
  for (const m of text.matchAll(/<filament\b[^>]*>/gi)) {
    const type = cleanString(parseAttributes(m[0]).get("type"));
    if (type) materials.push(type);
  }
  return {
    printer: cleanString(other.get("printer_model_id")),
    nozzle: firstNumber(toListItems(other.get("nozzle_diameters"))),
    layerHeight: toPositive(other.get("layer_height")),
    materials,
    seconds: seconds > 0 ? seconds : null,
    weight: weight > 0 ? Math.round(weight * 100) / 100 : null,
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
    const match = /<metadata\s+name="ProfileTitle"[^>]*>([\s\S]*?)<\/metadata>/i.exec(modelText);
    if (match) profile.title = cleanString(decodeEntities(match[1]));
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

  profile.printer = lookup(sources, PRINTER_KEYS).flatMap(toStrings)[0] ?? slice?.printer ?? null;
  profile.nozzle_mm = firstNumber(lookup(sources, NOZZLE_KEYS).flatMap(toListItems)) ?? slice?.nozzle ?? null;
  profile.layer_height_mm = firstNumber(lookup(sources, LAYER_KEYS).flatMap(toListItems)) ?? slice?.layerHeight ?? null;

  let materials = lookup(sources, MATERIAL_KEYS).flatMap(toListItems);
  if (materials.length === 0) materials = slice?.materials ?? [];
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
  return profile;
}
