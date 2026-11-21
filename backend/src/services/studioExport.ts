import { slicerProfile } from "../adapter";
import { printerSummary } from "../printers/catalogue";
import { printerTarget } from "../printers/targets";
import { isBody, plateOf, studioPlates, topLevel } from "../studio/document.generated";
import { centeredPrinterOutline } from "../studio/printLayout.generated";
import { HttpError } from "../utils/fileUtils";
import { exportStudioGeometry } from "./studioInspect";
import { studioAssetDir, withStudioSourcePlates, type StudioDesignOut } from "./studioService";
import type { StudioExportTarget } from "./studioThreeMf";

export type StudioExportOptions = {
  format: "auto" | "3mf";
  plate?: string;
  slicer?: string;
  printer?: { id: string; nozzle: string };
};

export async function exportStudioDesign(userId: string, design: StudioDesignOut, options: StudioExportOptions) {
  const { document } = design;
  const plates = studioPlates(document);
  if (options.plate && !plates.some((plate) => plate.id === options.plate))
    throw new HttpError(400, "That plate doesn't belong to this design.");
  const profile = options.slicer ? slicerProfile(options.slicer) : null;
  if (options.slicer && !profile) throw new HttpError(400, "That slicer isn't supported.");
  if (profile && profile.reads !== "bambu" && !options.plate) {
    const occupiedPlates = new Set(
      topLevel(document)
        .filter((feature) => isBody(feature) && feature.visible)
        .map(plateOf),
    );
    for (const plate of plates) if (plate.source) occupiedPlates.add(plate.id);
    if (occupiedPlates.size > 1) throw new HttpError(400, "Choose a plate to open with this slicer.");
  }
  let target: StudioExportTarget | undefined;
  if (profile) {
    const printer =
      options.printer && profile.targetsPrinter
        ? printerTarget(profile.id, options.printer.id, options.printer.nozzle)
        : null;
    if (options.printer && printer?.choice.nozzle !== options.printer.nozzle)
      throw new HttpError(400, "This slicer has no preset for that printer and nozzle.");
    const bed = printer && printerSummary(printer.choice.id)?.bed;
    target = {
      slicer: profile.id,
      ...(printer ? { printer: { ...printer, outline: bed ? centeredPrinterOutline(bed) : undefined } } : {}),
      ...(profile.reads === "bambu" ? { filamentSlots: document.filament_slots } : {}),
    };
  }
  const made = await withStudioSourcePlates(userId, design, options.plate, (ready) =>
    exportStudioGeometry({
      document: ready,
      assetDir: studioAssetDir(userId, design.id),
      name: design.name,
      format: target ? "3mf" : options.format,
      plate: options.plate,
      target,
    }),
  );
  if (made.status === "too-complex")
    throw new HttpError(
      422,
      `The design is too heavy to export (about ${made.triangles} triangles)`,
      "studio_too_complex",
    );
  if (made.status === "refused") throw new HttpError(422, made.reason, "studio_export_refused");
  if (made.status === "empty")
    throw new HttpError(400, "There's nothing to export: no visible printable body", "studio_save_empty");
  if (made.status !== "exported") {
    console.error("[studio] design export failed", made);
    throw new HttpError(500, "Couldn't export the Studio design", "studio_save_failed");
  }
  return {
    bytes: made.bytes,
    format: made.format,
    mime: made.format === "3mf" ? "model/3mf" : "model/stl",
  };
}
