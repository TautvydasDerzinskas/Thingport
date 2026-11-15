import type { SlicerProfile } from "./types";

// Takes `BambuStudio-` and `Snapmaker_Orca-` files as its own and, since 2.4, checks no version.
export const snapmakerOrca: SlicerProfile = {
  id: "snapmaker-orca",
  reads: "bambu",
  ownApps: ["BambuStudio", "Snapmaker_Orca"],
  dialect: "orca",
  targetsPrinter: true,
};
