import fs from "node:fs/promises";
import { prisma } from "../db";
import { createLogger } from "../logger";
import { sleep } from "../utils/concurrency";
import { HttpError } from "../utils/fileUtils";
import { withStorageLock } from "../utils/storageLock";
import { type AssetHome, assetTarget, galleryImageFile, legacyAssetPath } from "./modelAssets";
import {
  isGeneratorScript,
  keepGeneratorScripts,
  refreshPreparedReading,
  restorePlates,
  withPlateBatch,
  withPlateOrder,
  type NewPlateInput,
} from "./printCreation";
import { removeMissingPrintFiles } from "./printFileService";
import { managedPlatePath, removePlatePictures } from "./printService";
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
 *  had -- and a replacement that fails halfway puts the plate rows back (putPlatesBack), since a model with no plates
 *  at all is one the scan passes over and could never offer a repair again. `stillBroken`, asked with the plate order
 *  and the storage lock held, so neither an upload nor a move changes the plates under it, says whether the model
 *  still needs this; when it doesn't, nothing changes and the answer is null. */
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
  const swapped = await withPlateBatch(userId, printId, async (add, added) => {
    // The look and the old rows' going are one step under the storage lock, which a move holds from renaming a file to
    // saving where it went: a plate whose file came back can't look gone for being on its way somewhere else. Let go
    // before the new plates, whose placing takes it.
    const old = await withStorageLock(async () => {
      if (!(await stillBroken())) return null;
      if (!plateInputs.length) throw new HttpError(400, "The source gave nothing to print");
      const rows = await prisma.plate.findMany({ where: { printId }, orderBy: { position: "asc" } });
      // The first plate's reading, which only a change to the plates writes, with the plate order held from here on.
      const { preparedMetadata } = await prisma.print.findUniqueOrThrow({
        where: { id: printId },
        select: { preparedMetadata: true },
      });
      // Only the rows go before the download is in place, so the new files take the names and paths the model's own
      // had: adding walks around a name a plate still holds, and would bring every file back as "name (1)".
      await prisma.plate.deleteMany({ where: { printId } });
      return { rows, reading: preparedMetadata };
    });
    if (!old) return null;
    let plates: Plate[];
    try {
      plates = await add(plateInputs);
      // The new first plate's reading, saved before the plate order goes, as a reorder saves it: a merge reads it to
      // decide whether this model takes another's prepared print, and would otherwise go by the old first plate's.
      await refreshPreparedReading(printId);
    } catch (error) {
      // The rows go back pointing at the files that are gone, so the model is left exactly as broken as it was found
      // -- and found again by the next scan -- and its reading with them, in one transaction: a refresh that failed
      // may have saved the new first plate's all the same. Not when they can't go back, as the model then keeps plates
      // the repair made, and the reading that goes with them.
      await putPlatesBack(printId, old.rows, added, old.reading);
      throw error;
    }
    // Of the other files, the rows whose files are gone go, whatever took them, before the plate order goes too: a
    // prepared print whose file is gone stands in a merge's way as the old reading would. A supporting file or prepared
    // print still on disk stays -- the owner's own among them, which no source can give back -- and a new plate whose
    // name one of them holds landed beside it rather than over it (printService's freePlatePath reads them too).
    // The source's scripts come back below where theirs went. Best-effort: the plates are in, so the scan won't offer
    // this model again, and the steps after it must still run; a row left behind is only one the next sweep takes.
    await removeMissingPrintFiles(printId).catch((error: unknown) =>
      log.error("couldn't sweep a repaired model's missing files", { print: printId, error }),
    );
    return { old: old.rows, plates };
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
  await keepGeneratorScripts(userId, printId, scripts);
  // LICENSE.txt is written again when it went too.
  await afterLicenseChange(printId);

  // Looked for where the pictures are now, with the storage lock a move of them holds: where they were read from above,
  // a gallery a rename has just moved would look gone, and the owner's own photos be replaced for it. Of the pictures
  // read above, those still there: one the owner removed meanwhile has no file either, and would have the rest
  // replaced for it.
  const gallery = print.previewImages.map((image) => image.id);
  // A look that fails leaves the photos as they are: the plates are in by then, and a gallery that can't be checked
  // isn't one known to be gone.
  const galleryWhole = await withStorageLock(async () => {
    const now = await prisma.print.findUniqueOrThrow({
      where: { id: printId },
      select: { assetsPath: true, previewImages: { where: { id: { in: gallery } }, select: { id: true } } },
    });
    if (!now.previewImages.length) return false;
    for (const image of now.previewImages) if (!(await galleryFileThere(now.assetsPath, image.id))) return false;
    return true;
  }).catch((error: unknown) => {
    log.error("couldn't check a repaired model's photos, so they're left as they are", { print: printId, error });
    return true;
  });
  return { plates, galleryWhole, gallery };
}

/** Whether a gallery picture's file is there, where assetExists looks for it, but a look that fails for any other
 *  reason than the file being gone throws: a disk that can't be read says nothing of what's on it, and a gallery taken
 *  for broken on such a look would have the owner's photos replaced. */
export async function galleryFileThere(home: AssetHome, imageId: string): Promise<boolean> {
  const file = galleryImageFile(imageId);
  for (const at of home ? [assetTarget(home, file), legacyAssetPath(file)] : [legacyAssetPath(file)]) {
    try {
      await fs.stat(at);
      return true;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw err;
    }
  }
  return false;
}

/** The model's plates put back as `old` after a replacement that stopped part-way (restorePlates), with `reading`, its
 *  prepared reading from before, in the same transaction, tried again when that fails. One that can't be leaves the model with only the plates the replacement made (`made`), whose files are
 *  there, so the scan would never offer it again: their files go instead (removeMadeFiles), and the model's plates
 *  point at files that aren't there, as when it was found. One that made none leaves the model with no plates at all,
 *  so `old` goes back later instead (putPlatesBackLater). With the plate order held. Whether `old` is back. */
async function putPlatesBack(
  printId: string,
  old: Plate[],
  made: readonly Plate[],
  reading: Prisma.JsonValue | null,
): Promise<boolean> {
  let failure: unknown;
  for (let tries = 0; tries < 3; tries++) {
    if (tries) await sleep(250 * tries);
    try {
      await restorePlates(printId, old, { preparedMetadata: reading }, made);
      return true;
    } catch (err) {
      failure = err;
    }
  }
  if (!made.length) {
    // None made, as when the first of them failed: the model has no plates at all, which the scan passes over, so its
    // own go back once they can.
    log.error("couldn't put a model's plates back, so it waits with none to try again", {
      print: printId,
      error: failure,
    });
    putPlatesBackLater(printId, old, reading);
    return false;
  }
  log.error("couldn't put a model's plates back, so the files of the ones a repair made go", {
    print: printId,
    error: failure,
  });
  if (!(await removeMadeFiles(printId, made))) removeMadeFilesLater(printId, made);
  return false;
}

/** The files of `made`, the plates a failed repair made, removed where their rows say they are now. Read under the
 *  storage lock, which a move holds from renaming a file to saving where it went: a path a move has freed since, which
 *  another model's file may hold by now, is never removed. Only the plates the model still has: a merge since keeps a
 *  plate's id but makes it another model's. None once the model has plates the repair didn't make, as a merge into it
 *  brings: it isn't broken then, and the repair's would be rows with no files beside ones that have them. False when
 *  the rows can't be read or a file won't go, for a later try to read them again; a file that's gone already counts as
 *  gone. */
async function removeMadeFiles(printId: string, made: readonly Plate[]): Promise<boolean> {
  try {
    await withStorageLock(async () => {
      const ids = made.map((plate) => plate.id);
      if (await prisma.plate.count({ where: { printId, id: { notIn: ids } } })) return;
      const now = await prisma.plate.findMany({ where: { id: { in: ids }, printId } });
      for (const plate of now) {
        if (!plate.sourcePath) await fs.rm(managedPlatePath(plate), { force: true });
      }
    });
    return true;
  } catch (error) {
    log.error("couldn't remove the files of a failed repair's plates", { print: printId, error });
    return false;
  }
}

const CLEANUP_DELAYS_MS = [30_000, 120_000, 600_000];
// A timer that doesn't keep the process up for a clean-up still to come.
const timerWait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref());
let cleanupDelaysMs = CLEANUP_DELAYS_MS;
let cleanupWait = timerWait;

