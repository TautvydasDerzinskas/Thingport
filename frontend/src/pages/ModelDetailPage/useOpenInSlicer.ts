import { useMemo } from "react";
import { type Plate, type Print, printsApi } from "../../api/prints";
import { SLICER_OPTIONS } from "../../constants/settingsOptions";
import { useSlicerPreference } from "../../hooks/useSlicerPreference";
import { slicerLaunchUrl } from "../../utils/slicerLaunch";

/** One thing "Open in {Slicer}" can open: the attached prepared print, or one of the model's
 *  files (`plate` set). */
export type SlicerTarget = { key: string; href: string; filename: string; index: number; plate: Plate | null };

/** Everything "Open in {Slicer}" needs, shared by ModelSidePanel's button and ModelActionsMenu's
 *  item. `slicerOption` is null without a usable preference ("other" has no URL protocol to
 *  launch). With one target the caller links straight to it; with several (a model with multiple
 *  files, e.g. several MakerWorld print profiles, or a prepared print alongside the files) it
 *  offers a pick instead of silently opening the first. */
export function useOpenInSlicer(print: Print) {
  const slicerPreference = useSlicerPreference();
  const slicerOption = SLICER_OPTIONS.find(opt => opt.id === slicerPreference && opt.id !== "other") ?? null;

  const targets = useMemo<SlicerTarget[]>(() => {
    if (!slicerOption || !print.slicer_url) return [];
    const launch = (url: string, filename: string) => slicerLaunchUrl(slicerOption.id, printsApi.fileUrl(url), filename);
    const sortedPlates = print.plates.toSorted((a, b) => a.position - b.position);
    const out: SlicerTarget[] = [];
    // The backend's slicer_url is an attached prepared print, or else the first file -- which,
    // when that file is itself sliced, comes with a slicer_filename carrying the right suffix
    // (e.g. .gcode.3mf) for the slicer to treat it as such. Both are kept as-is here.
    const slicerUrlIsPlate = sortedPlates.some(p => p.url === print.slicer_url);
    if (!slicerUrlIsPlate) {
      const filename = print.slicer_filename ?? "";
      out.push({ key: "prepared", href: launch(print.slicer_url, filename), filename, index: -1, plate: null });
    }
    sortedPlates.forEach((plate, index) => {
      const filename = plate.url === print.slicer_url && print.slicer_filename ? print.slicer_filename : plate.filename;
      out.push({ key: plate.id, href: launch(plate.url, filename), filename: plate.filename, index, plate });
    });
    return out;
  }, [print.plates, print.slicer_url, print.slicer_filename, slicerOption]);

  return { slicerOption, targets };
}
