import type { SlicerProfile } from "./types";

// Loads a project's settings only from a file tagged `BambuStudio-`; Orca 2.5 writes that tag too.
export const bambustudio: SlicerProfile = {
  id: "bambustudio",
  reads: "bambu",
  ownApps: ["BambuStudio"],
  dialect: "bambu",
  targetsPrinter: true,
};
