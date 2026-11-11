import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Prisma, type Print, type PrintFile } from "@prisma/client";
import { prisma } from "../db";
import { createLogger } from "../logger";
import { createKeyedLock } from "../utils/concurrency";
import { HttpError } from "../utils/fileUtils";
import { createLog } from "./auditLog";
import { categoryRefOf, matchingCategoryId } from "./categoryService";
import {
  DESCRIPTION_IMAGE,
  DESCRIPTION_IMAGE_REF,
  descriptionImagePath,
  saveDescriptionImage,
} from "./descriptionImageService";
import { createPrint, discardPrint, resolvePlateFilePath } from "./printCreation";
import { managedPrintFilePath, saveFileFromTemp } from "./printFileService";
import { plateThumbExists, plateThumbPath, plateThumbReplaceable, saveThumbFromFile } from "./printService";
import { addPreviewImage, preferImageOverRenders, previewImagePath } from "./previewImageService";
import { libraryCopyOf, readablePrintWhere } from "./socialService";

// Copying another user's model, from one of their public collections, into the user's own library: its files, pictures,
// description, tags, source and print profiles, as a model of the user's that nothing of the original's later changes,
// privacy or deletion touches. Its category is the user's own that matches the original's starter category, if they
// have one; otherwise AI categorization sorts it as an import, when on. The owner's folders are theirs alone.

const log = createLogger("model-copy");

// One copy of a model at a time for each user, so a second request for it waits for the first to finish and finds a
// whole copy, rather than the first's row while its files are still coming (or one about to be discarded). Copies of
// other models don't wait on it. In-process, as the storage lock is; across processes, the database's one copy per user
// and original keeps it to one.
const perModel = createKeyedLock();

/** `copied` is false when `userId` already has the model -- their own, or a copy from before -- which comes back as is. */
export async function copyPrintToLibrary(userId: string, printId: string): Promise<{ print: Print; copied: boolean }> {
  return perModel(await modelKey(userId, printId), () => copyNow(userId, printId));
}

/** What the model is, as libraryCopyIds tells two apart: the same imported model has its source wherever it's been
 *  copied, and any other its first original. */
async function modelKey(userId: string, printId: string): Promise<string> {
  const print = await prisma.print.findUnique({
    where: { id: printId },
    select: { originalId: true, sourceProvider: true, sourceExternalId: true },
  });
  const model =
    print?.sourceProvider && print.sourceExternalId
      ? `${print.sourceProvider}:${print.sourceExternalId}`
      : (print?.originalId ?? printId);
  return `${userId}:${model}`;
}

