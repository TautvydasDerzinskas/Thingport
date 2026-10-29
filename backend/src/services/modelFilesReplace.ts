import { prisma } from "../db";
import { HttpError } from "../utils/fileUtils";
import { assetExists, galleryImageFile } from "./modelAssets";
import {
  addPlatesToPrint,
  isGeneratorScript,
  keepGeneratorScripts,
  refreshAutoPreparedMetadata,
  type NewPlateInput,
} from "./printCreation";
import { deleteAllPrintFiles } from "./printFileService";
import { removePlatePictures } from "./printService";
import type { Plate } from "@prisma/client";

// Swapping a model's files for freshly downloaded ones, for a model whose own are gone (see
// services/missingFilesService.ts). The rows that pointed at the missing files go and the new files take their
// place, so everything else about the model -- its name, tags, collections, favourite, counts -- is untouched.
//
// Only the files: the pictures are importService's to put back, since it is what fetches them.

export type ReplacedPlates = {
  plates: Plate[];
  /** Whether every picture the model has is still on disk, so the gallery needn't be fetched again. */
  galleryWhole: boolean;
};

/** Replaces every plate and supporting file of the model with `inputs`. Throws when the download holds nothing to
 *  print, before anything is removed, so a model is never left with less than it had. */
export async function replaceModelPlates(
  userId: string,
  printId: string,
  inputs: NewPlateInput[],
): Promise<ReplacedPlates> {
  const print = await prisma.print.findFirst({
    where: { id: printId, userId },
    include: { plates: { orderBy: { position: "asc" } }, previewImages: { select: { id: true } } },
  });
  if (!print) throw new HttpError(404, "Model not found");
  // A generator script is never a plate (see printCreation.createPrint): it goes beside the model instead.
  const scripts = inputs.filter((input) => isGeneratorScript(input.filename));
  const plateInputs = inputs.filter((input) => !isGeneratorScript(input.filename));
  if (!plateInputs.length) throw new HttpError(400, "The source gave nothing to print");

  // The prepared file is one of the supporting files about to go.
  if (print.preparedFileId) {
    await prisma.print.update({ where: { id: printId }, data: { preparedFile: { disconnect: true } } });
  }
  await deleteAllPrintFiles(printId);
  for (const plate of print.plates) await removePlatePictures(plate.id, print.assetsPath);
  await prisma.plate.deleteMany({ where: { printId } });

  const plates = await addPlatesToPrint(userId, printId, plateInputs);
  await keepGeneratorScripts(userId, printId, scripts);
  await refreshAutoPreparedMetadata(printId);

  const galleryWhole =
    print.previewImages.length > 0 &&
    print.previewImages.every((image) => assetExists(print.assetsPath, galleryImageFile(image.id)));
  return { plates, galleryWhole };
}
