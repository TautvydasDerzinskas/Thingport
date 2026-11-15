// GENERATED from backend/src/adapter/slicers/prusaslicer.ts by scripts/sync-adapter.mjs. Don't edit it here:
// change backend/src/adapter/ and run npm run adapter:sync.
import type { SlicerProfile } from "./types.generated";

// A Bambu project's settings and colours are lost on it; a 3MF without Slic3r_PE.config is added to the user's own
// setup without a question.
export const prusaslicer: SlicerProfile = {
  id: "prusaslicer",
  reads: "prusa",
  ownApps: ["PrusaSlicer"],
};
