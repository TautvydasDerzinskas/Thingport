// Which of the settings' copies a site's model gets, and what each says it keeps. A slicer that opens every kind of 3MF
// the site has as it is needs no copy, unless one is made for a printer: those aren't offered.

import { slicerProfile } from "../../adapter/index.generated";
import { planFor } from "../../adapting/run";
import type { AdaptTarget } from "../../shared/adaptTargets";
import { SLICER_LABELS } from "../../shared/slicers";
import type { Saved } from "./download";
import { siteFormats } from "./formats";
import type { AdaptSite } from "./site";

const MADE = "Made in your browser by Thingport Grab.";

type Output = NonNullable<ReturnType<typeof planFor>>["output"];

/** The printer as a plan takes it before its preset is looked up: enough to say whether a copy is made for it. */
const choiceOf = (target: AdaptTarget) =>
  target.printer ? { id: target.printer.id, nozzle: target.printer.nozzle, preset: "" } : null;

const slicerName = (target: AdaptTarget) => (target.slicer ? (SLICER_LABELS[target.slicer] ?? target.slicer) : null);
const printerOf = (target: AdaptTarget) => `${target.printer!.brandName} ${target.printer!.model}`.trim();

/** The copies a target's click makes of the kinds of 3MF the site has: none where the slicer opens them as they are. */
export function outputsFor(site: AdaptSite, target: AdaptTarget): Output[] {
  const outputs = siteFormats(site).map((format) => planFor(format, target.slicer, choiceOf(target))?.output);
  return [...new Set(outputs.filter((output): output is Output => Boolean(output)))];
}

/** The targets that make a copy of the site's files. */
export function copiesFor(site: AdaptSite, targets: readonly AdaptTarget[]): AdaptTarget[] {
  return targets.filter((target) => outputsFor(site, target).length > 0);
}

/** What's worth saying once a copy is saved, if anything: that it's the file itself, where the slicer needed none;
 *  that Grab has no preset of the slicer for the printer; or that the slicer's preset for the nearest nozzle stands
 *  in for the printer's own. */
export function savedNote(target: AdaptTarget, saved: Saved): string | null {
  const slicer = slicerName(target) ?? "PrusaSlicer";
  // The printer first: a file downloaded as it is keeps the designer's printer as well.
  if (saved.printerless && target.printer) {
    const what = saved.copy ? "this copy keeps" : `the file itself, which ${slicer} opens as it is, keeps`;
    return `Grab has no ${slicer} preset for the ${printerOf(target)}, so ${what} the designer's printer. Pick yours in ${slicer} before slicing.`;
  }
  if (!saved.copy) return `Downloaded the file itself: ${slicer} opens it as it is.`;
  if (!target.printer) return null;
  if (saved.nozzle) {
    return (
      `${slicer} has no ${target.printer.nozzle} mm nozzle preset for the ${printerOf(target)}, so this copy names its ` +
      `${saved.nozzle} mm one. Set your nozzle in ${slicer} before slicing.`
    );
  }
  return null;
}

/** Why nothing is downloaded for the page's own pick: a file that isn't a 3MF, or a pick that can't be read yet. */
export const unpickedReason = (pick: "other" | "unread"): string =>
  pick === "unread"
    ? "Grab is still reading which file the page has picked. Try again in a moment."
    : "Only a 3MF gets an adapted copy. Pick one of the model's 3MFs on the page, then try again.";

/** What the copy keeps, for the button's explanation. */
export function explanation(site: AdaptSite, target: AdaptTarget): string {
  return siteFormats(site).length > 1 ? ofSeveral(site, target) : ofOne(site, target);
}

const PICK = " Pick your slicer in Grab's Adapt 3MFs settings for a copy made for it.";

/** A site whose 3MFs are all one kind: what the copy of one keeps. */
function ofOne(site: AdaptSite, target: AdaptTarget): string {
  const output = outputsFor(site, target)[0] ?? null;
  const slicer = slicerName(target);
  if (output === "bambu" && target.printer) {
    return (
      `This downloads a copy made for your ${printerOf(target)} with its ${target.printer.nozzle} mm nozzle in ` +
      `${slicer}: it names ${slicer}'s presets for that printer, keeps the designer's settings on top of them and ` +
      `lays the plates out on its bed. ${MADE}`
    );
  }
  if (output === "bambu" && target.slicer === "crealityprintlink") {
    return (
      "This downloads a copy that keeps the parts, plates, painting and the designer's settings, under the names " +
      `Creality Print gives them. It still asks which of your printers to use. ${MADE}`
    );
  }
  if (output === "bambu") {
    return (
      `This downloads a copy ${slicer} opens as its own project: parts, plates, painting and the designer's ` +
      "settings, without questions about the file's version. A setting it names differently is renamed, to the " +
      `nearest of its choices where it has fewer. ${MADE}`
    );
  }
  if (output === "cura") {
    return (
      `${site.filesAre}, which Cura opens without their parts' filaments or the designer's settings. This downloads a ` +
      "copy whose multi-part objects keep their parts, each on its own extruder, with the designer's walls, top and " +
      `bottom layers, infill and whether to print supports set on each object. Cura doesn't read painted colors. ${MADE}`
    );
  }
  const who = slicer ? `${slicer} often opens` : "PrusaSlicer, Cura and other slicers often open";
  return (
    `${site.filesAre}, which ${who} without their colors or print settings. This downloads a copy that goes into ` +
    "your own printer, filament and print settings, with the designer's layer height, walls, infill and supports set " +
    `on each object and the painted colors on your extruders.${slicer ? "" : PICK} ${MADE}`
  );
}

/** A site with several kinds of 3MF: the copy is made from whichever the file turns out to be, and a file the slicer
 *  opens as it is comes as it is. */
function ofSeveral(site: AdaptSite, target: AdaptTarget): string {
  const slicer = slicerName(target);
  // Before a slicer is picked, the copy is PrusaSlicer's.
  const reads = slicerProfile(target.slicer)?.reads ?? "prusa";
  let copy: string;
  if (reads === "bambu" && target.printer) {
    copy =
      `a copy made for your ${printerOf(target)} with its ${target.printer.nozzle} mm nozzle in ${slicer}: it names ` +
      `${slicer}'s presets for that printer, keeps the designer's settings on top of them and lays the plates out on ` +
      "its bed";
  } else if (reads === "bambu") {
    copy =
      `a copy ${slicer} opens as its own project, keeping the parts, plates, painting and the designer's settings ` +
      `under the names ${slicer} gives them`;
  } else if (reads === "cura") {
    copy =
      "a copy whose multi-part objects keep their parts, each on its own extruder, with the designer's walls, top " +
      "and bottom layers, infill and whether to print supports set on each object. Cura doesn't read painted colors";
  } else {
    copy =
      "a copy that goes into your own printer, filament and print settings, with the designer's layer height, walls, " +
      "infill and supports set on each object and the colors on your extruders";
  }
  return (
    `${site.filesAre}. This downloads ${copy}. Where ${slicer ?? "PrusaSlicer"} opens the file as it is, you get ` +
    `the file itself.${slicer ? "" : PICK} ${MADE}`
  );
}
