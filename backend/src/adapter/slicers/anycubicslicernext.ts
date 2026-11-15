import type { SlicerProfile } from "./types";

// Built on OrcaSlicer 2.3.1, it says "Newer 3mf version" for any `BambuStudio-` file past that. Its own tag check is
// broken, so its own files carry `BambuStudio-` too.
export const anycubicslicernext: SlicerProfile = {
  id: "anycubicslicernext",
  reads: "bambu",
  ownApps: ["BambuStudio"],
  quietUpTo: { BambuStudio: "2.3.1" },
  dialect: "orca",
  targetsPrinter: true,
};
