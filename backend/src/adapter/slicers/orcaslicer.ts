import type { SlicerProfile } from "./types";

// Reads `BambuStudio-` and `OrcaSlicer-` files, and any file with an `OrcaSlicer` tag (Elegoo Slicer's), as its own,
// with no version check.
export const orcaslicer: SlicerProfile = {
  id: "orcaslicer",
  reads: "bambu",
  ownApps: ["BambuStudio", "OrcaSlicer"],
  ownWithOrcaTag: true,
  dialect: "orca",
  targetsPrinter: true,
};
