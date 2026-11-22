import path from "node:path";
import type { Plate, PrintFile } from "@prisma/client";
import { prisma } from "../db";
import { createLogger } from "../logger";
import { deleteAdapted3mfs } from "../services/adapted3mfCache";
import { descriptionImageFile, removeAsset } from "../services/modelAssets";
import { removeGalleryFiles } from "../services/previewImageService";
import { PENDING_STORAGE_PATH, printFilePathOrNull } from "../services/printFileService";
import {
  managedPlatePath,
  pruneEmptyStorageDirs,
  removeAssetHome,
  removePlatePictures,
} from "../services/printService";
import { fileState, removeFile } from "./storageFs";

// One way a model goes, for the owner's delete, an admin's, the discard of a model that couldn't be made, and an
// account's: its rows in one transaction, then every file and picture they named. A tool's plate reads the tool's
// file, which stays.

const log = createLogger("model-files");

/** What a removed model was, for what its caller does after: an author or tag only it had, the activity entry. */
export type RemovedModel = { userId: string; name: string; authorId: string | null; tags: string[] };

/** Where the files its rows name are. A tool's plate names the tool's file, which isn't the model's, and a file not
 *  yet in its place names none. */
function filesOf(rows: { plates: Plate[]; files: PrintFile[] }): string[] {
  const plates = rows.plates.filter((plate) => !plate.sourcePath).map((plate) => managedPlatePath(plate));
  const files = rows.files
    .map((file) => (file.storagePath === PENDING_STORAGE_PATH ? null : printFilePathOrNull(file)))
    .filter((where): where is string => where !== null);
  return [...plates, ...files];
}

/** Removes the model and everything of it, or nothing when a look at one of its files fails first. Null when it was
 *  gone already. A file that can't be removed once the rows are gone is logged and left. */
export async function removeModel(printId: string): Promise<RemovedModel | null> {
  const known = await prisma.print.findUnique({ where: { id: printId }, include: { plates: true, files: true } });
  if (!known) return null;
  // Looked at first: a disk that can't answer stops the delete before anything goes.
  const looked = new Set(filesOf(known));
  for (const abs of looked) await fileState(abs, "delete.look");
  // The rows read again under the model's lock, so one added since is taken too, and taken down together: a failure
  // leaves the model whole.
  const gone = await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Print" WHERE id = ${printId} FOR UPDATE`;
      const rows = await tx.print.findUnique({
        where: { id: printId },
        include: {
          plates: true,
          files: true,
          previewImages: { select: { id: true } },
          descriptionImages: { select: { id: true, mime: true } },
        },
      });
      if (!rows) return null;
      // A file added since is looked at here, before any row goes: a disk that can't answer rolls the delete back.
      for (const abs of filesOf(rows)) if (!looked.has(abs)) await fileState(abs, "delete.look");
      await tx.printFile.deleteMany({ where: { printId } });
      await tx.previewImage.deleteMany({ where: { printId } });
      await tx.descriptionImage.deleteMany({ where: { printId } });
      await tx.print.delete({ where: { id: printId } });
      return rows;
    },
    { timeout: 30_000 },
  );
  if (!gone) return null;

  const home = gone.assetsPath;
  const owners = [...gone.plates, ...gone.previewImages, ...gone.descriptionImages].map((row) => row.id);
  const folders = new Set<string>();
  const attempt = async (what: string, step: () => Promise<unknown>) => {
    try {
      await step();
    } catch (error) {
      log.warn(`couldn't remove ${what} of a deleted model`, { print: printId, error });
    }
  };
  for (const abs of filesOf(gone)) {
    await attempt("a file", () => removeFile(abs, "delete.unlink"));
    folders.add(path.dirname(abs));
  }
  for (const plate of gone.plates) {
    await attempt("a plate's adapted copies", () => deleteAdapted3mfs(plate.id));
    await attempt("a plate's pictures", () => removePlatePictures(plate.id, home));
  }
  for (const image of gone.previewImages) await attempt("a photo", () => removeGalleryFiles(home, image.id));
  for (const image of gone.descriptionImages) {
    await attempt("a description image", () => removeAsset(home, descriptionImageFile(image)));
  }
  await attempt("the pictures folder", () => removeAssetHome(home, owners));
  for (const folder of folders) await attempt("a folder", () => pruneEmptyStorageDirs(folder));
  return { userId: gone.userId, name: gone.name, authorId: gone.authorId, tags: gone.tags };
}
