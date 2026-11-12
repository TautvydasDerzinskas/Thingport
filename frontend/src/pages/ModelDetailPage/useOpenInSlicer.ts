import { useCallback, useEffect, useMemo } from "react";
import { type Plate, type Print, printsApi } from "../../api/prints";
import type { UserPrinter } from "../../api/printers";
import { planAdaptation, type AdaptPlan, type PrinterChoice } from "../../adapter/plan.generated";
import { slicerProfile } from "../../adapter/slicers/index.generated";
import { SLICER_OPTIONS } from "../../constants/settingsOptions";
import { useSlicerSettings } from "../../hooks/useSlicerPreference";
import { useUserPrinters } from "../../hooks/useUserPrinters";
import { slicerLaunchUrl } from "../../utils/slicerLaunch";

/** A file of the model a slicer can open or the user can download: a plate, or the prepared print when it
 *  isn't one of them. `launchFilename` is what the slicer is told the file is called. */
export type ModelFile = {
  key: string;
  url: string;
  filename: string;
  launchFilename: string;
  index: number;
  plate: Plate | null;
  /** Given where the size isn't on the plate: a partner's model's files. */
  size?: number | null;
  /** The folder it's in (Plate.folder), which the model page groups its files by. */
  folder?: string | null;
};
export type SlicerTarget = ModelFile & { href: string };
/** A plate's copy made for the slicer (src/adapter in the backend): `plan` says what it changes, `printer` the
 *  user's printer it's made for. With `ask`, which printer is asked first, and `withPrinter` makes the copy for the
 *  one picked: the file itself, as Open opens it, for the printer it was made for, and null for one the slicer has no
 *  preset for. */
export type AdaptedTarget = SlicerTarget & {
  plan: AdaptPlan;
  printer: PrinterChoice | null;
  ask?: boolean;
  withPrinter?: (printer: UserPrinter) => AdaptedTarget | SlicerTarget | null;
};

/** Whether it's a copy made for the slicer, rather than the file itself. */
export function isAdaptedTarget(target: SlicerTarget): target is AdaptedTarget {
  return "plan" in target;
}

/** The copy's printer as the slicer names it, null for a printer the slicer has no preset for. */
export function printerChoice(printer: UserPrinter, slicerId: string): PrinterChoice | null {
  const preset = printer.presets[slicerId];
  return preset ? { id: printer.printer.id, nozzle: printer.nozzle, preset } : null;
}

export const PREPARED_KEY = "prepared";

/** Sliced .gcode.3mf plates are never adapted: dropping their G-code would leave nothing to print. */
function isAdaptable3mf(filename: string): boolean {
  const lower = filename.toLowerCase();
  return lower.endsWith(".3mf") && !lower.endsWith(".gcode.3mf");
}

/** The prepared print first, when it isn't a plate, then the plates in order. */
export function modelFiles(print: Print): ModelFile[] {
  const sortedPlates = print.plates.toSorted((a, b) => a.position - b.position);
  const out: ModelFile[] = [];
  if (print.slicer_url && !sortedPlates.some((p) => p.url === print.slicer_url)) {
    const filename = print.slicer_filename ?? "";
    out.push({ key: PREPARED_KEY, url: print.slicer_url, filename, launchFilename: filename, index: -1, plate: null });
  }
  sortedPlates.forEach((plate, index) => {
    const launchFilename =
      plate.url === print.slicer_url && print.slicer_filename ? print.slicer_filename : plate.filename;
    out.push({
      key: plate.id,
      url: plate.url,
      filename: plate.filename,
      launchFilename,
      index,
      plate,
      folder: plate.folder ?? null,
    });
  });
  return out;
}

/** Whether the copies the user's printers decide can be offered in `slicerId` yet: in a slicer that loads a printer's
 *  presets, once the printers are read, and not after a read that failed, which doesn't say there are none. */
export function printersKnownFor(slicerId: string, printers: { loaded: boolean; failed: boolean }): boolean {
  return !slicerProfile(slicerId)?.targetsPrinter || (printers.loaded && !printers.failed);
}

/** `bridged` are the slicers the user sends through the Bridge. */
export function slicerHref(slicerId: string, file: ModelFile, bridged: readonly string[]): string {
  return slicerLaunchUrl(slicerId, printsApi.slicerFileUrl(file.url), file.launchFilename, bridged);
}

/**
 * The copies `slicerId` gets of `files`, made for `remembered` where it's one of the user's printers the slicer has.
 * With none remembered, a file one of the user's printers would change is asked about first (`ask`).
 */
