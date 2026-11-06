import type { Plate, Print } from "../../api/prints";
import { MODEL_EXTS } from "../../constants/fileTypes";
import { extOf } from "../../utils/fileExtensions";
import { defaultFile, type ModelFile } from "./useOpenInSlicer";

/** The file the side panel's actions apply to: the one picked, else the source's default, else the first. */
export function selectedModelFile<T extends ModelFile>(files: T[], selectedKey: string | null): T | null {
  return files.find((file) => file.key === selectedKey) ?? defaultFile(files);
}

/**
 * The plates the detail page's large preview works from. `selectedPlate` is the selected file's plate, null for the
 * prepared print, which has none. `plate3d` is the plate the 3D preview opens with: the selected one when it is a
 * 3D file, else the model's first plate when that is one, else null (no 3D preview to offer).
 */
export function mainPreviewPlates(
  print: Print,
  files: ModelFile[],
  selectedKey: string | null,
): { selectedPlate: Plate | null; plate3d: Plate | null } {
  const selectedPlate = selectedModelFile(files, selectedKey)?.plate ?? null;
  const plate3d =
    [selectedPlate, print.plates[0] ?? null].find((plate) => plate && MODEL_EXTS.has(extOf(plate.filename))) ?? null;
  return { selectedPlate, plate3d };
}
