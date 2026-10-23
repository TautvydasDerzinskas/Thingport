import { useCallback, useMemo } from "react";
import { type Plate, type Print, printsApi } from "../../api/prints";
import { NORMALIZE_3MF_SLICER_IDS, SLICER_OPTIONS } from "../../constants/settingsOptions";
import { useSlicerSettings } from "../../hooks/useSlicerPreference";
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
};
export type SlicerTarget = ModelFile & { href: string };

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
    out.push({ key: "prepared", url: print.slicer_url, filename, launchFilename: filename, index: -1, plate: null });
  }
  sortedPlates.forEach((plate, index) => {
    const launchFilename =
      plate.url === print.slicer_url && print.slicer_filename ? print.slicer_filename : plate.filename;
    out.push({ key: plate.id, url: plate.url, filename: plate.filename, launchFilename, index, plate });
  });
  return out;
}

export function slicerHref(slicerId: string, file: ModelFile): string {
  return slicerLaunchUrl(slicerId, printsApi.slicerFileUrl(file.url), file.launchFilename);
}

/** `slicerOptions` are the installed slicers that can be launched, `slicerOption` the one the main button opens
 *  (the last one used), null without any. `targets` are empty when the model has nothing a slicer opens; with
 *  several, the caller offers a pick rather than opening the first. `normalizedTargets` is empty unless the
 *  slicer needs MakerWorld 3MFs converted. */
export function useOpenInSlicer(print: Print) {
  const { slicer, slicers } = useSlicerSettings();
  const slicerOptions = useMemo(
    () => SLICER_OPTIONS.filter((opt) => opt.id !== "other" && slicers.includes(opt.id)),
    [slicers],
  );
  const slicerOption = slicerOptions.find((opt) => opt.id === slicer) ?? slicerOptions[0] ?? null;

  const files = useMemo(() => modelFiles(print), [print]);
  const canOpen = Boolean(print.slicer_url) && files.length > 0;

  const targets = useMemo<SlicerTarget[]>(
    () => (slicerOption && canOpen ? files.map((file) => ({ ...file, href: slicerHref(slicerOption.id, file) })) : []),
    [files, canOpen, slicerOption],
  );

  const normalizedTargets = useMemo<SlicerTarget[]>(() => {
    if (!slicerOption || !NORMALIZE_3MF_SLICER_IDS.has(slicerOption.id) || print.source_provider !== "makerworld") {
      return [];
    }
    // A non-removable prepared print means the plates themselves are the sliced files.
    if (print.prepared_print && !print.prepared_print.removable) return [];
    return files
      .filter((file) => file.plate && isNormalizable3mf(file.filename))
      .map(({ key, url, filename, launchFilename, index, plate }) => ({
        key: `normalized-${key}`,
        url,
        filename,
        launchFilename,
        index,
        plate,
        href: slicerLaunchUrl(slicerOption.id, printsApi.slicerFileUrl(`${url}?normalize=1`), filename),
      }));
  }, [files, print.source_provider, print.prepared_print, slicerOption]);

  /** The normalized counterpart of `file`, if the current slicer offers one. */
  const normalizedTargetFor = useCallback(
    (file: ModelFile | null) =>
      file ? normalizedTargets.find((target) => target.key === `normalized-${file.key}`) : undefined,
    [normalizedTargets],
  );

  return { slicerOption, slicerOptions, files, canOpen, targets, normalizedTargets, normalizedTargetFor };
}
