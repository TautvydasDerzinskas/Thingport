// The printer catalogue: every printer the slicers Thingport opens files in know, with its bed, height and nozzles,
// and each slicer's own names for it and for the process and filament presets it uses (assets/printers, made by
// scripts/printers/update.mjs and committed, so it's there offline). Read as asked for: the index once, a brand's full
// entries the first time one of them is wanted, the names the first time one is looked up.

import fs from "node:fs";
import path from "node:path";

const DIR = path.resolve(__dirname, "../../assets/printers");

/** A printable area in mm, its origin the front-left corner's place in the printer's coordinates. */
export type Bed = {
  shape: "rectangle" | "circle" | "polygon";
  x: number;
  y: number;
  origin: [number, number];
  /** A round (delta) bed's diameter. */
  diameter?: number;
  /** Any other shape's outline. */
  points?: [number, number][];
};

export type PrinterCodes = {
  /** Bambu Lab's model code, as its cloud names a bound printer ("C12" is the P1S). */
  bambu?: string;
  qidi?: string;
  orca?: string;
  prusa?: string;
  cura?: string;
};

export type PrinterSummary = {
  /** `<brand>-<model>`, stable across catalogue updates. */
  id: string;
  brand: string;
  model: string;
  bed: Bed | null;
  /** Areas of the bed nothing may be printed on, each an outline in bed coordinates. */
  exclude?: [number, number][][];
  /** Each extruder's printable area where they differ (Bambu Lab H2D). */
  extruderBeds?: Bed[];
  height: number | null;
  /** Nozzle diameters in mm, as slicers name them ("0.4"). */
  nozzles: string[];
  extruders: number;
  codes?: PrinterCodes;
  /** Whether covers/<id>.webp exists. */
  cover?: true;
};

export type ProcessPreset = { name: string; layerHeight: number | null };

/** A slicer's filament presets for a printer: the one to name for each filament type ("PLA"), and for each product,
 *  a preset's name without the printer it's tuned for, in lower case ("bambu pla basic"). */
export type FilamentChoices = { types: Record<string, string>; products: Record<string, string> };

/** One of a slicer's printer presets for a nozzle, and the process and filament presets it can use. */
export type PrinterPreset = {
  name: string;
  defaultProcess?: string;
  processes: ProcessPreset[];
  /** Names the preset had before, which older files still use. */
  renamedFrom?: string[];
  /** The filament the slicer starts it with. */
  defaultFilament?: string;
  /** The filaments made for it; the slicer's filaments for every printer (slicerFilaments) come after these. */
  filaments?: FilamentChoices;
};

/** How a slicer knows a printer: its model and presets by nozzle (a "HF0.4" key for high-flow), or Cura's definition. */
export type SlicerEntry = {
  /** A setup the printer is sold in or fitted with ("Combo", "MMU3"), where it has presets of its own. */
  config?: string;
  model?: string;
  presets?: Record<string, PrinterPreset[]>;
  definition?: string;
  nozzles?: string[];
};

export type Printer = Omit<PrinterSummary, "cover"> & {
  aliases: string[];
  tools: { config: string; tools: number }[];
  multiMaterial: string[];
  temps: { nozzle?: number; bed?: number; chamber?: number } | null;
  materialDiameter: number | null;
  gcodeFlavor: string | null;
  relativeE: boolean | null;
  device: Record<string, string | number | boolean> | null;
  /** The sources (scripts/printers/sources.json) it's in, the one its facts came from first. */
  sources: string[];
  /** Each slicer's names for it, by source id (Thingport's slicer id where there is one). */
  slicers: Record<string, SlicerEntry[]>;
  cover?: true;
};

export type Brand = { id: string; name: string; printers: number };

type Index = { version: number; brands: Brand[]; printers: PrinterSummary[] };

let index: { brands: Brand[]; printers: PrinterSummary[]; byId: Map<string, PrinterSummary> } | null = null;
const brandFiles = new Map<string, Map<string, Printer>>();
let names: Record<string, [string, string?]> | null = null;
const slicerFilamentFiles = new Map<string, FilamentChoices | null>();

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8")) as T;
}

function loadIndex() {
  if (!index) {
    const read = readJson<Index>("index.json");
    index = { brands: read.brands, printers: read.printers, byId: new Map(read.printers.map((p) => [p.id, p])) };
  }
  return index;
}

/** Every brand, with how many printers it has. */
export function printerBrands(): Brand[] {
  return loadIndex().brands;
}

/** Every printer's summary: enough to list them, draw their beds and check a model fits. */
export function printerSummaries(): PrinterSummary[] {
  return loadIndex().printers;
}

export function printerSummary(id: string): PrinterSummary | null {
  return loadIndex().byId.get(id) ?? null;
}

/** A brand's printers in full, each slicer's preset names among them. */
export function brandPrinters(brandId: string): Printer[] {
  if (!loadIndex().brands.some((b) => b.id === brandId)) return [];
  let printers = brandFiles.get(brandId);
  if (!printers) {
    const read = readJson<{ printers: Printer[] }>(path.join("brands", `${brandId}.json`));
    printers = new Map(read.printers.map((p) => [p.id, p]));
    brandFiles.set(brandId, printers);
  }
  return [...printers.values()];
}

/** A printer in full, or null for an id the catalogue doesn't have. */
export function printer(id: string): Printer | null {
  const summary = printerSummary(id);
  if (!summary) return null;
  brandPrinters(summary.brand);
  return brandFiles.get(summary.brand)?.get(id) ?? null;
}

/**
 * The printer a slicer's name means -- a printer preset ("Bambu Lab P1S 0.4 nozzle"), a model ("Bambu Lab P1S"), a
 * preset's old name or a Cura definition ("ultimaker_s5") -- and the nozzle a preset is for. As a 3MF names the
 * printer it was made for, and a sliced file the one it was sliced for. Case doesn't matter.
 */
export function printerForName(
  name: string | null | undefined,
): { printer: PrinterSummary; nozzle: string | null } | null {
  const key = String(name ?? "")
    .trim()
    .toLowerCase();
  if (!key) return null;
  names ??= readJson<{ names: Record<string, [string, string?]> }>("names.json").names;
  const hit = Object.hasOwn(names, key) ? names[key] : undefined;
  const found = hit ? printerSummary(hit[0]) : null;
  return found ? { printer: found, nozzle: hit?.[1] ?? null } : null;
}

/** The printers of a Bambu Lab model code, as Bambu's cloud lists a bound printer's (`C12`). */
export function printersForBambuCode(code: string | null | undefined): PrinterSummary[] {
  if (!code) return [];
  return loadIndex().printers.filter((p) => p.codes?.bambu === code);
}

/** The filaments a slicer installs for every printer (OrcaSlicer's filament library); null when it has none. */
export function slicerFilaments(slicerId: string): FilamentChoices | null {
  if (!/^[a-z0-9-]+$/.test(slicerId)) return null;
  if (!slicerFilamentFiles.has(slicerId)) {
    const file = path.join("filaments", `${slicerId}.json`);
    const read = fs.existsSync(path.join(DIR, file)) ? readJson<FilamentChoices>(file) : null;
    slicerFilamentFiles.set(slicerId, read ? { types: read.types, products: read.products } : null);
  }
  return slicerFilamentFiles.get(slicerId) ?? null;
}

/** The printer's picture, a small WebP, when the catalogue has one. */
export function printerCoverFile(id: string): string | null {
  return printerSummary(id)?.cover ? path.join(DIR, "covers", `${id}.webp`) : null;
}
