import type { SlicerProfile } from "./types";

// A Bambu project's settings and colours are lost on it; a 3MF without Slic3r_PE.config is added to the user's own
// setup without a question.
export const prusaslicer: SlicerProfile = {
  id: "prusaslicer",
  reads: "prusa",
  ownApps: ["PrusaSlicer"],
};