/** The waits before each later try of removeMadeFiles, and how they're waited out (a test's own gate); the defaults
 *  when none are given. */
export function setCleanupDelaysForTest(delays?: number[], wait?: (ms: number) => Promise<void>): void {
  cleanupDelaysMs = delays ?? CLEANUP_DELAYS_MS;
  cleanupWait = wait ?? timerWait;
}

/** removeMadeFiles tried again later, until it's done or the tries run out: the database or the disk is away for
 *  longer than a moment. Each try holds the plate order, as any change to the model's plates does. Pending in this
 *  process only: one that's stopped first leaves the model with the plates the repair made. */
function removeMadeFilesLater(printId: string, made: readonly Plate[], attempt = 0): void {
  const delay = cleanupDelaysMs[attempt];
  if (delay === undefined) {
    log.error("gave up removing a failed repair's files, so the model keeps the plates it made", { print: printId });
    return;
  }
  void cleanupWait(delay)
    .then(() => withPlateOrder(printId, () => removeMadeFiles(printId, made)))
    .then((done) => {
      if (!done) removeMadeFilesLater(printId, made, attempt + 1);
    });
}

/** putPlatesBack tried again later, as removeMadeFilesLater is, for a model a failed repair left with no plates: `old`
 *  goes back only while it has none, as one added since is the owner's. Each try holds the plate order. */
function putPlatesBackLater(printId: string, old: Plate[], reading: Prisma.JsonValue | null, attempt = 0): void {
  const delay = cleanupDelaysMs[attempt];
  if (delay === undefined) {
    log.error("gave up putting a failed repair's model's plates back, so it has none", { print: printId });
    return;
  }
  void cleanupWait(delay)
    .then(() => withPlateOrder(printId, () => putBackIfNone(printId, old, reading)))
    .then((done) => {
      if (!done) putPlatesBackLater(printId, old, reading, attempt + 1);
    });
}

/** `old` put back as the model's plates while it's there and has none. False when that fails, for a later try. */
async function putBackIfNone(printId: string, old: Plate[], reading: Prisma.JsonValue | null): Promise<boolean> {
  try {
    const model = await prisma.print.findUnique({
      where: { id: printId },
      select: { _count: { select: { plates: true } } },
    });
    if (model && !model._count.plates) await restorePlates(printId, old, { preparedMetadata: reading });
    return true;
  } catch (error) {
    log.error("couldn't put a failed repair's model's plates back", { print: printId, error });
    return false;
  }
}
