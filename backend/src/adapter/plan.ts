// Whether a slicer opens a file as well as it can as it is, and if not, what copy to make for it. Knows no slicer by
// name: only what each one's profile (slicers/) says it reads.

import type { ThreeMfFormat } from "./format";
import type { SettingsDialect } from "./settings";
import type { SlicerProfile } from "./slicers/types";

/** The Application a Bambu layout copy carries for a slicer that would otherwise question the file: past every
 *  version these slicers convert old projects up from (2.0), short of every one they warn about (2.3.1). */
export const COMPATIBLE_TAG = "BambuStudio-02.01.00.00";

export type AdaptPlan =
  | { output: "bambu"; tag: string | null; dropOrcaTag: boolean; dialect: SettingsDialect | null }
  | { output: "prusa" }
  | { output: "cura" };

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

/** The copy to open in `slicer` instead of the file, or null when the file itself is the best it gets. */
export function planAdaptation(
  format: ThreeMfFormat | null | undefined,
  slicer: SlicerProfile | null | undefined,
): AdaptPlan | null {
  if (!format || !slicer || format.kind !== "bambu") return null;
  if (slicer.reads === "prusa") return { output: "prusa" };
  if (slicer.reads === "cura") return { output: "cura" };

  const dropOrcaTag = !orcaTagQuiet(format, slicer);
  const retag = !slicer.asksForPrinter && (!ownedBy(format, slicer) || !quietFor(format, slicer) || dropOrcaTag);
  const dialect = slicer.dialect && format.dialect && format.dialect !== slicer.dialect ? slicer.dialect : null;
  if (!retag && !dropOrcaTag && !dialect) return null;
  return { output: "bambu", tag: retag ? COMPATIBLE_TAG : null, dropOrcaTag, dialect };
}

/** A name for the copy a plan makes, the same for every slicer that gets the same copy. */
export function planKey(plan: AdaptPlan): string {
  if (plan.output !== "bambu") return plan.output;
  return ["bambu", plan.tag ? "tag" : "", plan.dropOrcaTag ? "noorca" : "", plan.dialect ?? ""]
    .filter(Boolean)
    .join("-");
}
