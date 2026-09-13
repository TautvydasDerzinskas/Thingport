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
  pruneEmptyStorageDirs,
  renderPlateStoragePath,
  saveThumbFromFile,
} from "./printService";
import { generateModelPreviewGlb } from "./modelPreviewCache";
import { Prisma } from "@prisma/client";
import type { Plate, Print } from "@prisma/client";

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp"]);

export type NewPlateInput = {
  /** Original (untrusted) filename; will be sanitized. */
  filename: string;
  mime?: string | null;
  size?: number;
  /** Exactly one of tempFilePath / copyFromPath / sourcePath should be set. */
  tempFilePath?: string; // moved (renamed) into managed storage, source is deleted
  copyFromPath?: string; // copied into managed storage, source left intact
  sourcePath?: string; // no-copy: file stays at this path, storagePath is still rendered/recorded
};

export type PrintMetaInput = {
  title?: string | null;
  notes?: string | null;
  tags?: string[];
  categoryId?: string | null;
  creator?: string | null;
  collection?: string | null;
  /** Id of an already-upserted Author row (see authorService.ts), e.g. "makerworld:12345". */
  authorId?: string | null;
  /** Set when this print was resolved from a known provider's model URL (see
   * importService.ts's identifySourceModel) -- backs de-duplication of future imports of the
   * same source model. Null for uploads, zip/folder-scan imports, and unrecognized sources. */
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
  // no-copy: nothing placed on disk, caller should use sourcePath for reads.
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
    // Not awaited: pre-rendering the interactive 3D preview can take real time for a large/
    // high-poly model, and doing it here would block the upload/import response on that. It
    // runs in the background and self-heals (see routes/plates.ts's preview.glb route) if this
    // fires before the process is ready or somehow never completes.
    void generateModelPreviewGlb(plateId, effectivePath);
  }
}

/** Resolves the on-disk path to read a plate's bytes from (managed storage, else its sourcePath). */
export function resolvePlateFilePath(plate: Pick<Plate, "storagePath" | "sourcePath">): string | null {
  const managed = managedPlatePath(plate);
  if (fsSync.existsSync(managed)) return managed;
  if (plate.sourcePath && fsSync.existsSync(plate.sourcePath)) return plate.sourcePath;
  return null;
}

/** Re-inspects plate[0] of a print and refreshes the auto-detected Print.preparedMetadata. */
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
  print: Pick<Print, "id" | "name" | "creator" | "collection" | "tags" | "categoryId" | "userId">,
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

  const record = await prisma.plate.create({
    data: {
      printId: print.id,
      position,
      filename: desiredFilename,
      mime,
      size,
      storagePath,
      sourcePath: input.sourcePath ?? null,
    },
  });

  await thumbnailAndSniff(record.id, desiredFilename, mime, effectivePath);
  return { record, effectivePath };
}

/** Creates a new Print with one or more Plates (in the given order). Used by /upload (single + multiplate). */
export async function createPrint(
  userId: string,
  meta: PrintMetaInput,
  nameHint: string,
  plateInputs: NewPlateInput[],
): Promise<{ print: Print; plates: Plate[] }> {
  if (!plateInputs.length) throw new Error("createPrint requires at least one plate");
  // meta.categoryId can come straight from a request body (upload/import/zip) with no prior
  // ownership check by the caller -- verify here, once, rather than trusting every call site
  // to have already confirmed it (the FK to Category.id alone doesn't prove *this user* owns it).
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
      collection: meta.collection?.trim() || null,
      tags: normalizeTags(meta.tags || []),
      categoryId: meta.categoryId ?? null,
      authorId: meta.authorId ?? null,
      sourceProvider: meta.sourceProvider ?? null,
      sourceExternalId: meta.sourceExternalId ?? null,
    },
  });

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

  return { print, plates };
}

/** Appends one or more plates to an existing print (POST /print/:id/plates). */
export async function addPlatesToPrint(userId: string, printId: string, plateInputs: NewPlateInput[]): Promise<Plate[]> {
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

export async function deletePlateFiles(plate: Pick<Plate, "storagePath">): Promise<void> {
  const abs = path.join(STORAGE, plate.storagePath);
  try {
    await fs.rm(abs, { force: true });
    await pruneEmptyStorageDirs(path.dirname(abs));
  } catch {
    // best-effort cleanup
  }
}

export function mimeForUpload(contentType: string | null | undefined, filename: string): string {
  return mimeFromContentType(contentType, filename);
}
