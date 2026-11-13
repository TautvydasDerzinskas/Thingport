// GENERATED from backend/src/adapter/slicers/qidistudio.ts by scripts/sync-adapter.mjs. Don't edit it here:
// change backend/src/adapter/ and run npm run adapter:sync.
import type { SlicerProfile } from "./types.generated";

// QIDI Studio is Bambu Studio-based and writes its own Bambu-layout project and preset names.
export const qidistudio: SlicerProfile = {
  id: "qidistudio",
  reads: "bambu",
  ownApps: ["QIDIStudio"],
  dialect: "bambu",
  targetsPrinter: true,
};
