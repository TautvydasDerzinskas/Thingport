import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Print } from "@prisma/client";
import { prisma } from "../db";
import { createLogger } from "../logger";
import { HttpError } from "../utils/fileUtils";
import { createLog } from "./auditLog";
import { descriptionImagePath, saveDescriptionImage } from "./descriptionImageService";
import { createPrint, discardPrint, resolvePlateFilePath } from "./printCreation";
import { managedPrintFilePath, saveFileFromTemp } from "./printFileService";
import { plateThumbExists, plateThumbPath, plateThumbReplaceable, saveThumbFromFile } from "./printService";
import { addPreviewImage, preferImageOverRenders, previewImagePath } from "./previewImageService";
import { readablePrintWhere, sameModelWhere } from "./socialService";

// Copying another user's model, from one of their public collections, into the user's own library: its files, pictures,
// description and tags, as a model of the user's that nothing of the original's later changes, privacy or deletion
// touches. Its category isn't copied, being the owner's own sorting; AI categorization sorts it as an import, when on.

const log = createLogger("model-copy");

const DESCRIPTION_IMAGE_REF = /\/description-image\/([a-z0-9]+)/g;

/** `copied` is false when `userId` already has the model -- their own, or a copy from before -- which comes back as is. */
export async function copyPrintToLibrary(userId: string, printId: string): Promise<{ print: Print; copied: boolean }> {
  const source = await prisma.print.findFirst({
    where: { id: printId, AND: [await readablePrintWhere(userId)] },
    include: {
      plates: { orderBy: { position: "asc" } },
      previewImages: { orderBy: { position: "asc" } },
      descriptionImages: true,
      files: true,
    },
  });
  if (!source) throw new HttpError(404, "Print not found");
  if (source.userId === userId) return { print: source, copied: false };
  const existing = await prisma.print.findFirst({ where: sameModelWhere(userId, source) });
  if (existing) return { print: existing, copied: false };

  const plates = source.plates.flatMap((plate) => {
    const from = resolvePlateFilePath(plate);
    return from ? [{ plate, from }] : [];
  });
  if (!plates.length) throw new HttpError(409, "This model's files are missing from storage, so it can't be copied");

  const { print } = await createPrint(
    userId,
    {
      title: source.title,
      notes: source.notes,
      tags: source.tags,
      creator: source.creator,
      authorId: source.authorId,
      sourceProvider: source.sourceProvider,
      sourceExternalId: source.sourceExternalId,
      generatorScriptWithheld: source.generatorScriptWithheld,
      copiedFromId: source.id,
    },
    source.name,
    plates.map(({ plate, from }) => ({
      filename: plate.filename,
      mime: plate.mime,
      copyFromPath: from,
      sourceInstanceId: plate.sourceInstanceId,
    })),
    // It has its description already.
    { describe: false },
  );

  // Supporting files and the prepared print: what the model is, so a copy without them would be a different one.
  try {
    await copyFiles(userId, print.id, source.files);
  } catch (err) {
    await discardPrint(print.id);
    throw err;
  }

  // The pictures only make it look like the original; one that fails leaves a model that's still whole.
  const didNot = (step: string) => (error: unknown) => log.warn(`couldn't ${step}`, { print: print.id, error });
  await copyPictures(print.id, source).catch(didNot("copy its pictures"));
  await copyDescriptionImages(print.id, source).catch(didNot("copy its description's images"));

  void createLog({
    userId,
    action: "model_copied",
    targetId: print.id,
    details: { name: print.title || print.name, from: source.id, owner: source.userId },
  });
  return { print: (await prisma.print.findUnique({ where: { id: print.id } })) ?? print, copied: true };
}

/** Through a temporary copy each, as saveFileFromTemp takes the file it's given. */
async function copyFiles(
  userId: string,
  printId: string,
  files: { storagePath: string; filename: string; mime: string }[],
) {
  if (!files.length) return;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "thingport-copy-"));
  try {
    for (const [index, file] of files.entries()) {
      const temp = path.join(dir, String(index));
      await fs.copyFile(managedPrintFilePath(file), temp);
      await saveFileFromTemp(userId, printId, temp, file.filename, file.mime);
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

type PictureSource = Pick<Print, "assetsPath"> & {
  plates: { id: string; thumbGenerated: boolean }[];
  previewImages: { id: string; generated: boolean }[];
};

/** The gallery's real pictures, then each plate's thumbnail where the copy has none of its own yet. Our own renders
 *  are left for the copy to make itself, as for any new model, unless the original had nothing else to show. */
async function copyPictures(printId: string, source: PictureSource) {
  const copyPlates = await prisma.plate.findMany({ where: { printId }, orderBy: { position: "asc" } });
  const real = source.previewImages.filter((image) => !image.generated);
  let firstReal: Buffer | null = null;
  for (const image of real) {
    const buffer = await fs.readFile(previewImagePath(image.id, source.assetsPath)).catch(() => null);
    if (!buffer) continue;
    // Already the normalized JPEG the original stored; its EXIF was dealt with then.
    if (await addPreviewImage(printId, buffer, { keepExif: true })) firstReal ??= buffer;
  }
  // As a picture added to a new model would: it leads, ahead of any render made meanwhile, and becomes the card's.
  if (firstReal) await preferImageOverRenders(printId, copyPlates[0]?.id, firstReal, true);
  else if (!(await prisma.previewImage.count({ where: { printId } }))) {
    for (const image of source.previewImages) {
      const buffer = await fs.readFile(previewImagePath(image.id, source.assetsPath)).catch(() => null);
      if (buffer) await addPreviewImage(printId, buffer, { generated: true, keepExif: true });
    }
  }

  for (const [index, plate] of source.plates.entries()) {
    const copy = copyPlates[index];
    if (!copy || !plateThumbExists(plate.id, source.assetsPath) || !(await plateThumbReplaceable(copy.id))) continue;
    if (!(await saveThumbFromFile(copy.id, plateThumbPath(plate.id, source.assetsPath)))) continue;
    if (plate.thumbGenerated) await prisma.plate.update({ where: { id: copy.id }, data: { thumbGenerated: true } });
  }
}

/** Each image gets a new id with the copy, so the description is pointed at those. */
async function copyDescriptionImages(
  printId: string,
  source: Pick<Print, "assetsPath" | "notes"> & {
    descriptionImages: { id: string; mime: string; sourceUrl: string | null }[];
  },
) {
  if (!source.notes || !source.descriptionImages.length) return;
  const renamed = new Map<string, string>();
  for (const image of source.descriptionImages) {
    const buffer = await fs.readFile(descriptionImagePath(image, source.assetsPath)).catch(() => null);
    const saved = buffer && (await saveDescriptionImage(printId, buffer, image.sourceUrl));
    if (saved) renamed.set(image.id, saved.id);
  }
  if (!renamed.size) return;
  const notes = source.notes.replace(DESCRIPTION_IMAGE_REF, (ref, id: string) => {
    const next = renamed.get(id);
    return next ? `/description-image/${next}` : ref;
  });
  await prisma.print.update({ where: { id: printId }, data: { notes } });
}
