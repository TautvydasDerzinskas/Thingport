// GENERATED from backend/src/adapter/slicers/qidistudio.ts by scripts/sync-adapter.mjs. Don't edit it here:
// change backend/src/adapter/ and run npm run adapter:sync.
import type { SlicerProfile } from "./types.generated";

// Built on Bambu Studio, it takes a `QIDIStudio-` file as its own. Since 2.4 it opens a `BambuStudio-` one with the
// designer's settings but on the printer selected in it, and any other app's without its settings. So a copy for the
// user's printer carries its own tag, and opens on the presets it names.
export const qidistudio: SlicerProfile = {
  id: "qidistudio",
  reads: "bambu",
  ownApps: ["QIDIStudio", "BambuStudio"],
  ownTag: "QIDIStudio-02.01.00.00",
  dialect: "bambu",
  targetsPrinter: true,
};
