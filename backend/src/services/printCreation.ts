import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { prisma } from "../db";
import { STORAGE, PARAMETRIC_SOURCE_EXTS } from "../config";
import { withStorageLock } from "../utils/storageLock";
import { HttpError, sanitizeFilename, guessMimeFromPath, mimeFromContentType } from "../utils/fileUtils";
import { normalizeTags } from "../utils/tagNormalization";
import { inspectPreparedPrint } from "./preparedPrint";
import {
  availableModelName,
  availablePlateFilename,
  ensureAssetHome,
  ensurePlateThumbnail,
  managedPlatePath,
  pruneEmptyStorageDirs,
  relocatePrint,
  removeAssetHome,
  assetOwnerIds,
  removePlatePictures,
  renderPlateStoragePath,
  saveThumbFromFile,
} from "./printService";
import { generateModelPreviewGlb, canRenderModelImage } from "./modelPreviewCache";
import { generateCardRender } from "./previewImageService";
import { printAssetHome } from "./modelAssets";
import { deleteNormalized3mf } from "./normalized3mfCache";
import { getPreviewMode } from "./settingsService";
import { reuseMarker, shareStoredCopy, type ReuseMarker } from "./fileReuse";
import { findStoredCopies } from "./storedContent";
import { Prisma } from "@prisma/client";
import type { CategorySource, Plate, Print } from "@prisma/client";
import { enqueueAiCategorization } from "./aiCategorizationService";
import { enqueueAiDescription } from "./aiDescriptionService";
import { deleteAllPrintFiles, saveFileFromTemp } from "./printFileService";
import { importingQuietly } from "../utils/quietImport";

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp"]);

export type NewPlateInput = {
  /** Untrusted; will be sanitized. */
  filename: string;
  mime?: string | null;
  size?: number;
  /** Exactly one of tempFilePath / copyFromPath / sourcePath should be set. */
  tempFilePath?: string; // moved (renamed) into managed storage, source is deleted
  copyFromPath?: string; // copied into managed storage, source left intact
  sourcePath?: string; // no-copy: file stays at this path, storagePath is still rendered/recorded
  sourceInstanceId?: string | null;
};

/** A file that is a script a model can be generated from, rather than geometry to print. */
export function isGeneratorScript(filename: string): boolean {
  return PARAMETRIC_SOURCE_EXTS.has(path.extname(filename).toLowerCase());
}

export type PrintMetaInput = {
  title?: string | null;
  notes?: string | null;
  tags?: string[];
  categoryId?: string | null;
  categorySource?: CategorySource | null;
  creator?: string | null;
  authorId?: string | null;
  /** Backs de-duplication of future imports of the same source model. */
  sourceProvider?: string | null;
  sourceExternalId?: string | null;
  /** The source has the script this model is generated from, but its creator chose not to share it. */
  generatorScriptWithheld?: boolean;
};

/** Never over another file: a link fails on one that's there, where a rename would replace it. Only the placing is
 *  under the storage lock (the file reuse backfill's swap renames over a path it has just checked, and mustn't land
 *  after a file saved at a path its row just freed); removing the temp file is not. */
async function placeFile(input: NewPlateInput, destAbsPath: string): Promise<string | null> {
  await fs.mkdir(path.dirname(destAbsPath), { recursive: true });
  try {
    if (input.tempFilePath) {
      const tempFilePath = input.tempFilePath;
      await withStorageLock(async () => {
        try {
          await fs.link(tempFilePath, destAbsPath);
        } catch (err: any) {
          if (err?.code === "EEXIST") throw err;
          // Another disk, or one without hard links.
          await fs.copyFile(tempFilePath, destAbsPath, fsSync.constants.COPYFILE_EXCL);
        }
      });
      await fs.rm(tempFilePath, { force: true });
      return destAbsPath;
    }
    if (input.copyFromPath) {
      const copyFromPath = input.copyFromPath;
      await withStorageLock(() => fs.copyFile(copyFromPath, destAbsPath, fsSync.constants.COPYFILE_EXCL));
      return destAbsPath;
    }
  } catch (err: any) {
    if (err?.code === "EEXIST") throw new HttpError(409, "Another file was just saved at the same path; try again");
    throw err;
  }
  return input.sourcePath ?? null;
}

/** Stores the file, sharing a stored copy of it when the admin setting allows. Returns where it is and, when it was
 *  hashed for that, its SHA-256 -- recorded either way so a later identical file finds it. */
