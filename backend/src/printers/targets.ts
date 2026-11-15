// What a copy for a printer names in one slicer, from the server's printer catalogue: the recipe the adapter makes of
// a catalogue printer (src/adapter/recipe.ts, which Thingport Grab uses with its own copy), stamped with what it says.

import { createHash } from "node:crypto";
import { printerPresetName, printerRecipe, type PrinterChoice, type PrinterRecipe } from "../adapter";
import { printer, slicerFilaments } from "./catalogue";

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
  const made = found ? printerRecipe(slicerId, found, nozzle, slicerFilaments(slicerId)) : null;
  if (!made) return null;
  const stamp = createHash("sha256").update(JSON.stringify(made.recipe)).digest("hex").slice(0, 10);
  return { choice: { ...made.choice, stamp }, recipe: made.recipe };
}

/** The preset name each slicer gives the printer for `nozzle`, null where a slicer has none. */
export function printerPresetNames(
  printerId: string,
  nozzle: string,
  slicerIds: readonly string[],
): Record<string, string | null> {
  const found = printer(printerId);
  return Object.fromEntries(slicerIds.map((id) => [id, found ? printerPresetName(id, found, nozzle) : null] as const));
}
