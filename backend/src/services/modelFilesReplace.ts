import { prisma } from "../db";
import { createLogger } from "../logger";
import { HttpError } from "../utils/fileUtils";
import { assetExists, galleryImageFile } from "./modelAssets";
import {
  deletePlateFiles,
  isGeneratorScript,
  keepGeneratorScripts,
  keepSupportingFiles,
  refreshAutoPreparedMetadata,
  withPlateBatch,
  type NewPlateInput,
} from "./printCreation";
import { removeMissingPrintFiles } from "./printFileService";
import { removePlatePictures } from "./printService";
import { afterLicenseChange } from "./licenseService";
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

/** Replaces every plate of the model with `inputs`, and drops the rows of its other files whose files are gone. Throws
 *  when the download holds nothing to print, before anything is removed, so a model is never left with less than it
 *  had -- and a replacement that fails halfway puts the plate rows back, since a model with no plates at all is one
 *  the scan passes over and could never offer a repair again. `stillBroken`, asked once the plates can't change under
 *  it, says whether the model still needs this; when it doesn't, nothing changes and the answer is null. */
export async function replaceModelPlates(
  userId: string,
  printId: string,
  inputs: NewPlateInput[],
  stillBroken: () => Promise<boolean> = async () => true,
): Promise<ReplacedPlates | null> {
  const print = await prisma.print.findFirst({
    where: { id: printId, userId },
    include: { previewImages: { select: { id: true } } },
  });
  if (!print) throw new HttpError(404, "Model not found");
  // A generator script is never a plate (see printCreation.createPrint): it goes beside the model instead, as does a
  // file the site gave beside its own.
  const supporting = inputs.filter((input) => input.supporting);
  const scripts = inputs.filter((input) => !input.supporting && isGeneratorScript(input.filename));
  const plateInputs = inputs.filter((input) => !input.supporting && !isGeneratorScript(input.filename));

  // With the plate order held, from the look at the files to the new plates, as an upload's are added: one an upload
  // adds in between would otherwise go with the old rows, seen or not.
  const swapped = await withPlateBatch(userId, printId, async (add) => {
    if (!(await stillBroken())) return null;
    if (!plateInputs.length) throw new HttpError(400, "The source gave nothing to print");
    const old = await prisma.plate.findMany({ where: { printId }, orderBy: { position: "asc" } });
    // Only the rows go before the download is in place, so the new files take the names and paths the model's own
    // had: adding walks around a name a plate still holds, and would bring every file back as "name (1)".
    await prisma.plate.deleteMany({ where: { printId } });
    try {
      return { old, plates: await add(plateInputs) };
    } catch (error) {
      // The rows go back pointing at the files that are gone, so the model is left exactly as broken as it was found
      // -- and found again by the next scan.
      await restorePlates(printId, old).catch((failure: unknown) =>
        log.error("couldn't put a model's plates back", { print: printId, error: failure }),
      );
      throw error;
    }
  });
  if (!swapped) return null;
  const { old, plates } = swapped;

  // The old plates' pictures go once the new files are stored, not before, so an attempt that threw halfway takes
  // nothing with it.
  const { assetsPath } = await prisma.print.findUniqueOrThrow({ where: { id: printId }, select: { assetsPath: true } });
  for (const plate of old) await removePlatePictures(plate.id, assetsPath);
  // The reading of plate 0 describes a plate that has gone: emptied here rather than left for the refresh below, which
  // would leave the old reading behind if it threw.
  await prisma.print.update({ where: { id: printId }, data: { preparedMetadata: Prisma.JsonNull } });
  // Of the other files, the rows whose files are gone go, whatever took them. A supporting file or prepared print
  // still on disk stays -- the owner's own among them, which no source can give back -- and a new plate whose name one
  // of them holds lands beside it rather than over it (printService's freePlatePath reads them too). The source's
  // scripts come back below where theirs went. Best-effort: the plates are in, so the scan won't offer this model again,
  // and the steps after it must still run; a row left behind is only one the next sweep takes.
  await removeMissingPrintFiles(printId).catch((error: unknown) =>
    log.error("couldn't sweep a repaired model's missing files", { print: printId, error }),
  );
  await keepGeneratorScripts(userId, printId, scripts);
  // Only those the model hasn't still got: a supporting file that went with the plates comes back from the site.
  await keepSupportingFiles(userId, printId, supporting);
  await refreshAutoPreparedMetadata(printId);
  // LICENSE.txt is written again when it went too.
  await afterLicenseChange(printId);

  const galleryWhole =
    print.previewImages.length > 0 &&
    print.previewImages.every((image) => assetExists(assetsPath, galleryImageFile(image.id)));
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
