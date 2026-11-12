// GENERATED from backend/src/adapter/plan.ts by scripts/sync-adapter.mjs. Don't edit it here:
// change backend/src/adapter/ and run npm run adapter:sync.
// Whether a slicer opens a file as well as it can as it is, and if not, what copy to make for it. Knows no slicer by
// name: only what each one's profile (slicers/) says it reads.

import type { ThreeMfFormat } from "./format.generated";
import type { SettingsDialect } from "./settings.generated";
import type { SlicerProfile } from "./slicers/types.generated";

/** The Application a Bambu layout copy carries for a slicer that would otherwise question the file: past every
 *  version these slicers convert old projects up from (2.0), short of every one they warn about (2.3.1). */
export const COMPATIBLE_TAG = "BambuStudio-02.01.00.00";

/** The printer a copy is for (printer.ts): its printer catalogue id, its nozzle, and the slicer's printer preset for
 *  the two. `stamp` changes with what the catalogue says about it for that slicer, and with it the copy's name. */
export type PrinterChoice = { id: string; nozzle: string; preset: string; stamp?: string };

/** Whether the project was made for this very printer preset, which then needs nothing changed for it. */
export function madeFor(printerPreset: string | null | undefined, choice: PrinterChoice): boolean {
  return Boolean(printerPreset) && String(printerPreset).trim().toLowerCase() === choice.preset.trim().toLowerCase();
}

export type AdaptPlan =
  | {
      output: "bambu";
      tag: string | null;
      dropOrcaTag: boolean;
      dialect: SettingsDialect | null;
      /** The user's printer the copy names the presets of (printer.ts); absent, the designer's stays. */
      printer?: PrinterChoice;
      /** A PrusaSlicer project written in Bambu's layout (writers/bambuFromPrusa.ts), rather than a Bambu one kept. */
      from?: "prusa";
    }
  /** `from` "plain": a plain 3MF's colours as filaments (readers/plainProject.ts), rather than a Bambu project. */
  | { output: "prusa"; from?: "plain" }
  | { output: "cura"; from?: "plain" };

function versionParts(version: string): number[] {
  return (version.match(/\d+/g) ?? []).map(Number);
}

/** True when `version` is `limit` or older. A version with more parts than the limit ("02.03.02.61" against "2.3.2")
 *  counts as newer unless the extra parts are zero. */
export function versionAtMost(version: string, limit: string): boolean {
  const a = versionParts(version);
  const b = versionParts(limit);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y;
  }
  return true;
}

function ownedBy(format: ThreeMfFormat, slicer: SlicerProfile): boolean {
  if (format.app && slicer.ownApps.includes(format.app)) return true;
  return Boolean(slicer.ownWithOrcaTag && format.orcaTag);
}

function quietFor(format: ThreeMfFormat, slicer: SlicerProfile): boolean {
  const limit = format.app ? slicer.quietUpTo?.[format.app] : undefined;
  return !limit || (format.appVersion !== null && versionAtMost(format.appVersion, limit));
}

function orcaTagQuiet(format: ThreeMfFormat, slicer: SlicerProfile): boolean {
  return !format.orcaTag || !slicer.orcaTagQuietUpTo || versionAtMost(format.orcaTag, slicer.orcaTagQuietUpTo);
}

/** The copy to open in `slicer` instead of the file, or null when the file itself is the best it gets. `printer` is
 *  the user's printer for that slicer: a slicer that loads printer presets by name gets a copy naming its presets for
 *  it, unless the project was made for that very preset. */
export function planAdaptation(
  format: ThreeMfFormat | null | undefined,
  slicer: SlicerProfile | null | undefined,
  printer?: PrinterChoice | null,
): AdaptPlan | null {
  if (!format || !slicer) return null;
  // The Bambu family opens a PrusaSlicer project with an old loader that keeps its parts but none of its settings,
  // colours or beds; PrusaSlicer itself, and those built on it, open it as their own.
  if (format.kind === "prusa") {
    if (slicer.reads !== "bambu") return null;
    const forPrusa = printer && slicer.targetsPrinter ? printer : null;
    return {
      output: "bambu",
      from: "prusa",
      tag: COMPATIBLE_TAG,
      dropOrcaTag: false,
      dialect: slicer.dialect ?? null,
      ...(forPrusa ? { printer: forPrusa } : {}),
    };
  }
  // PrusaSlicer, eufyMake Studio and Cura read none of a plain 3MF's colours: a copy puts each on a filament of its
  // own where there are several, unless PrusaSlicer's painting covers every triangle already.
  if (format.kind === "plain") {
    if ((format.filaments ?? 0) < 2) return null;
    if (slicer.reads === "prusa" && !format.painted) return { output: "prusa", from: "plain" };
    if (slicer.reads === "cura") return { output: "cura", from: "plain" };
    return null;
  }
  if (format.kind !== "bambu") return null;
  if (slicer.reads === "prusa") return { output: "prusa" };
  if (slicer.reads === "cura") return { output: "cura" };

  const forPrinter = printer && slicer.targetsPrinter && !madeFor(format.printer, printer) ? printer : null;
  const dropOrcaTag = !orcaTagQuiet(format, slicer);
  const retag = !slicer.asksForPrinter && (!ownedBy(format, slicer) || !quietFor(format, slicer) || dropOrcaTag);
  const dialect = slicer.dialect && format.dialect && format.dialect !== slicer.dialect ? slicer.dialect : null;
  if (!retag && !dropOrcaTag && !dialect && !forPrinter) return null;
  return {
    output: "bambu",
    tag: retag ? COMPATIBLE_TAG : null,
    dropOrcaTag,
    dialect,
    ...(forPrinter ? { printer: forPrinter } : {}),
  };
}

/** A name for the copy a plan makes, the same for every slicer that gets the same copy. A copy for a printer is
 *  named for it and its recipe's stamp, as slicers name the same printer's presets differently. */
export function planKey(plan: AdaptPlan): string {
  if (plan.output !== "bambu") return plan.from === "plain" ? `${plan.output}-fromplain` : plan.output;
  return [
    "bambu",
    plan.from === "prusa" ? "fromprusa" : "",
    plan.tag ? "tag" : "",
    plan.dropOrcaTag ? "noorca" : "",
    plan.dialect ?? "",
    plan.printer ? ["for", plan.printer.id, plan.printer.nozzle, plan.printer.stamp].filter(Boolean).join("-") : "",
  ]
    .filter(Boolean)
    .join("-");
}
