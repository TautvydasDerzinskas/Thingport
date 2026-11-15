import type { SlicerProfile } from "./types";

// Takes a multi-part object's first part only, and no colours or settings, from a Bambu project.
export const cura: SlicerProfile = {
  id: "cura",
  reads: "cura",
  ownApps: ["Cura", "UltiMaker Cura"],
};