async function placePlateFile(
  input: NewPlateInput,
  destAbsPath: string,
): Promise<{ effectivePath: string | null; contentSha256: string | null; marker: ReuseMarker }> {
  const fromPath = input.tempFilePath ?? input.copyFromPath;
  if (!fromPath) return { effectivePath: await placeFile(input, destAbsPath), contentSha256: null, marker: {} };
  const { contentSha256, shared } = await shareStoredCopy(fromPath, destAbsPath, findStoredCopies);
  if (!shared) return { effectivePath: await placeFile(input, destAbsPath), contentSha256, marker: {} };
  // The clone is in place: a temp file left behind is only clutter, not a reason to fail the import.
  if (input.tempFilePath) await fs.rm(input.tempFilePath, { force: true }).catch(() => undefined);
  return { effectivePath: destAbsPath, contentSha256, marker: await reuseMarker(destAbsPath, true, contentSha256) };
}

async function resolveSize(input: NewPlateInput, effectivePath: string | null): Promise<number> {
  if (typeof input.size === "number") return input.size;
  if (!effectivePath) return 0;
  try {
    const stat = await fs.stat(effectivePath);
    return stat.size;
  } catch {
    return 0;
  }
}

async function thumbnailAndSniff(plateId: string, filename: string, mime: string, effectivePath: string | null) {
  if (!effectivePath || !fsSync.existsSync(effectivePath)) return;
  const ext = path.extname(filename).toLowerCase();
  if (mime.toLowerCase().startsWith("image/") && IMAGE_EXTS.has(ext)) {
    await saveThumbFromFile(plateId, effectivePath);
  } else if (ext === ".3mf") {
    await ensurePlateThumbnail(plateId, effectivePath);
    // "on-demand" builds the preview on first view, "disabled" never. Not awaited: it can be slow.
    if ((await getPreviewMode()) === "automatic") void generateModelPreviewGlb(plateId, effectivePath);
  }
  // Queued behind the GLB, which the model page needs first.
  if (canRenderModelImage(filename) && (await getPreviewMode()) === "automatic") {
    void generateCardRender(plateId, effectivePath, filename);
  }
}

export function resolvePlateFilePath(plate: Pick<Plate, "storagePath" | "sourcePath">): string | null {
  const managed = managedPlatePath(plate);
  if (fsSync.existsSync(managed)) return managed;
  if (plate.sourcePath && fsSync.existsSync(plate.sourcePath)) return plate.sourcePath;
  return null;
}

export async function refreshAutoPreparedMetadata(printId: string): Promise<void> {
  const plate0 = await prisma.plate.findFirst({ where: { printId }, orderBy: { position: "asc" } });
  let metadata: Prisma.InputJsonValue | null = null;
  if (plate0) {
    const filePath = resolvePlateFilePath(plate0);
    if (filePath) {
      const sniffed = await inspectPreparedPrint(filePath, plate0.filename);
      if (sniffed) metadata = sniffed as unknown as Prisma.InputJsonValue;
    }
  }
  await prisma.print.update({
    where: { id: printId },
    data: { preparedMetadata: metadata === null ? Prisma.JsonNull : metadata },
  });
}

type CreatedPlate = { record: Plate; effectivePath: string | null };

async function createPlateAtPosition(
  print: Pick<Print, "id" | "name" | "creator" | "tags" | "categoryId" | "userId" | "authorId" | "sourceProvider">,
  input: NewPlateInput,
  position: number,
): Promise<CreatedPlate> {
  const sanitized = sanitizeFilename(input.filename);
  const desiredFilename = await availablePlateFilename(print.id, sanitized);
  const storagePath = await renderPlateStoragePath(print, desiredFilename, position);
  const destAbsPath = path.join(STORAGE, storagePath);
  const { effectivePath, contentSha256, marker } = await placePlateFile(input, destAbsPath);
  const size = await resolveSize(input, effectivePath);
  const mime = input.mime || guessMimeFromPath(desiredFilename) || "application/octet-stream";

  let record: Plate;
  try {
    record = await prisma.plate.create({
      data: {
        printId: print.id,
        position,
        filename: desiredFilename,
        mime,
        size,
        storagePath,
        sourcePath: input.sourcePath ?? null,
        sourceInstanceId: input.sourceInstanceId ?? null,
        contentSha256,
        ...marker,
      },
    });
  } catch (err) {
    // e.g. a concurrent import of the same profile won; don't orphan the placed file.
    if (effectivePath && !input.sourcePath) await fs.rm(effectivePath, { force: true }).catch(() => undefined);
    throw err;
  }

  await thumbnailAndSniff(record.id, desiredFilename, mime, effectivePath);
  return { record, effectivePath };
}

