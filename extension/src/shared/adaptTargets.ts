// Who Download adapted makes copies for: from Adapt 3MFs' settings (shared/adaptSettings.ts), or the Thingport
// instance's slicers and printers once connected, one copy for each slicer, and for a slicer that loads a printer's
// presets by name, one for each printer (only the one the instance names for it, where it does). Pure, so the
// popup, the page's button and the bubble all go by the same list.

import { slicerProfile } from "../adapter/slicers/index.generated";
import type { AdaptPrinter } from "./adaptSettings";
import type { AdaptView, ThingportPrinter } from "./messages";
import type { ArtPrinter } from "./printerArt";
import { SLICER_LABELS } from "./slicers";

/** A printer as Adapt 3MFs names and draws it. */
export type TargetPrinter = ArtPrinter & { id: string; brandName: string; model: string; nozzle: string };

/** What copies are made for now: Thingport's slicers and printers once connected, else Grab's own. */
export type AdaptInUse = {
  slicers: string[];
  printers: TargetPrinter[];
  slicersFromThingport: boolean;
  printersFromThingport: boolean;
  /** The printer each slicer's copies are made for, where the instance names one. */
  slicerPrinters: Record<string, string>;
  /** Slicers whose files the user wants as they are. */
  unadapted: string[];
  /** Why Thingport's aren't used, where they would be: an instance from before printers, or one out of reach. */
  fallback: "no-printers" | "unreachable" | null;
  /** What the instance said when it couldn't be reached. */
  error?: string;
  /** Thingport's are what the instance said last, as it couldn't be asked now: why it couldn't. */
  remembered?: string;
};

/** What copies are made for, Grab's own printers described by `describe` (the catalogue's summary of each). */
export function adaptInUse(view: AdaptView, describe: (printer: AdaptPrinter) => TargetPrinter): AdaptInUse {
  const own = view.own.printers.map(describe);
  const thingport = view.thingport;
  const none = { slicerPrinters: {}, unadapted: [], slicersFromThingport: false, printersFromThingport: false };
  if (thingport && "slicers" in thingport) {
    return {
      slicers: thingport.slicers,
      printers: thingport.printers ? thingport.printers.map((p: ThingportPrinter) => ({ ...p })) : own,
      slicersFromThingport: true,
      printersFromThingport: Boolean(thingport.printers),
      slicerPrinters: thingport.slicerPrinters,
      unadapted: thingport.unadapted,
      fallback: thingport.printers ? null : "no-printers",
      ...(thingport.remembered ? { remembered: thingport.remembered } : {}),
    };
  }
  const base = { ...none, slicers: view.own.slicers, printers: own };
  if (thingport) return { ...base, fallback: "unreachable", error: thingport.error };
  return { ...base, fallback: null };
}

/** One copy on offer: for a slicer and maybe a printer; neither is the copy PrusaSlicer and the like read, which is
 *  what there is before a slicer is picked. `key` stays the same across loads, to remember the last one used. */
export type AdaptTarget = { key: string; slicer: string | null; printer: TargetPrinter | null };

export const DEFAULT_TARGET: AdaptTarget = { key: "", slicer: null, printer: null };

/** Every copy the settings ask for, in the order the slicers and printers are listed. Empty when every slicer picked
 *  wants its files as they are. */
export function adaptTargets(use: AdaptInUse): AdaptTarget[] {
  if (!use.slicers.length) return [DEFAULT_TARGET];
  const targets: AdaptTarget[] = [];
  for (const slicer of use.slicers) {
    if (use.unadapted.includes(slicer)) continue;
    const named = use.printers.find((p) => p.id === use.slicerPrinters[slicer]);
    const printers = slicerProfile(slicer)?.targetsPrinter ? (named ? [named] : use.printers) : [];
    if (!printers.length) {
      targets.push({ key: slicer, slicer, printer: null });
      continue;
    }
    for (const printer of printers) {
      targets.push({ key: `${slicer}|${printer.id}|${printer.nozzle}`, slicer, printer });
    }
  }
  return targets;
}

/** Whether the copies are the one there is before a slicer is picked. By key, as they arrive by message, as copies. */
export const beforeSlicerPicked = (targets: readonly AdaptTarget[]) =>
  targets.length === 1 && targets[0].key === DEFAULT_TARGET.key;

/** The one the button makes: the last one used where it's still on offer, else the first. */
export function pickTarget(targets: readonly AdaptTarget[], lastKey: string | null | undefined): AdaptTarget | null {
  return targets.find((target) => target.key === lastKey) ?? targets[0] ?? null;
}

const slicerName = (slicer: string) => SLICER_LABELS[slicer] ?? slicer;

/** How a copy is named in a list: its printer, or its slicer, first. */
export function targetName(target: AdaptTarget): { name: string; sub: string } {
  if (target.printer) {
    return { name: `${target.printer.brandName} ${target.printer.model}`.trim(), sub: slicerName(target.slicer!) };
  }
  if (target.slicer) return { name: slicerName(target.slicer), sub: "Your own printer and settings" };
  return { name: "PrusaSlicer and the like", sub: "Your own printer and settings" };
}

/** The line under the button's label: which copy a click makes. */
export function targetLine(target: AdaptTarget): string {
  if (target.printer) return `${target.printer.brandName} ${target.printer.model} · ${slicerName(target.slicer!)}`;
  if (target.slicer) return slicerName(target.slicer);
  return "For PrusaSlicer · pick your slicer";
}
