// Which of the settings' copies a site's model gets, and what each says it keeps. A slicer that opens every kind of 3MF
// the site has as it is needs no copy, unless one is made for a printer: those aren't offered.

import { slicerProfile } from "../../adapter/index.generated";
import { planFor } from "../../adapting/run";
import type { AdaptTarget } from "../../shared/adaptTargets";
import { t } from "../../shared/i18n";
import { SLICER_LABELS } from "../../shared/slicers";
import type { Saved } from "./download";
import { siteFormats } from "./formats";
import type { AdaptSite } from "./site";

const made = () => t("adaptPage.madeInBrowser", { grab: "Thingport Grab" });

type Output = NonNullable<ReturnType<typeof planFor>>["output"];

/** The printer as a plan takes it before its preset is looked up: enough to say whether a copy is made for it. */
const choiceOf = (target: AdaptTarget) =>
  target.printer ? { id: target.printer.id, nozzle: target.printer.nozzle, preset: "" } : null;

const slicerName = (target: AdaptTarget) => (target.slicer ? (SLICER_LABELS[target.slicer] ?? target.slicer) : null);
const printerOf = (target: AdaptTarget) => `${target.printer!.brandName} ${target.printer!.model}`.trim();
/** A slicer that opens another app's project on the printer selected in it, which a copy only changes for a
 *  printer of the user's (QIDI Studio). */
const movesOntoItsPrinter = (target: AdaptTarget) => Boolean(slicerProfile(target.slicer)?.ownTag);

/** Whole sentences, one after another. */
const sentences = (...parts: (string | false)[]) => parts.filter(Boolean).join(" ");

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
  // The printer first: a file downloaded as it is keeps the designer's printer as well, unless the slicer moves it.
  if (saved.printerless && target.printer && movesOntoItsPrinter(target)) {
    const values = { grab: "Grab", slicer, printer: printerOf(target) };
    return t(saved.copy ? "adaptPage.noPresetMovesCopy" : "adaptPage.noPresetMovesFile", values);
  }
  if (saved.printerless && target.printer) {
    const values = { grab: "Grab", slicer, printer: printerOf(target) };
    return t(saved.copy ? "adaptPage.noPresetCopy" : "adaptPage.noPresetFile", values);
  }
  if (!saved.copy) return t("adaptPage.fileItself", { slicer });
  if (!target.printer) return null;
  if (saved.nozzle) {
    return t("adaptPage.nearestNozzle", {
      slicer,
      nozzle: target.printer.nozzle,
      printer: printerOf(target),
      named: saved.nozzle,
    });
  }
  return null;
}

/** Why nothing is downloaded for the page's own pick: a file that isn't a 3MF, or a pick that can't be read yet. */
export const unpickedReason = (pick: "other" | "unread"): string =>
  pick === "unread"
    ? t("adaptPage.stillReadingPick", { grab: "Grab" })
    : t("adaptPage.onlyFormatAdapted", { format: "3MF" });

/** What the copy keeps, for the button's explanation. */
export function explanation(site: AdaptSite, target: AdaptTarget): string {
  return siteFormats(site).length > 1 ? ofSeveral(site, target) : ofOne(site, target);
}

const pick = () => t("adaptPage.pickSlicer", { grab: "Grab" });

/** A site whose 3MFs are all one kind: what the copy of one keeps. */
function ofOne(site: AdaptSite, target: AdaptTarget): string {
  const output = outputsFor(site, target)[0] ?? null;
  const slicer = slicerName(target);
  const { filesAre } = site;
  if (output === "bambu" && target.printer) {
    return sentences(
      t("adaptPage.oneForPrinter", { printer: printerOf(target), nozzle: target.printer.nozzle, slicer: slicer ?? "" }),
      made(),
    );
  }
  if (output === "bambu" && target.slicer === "crealityprintlink") return t("adaptedDownloadExplanationCreality");
  if (output === "bambu" && movesOntoItsPrinter(target)) {
    return sentences(t("adaptPage.oneOnItsPrinter", { slicer: slicer ?? "" }), made());
  }
  if (output === "bambu") return t("adaptedDownloadExplanationBambu", { slicer: slicer ?? "" });
  if (output === "cura") return sentences(t("adaptPage.oneCura", { filesAre, cura: "Cura" }), made());
  const other = slicer
    ? t("adaptPage.oneOtherKnown", { filesAre, slicer })
    : t("adaptPage.oneOtherUnknown", { filesAre, prusaSlicer: "PrusaSlicer", cura: "Cura" });
  return sentences(other, !slicer && pick(), made());
}

/** A site with several kinds of 3MF: the copy is made from whichever the file turns out to be, and a file the slicer
 *  opens as it is comes as it is. */
function ofSeveral(site: AdaptSite, target: AdaptTarget): string {
  const slicer = slicerName(target);
  const { filesAre } = site;
  // Before a slicer is picked, the copy is PrusaSlicer's.
  const reads = slicerProfile(target.slicer)?.reads ?? "prusa";
  let copy: string;
  if (reads === "bambu" && target.printer) {
    copy = t("adaptPage.severalForPrinter", {
      filesAre,
      printer: printerOf(target),
      nozzle: target.printer.nozzle,
      slicer: slicer ?? "",
    });
  } else if (reads === "bambu" && movesOntoItsPrinter(target)) {
    copy = t("adaptPage.severalOnItsPrinter", { filesAre, slicer: slicer ?? "" });
  } else if (reads === "bambu") {
    copy = t("adaptPage.severalOwnProject", { filesAre, slicer: slicer ?? "" });
  } else if (reads === "cura") {
    copy = t("adaptPage.severalCura", { filesAre, cura: "Cura" });
  } else {
    copy = t("adaptPage.severalOther", { filesAre });
  }
  return sentences(
    copy,
    t("adaptPage.fileItselfWhereOpens", { slicer: slicer ?? "PrusaSlicer" }),
    !slicer && pick(),
    made(),
  );
}
