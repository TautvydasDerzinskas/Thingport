// Which of the settings' copies a site's model gets, and what each says it keeps. A slicer that opens the site's
// files as they are needs no copy, unless one is made for a printer: those aren't offered.

import { SLICER_LABELS } from "../../shared/slicers";
import { planFor } from "../../adapting/run";
import type { AdaptTarget } from "../../shared/adaptTargets";
import type { AdaptSite } from "./site";

const MADE = "Made in your browser by Thingport Grab.";

/** The printer as a plan takes it before its preset is looked up: enough to say whether a copy is made for it. */
const choiceOf = (target: AdaptTarget) =>
  target.printer ? { id: target.printer.id, nozzle: target.printer.nozzle, preset: "" } : null;

/** The copy a target's click makes of the site's files, or null where the slicer opens them as they are. */
export function outputFor(site: AdaptSite, target: AdaptTarget) {
  return planFor(site.format, target.slicer, choiceOf(target))?.output ?? null;
}

/** The targets that make a copy of the site's files. */
export function copiesFor(site: AdaptSite, targets: readonly AdaptTarget[]): AdaptTarget[] {
  return targets.filter((target) => outputFor(site, target) !== null);
}

/** What the copy keeps, for the button's explanation. */
export function explanation(site: AdaptSite, target: AdaptTarget): string {
  const output = outputFor(site, target);
  const slicer = target.slicer ? (SLICER_LABELS[target.slicer] ?? target.slicer) : null;
  if (output === "bambu" && target.printer) {
    const printer = `${target.printer.brandName} ${target.printer.model}`.trim();
    return (
      `This downloads a copy made for your ${printer} with its ${target.printer.nozzle} mm nozzle in ${slicer}: it ` +
      `names ${slicer}'s presets for that printer, keeps the designer's settings on top of them and lays the plates ` +
      `out on its bed. ${MADE}`
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
  const pick = slicer ? "" : " Pick your slicer in Grab's Adapt 3MFs settings for a copy made for it.";
  return (
    `${site.filesAre}, which ${who} without their colors or print settings. This downloads a copy that goes into ` +
    "your own printer, filament and print settings, with the designer's layer height, walls, infill and supports set " +
    `on each object and the painted colors on your extruders.${pick} ${MADE}`
  );
}