async function copyNow(userId: string, printId: string): Promise<{ print: Print; copied: boolean }> {
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
  const existing = await libraryCopyOf(userId, source);
  if (existing) return { print: existing, copied: false };

  // A model left without a file to its name (a replacement of its files that failed halfway) has nothing to copy.
  if (!source.plates.length) throw new HttpError(409, "This model can't be copied: it has no files", "copy_no_plates");
  // All of it or nothing: a copy missing a file would quietly be a different model.
  const plates = source.plates.map((plate) => ({ plate, from: resolvePlateFilePath(plate) }));
  const missing = [
    ...plates.flatMap(({ plate, from }) => (from ? [] : [plate.filename])),
    // Not its LICENSE.txt, which the copy writes for itself.
    ...source.files.flatMap((file) =>
      file.role === "LICENSE" || fsSync.existsSync(managedPrintFilePath(file)) ? [] : [file.filename],
    ),
  ];
  if (missing.length) {
    throw new HttpError(
      409,
      `This model can't be copied: ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} missing from storage`,
      "copy_files_missing",
    );
  }

  const categoryId = await matchingCategoryId(userId, await categoryRefOf(source.categoryId));
  let created: Awaited<ReturnType<typeof createPrint>>;
  try {
    created = await createPrint(
      userId,
      {
        title: source.title,
        // Not pointing at the original's images even for a moment: the copy's own replace them once they're stored.
        notes: describedWithImages(source, new Map()),
        tags: source.tags,
        creator: source.creator,
        authorId: source.authorId,
        sourceProvider: source.sourceProvider,
        sourceExternalId: source.sourceExternalId,
        unfillableGaps: source.unfillableGaps,
        generatorScriptWithheld: source.generatorScriptWithheld,
        categoryId,
        categorySource: categoryId ? "RULE" : null,
        copiedFromId: source.id,
        originalId: source.originalId ?? source.id,
        // A copy of a partner's model says so too, and stands for it as the copier's own.
        remoteSource: (source.remoteSource as Prisma.InputJsonValue | null) ?? undefined,
        // As its owner had it, picked or read: the copier can pick another.
        licenseColumns: {
          license: (source.license as Prisma.InputJsonValue | null) ?? Prisma.DbNull,
          licenseAllows: source.licenseAllows,
          licenseReadAt: source.licenseReadAt,
        },
      },
      source.name,
      plates.flatMap(({ plate, from }) =>
        from
          ? [
              {
                filename: plate.filename,
                folder: plate.folder,
                mime: plate.mime,
                copyFromPath: from,
                sourceInstanceId: plate.sourceInstanceId,
                profile: plate.profile,
              },
            ]
          : [],
      ),
      // It has its description already.
      { describe: false },
    );
  } catch (err) {
    // The same model, copied by another request (or imported) since the check above: that one is the user's copy.
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
    const arrived = await libraryCopyOf(userId, source);
    if (!arrived) throw err;
    return { print: arrived, copied: false };
  }
  const { print } = created;

  // Supporting files and the prepared print: what the model is, so a copy without them would be a different one.
  try {
    // Its LICENSE.txt is written from the licence the copy carries, not copied.
    await copyFiles(
      userId,
      print.id,
      source.files.flatMap((file) => (file.role === "LICENSE" ? [] : [{ ...file, role: file.role }])),
    );
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

/** Through a temporary copy each, as saveFileFromTemp takes the file it's given. Each keeps the role it has: one named
 *  like a prepared print may be a supporting file (a merge demotes all but one), and only the prepared one may replace
 *  the copy's. */
async function copyFiles(
  userId: string,
  printId: string,
  files: (Pick<PrintFile, "storagePath" | "filename" | "folder" | "mime"> & { role: "SUPPORTING" | "PREPARED" })[],
) {
  if (!files.length) return;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "thingport-copy-"));
  try {
    for (const [index, file] of files.entries()) {
      const temp = path.join(dir, String(index));
      await fs.copyFile(managedPrintFilePath(file), temp);
      await saveFileFromTemp(userId, printId, temp, file.filename, file.mime, { role: file.role, folder: file.folder });
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

type DescribedSource = Pick<Print, "assetsPath" | "notes"> & {
  descriptionImages: { id: string; mime: string; sourceUrl: string | null }[];
};

/** The original's description pointed at the copy's images, `renamed` from the original's. One without a copy points
 *  back at where it was downloaded from, or goes: left pointing at the original's, it would break the day the original
 *  goes private or is deleted. */
function describedWithImages(source: DescribedSource, renamed: Map<string, string>): string | null {
  if (!source.notes?.includes("/description-image/")) return source.notes;
  const downloadedFrom = new Map(source.descriptionImages.map((image) => [image.id, image.sourceUrl]));
  const copies = new Set(renamed.values());
  return (
    source.notes
      .replace(DESCRIPTION_IMAGE, (_, alt: string, id: string) => {
        const next = renamed.get(id);
        if (next) return `![${alt}](/description-image/${next})`;
        const url = downloadedFrom.get(id);
        return url ? `![${alt}](${url})` : "";
      })
      // Anywhere else, as in an HTML image; the copy's own, just written above, stay as they are.
      .replace(DESCRIPTION_IMAGE_REF, (ref, id: string) => {
        if (copies.has(id)) return ref;
        const next = renamed.get(id);
        return next ? `/description-image/${next}` : (downloadedFrom.get(id) ?? "");
      })
  );
}

/** Each image gets a new id with the copy, and the description is pointed at those. Until then, and if this fails, it
 *  has the one it was made with (describedWithImages with none), which doesn't depend on the original. */
async function copyDescriptionImages(printId: string, source: DescribedSource) {
  if (!source.notes?.includes("/description-image/")) return;
  const renamed = new Map<string, string>();
  for (const image of source.descriptionImages) {
    try {
      const buffer = await fs.readFile(descriptionImagePath(image, source.assetsPath)).catch(() => null);
      const saved = buffer && (await saveDescriptionImage(printId, buffer, image.sourceUrl));
      if (saved) renamed.set(image.id, saved.id);
    } catch (error) {
      log.warn("couldn't copy a description image", { print: printId, image: image.id, error });
    }
  }
  if (!renamed.size) return;
  await prisma.print.update({ where: { id: printId }, data: { notes: describedWithImages(source, renamed) } });
}
