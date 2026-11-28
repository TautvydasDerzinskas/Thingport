import type { ThreeMfRules } from "../../services/threeMfCheck/types";

// What MakerWorld takes as a print profile's 3MF. It slices each plate with Bambu Studio's command line on upload and
// turns down a plate that fails: -101 for objects or the wipe tower printing into each other, -104 for anything
// past the bed, -100 for anything else; its command line stops dead on a project naming no nozzle. The profile is a
// Bambu Studio project for a Bambu Lab printer on Bambu's own printer preset, whose nozzle variant the draft names the
// printer by.
export const makerworldThreeMfRules: ThreeMfRules = {
  slicer: "bambustudio",
  brand: "bambulab",
  checks: ["sliced", "project", "nozzle", "overlapping-objects", "wipe-tower", "off-bed"],
};
