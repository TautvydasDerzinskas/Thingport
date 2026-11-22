import { prisma } from "../db";
import { createLogger } from "../logger";
import { fileState } from "../modelFiles/storageFs";
import { HttpError } from "../utils/fileUtils";
import { withStorageLock } from "../utils/storageLock";
import { afterLicenseChange } from "./licenseService";
import { modelFilesMissing } from "./missingFilesService";
import { assetTarget, galleryImageFile, legacyAssetPath, type AssetFile, type AssetHome } from "./modelAssets";
import {
  addPlatesToPrint,
  deletePlateFiles,
  isGeneratorScript,
  keepGeneratorScripts,
  refreshAutoPreparedMetadata,
  type NewPlateInput,
} from "./printCreation";
import { lookAtPrintFiles, removeMissingPrintFiles } from "./printFileService";
import { removePlatePictures } from "./printService";
import { Prisma, type Plate } from "@prisma/client";

const log = createLogger("model-files");

// Swapping a model's files for freshly downloaded ones, for a model whose own are gone (see
// services/missingFilesService.ts). The rows that pointed at the missing files go and the new files take their
// place, so everything else about the model -- its name, tags, collections, favourite, counts, and the files it still
// has -- is untouched.
//
// Only the files: the pictures are importService's to put back, since it is what fetches them.

export type ReplacedPlates = {
  plates: Plate[];
  /** Whether every picture the model has is still on disk, so the gallery needn't be fetched again. */
  galleryWhole: boolean;
};

/** Whether the model still needs its files: none of its plates' files is there. Looked at in one storage-lock turn
 *  with every other file of the model, so a move can't carry one away under the look, and a disk that can't answer
 *  for any of them throws here, before the repair has removed anything. */
export function modelStillBroken(userId: string, printId: string): Promise<boolean> {
  return withStorageLock(async () => {
    const recorded = await prisma.plate.findMany({
      where: { printId, print: { userId } },
      select: { storagePath: true, sourcePath: true },
    });
    // A model with no plates at all has nothing to take away, so it is always worth the files.
    if (recorded.length > 0 && !(await modelFilesMissing(recorded))) return false;
    await lookAtPrintFiles(printId);
    return true;
  });
}

/** Replaces every plate of the model with `inputs`, and drops the rows of its other files that are gone too. Throws
 *  when the download holds nothing to print, before anything is removed, so a model is never left with less than it
 *  had -- and a replacement that fails halfway puts the plate rows back, since a model with no plates at all is one
 *  the scan passes over and could never offer a repair again. */
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

  // The old plates' pictures go once the new files are stored, not before, so an attempt that threw halfway takes
  // nothing with it.
  for (const plate of print.plates) await removePlatePictures(plate.id, print.assetsPath);
  // The reading of plate 0 describes a plate that has gone: emptied here rather than left for the refresh below, which
  // would leave the old reading behind if it threw. The prepared print keeps its place: its row goes below only when
  // its file went too, and the slot empties with it.
  await prisma.print.update({ where: { id: printId }, data: { preparedMetadata: Prisma.JsonNull } });
  // Of the other files, only those that are gone go. A supporting file, prepared print or LICENSE.txt still on disk
  // stays -- the owner's own among them, which no source can give back -- and a new plate whose name one of them holds
  // landed beside it rather than over it (printService's freePlatePath reads them too). Best-effort: the plates are in,
  // so the scan won't offer this model again, and the steps after it must still run.
  await removeMissingPrintFiles(printId).catch((error: unknown) =>
    log.error("couldn't sweep a repaired model's missing files", { print: printId, error }),
  );
  // After the sweep, so a script whose file went comes back, and one still there isn't stored twice.
  await keepGeneratorScripts(userId, printId, scripts);
  await refreshAutoPreparedMetadata(printId);
  // LICENSE.txt is written again when it went too.
  await afterLicenseChange(printId);

  // The pictures folder as it is now, read and looked at in one storage-lock turn: a folder move renames the pictures
  // and saves the new folder under the lock, so one read before the swap may have been left since.
  const whole = await withStorageLock(async () => {
    const now = await prisma.print.findUnique({ where: { id: printId }, select: { assetsPath: true } });
    return galleryWhole(printId, now?.assetsPath ?? null, print.previewImages);
  });
  return { plates, galleryWhole: whole };
}

/** Whether every picture of the gallery is on disk, in the model's folder or the old shared one. One the disk can't
 *  answer for counts as there: a gallery that isn't whole is replaced, the owner's own photos with it, and a photo that
 *  only couldn't be read may well be fine. */
async function galleryWhole(printId: string, home: AssetHome, images: { id: string }[]): Promise<boolean> {
  if (!images.length) return false;
  let whole = true;
  for (const image of images) {
    try {
      if (!(await pictureThere(home, galleryImageFile(image.id)))) whole = false;
    } catch (error) {
      log.warn("couldn't look at a repaired model's gallery, so it stays", { print: printId, image: image.id, error });
      return true;
    }
  }
  return whole;
}

async function pictureThere(home: AssetHome, file: AssetFile): Promise<boolean> {
  if (home && (await fileState(assetTarget(home, file), "repair.gallery")).state === "file") return true;
  return (await fileState(legacyAssetPath(file), "repair.gallery")).state === "file";
}

/** The plates as they were before a replacement that didn't finish: whatever it managed to store goes, files and
 *  all, and the rows taken down at the start take their place. Nothing else of the model's has been touched by
 *  then, so the plates are all there is to put back. */
async function restorePlates(printId: string, previous: Plate[]): Promise<void> {
  const half = await prisma.plate.findMany({ where: { printId } });
  for (const plate of half) await deletePlateFiles(plate);
  await prisma.plate.deleteMany({ where: { printId } });
  await prisma.plate.createMany({
    // The printability check, the profile and the format are nullable Json, which Prisma writes with a null of its own
    // (providers/connections).
    data: previous.map((plate) => ({
      ...plate,
      qualityCheck: plate.qualityCheck === null ? Prisma.DbNull : (plate.qualityCheck as Prisma.InputJsonValue),
      profile: plate.profile === null ? Prisma.DbNull : (plate.profile as Prisma.InputJsonValue),
      format: plate.format === null ? Prisma.DbNull : (plate.format as Prisma.InputJsonValue),
    })),
  });
}
