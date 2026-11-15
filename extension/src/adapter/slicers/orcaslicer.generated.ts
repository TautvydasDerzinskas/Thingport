// GENERATED from backend/src/adapter/slicers/orcaslicer.ts by scripts/sync-adapter.mjs. Don't edit it here:
// change backend/src/adapter/ and run npm run adapter:sync.
import type { SlicerProfile } from "./types.generated";

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