export function adaptedTargetsFor(
  files: ModelFile[],
  slicerId: string,
  bridged: readonly string[],
  printers: UserPrinter[],
  remembered: UserPrinter | null,
): AdaptedTarget[] {
  const profile = slicerProfile(slicerId);
  const rememberedChoice = remembered ? printerChoice(remembered, slicerId) : null;
  // With no printer remembered, one of the user's that the slicer has is asked for when it makes a difference.
  const askable =
    profile?.targetsPrinter && !rememberedChoice ? printers.filter((p) => printerChoice(p, slicerId)) : [];

  const targetFor = (file: ModelFile, plate: Plate, choice: PrinterChoice | null): AdaptedTarget | null => {
    const plan = planAdaptation(plate.format, profile, choice);
    if (!plan) return null;
    const printer = plan.output === "bambu" && plan.printer ? choice : null;
    const adaptedUrl = printsApi.adaptedPlateUrl(plate, slicerId, printer);
    const href = slicerLaunchUrl(slicerId, printsApi.slicerFileUrl(adaptedUrl), file.filename, bridged);
    return { ...file, key: `adapted-${file.key}`, launchFilename: file.filename, plan, printer, href };
  };

  return files.flatMap((file) => {
    const plate = file.plate;
    if (!plate || !isAdaptable3mf(file.filename)) return [];
    const withPrinter = (printer: UserPrinter): AdaptedTarget | SlicerTarget | null => {
      const choice = printerChoice(printer, slicerId);
      if (!choice) return null;
      // A project made for that very printer needs nothing changed for it: the file itself opens.
      return targetFor(file, plate, choice) ?? { ...file, href: slicerHref(slicerId, file, bridged) };
    };
    const asked = askable
      .map(withPrinter)
      .find((target): target is AdaptedTarget => Boolean(target && isAdaptedTarget(target) && target.printer));
    if (asked) return [{ ...asked, printer: null, href: "", ask: true, withPrinter }];
    const target = targetFor(file, plate, rememberedChoice);
    return target ? [target] : [];
  });
}

/** The installed slicers that can be launched, and the one to open with: the last one used. `bridged` are those sent
 *  through the Bridge. */
export function useSlicerChoice() {
  const { slicer, slicers, bridged } = useSlicerSettings();
  const slicerOptions = useMemo(
    () => SLICER_OPTIONS.filter((opt) => opt.id !== "other" && slicers.includes(opt.id)),
    [slicers],
  );
  const slicerOption = slicerOptions.find((opt) => opt.id === slicer) ?? slicerOptions[0] ?? null;
  return { slicerOption, slicerOptions, bridged };
}

/** `slicerOptions` are the installed slicers that can be launched, `slicerOption` the one the main button opens
 *  (the last one used), null without any. `targets` are empty when the model has nothing a slicer opens; with
 *  several, the caller offers a pick rather than opening the first. `adaptedTargets` are the files that slicer opens
 *  better as a copy made for it, read from what kind of 3MF each is. */
export function useOpenInSlicer(print: Print) {
  const { slicerOption, slicerOptions, bridged } = useSlicerChoice();
  const { unadapted, printers: slicerPrinters } = useSlicerSettings();
  const { printers, loaded: printersLoaded, failed: printersFailed, reload: reloadPrinters } = useUserPrinters();

  // A read that failed is tried again when the user comes back to the window (opening another page tries it too).
  useEffect(() => {
    if (!printersFailed) return;
    const retry = () => void reloadPrinters().catch(() => undefined);
    window.addEventListener("focus", retry);
    return () => window.removeEventListener("focus", retry);
  }, [printersFailed, reloadPrinters]);

  const files = useMemo(() => modelFiles(print), [print]);
  const canOpen = Boolean(print.slicer_url) && files.length > 0;

  const targets = useMemo<SlicerTarget[]>(
    () =>
      slicerOption && canOpen
        ? files.map((file) => ({ ...file, href: slicerHref(slicerOption.id, file, bridged) }))
        : [],
    [files, canOpen, slicerOption, bridged],
  );

  const adaptedTargets = useMemo<AdaptedTarget[]>(() => {
    if (!slicerOption || unadapted.includes(slicerOption.id)) return [];
    // A non-removable prepared print means the plates themselves are the sliced files.
    if (print.prepared_print && !print.prepared_print.removable) return [];
    // Until the user's printers are known, a copy for a slicer that loads a printer's presets isn't the one to offer.
    if (!printersKnownFor(slicerOption.id, { loaded: printersLoaded, failed: printersFailed })) return [];
    const remembered = printers.find((p) => p.printer.id === slicerPrinters[slicerOption.id]) ?? null;
    return adaptedTargetsFor(files, slicerOption.id, bridged, printers, remembered);
  }, [
    files,
    print.prepared_print,
    slicerOption,
    bridged,
    unadapted,
    slicerPrinters,
    printers,
    printersLoaded,
    printersFailed,
  ]);

  /** The adapted counterpart of `file`, if the current slicer opens it better as one. */
  const adaptedTargetFor = useCallback(
    (file: ModelFile | null) =>
      file ? adaptedTargets.find((target) => target.key === `adapted-${file.key}`) : undefined,
    [adaptedTargets],
  );

  return { slicerOption, slicerOptions, files, canOpen, targets, adaptedTargets, adaptedTargetFor };
}
