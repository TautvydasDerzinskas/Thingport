// What a copy for a printer takes from the printer catalogue in one slicer: the slicer's printer preset for the
// printer and nozzle, the process and filament presets that preset can use, and the printer's bed. Both the server
// (backend/assets/printers) and Thingport Grab (its copy, made by scripts/sync-printers.mjs) read a catalogue printer
// into this shape and make the recipe here, so a copy names the same presets whichever made it.

import type { PrinterChoice } from "./plan";
import type { BedBox, FilamentChoices, PrinterRecipe } from "./printer";

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

export type ProcessPreset = { name: string; layerHeight: number | null };

/** One of a slicer's printer presets for a nozzle, and the process and filament presets it can use. */
export type PrinterPreset = {
  name: string;
  defaultProcess?: string;
  processes: ProcessPreset[];
  /** Names the preset had before, which older files still use. */
  renamedFrom?: string[];
  /** The filament the slicer starts it with. */
  defaultFilament?: string;
  /** The filaments made for it; the slicer's filaments for every printer come after these. */
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

/** As much of a catalogue printer as a recipe takes. */
export type RecipePrinter = {
  id: string;
  extruders: number;
  bed: Bed | null;
  height: number | null;
  /** Each slicer's names for it, by Thingport's slicer id. */
  slicers: Record<string, SlicerEntry[]>;
};

function nozzleNumber(key: string): number | null {
  const n = Number(key);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** The presets for `nozzle`, else for the nearest plain nozzle the slicer has ("HF0.4" and the like only when asked
 *  for by name). */
function presetsFor(entry: SlicerEntry, nozzle: string): { nozzle: string; presets: PrinterPreset[] } | null {
  const byNozzle = entry.presets ?? {};
  if (byNozzle[nozzle]?.length) return { nozzle, presets: byNozzle[nozzle] };
  const wanted = nozzleNumber(nozzle);
  if (wanted === null) return null;
  let best: string | null = null;
  for (const key of Object.keys(byNozzle)) {
    const n = nozzleNumber(key);
    if (n === null || !byNozzle[key].length) continue;
    if (best === null || Math.abs(n - wanted) < Math.abs((nozzleNumber(best) as number) - wanted)) best = key;
  }
  return best ? { nozzle: best, presets: byNozzle[best] } : null;
}

/** The printer's own entry, before one for a setup it's sold in ("Combo") or fitted with ("MMU3"). */
function entryFor(entries: SlicerEntry[] | undefined): SlicerEntry | null {
  if (!entries?.length) return null;
  return entries.find((e) => !e.config && e.presets) ?? entries.find((e) => e.presets) ?? null;
}

/** The bed's bounding box in the printer's coordinates, flagged when it isn't the bed itself (a round one). */
export function bedBox(bed: Bed | null): BedBox | null {
  if (!bed || !(bed.x > 0) || !(bed.y > 0)) return null;
  const [ox, oy] = bed.origin;
  return {
    minX: ox,
    minY: oy,
    maxX: ox + bed.x,
    maxY: oy + bed.y,
    ...(bed.shape === "rectangle" ? {} : { outline: true }),
  };
}

/** The slicer's preset for the printer and nozzle (the nearest nozzle it has), with the entry it's under. */
function presetOf(slicerId: string, found: RecipePrinter, nozzle: string) {
  const entry = entryFor(Object.hasOwn(found.slicers, slicerId) ? found.slicers[slicerId] : undefined);
  const forNozzle = entry ? presetsFor(entry, nozzle) : null;
  const preset = forNozzle?.presets[0];
  return entry && forNozzle && preset ? { entry, nozzle: forNozzle.nozzle, preset } : null;
}

/**
 * The preset `slicerId` names the printer by for `nozzle`, and what a copy made for it needs; `everyPrinter` is the
 * slicer's filaments for every printer. Null when the slicer has no preset for the printer. The choice has no
 * stamp: the server stamps the copies it keeps.
 */
export function printerRecipe(
  slicerId: string,
  found: RecipePrinter,
  nozzle: string,
  everyPrinter: FilamentChoices | null,
): { choice: PrinterChoice; recipe: PrinterRecipe } | null {
  const hit = presetOf(slicerId, found, nozzle);
  if (!hit) return null;
  const { entry, preset } = hit;
  const recipe: PrinterRecipe = {
    preset: preset.name,
    model: entry.model ?? null,
    nozzle: nozzleNumber(hit.nozzle) ?? 0.4,
    extruders: Math.max(found.extruders || 1, 1),
    processes: preset.processes,
    defaultProcess: preset.defaultProcess ?? null,
    filaments: preset.filaments ?? null,
    everyPrinter,
    bed: bedBox(found.bed),
    height: found.height,
  };
  return { choice: { id: found.id, nozzle: hit.nozzle, preset: preset.name }, recipe };
}

/** The name `slicerId` gives the printer's preset for `nozzle`, or null where it has none. */
export function printerPresetName(slicerId: string, found: RecipePrinter, nozzle: string): string | null {
  return presetOf(slicerId, found, nozzle)?.preset.name ?? null;
}
