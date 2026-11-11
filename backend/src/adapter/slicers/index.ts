import { anycubicslicernext } from "./anycubicslicernext";
import { bambustudio } from "./bambustudio";
import { crealityprint } from "./crealityprint";
import { cura } from "./cura";
import { elegooslicer } from "./elegooslicer";
import { eufystudio3d } from "./eufystudio3d";
import { orcaslicer } from "./orcaslicer";
import { prusaslicer } from "./prusaslicer";
import { snapmakerOrca } from "./snapmakerOrca";
import type { SlicerProfile } from "./types";

export type { SlicerProfile } from "./types";

/** Every slicer a copy can be made for, by Thingport's slicer id. */
export const SLICER_PROFILES: Readonly<Record<string, SlicerProfile>> = Object.fromEntries(
  [
    bambustudio,
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

export function slicerProfile(id: string | null | undefined): SlicerProfile | null {
  return (id && SLICER_PROFILES[id]) || null;
}
