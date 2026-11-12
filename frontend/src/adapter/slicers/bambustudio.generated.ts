// GENERATED from backend/src/adapter/slicers/bambustudio.ts by scripts/sync-adapter.mjs. Don't edit it here:
// change backend/src/adapter/ and run npm run adapter:sync.
import type { SlicerProfile } from "./types.generated";

// Loads a project's settings only from a file tagged `BambuStudio-`; Orca 2.5 writes that tag too.
export const bambustudio: SlicerProfile = {
  id: "bambustudio",
  reads: "bambu",
  ownApps: ["BambuStudio"],
  dialect: "bambu",
  targetsPrinter: true,
};
