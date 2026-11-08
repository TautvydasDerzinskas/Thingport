// What a print profile's own 3MF says about it: the printer and settings it was made for, its plates, and -- when the
// designer uploaded it sliced -- each plate's time and filament. Bambu Studio and the slicers built on it (OrcaSlicer,
// Creality Print, Elegoo Slicer, Anycubic Slicer Next, Snapmaker Orca) all write the same Metadata files.

import { decodeHtmlEntities } from "../utils/htmlEntities";
import { listZipEntries, readZipEntry } from "../utils/zipReader";
import { hexColor, percentText, rounded, text, type ProfileFilament } from "./printProfileFacts";

const SETTINGS_LIMIT = 8 * 1024 * 1024;
const CONFIG_LIMIT = 16 * 1024 * 1024;

export type ProfileFilePlate = {
  index: number;
  name: string | null;
  /** How many objects are on it. */
  objects: number | null;
  /** The project holds its picture (Metadata/plate_N.png). */
  thumb: boolean;
  seconds: number | null;
  grams: number | null;
  filaments: ProfileFilament[];
};

export type ProfileFileFacts = {
  printer: string | null;
  nozzleMm: number | null;
  layerMm: number | null;
  infill: string | null;
  walls: number | null;
  supports: boolean | null;
  plates: ProfileFilePlate[];
};

/** Whether a file is a project this reads: any 3MF, a sliced one too. */
export function isProfileProject(filename: string): boolean {
  return filename.toLowerCase().endsWith(".3mf");
}

/** The zip entry holding a plate's picture. */
export function plateThumbEntry(index: number): string {
  return `Metadata/plate_${index}.png`;
}

function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [, name, value] of tag.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) out[name] = decodeHtmlEntities(value);
  return out;
}

/** The `<metadata key value>` pairs in a piece of a config, first one winning. */
function metadataOf(xml: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const [tag] of xml.matchAll(/<metadata\b[^>]*>/g)) {
    const { key, value } = attributes(tag);
    if (key && value !== undefined && !out.has(key)) out.set(key, value);
  }
  return out;
}

function blocksOf(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "g"))].map((match) => match[1]);
}

