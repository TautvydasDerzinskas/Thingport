import { prisma } from "../db";
import { createLogger } from "../logger";
import { HttpError } from "../utils/fileUtils";
import { assetExists, galleryImageFile } from "./modelAssets";
import {
  addPlatesToPrint,
  deletePlateFiles,
  isGeneratorScript,
  keepGeneratorScripts,
  refreshAutoPreparedMetadata,
  type NewPlateInput,
} from "./printCreation";
import { deleteAllPrintFiles } from "./printFileService";
import { removePlatePictures } from "./printService";
import { Prisma, type Plate } from "@prisma/client";

const log = createLogger("model-files");

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
 *  print, before anything is removed, so a model is never left with less than it had -- and a replacement that
 *  fails halfway puts the plate rows back, since a model with no plates at all is one the scan passes over and
 *  could never offer a repair again. */
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

  // Only the rows go before the download is in place, so the new files take the names and paths the model's own
  // had: addPlatesToPrint walks around a name a plate still holds, and would bring every file back as "name (1)".
  await prisma.plate.deleteMany({ where: { printId } });

  let plates: Plate[];
  try {
    plates = await addPlatesToPrint(userId, printId, plateInputs);
  } catch (error) {
    // The rows go back pointing at the files that are gone, so the model is left exactly as broken as it was found
    // -- and found again by the next scan.
    await restorePlates(printId, print.plates).catch((failure: unknown) =>
      log.error("couldn't put a model's plates back", { print: printId, error: failure }),
    );
    throw error;
  }

  // Everything else the model had goes once the new files are stored, not before: a model can have lost its plate
  // files alone and still hold its supporting files and its old plates' pictures, which an attempt that threw
  // halfway would otherwise have taken with it for nothing. A new plate whose name one of those files holds lands
  // beside it rather than over it (printService's freePlatePath reads them too).
  for (const plate of print.plates) await removePlatePictures(plate.id, print.assetsPath);
  // The prepared file is one of the supporting files about to go, and its metadata describes plates that have gone
  // too: emptied here rather than left for the refresh below, which would leave the old reading behind if it threw.
  await prisma.print.update({
    where: { id: printId },
    data: {
      preparedMetadata: Prisma.JsonNull,
      ...(print.preparedFileId ? { preparedFile: { disconnect: true } } : {}),
    },
  });
  await deleteAllPrintFiles(printId);
  await keepGeneratorScripts(userId, printId, scripts);
  await refreshAutoPreparedMetadata(printId);

  const galleryWhole =
    print.previewImages.length > 0 &&
    print.previewImages.every((image) => assetExists(print.assetsPath, galleryImageFile(image.id)));
  return { plates, galleryWhole };
}

/** The plates as they were before a replacement that didn't finish: whatever it managed to store goes, files and
 *  all, and the rows taken down at the start take their place. Nothing else of the model's has been touched by
 *  then, so the plates are all there is to put back. */
async function restorePlates(printId: string, previous: Plate[]): Promise<void> {
  const half = await prisma.plate.findMany({ where: { printId } });
  for (const plate of half) await deletePlateFiles(plate);
  await prisma.plate.deleteMany({ where: { printId } });
  await prisma.plate.createMany({
    // The printability check is nullable Json, which Prisma writes with a null of its own (providers/connections).
    data: previous.map((plate) => ({
      ...plate,
      qualityCheck: plate.qualityCheck === null ? Prisma.DbNull : (plate.qualityCheck as Prisma.InputJsonValue),
    })),
  });
}
