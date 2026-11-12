// GENERATED from backend/src/adapter/slicers/snapmakerOrca.ts by scripts/sync-adapter.mjs. Don't edit it here:
// change backend/src/adapter/ and run npm run adapter:sync.
import type { SlicerProfile } from "./types.generated";

// Takes `BambuStudio-` and `Snapmaker_Orca-` files as its own and, since 2.4, checks no version.
export const snapmakerOrca: SlicerProfile = {
  id: "snapmaker-orca",
  reads: "bambu",
  ownApps: ["BambuStudio", "Snapmaker_Orca"],
  dialect: "orca",
  targetsPrinter: true,
};
