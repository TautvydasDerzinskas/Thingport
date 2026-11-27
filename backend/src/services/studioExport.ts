import JSZip from "jszip";
import { slicerProfile } from "../adapter";
import { normalizeFileName } from "../files/names";
import { printerSummary } from "../printers/catalogue";
import { printerTarget } from "../printers/targets";
import {
  exportablePlates,
  hiddenPlates,
  profileOf,
  profileSettings,
  studioPlates,
  studioProfileName,
  studioProfiles,
} from "../studio/document.generated";
import { centeredPrinterOutline } from "../studio/printLayout.generated";
import { HttpError } from "../utils/fileUtils";
import { exportStudioGeometry } from "./studioInspect";
import { studioAssetDir, withStudioSourcePlates, type StudioDesignOut } from "./studioService";
import type { StudioExportTarget } from "./studioThreeMf";
import type { StudioExportFormat } from "./studioWorker";

export type StudioExportOptions = {
  format: StudioExportFormat;
  plate?: string;
  profile?: string;
  slicer?: string;
  printer?: { id: string; nozzle: string };
  /** The plate whose picture is the 3MF's thumbnail. */
  thumbnailPlate?: string;
};

type StudioExportFile = {
  bytes: Uint8Array;
  format: "stl" | "3mf" | "zip";
  mime: string;
};

export function studioExportFilename(name: string, extension: StudioExportFile["format"]) {
  return normalizeFileName(`${name}.${extension}`).replace(/[:*?"<>|]+/g, "-");
}

function emptyExport(): never {
  throw new HttpError(400, "There's nothing to export: no visible printable body", "studio_save_empty");
}

export async function exportStudioDesign(
  userId: string,
  design: StudioDesignOut,
  options: StudioExportOptions,
): Promise<StudioExportFile> {
  const { document } = design;
  const plate = options.plate ? studioPlates(document).find((entry) => entry.id === options.plate) : undefined;
  if (options.plate && !plate) throw new HttpError(400, "That plate doesn't belong to this design.");
  if (options.format === "stl" && !plate) throw new HttpError(400, "Choose a plate to export as STL.");
  if (options.format === "stl-zip" && (plate || options.profile))
    throw new HttpError(400, "STL ZIP exports the whole design.");
  if ((options.format === "stl" || options.format === "stl-zip") && options.slicer)
    throw new HttpError(400, "Export as 3MF for a slicer preset.");

  const profiles = studioProfiles(document);
  const selectedId = options.profile ?? (plate && profileOf(plate));
  const selected = selectedId && profiles.find((profile) => profile.id === selectedId);
  if (selectedId && (!selected || (plate && profileOf(plate) !== selectedId)))
    throw new HttpError(400, "That profile doesn't match the requested export.");
  if (selected && selected.hidden) emptyExport();

  const eligible = plate ? [plate] : exportablePlates(document);
  const platesByProfile = new Map<string, string[]>();
  for (const entry of eligible) {
    const id = profileOf(entry);
    if (selectedId && id !== selectedId) continue;
    const ids = platesByProfile.get(id);
    if (ids) ids.push(entry.id);
    else platesByProfile.set(id, [entry.id]);
  }
  if (!platesByProfile.size) emptyExport();

  const slicer = options.slicer ? slicerProfile(options.slicer) : null;
  if (options.slicer && !slicer) throw new HttpError(400, "That slicer isn't supported.");
  if (slicer && platesByProfile.size > 1) throw new HttpError(400, "Choose a profile to open with this slicer.");
  if (
    slicer &&
    slicer.reads !== "bambu" &&
    eligible.filter((entry) => platesByProfile.has(profileOf(entry))).length > 1
  )
    throw new HttpError(400, "Choose a plate to open with this slicer.");

  const write = async (ids: string[], format: StudioExportFormat, profileId?: string): Promise<StudioExportFile> => {
    let target: StudioExportTarget | undefined;
    const saved = format === "3mf" ? profileSettings(document, profileId).print_profile : undefined;
    const savedSlicer = saved?.slicer ? slicerProfile(saved.slicer) : null;
    const targetSlicer = slicer ?? (savedSlicer?.reads === "bambu" ? savedSlicer : null);
    if (targetSlicer) {
      const choice = slicer ? options.printer : saved?.printer;
      const matched =
        choice && targetSlicer.targetsPrinter ? printerTarget(targetSlicer.id, choice.id, choice.nozzle) : null;
      const printer = matched?.choice.nozzle === choice?.nozzle ? matched : null;
      if (options.printer && !printer)
        throw new HttpError(400, "This slicer has no preset for that printer and nozzle.");
      const bed = printer && printerSummary(printer.choice.id)?.bed;
      target = {
        slicer: targetSlicer.id,
        ...(printer ? { printer: { ...printer, outline: bed ? centeredPrinterOutline(bed) : undefined } } : {}),
      };
    }
    const made = await withStudioSourcePlates(userId, design, ids, (ready) =>
      exportStudioGeometry({
        document: ready,
        assetDir: studioAssetDir(userId, design.id),
        name: design.name,
        format: target ? "3mf" : format,
        plateIds: ids,
        profileId,
        target,
        thumbnailPlate: options.thumbnailPlate,
      }),
    );
    if (made.status === "too-complex")
      throw new HttpError(
        422,
        `The design is too heavy to export (about ${made.triangles} triangles)`,
        "studio_too_complex",
      );
    if (made.status === "refused") throw new HttpError(422, made.reason, "studio_export_refused");
    if (made.status === "empty") emptyExport();
    if (made.status !== "exported") {
      console.error("[studio] design export failed", made);
      throw new HttpError(500, "Couldn't export the Studio design", "studio_save_failed");
    }
    const mime = { stl: "model/stl", "3mf": "model/3mf", zip: "application/zip" }[made.format];
    return { bytes: made.bytes, format: made.format, mime };
  };

  if (options.format === "stl-zip") {
    const hidden = hiddenPlates(document);
    return write(
      studioPlates(document)
        .filter((entry) => !hidden.has(entry.id))
        .map((entry) => entry.id),
      "stl-zip",
    );
  }
  const included = profiles.filter(({ id }) => platesByProfile.has(id));
  if (included.length === 1) {
    const { id } = included[0];
    const format = options.format === "auto" && (document.profiles || document.print_profile) ? "3mf" : options.format;
    return write(platesByProfile.get(id)!, format, id);
  }
  const zip = new JSZip();
  for (const [index, profile] of included.entries()) {
    const file = await write(platesByProfile.get(profile.id)!, "3mf", profile.id);
    zip.file(studioExportFilename(`${index + 1} - ${studioProfileName(profile)}`, "3mf"), file.bytes);
  }
  return { bytes: await zip.generateAsync({ type: "uint8array" }), format: "zip", mime: "application/zip" };
}
