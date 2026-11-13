import type { SlicerProfile } from "./types";

// QIDI Studio is Bambu Studio-based and writes its own Bambu-layout project and preset names.
export const qidistudio: SlicerProfile = {
  id: "qidistudio",
  reads: "bambu",
  ownApps: ["QIDIStudio"],
  dialect: "bambu",
  targetsPrinter: true,
};
