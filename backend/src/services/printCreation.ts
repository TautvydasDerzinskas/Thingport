import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { prisma } from "../db";
import { STORAGE } from "../config";
import { HttpError, sanitizeFilename, guessMimeFromPath, mimeFromContentType } from "../utils/fileUtils";
import { normalizeTags } from "../utils/tagNormalization";
import { inspectPreparedPrint } from "./preparedPrint";
import {
  availableModelName,
  availablePlateFilename,
  ensurePlateThumbnail,
  managedPlatePath,
  plateThumbPath,
  pruneEmptyStorageDirs,
  renderPlateStoragePath,
  saveThumbFromFile,
} from "./printService";
import { generateModelPreviewGlb } from "./modelPreviewCache";
import { deleteNormalized3mf } from "./normalized3mfCache";
import { getPreviewMode } from "./settingsService";
import { Prisma } from "@prisma/client";
import type { CategorySource, Plate, Print } from "@prisma/client";
import { enqueueAiCategorization } from "./aiCategorizationService";

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
};

async function placeFile(input: NewPlateInput, destAbsPath: string): Promise<string | null> {
  await fs.mkdir(path.dirname(destAbsPath), { recursive: true });
  if (input.tempFilePath) {
    try {
      await fs.rename(input.tempFilePath, destAbsPath);
    } catch (err: any) {
      if (err?.code === "EXDEV") {
        await fs.copyFile(input.tempFilePath, destAbsPath);
        await fs.rm(input.tempFilePath, { force: true });
      } else {
        throw err;
      }
    }
    return destAbsPath;
  }
  if (input.copyFromPath) {
    await fs.copyFile(input.copyFromPath, destAbsPath);
    return destAbsPath;
  }
  return input.sourcePath ?? null;
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
  const effectivePath = await placeFile(input, destAbsPath);
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

export async function createPrint(
  userId: string,
  meta: PrintMetaInput,
  nameHint: string,
  plateInputs: NewPlateInput[],
): Promise<{ print: Print; plates: Plate[] }> {
  if (!plateInputs.length) throw new Error("createPrint requires at least one plate");
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
    },
  });

  try {
    const plates: Plate[] = [];
    let firstEffectivePath: string | null = null;
    let firstFilename = "";
    for (let i = 0; i < plateInputs.length; i++) {
      const { record, effectivePath } = await createPlateAtPosition(print, plateInputs[i], i);
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

    // Background classification is intentionally detached: importing a model must not wait for,
    // or fail because of, a third-party AI provider.
    if (!print.categoryId) void enqueueAiCategorization(userId, print.id);
    return { print, plates };
  } catch (err) {
    await discardPrint(print.id);
    throw err;
  }
}

/** Undoes a half-created print, so a failure doesn't leave a model with only some of its plates. */
async function discardPrint(printId: string): Promise<void> {
  try {
    const plates = await prisma.plate.findMany({ where: { printId } });
    await prisma.print.delete({ where: { id: printId } });
    for (const plate of plates) {
      await fs.rm(plateThumbPath(plate.id), { force: true });
      if (plate.sourcePath) continue;
      const managed = managedPlatePath(plate);
      await fs.rm(managed, { force: true });
      await pruneEmptyStorageDirs(path.dirname(managed));
    }
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
