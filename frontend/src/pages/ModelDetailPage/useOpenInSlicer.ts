import { useCallback, useMemo } from "react";
import { type Plate, type Print, printsApi } from "../../api/prints";
import { NORMALIZE_3MF_SLICER_IDS, SLICER_OPTIONS, normalizeTargetFor } from "../../constants/settingsOptions";
import { useSlicerSettings } from "../../hooks/useSlicerPreference";
import { slicerLaunchUrl } from "../../utils/slicerLaunch";
import { isProviderId, manifestOf } from "../../providers/index.generated";

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
};
/** `normalizeTarget` is set on "Open normalized" targets: which kind of copy the server prepares. */
export type SlicerTarget = ModelFile & { href: string; normalizeTarget?: "flat" | "orca" };

export const PREPARED_KEY = "prepared";

/** Key of a normalized target: includes the kind of copy, so "flat" and "orca" never share state. */
export function normalizedKey(normalizeTarget: "flat" | "orca" | undefined, fileKey: string): string {
  return `normalized-${normalizeTarget ?? "flat"}-${fileKey}`;
}

/** Sliced .gcode.3mf plates are never normalized: dropping their G-code would leave nothing to print. */
function isNormalizable3mf(filename: string): boolean {
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
    out.push({ key: plate.id, url: plate.url, filename: plate.filename, launchFilename, index, plate });
  });
  return out;
}

/** `bridged` are the slicers the user sends through the Bridge. */
export function slicerHref(slicerId: string, file: ModelFile, bridged: readonly string[]): string {
  return slicerLaunchUrl(slicerId, printsApi.slicerFileUrl(file.url), file.launchFilename, bridged);
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
 *  several, the caller offers a pick rather than opening the first. `normalizedTargets` is empty unless the
 *  slicer needs MakerWorld 3MFs converted. */
export function useOpenInSlicer(print: Print) {
  const { slicerOption, slicerOptions, bridged } = useSlicerChoice();

  const files = useMemo(() => modelFiles(print), [print]);
  const canOpen = Boolean(print.slicer_url) && files.length > 0;

  const targets = useMemo<SlicerTarget[]>(
    () =>
      slicerOption && canOpen
        ? files.map((file) => ({ ...file, href: slicerHref(slicerOption.id, file, bridged) }))
        : [],
    [files, canOpen, slicerOption, bridged],
  );

  /** The normalized copies `slicerId` would open: empty unless it needs MakerWorld 3MFs converted. Built for any
   *  slicer, not only the selected one, so the menu can offer "normalized" before the slicer was ever used. */
  const normalizedTargetsOf = useCallback(
    (slicerId: string): SlicerTarget[] => {
      const source = print.source_provider;
      const bambuProjects = !!source && isProviderId(source) && manifestOf(source).capabilities.bambuProjects;
      if (!NORMALIZE_3MF_SLICER_IDS.has(slicerId) || !bambuProjects) return [];
      // A non-removable prepared print means the plates themselves are the sliced files.
      if (print.prepared_print && !print.prepared_print.removable) return [];
      const normalizeTarget = normalizeTargetFor(slicerId);
      return files
        .filter((file) => file.plate && isNormalizable3mf(file.filename))
        .map(({ key, url, filename, launchFilename, index, plate }) => ({
          key: normalizedKey(normalizeTarget, key),
          url,
          filename,
          launchFilename,
          index,
          plate,
          normalizeTarget,
          href: slicerLaunchUrl(
            slicerId,
            printsApi.slicerFileUrl(`${url}?normalize=${normalizeTarget === "orca" ? "orca" : "1"}`),
            filename,
            bridged,
          ),
        }));
    },
    [files, print.source_provider, print.prepared_print, bridged],
  );

  const normalizedTargets = useMemo<SlicerTarget[]>(
    () => (slicerOption ? normalizedTargetsOf(slicerOption.id) : []),
    [slicerOption, normalizedTargetsOf],
  );

  return {
    slicerOption,
    slicerOptions,
    files,
    canOpen,
    targets,
    normalizedTargets,
    normalizedTargetsOf,
  };
}
