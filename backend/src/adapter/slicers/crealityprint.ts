import type { SlicerProfile } from "./types";

// Reads another maker's project in full but first asks which of its printers to use, keeping the designer's process
// changes and filament colours on that printer's presets.
export const crealityprint: SlicerProfile = {
  id: "crealityprintlink",
  reads: "bambu",
  ownApps: ["Creality_Print"],
  dialect: "orca",
  asksForPrinter: true,
};
