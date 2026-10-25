// Slicers that mis-import Bambu Studio projects, mirroring the web app's NORMALIZE_3MF_SLICER_IDS
// (frontend/src/constants/settingsOptions.ts) with their labels. Keep in sync by hand.
export const NORMALIZE_3MF_SLICERS: Readonly<Record<string, string>> = {
  prusaslicer: "PrusaSlicer",
  cura: "Cura",
  anycubicslicernext: "Anycubic Slicer Next",
  crealityprintlink: "Creality Print",
  elegooslicer: "Elegoo Slicer",
  "snapmaker-orca": "Snapmaker Orca",
  eufystudio3d: "eufyMake Studio",
};
