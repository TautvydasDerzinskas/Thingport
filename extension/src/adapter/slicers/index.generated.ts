// GENERATED from backend/src/adapter/slicers/index.ts by scripts/sync-adapter.mjs. Don't edit it here:
// change backend/src/adapter/ and run npm run adapter:sync.
import { anycubicslicernext } from "./anycubicslicernext.generated";
import { bambustudio } from "./bambustudio.generated";
import { crealityprint } from "./crealityprint.generated";
import { cura } from "./cura.generated";
import { elegooslicer } from "./elegooslicer.generated";
import { eufystudio3d } from "./eufystudio3d.generated";
import { orcaslicer } from "./orcaslicer.generated";
import { prusaslicer } from "./prusaslicer.generated";
import { qidistudio } from "./qidistudio.generated";
import { snapmakerOrca } from "./snapmakerOrca.generated";
import type { SlicerProfile } from "./types.generated";

export type { SlicerProfile } from "./types.generated";

/** Every slicer a copy can be made for, by Thingport's slicer id. */
export const SLICER_PROFILES: Readonly<Record<string, SlicerProfile>> = Object.fromEntries(
  [
    bambustudio,
    qidistudio,
    orcaslicer,
    prusaslicer,
    cura,
    crealityprint,
    anycubicslicernext,
    elegooslicer,
    snapmakerOrca,
    eufystudio3d,
  ].map((profile) => [profile.id, profile]),
);

/** The slicer's profile; null for one the adapter doesn't know, "constructor" and the like included. */
export function slicerProfile(id: string | null | undefined): SlicerProfile | null {
  return id && Object.hasOwn(SLICER_PROFILES, id) ? SLICER_PROFILES[id] : null;
}
