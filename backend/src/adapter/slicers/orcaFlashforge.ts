import type { SlicerProfile } from "./types";

// Flash Studio, Flashforge's slicer (FlashForge/Orca-Flashforge), built on OrcaSlicer 2.3.2. It takes `BambuStudio-`
// and `OrcaSlicer-` files, and any file with an `OrcaSlicer` tag, as its own, and says "Newer 3MF version" for one
// past its 2.3.2: by the tag where there is one, else by the `BambuStudio-` version. Its own files carry
// `BambuStudio-01.10.01.50` and the tag 2.3.2. It has presets for Flashforge's printers only.
export const orcaFlashforge: SlicerProfile = {
  id: "orca-flashforge",
  reads: "bambu",
  ownApps: ["BambuStudio", "OrcaSlicer"],
  ownWithOrcaTag: true,
  quietUpTo: { BambuStudio: "2.3.2", OrcaSlicer: "2.3.2" },
  orcaTagQuietUpTo: "2.3.2",
  dialect: "orca",
  targetsPrinter: true,
};
