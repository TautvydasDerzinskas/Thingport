// What a copy for a printer names in one slicer (src/adapter/printer.ts), read from the printer catalogue: the
// slicer's printer preset for the printer and nozzle, the process and filament presets that preset can use, and the
// printer's bed.

import { createHash } from "node:crypto";
import type { PrinterChoice, PrinterRecipe } from "../adapter";
import { printer, slicerFilaments, type Bed, type Printer, type PrinterPreset, type SlicerEntry } from "./catalogue";

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

function bedBox(bed: Bed | null): PrinterRecipe["bed"] {
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
function presetOf(slicerId: string, found: Printer, nozzle: string) {
  const entry = entryFor(Object.hasOwn(found.slicers, slicerId) ? found.slicers[slicerId] : undefined);
  const forNozzle = entry ? presetsFor(entry, nozzle) : null;
  const preset = forNozzle?.presets[0];
  return entry && forNozzle && preset ? { entry, nozzle: forNozzle.nozzle, preset } : null;
}

/**
 * The preset `slicerId` names the printer by for `nozzle`, and what a copy made for it needs. Null when the printer
 * isn't in the catalogue or the slicer has no preset for it.
 */
export function printerTarget(
  slicerId: string,
  printerId: string,
  nozzle: string,
): { choice: PrinterChoice; recipe: PrinterRecipe } | null {
  const found = printer(printerId);
  const hit = found ? presetOf(slicerId, found, nozzle) : null;
  if (!found || !hit) return null;
  const { entry, preset } = hit;
  const recipe: PrinterRecipe = {
    preset: preset.name,
    model: entry.model ?? null,
    nozzle: nozzleNumber(hit.nozzle) ?? 0.4,
    extruders: Math.max(found.extruders || 1, 1),
    processes: preset.processes,
    defaultProcess: preset.defaultProcess ?? null,
    filaments: preset.filaments ?? null,
    everyPrinter: slicerFilaments(slicerId),
    bed: bedBox(found.bed),
    height: found.height,
  };
  const stamp = createHash("sha256").update(JSON.stringify(recipe)).digest("hex").slice(0, 10);
  return { choice: { id: found.id, nozzle: hit.nozzle, preset: preset.name, stamp }, recipe };
}

/** The preset name each slicer gives the printer for `nozzle`, null where a slicer has none. */
export function printerPresetNames(
  printerId: string,
  nozzle: string,
  slicerIds: readonly string[],
): Record<string, string | null> {
  const found = printer(printerId);
  return Object.fromEntries(
    slicerIds.map((id) => [id, (found && presetOf(id, found, nozzle)?.preset.name) ?? null] as const),
  );
}
