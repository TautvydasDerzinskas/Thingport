import type { SlicerProfile } from "./types";

// Opens a `BambuStudio-` file newer than 2.3.2, or one with an `OrcaSlicer` tag newer than 2.4.2, with a dialog that
// its settings may differ, every time.
export const elegooslicer: SlicerProfile = {
  id: "elegooslicer",
  reads: "bambu",
  ownApps: ["BambuStudio", "OrcaSlicer", "ElegooSlicer"],
  ownWithOrcaTag: true,
  quietUpTo: { BambuStudio: "2.3.2" },
  orcaTagQuietUpTo: "2.4.2",
  dialect: "orca",
  targetsPrinter: true,
};
