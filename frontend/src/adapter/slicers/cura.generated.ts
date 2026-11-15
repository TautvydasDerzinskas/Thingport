// GENERATED from backend/src/adapter/slicers/cura.ts by scripts/sync-adapter.mjs. Don't edit it here:
// change backend/src/adapter/ and run npm run adapter:sync.
import type { SlicerProfile } from "./types.generated";

// Takes a multi-part object's first part only, and no colours or settings, from a Bambu project.
export const cura: SlicerProfile = {
  id: "cura",
  reads: "cura",
  ownApps: ["Cura", "UltiMaker Cura"],
};
