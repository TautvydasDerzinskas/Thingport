import { prisma } from "../db";
import { createLogger } from "../logger";
import { HttpError } from "../utils/fileUtils";
import { withStorageLock } from "../utils/storageLock";
import { assetExists, galleryImageFile } from "./modelAssets";
import {
  isGeneratorScript,
  keepGeneratorScripts,
  refreshAutoPreparedMetadata,
  restorePlates,
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
  /** Whether every picture the model had, of those it still has, is on disk, so the gallery needn't be fetched again. */
  galleryWhole: boolean;
  /** The pictures that was asked of, by id: the ones a gallery fetched again replaces. One added since is the owner's,
   *  and stays. */
  gallery: string[];
};

/** Replaces every plate of the model with `inputs`, and drops the rows of its other files whose files are gone. Throws
 *  when the download holds nothing to print, before anything is removed, so a model is never left with less than it
 *  had -- and a replacement that fails halfway puts the plate rows back, since a model with no plates at all is one
 *  the scan passes over and could never offer a repair again. `stillBroken`, asked with the plate order and the
 *  storage lock held, so neither an upload nor a move changes the plates under it, says whether the model still needs
 *  this; when it doesn't, nothing changes and the answer is null. */
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
  // A generator script is never a plate (see printCreation.createPrint): it goes beside the model instead.
  const scripts = inputs.filter((input) => isGeneratorScript(input.filename));
  const plateInputs = inputs.filter((input) => !isGeneratorScript(input.filename));

  // With the plate order held, from the look at the files to the new plates, as an upload's are added: one an upload
  // adds in between would otherwise go with the old rows, seen or not.
  const swapped = await withPlateBatch(userId, printId, async (add) => {
    // The look and the old rows' going are one step under the storage lock, which a move holds from renaming a file to
    // saving where it went: a plate whose file came back can't look gone for being on its way somewhere else. Let go
    // before the new plates, whose placing takes it.
    const old = await withStorageLock(async () => {
      if (!(await stillBroken())) return null;
      if (!plateInputs.length) throw new HttpError(400, "The source gave nothing to print");
      const rows = await prisma.plate.findMany({ where: { printId }, orderBy: { position: "asc" } });
      // Only the rows go before the download is in place, so the new files take the names and paths the model's own
      // had: adding walks around a name a plate still holds, and would bring every file back as "name (1)".
      await prisma.plate.deleteMany({ where: { printId } });
      return rows;
    });
    if (!old) return null;
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
  // nothing with it. Best-effort, as the sweep below: the plates are in, and the steps after must still run; a picture
  // left behind is only clutter.
  await prisma.print
    .findUniqueOrThrow({ where: { id: printId }, select: { assetsPath: true } })
    .then(async ({ assetsPath }) => {
      for (const plate of old) await removePlatePictures(plate.id, assetsPath);
    })
    .catch((error: unknown) =>
      log.error("couldn't remove a repaired model's old plate pictures", { print: printId, error }),
    );
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
  await refreshAutoPreparedMetadata(printId);
  // LICENSE.txt is written again when it went too.
  await afterLicenseChange(printId);

  // Looked for where the pictures are now, with the storage lock a move of them holds: where they were read from above,
  // a gallery a rename has just moved would look gone, and the owner's own photos be replaced for it. Of the pictures
  // read above, those still there: one the owner removed meanwhile has no file either, and would have the rest
  // replaced for it.
  const gallery = print.previewImages.map((image) => image.id);
  const galleryWhole = await withStorageLock(async () => {
    const now = await prisma.print.findUniqueOrThrow({
      where: { id: printId },
      select: { assetsPath: true, previewImages: { where: { id: { in: gallery } }, select: { id: true } } },
    });
    return (
      now.previewImages.length > 0 &&
      now.previewImages.every((image) => assetExists(now.assetsPath, galleryImageFile(image.id)))
    );
  });
  return { plates, galleryWhole, gallery };
}