function plateIndex(value: string | undefined): number | null {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function first(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

/** "Bambu Lab A1 mini 0.4 nozzle" as just the printer, for a project that doesn't name its model. */
function printerOfPreset(preset: unknown): string | null {
  const name = text(preset);
  return name ? name.replace(/\s+\d+(?:\.\d+)?\s*(?:mm\s*)?nozzle$/i, "").trim() || null : null;
}

type Settings = Omit<ProfileFileFacts, "plates">;

function readSettings(json: string): Settings | null {
  let config: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    config = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const supports = text(first(config.enable_support));
  const walls = rounded(first(config.wall_loops));
  return {
    printer: text(config.printer_model) ?? printerOfPreset(config.printer_settings_id),
    nozzleMm: rounded(first(config.nozzle_diameter), 2),
    layerMm: rounded(first(config.layer_height), 3),
    infill: percentText(first(config.sparse_infill_density)),
    walls,
    supports: supports === null ? null : supports === "1" || supports.toLowerCase() === "true",
  };
}

type PlateLayout = { index: number; name: string | null; objects: number };

function readLayout(xml: string): PlateLayout[] {
  const plates: PlateLayout[] = [];
  for (const block of blocksOf(xml, "plate")) {
    const meta = metadataOf(block);
    const index = plateIndex(meta.get("plater_id") ?? meta.get("plate_id"));
    if (index === null) continue;
    plates.push({
      index,
      name: text(meta.get("plater_name")),
      objects: [...block.matchAll(/<model_instance\b/g)].length,
    });
  }
  return plates;
}

type PlateSlice = { index: number; seconds: number | null; grams: number | null; filaments: ProfileFilament[] };

function readSlices(xml: string): PlateSlice[] {
  const plates: PlateSlice[] = [];
  for (const block of blocksOf(xml, "plate")) {
    const meta = metadataOf(block);
    const index = plateIndex(meta.get("index"));
    if (index === null) continue;
    const filaments = [...block.matchAll(/<filament\b[^>]*>/g)].map(([tag]) => {
      const attrs = attributes(tag);
      return { type: text(attrs.type), color: hexColor(attrs.color), grams: rounded(attrs.used_g, 2) };
    });
    plates.push({
      index,
      seconds: rounded(meta.get("prediction")),
      grams: rounded(meta.get("weight"), 2),
      filaments: filaments.filter((filament) => filament.grams !== null),
    });
  }
  return plates;
}

async function readText(filePath: string, entry: string, limit: number): Promise<string | null> {
  const buf = await readZipEntry(filePath, entry, limit).catch(() => null);
  return buf ? buf.toString("utf-8") : null;
}

/** What a profile's 3MF says, or null for a file that isn't one (or can't be read). Reads only its small config
 *  files, never the meshes, so it's quick however big the model is. */
export async function readProfileFile(filePath: string): Promise<ProfileFileFacts | null> {
  let entries: string[];
  try {
    entries = (await listZipEntries(filePath)).filter((entry) => !entry.isDirectory).map((entry) => entry.name);
  } catch {
    return null;
  }
  const has = new Set(entries);
  const [settingsJson, layoutXml, sliceXml] = await Promise.all([
    has.has("Metadata/project_settings.config")
      ? readText(filePath, "Metadata/project_settings.config", SETTINGS_LIMIT)
      : null,
    has.has("Metadata/model_settings.config")
      ? readText(filePath, "Metadata/model_settings.config", CONFIG_LIMIT)
      : null,
    has.has("Metadata/slice_info.config") ? readText(filePath, "Metadata/slice_info.config", CONFIG_LIMIT) : null,
  ]);
  const settings = (settingsJson && readSettings(settingsJson)) || {
    printer: null,
    nozzleMm: null,
    layerMm: null,
    infill: null,
    walls: null,
    supports: null,
  };
  const layout = layoutXml ? readLayout(layoutXml) : [];
  const slices = sliceXml ? readSlices(sliceXml) : [];
  const thumbs = new Set(
    entries.flatMap((entry) => {
      const match = entry.match(/^Metadata\/plate_(\d+)\.png$/);
      return match ? [Number(match[1])] : [];
    }),
  );

  // The project's own plates; a project without them (or one that's only sliced) by what else names plates.
  const indexes = layout.length
    ? layout.map((plate) => plate.index)
    : slices.length
      ? slices.map((plate) => plate.index)
      : [...thumbs];
  const plates = [...new Set(indexes)]
    .toSorted((a, b) => a - b)
    .map((index): ProfileFilePlate => {
      const shape = layout.find((plate) => plate.index === index);
      const slice = slices.find((plate) => plate.index === index);
      return {
        index,
        name: shape?.name ?? null,
        objects: shape ? shape.objects : null,
        thumb: thumbs.has(index),
        seconds: slice?.seconds ?? null,
        grams: slice?.grams ?? null,
        filaments: slice?.filaments ?? [],
      };
    });

  return { ...settings, plates };
}

/** The filaments of the whole project, from its plates' slices: the same filament on several plates once, its grams
 *  added up. */
export function projectFilaments(plates: { filaments: ProfileFilament[] }[]): ProfileFilament[] {
  const byKey = new Map<string, ProfileFilament>();
  for (const filament of plates.flatMap((plate) => plate.filaments)) {
    const key = `${filament.type ?? ""}|${filament.color ?? ""}`;
    const seen = byKey.get(key);
    if (seen) seen.grams = rounded((seen.grams ?? 0) + (filament.grams ?? 0), 2);
    else byKey.set(key, { ...filament });
  }
  return [...byKey.values()];
}