/** `describe: false` leaves the AI description check to the caller: an import's description is rewritten after this,
 *  when its images are stored locally, and a check started before then would come back to a changed description.
 *  `classify: false` keeps it out of AI categorization too, as for a tool's own models, which no one may change. */
export async function createPrint(
  userId: string,
  meta: PrintMetaInput,
  nameHint: string,
  plateInputs: NewPlateInput[],
  { describe = true, classify = true } = {},
): Promise<{ print: Print; plates: Plate[] }> {
  // A generator script holds no geometry until something runs it, so it is never a plate: it comes along as a
  // SUPPORTING file instead. Split here rather than in each caller, so a script reaches a model the same way
  // whether it was imported, uploaded beside it, or unpacked from a provider's zip.
  const sourceInputs = plateInputs.filter((input) => isGeneratorScript(input.filename));
  const plateInputs2 = plateInputs.filter((input) => !isGeneratorScript(input.filename));
  if (!plateInputs2.length) {
    // A script on its own is answerable, not a bug: it describes a model but holds none, so there is nothing to
    // show, print or render until something runs it. Attach it to a model instead.
    if (sourceInputs.length)
      throw new HttpError(400, "A generator script needs a model to go with: it holds no shape of its own");
    throw new Error("createPrint requires at least one plate");
  }
  // categoryId may come straight from a request body, so verify ownership here.
  if (meta.categoryId) {
    const category = await prisma.category.findFirst({ where: { id: meta.categoryId, userId } });
    if (!category) throw new HttpError(400, "Category not found");
  }
  const baseName = (meta.title || "").trim() || nameHint;
  const finalName = await availableModelName(userId, baseName, meta.categoryId ?? null);

  const print = await prisma.print.create({
    data: {
      userId,
      name: finalName,
      nameNormalized: finalName.trim().toLowerCase(),
      title: meta.title ?? null,
      notes: meta.notes ?? null,
      creator: meta.creator?.trim() || null,
      tags: normalizeTags(meta.tags || []),
      categoryId: meta.categoryId ?? null,
      categorySource: meta.categoryId ? (meta.categorySource ?? "MANUAL") : null,
      authorId: meta.authorId ?? null,
      sourceProvider: meta.sourceProvider ?? null,
      sourceExternalId: meta.sourceExternalId ?? null,
      generatorScriptWithheld: meta.generatorScriptWithheld ?? false,
    },
  });
  // Chosen now, though nothing is in it yet, so a null assetsPath only ever means a model from before (see
  // storageMoveService). Failing here isn't fatal: the first picture tries again.
  await ensureAssetHome(print.id).catch((err) => console.error("Couldn't choose a pictures folder", print.id, err));

  try {
    const plates: Plate[] = [];
    let firstEffectivePath: string | null = null;
    let firstFilename = "";
    for (let i = 0; i < plateInputs2.length; i++) {
      const { record, effectivePath } = await createPlateAtPosition(print, plateInputs2[i], i);
      plates.push(record);
      if (i === 0) {
        firstEffectivePath = effectivePath;
        firstFilename = record.filename;
      }
    }

    if (firstEffectivePath) {
      const sniffed = await inspectPreparedPrint(firstEffectivePath, firstFilename);
      if (sniffed) {
        await prisma.print.update({
          where: { id: print.id },
          data: { preparedMetadata: sniffed as unknown as Prisma.InputJsonValue },
        });
      }
    }

    // Best-effort: a script that won't store leaves the model itself made, since its plates are what the user
    // asked for. Line endings are put right by saveFileFromTemp, wherever a script comes from.
    for (const input of sourceInputs) {
      if (!input.tempFilePath) continue;
      try {
        // Plain text, which no mime table knows .scad for, so it is given rather than guessed.
        await saveFileFromTemp(userId, print.id, input.tempFilePath, input.filename, "text/plain");
      } catch (err) {
        console.warn(`Couldn't keep the generator script ${input.filename}:`, err);
      }
    }

    // Background classification is intentionally detached: importing a model must not wait for,
    // or fail because of, a third-party AI provider.
    const quiet = importingQuietly();
    if (!print.categoryId && classify && !quiet) void enqueueAiCategorization(userId, print.id);
    if (describe && !quiet) enqueueAiDescription(userId, print.id);
    return { print, plates };
  } catch (err) {
    await discardPrint(print.id);
    throw err;
  }
}

