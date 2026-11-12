// "Adapt 3MFs" as Grab keeps it for itself: the slicers the user opens models in, their printers, and where the
// Download adapted button goes. Once connected, the slicers and printers are the Thingport instance's
// (background/adaptSettings.ts): these stand in while the instance can't be reached, and these printers on an
// instance from before printers. The button's place stays Grab's either way.

import { SLICER_LABELS } from "./slicers";

/** Beside the site's own open or download button, or in Grab's bubble. */
export const ADAPT_PLACEMENTS = ["beside", "bubble"] as const;
export type AdaptPlacement = (typeof ADAPT_PLACEMENTS)[number];

/** A printer by its printer catalogue id, and the nozzle it prints with ("0.4"). */
export type AdaptPrinter = { id: string; nozzle: string };

export type AdaptSettings = { slicers: string[]; printers: AdaptPrinter[]; placement: AdaptPlacement };

export const DEFAULT_ADAPT: AdaptSettings = { slicers: [], printers: [], placement: "beside" };

const PRINTER_ID = /^[a-z0-9-]{1,120}$/;
const NOZZLE = /^[A-Za-z]{0,3}\d+(\.\d+)?$/;

/** The slicers Grab knows, in the order the web app lists them; anything else is dropped. */
export function knownSlicers(ids: unknown): string[] {
  const wanted = new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []);
  return Object.keys(SLICER_LABELS).filter((id) => wanted.has(id));
}

/** Well-formed printers, each once, in the order they were added. */
export function knownPrinters(printers: unknown): AdaptPrinter[] {
  if (!Array.isArray(printers)) return [];
  const seen = new Set<string>();
  const out: AdaptPrinter[] = [];
  for (const item of printers) {
    const id = (item as Partial<AdaptPrinter> | null)?.id;
    const nozzle = (item as Partial<AdaptPrinter> | null)?.nozzle;
    if (typeof id !== "string" || !PRINTER_ID.test(id) || seen.has(id)) continue;
    if (typeof nozzle !== "string" || !NOZZLE.test(nozzle)) continue;
    seen.add(id);
    out.push({ id, nozzle });
  }
  return out;
}

/** What storage holds, cleaned, with the defaults for what it doesn't; a value a newer Grab wrote reads as unset. */
export function adaptSettingsOf(stored: {
  adaptSlicers?: unknown;
  adaptPrinters?: unknown;
  adaptPlacement?: unknown;
}): AdaptSettings {
  return {
    slicers: knownSlicers(stored.adaptSlicers),
    printers: knownPrinters(stored.adaptPrinters),
    placement: ADAPT_PLACEMENTS.find((place) => place === stored.adaptPlacement) ?? DEFAULT_ADAPT.placement,
  };
}

/** The storage keys a change writes, cleaned. */
export function adaptUpdate(change: Partial<AdaptSettings>): Record<string, unknown> {
  return {
    ...(change.slicers ? { adaptSlicers: knownSlicers(change.slicers) } : {}),
    ...(change.printers ? { adaptPrinters: knownPrinters(change.printers) } : {}),
    ...(change.placement && ADAPT_PLACEMENTS.includes(change.placement) ? { adaptPlacement: change.placement } : {}),
  };
}

/** The nozzle a printer is added with: 0.4 where it has one, else its first. */
export function defaultNozzle(nozzles: readonly string[]): string {
  return nozzles.includes("0.4") ? "0.4" : (nozzles[0] ?? "0.4");
}
