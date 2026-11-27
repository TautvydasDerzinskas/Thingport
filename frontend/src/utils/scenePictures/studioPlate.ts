import { exportablePlates, exportableProfiles, profileOfPlate, type StudioDocument } from "../../studio/document";

/** Where a plate of a design saved as a new model ends up, as Save to Thingport writes it (backend studioLibrary):
 *  which of the model's files (one 3MF per profile, in profile order) and the plate's number in that 3MF. Null for a
 *  plate the save leaves out. */
export function savedPlateLocation(doc: StudioDocument, plateId: string): { file: number; plate: number } | null {
  const profile = profileOfPlate(doc, plateId);
  const file = exportableProfiles(doc).findIndex((entry) => entry.id === profile);
  const plate = exportablePlates(doc)
    .filter((entry) => profileOfPlate(doc, entry.id) === profile)
    .findIndex((entry) => entry.id === plateId);
  return file < 0 || plate < 0 ? null : { file, plate: plate + 1 };
}