/** Undoes a half-created print, so a failure doesn't leave a model with only some of its files. */
export async function discardPrint(printId: string): Promise<void> {
  try {
    const plates = await prisma.plate.findMany({ where: { printId } });
    const home = await printAssetHome(printId);
    const assetOwners = await assetOwnerIds(printId);
    await deleteAllPrintFiles(printId);
    await prisma.print.delete({ where: { id: printId } });
    for (const plate of plates) {
      await removePlatePictures(plate.id, home);
      if (plate.sourcePath) continue;
      const managed = managedPlatePath(plate);
      await fs.rm(managed, { force: true });
      await pruneEmptyStorageDirs(path.dirname(managed));
    }
    await removeAssetHome(home, assetOwners);
  } catch (err) {
    console.error("Failed to discard half-created print", printId, err);
  }
}

export async function addPlatesToPrint(
  userId: string,
  printId: string,
  plateInputs: NewPlateInput[],
): Promise<Plate[]> {
  const print = await prisma.print.findFirst({ where: { id: printId, userId } });
  if (!print) throw new Error("Print not found");
  const maxPosition = await prisma.plate.aggregate({ where: { printId }, _max: { position: true } });
  let nextPosition = (maxPosition._max.position ?? -1) + 1;

  const created: Plate[] = [];
  for (const input of plateInputs) {
    const { record } = await createPlateAtPosition(print, input, nextPosition);
    created.push(record);
    nextPosition += 1;
  }
  return created;
}

/** Removes one of the model's plates and its file. The only plate can't go: the model is deleted instead. */
export async function removePlate(print: Pick<Print, "id" | "assetsPath">, plateId: string): Promise<void> {
  const plates = await prisma.plate.findMany({ where: { printId: print.id }, orderBy: { position: "asc" } });
  const target = plates.find((p) => p.id === plateId);
  if (!target) throw new HttpError(404, "Plate not found");
  if (plates.length <= 1) {
    throw new HttpError(409, "Cannot remove the only plate of a print; delete the print instead.");
  }

  const remaining = plates.filter((p) => p.id !== target.id);
  // Renumber in two phases (negative temp positions) to avoid (printId, position) collisions.
  await prisma.plate.delete({ where: { id: target.id } });
  await prisma.$transaction(
    remaining.map((p, idx) => prisma.plate.update({ where: { id: p.id }, data: { position: -(idx + 1) } })),
  );
  await prisma.$transaction(
    remaining.map((p, idx) => prisma.plate.update({ where: { id: p.id }, data: { position: idx } })),
  );
  await deletePlateFiles(target);
  await removePlatePictures(target.id, print.assetsPath);
  if (target.position === 0) await refreshAutoPreparedMetadata(print.id);
}

/** Renames one of the model's plates, suffixed when another plate has the name. Returns the name it got. */
export async function renamePlate(print: Print, plateId: string, filename: string): Promise<string> {
  const plate = await prisma.plate.findUnique({ where: { id: plateId } });
  if (!plate || plate.printId !== print.id) throw new HttpError(404, "Plate not found");
  const nextFilename = await availablePlateFilename(print.id, sanitizeFilename(filename), plate.id);
  if (nextFilename !== plate.filename) {
    await prisma.plate.update({ where: { id: plate.id }, data: { filename: nextFilename } });
    await relocatePrint(print, [{ ...plate, filename: nextFilename }]);
    if (plate.position === 0) await refreshAutoPreparedMetadata(print.id);
  }
  return nextFilename;
}

export async function deletePlateFiles(plate: Pick<Plate, "id" | "storagePath">): Promise<void> {
  await deleteNormalized3mf(plate.id);
  const abs = path.join(STORAGE, plate.storagePath);
  try {
    await fs.rm(abs, { force: true });
    await pruneEmptyStorageDirs(path.dirname(abs));
  } catch {}
}

export function mimeForUpload(contentType: string | null | undefined, filename: string): string {
  return mimeFromContentType(contentType, filename);
}
