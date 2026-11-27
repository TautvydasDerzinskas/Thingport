import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { setInterval as intervals, setTimeout as delay } from "node:timers/promises";
import { prisma } from "../db";
import { removeModel } from "../modelFiles/removeModel";
import { STORAGE, PARAMETRIC_SOURCE_EXTS } from "../config";
import { withStorageLock } from "../utils/storageLock";
import { createKeyedLock } from "../utils/concurrency";
import { HttpError, guessMimeFromPath, mimeFromContentType } from "../utils/fileUtils";
import { LEGACY } from "../files/kinds";
import { nameKey, normalizeFileName, preservesFileExtension } from "../files/names";
import { normalizeFolder } from "../utils/fileFolder";
import { normalizeTags } from "../utils/tagNormalization";
import { fileState, fileStateSync, isMissingError, type StorageSite } from "../modelFiles/storageFs";
import { inspectPreparedPrint } from "./preparedPrint";
import {
  availableModelName,
  availablePlateFilename,
  freePlateFilename,
  ensureAssetHome,
  ensurePlateThumbnail,
  managedPlatePath,
  pruneEmptyStorageDirs,
  relocatePrint,
  removePlatePictures,
  renderPlateStoragePath,
  saveThumbFromFile,
} from "./printService";
import { generateModelPreviewGlb, canRenderModelImage } from "./modelPreviewCache";
import { generateCardRender } from "./previewImageService";
import { deleteAdapted3mfs } from "./adapted3mfCache";
import { storePlateFormat } from "./threeMfFormat";
import { getPreviewMode } from "./settingsService";
import { reuseMarker, sha256OfRegularFile, shareStoredCopy, type ReuseMarker } from "./fileReuse";
import { findStoredCopies } from "./storedContent";
import { Prisma } from "@prisma/client";
import type { CategorySource, Plate, Print } from "@prisma/client";
import { enqueueAiCategorization } from "./aiCategorizationService";
import { enqueueAiDescription } from "./aiDescriptionService";
import { saveFileFromTemp } from "./printFileService";
import { importingQuietly } from "../utils/quietImport";
import { authorIdByName } from "./authorService";
import { afterLicenseChange, scheduleLicenseFill } from "./licenseService";

const IMAGE_EXTS = LEGACY.photo;

export type NewPlateInput = {
  /** Untrusted; will be sanitized. */
  filename: string;
  /** Stable client ID for a retryable upload; used to deduplicate uncertain requests. */
  clientUploadId?: string;
  mime?: string | null;
  size?: number;
  /** Exactly one of tempFilePath / copyFromPath / sourcePath should be set. */
  tempFilePath?: string; // moved (renamed) into managed storage, source is deleted
  copyFromPath?: string; // copied into managed storage, source left intact
  sourcePath?: string; // no-copy: file stays at this path, storagePath is still rendered/recorded
  sourceInstanceId?: string | null;
  /** What was read of the print profile it is (Plate.profile), carried over by a copy so it isn't read again. */
  profile?: Prisma.JsonValue | null;
  /** The folder its source kept it in (Plate.folder); untrusted, normalized here. */
  folder?: string | null;
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
  /** What its source had nothing for at the last fill (Print.unfillableGaps), carried over by a copy. */
  unfillableGaps?: string[];
  /** The source has the script this model is generated from, but its creator chose not to share it. */
  generatorScriptWithheld?: boolean;
  /** Another user's model this one is a copy of (services/modelCopyService.ts), and the first original behind it. */
  copiedFromId?: string | null;
  originalId?: string | null;
  /** A copy of a partner instance's model: where it came from (federation/remoteCopy.ts). */
  remoteSource?: Prisma.InputJsonValue | null;
  /** What made it, when Thingport did (Print.createdWith): one of the Tools, by slug, or a Studio design, by id. */
  createdWith?: { kind: "tool" | "studio"; ref: string } | null;
  /** Its licence's columns (services/licenseService.ts): what an import read, or what a copy carries over. Absent on an
   *  import that didn't look, whose licence is then read once it has settled. */
  licenseColumns?: Partial<Pick<Prisma.PrintUncheckedCreateInput, "license" | "licenseAllows" | "licenseReadAt">>;
};

/** Never over another file: a link fails on one that's there, where a rename would replace it. Only the placing is
 *  under the storage lock (the file reuse backfill's swap renames over a path it has just checked, and mustn't land
 *  after a file saved at a path its row just freed); removing the temp file is not. */
async function placeFile(input: NewPlateInput, destAbsPath: string): Promise<string | null> {
  // Nothing is placed for a tool's plate, which reads the tool's file: no folder is made for it either.
  if (input.tempFilePath || input.copyFromPath) await fs.mkdir(path.dirname(destAbsPath), { recursive: true });
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
    await storePlateFormat(plateId, filename, effectivePath);
    await ensurePlateThumbnail(plateId, effectivePath);
    // "on-demand" builds the preview on first view, "disabled" never. Not awaited: it can be slow.
    if ((await getPreviewMode()) === "automatic") void generateModelPreviewGlb(plateId, effectivePath);
  }
  // Queued behind the GLB, which the model page needs first.
  if (canRenderModelImage(filename) && (await getPreviewMode()) === "automatic") {
    void generateCardRender(plateId, effectivePath, filename);
  }
}

/** The plate's file, or null when no file is there. A plate with a sourcePath (a tool's) is read there only: the file
 *  is the tool's, and its path under storage is only reserved. An error other than a missing file throws (Fs 1), so a
 *  caller never takes a disk that failed to answer for a file that's gone. */
export function resolvePlateFilePath(
  plate: Pick<Plate, "storagePath" | "sourcePath">,
  site: StorageSite = "plate.file",
): string | null {
  const abs = plate.sourcePath ?? managedPlatePath(plate);
  return fileStateSync(abs, site).state === "file" ? abs : null;
}

export async function refreshAutoPreparedMetadata(printId: string): Promise<void> {
  const plate0 = await prisma.plate.findFirst({ where: { printId }, orderBy: { position: "asc" } });
  let metadata: Prisma.InputJsonValue | null = null;
  if (plate0) {
    let filePath: string | null;
    try {
      filePath = resolvePlateFilePath(plate0);
    } catch (err) {
      // An error says nothing of what the file holds, so the reading stays. The caller's change is saved already.
      console.warn(`Couldn't look at plate ${plate0.id}'s file; the model's print facts stay as they were:`, err);
      return;
    }
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
type PlateUploadClaim = { printId: string; clientUploadId: string; claimToken: string };

/** Serialises every change to a model's plate list (names, positions, additions and removals), so none of them reads
 *  another's half: a temporary position, or a name about to be taken. */
function lockPlateList(tx: Prisma.TransactionClient, printId: string) {
  return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('plate-names'), hashtext(${printId}))`;
}

/** The name or position a plate was prepared with stopped being the model's next while its file was placed. */
class PlateListChangedError extends Error {}

/** Held while a rename commits names and moves their files, and by anything that reads those files meanwhile. */
const withPlateRenameLock = createKeyedLock();

/** Through negative positions first, so no step collides with another plate's on (printId, position). The caller holds
 *  lockPlateList. */
async function renumberPlates(tx: Prisma.TransactionClient, ids: string[]): Promise<void> {
  await Promise.all(ids.map((id, idx) => tx.plate.update({ where: { id }, data: { position: -(idx + 1) } })));
  await Promise.all(ids.map((id, idx) => tx.plate.update({ where: { id }, data: { position: idx } })));
}

async function createPlateAtPosition(
  print: Pick<Print, "id" | "name" | "creator" | "tags" | "categoryId" | "userId" | "authorId" | "sourceProvider">,
  input: NewPlateInput,
  position: number,
  claim?: PlateUploadClaim,
): Promise<CreatedPlate> {
  const sanitized = normalizeFileName(input.filename);
  const folder = normalizeFolder(input.folder);
  const desiredFilename = await availablePlateFilename(print.id, sanitized, undefined, folder);
  const storagePath = await renderPlateStoragePath(print, desiredFilename, position, folder);
  const destAbsPath = path.join(STORAGE, storagePath);
  const { effectivePath, contentSha256, marker } = await placePlateFile(input, destAbsPath);
  const size = await resolveSize(input, effectivePath);
  const mime = input.mime || guessMimeFromPath(desiredFilename) || "application/octet-stream";

  let record: Plate;
  try {
    const data: Prisma.PlateUncheckedCreateInput = {
      printId: print.id,
      position,
      filename: desiredFilename,
      folder,
      mime,
      size,
      storagePath,
      sourcePath: input.sourcePath ?? null,
      sourceInstanceId: input.sourceInstanceId ?? null,
      profile: input.profile == null ? undefined : (input.profile as Prisma.InputJsonValue),
      contentSha256,
      ...marker,
    };
    record = await prisma.$transaction(async (tx) => {
      await lockPlateList(tx, print.id);
      // The storage path was prepared outside the lock from this name and position: both must still be the model's
      // next before they're published.
      const last = await tx.plate.aggregate({ where: { printId: print.id }, _max: { position: true } });
      if (
        (last._max.position ?? -1) + 1 !== position ||
        (await availablePlateFilename(print.id, sanitized, undefined, folder, tx)) !== desiredFilename
      ) {
        throw new PlateListChangedError();
      }
      const plate = await tx.plate.create({ data });
      if (claim) await completePlateUpload(tx, claim, plate.id);
      return plate;
    });
  } catch (err) {
    // e.g. a concurrent import of the same profile won; don't orphan the placed file.
    if (effectivePath && !input.sourcePath) await fs.rm(effectivePath, { force: true }).catch(() => undefined);
    throw err;
  }

  // Keep the submitted file until the row commits, so an append collision can be retried under the same claim.
  if (input.tempFilePath) await fs.rm(input.tempFilePath, { force: true }).catch(() => undefined);
  await thumbnailAndSniff(record.id, desiredFilename, mime, effectivePath);
  // A print profile's facts are read once its import has settled. Loaded when used: the service reaches this file.
  if (record.sourceInstanceId) {
    void import("./printProfileService").then(({ scheduleProfileFill }) => scheduleProfileFill(print.id));
  }
  return { record, effectivePath };
}

/**
 * Generator scripts kept beside a model as supporting files, which is the only way one ever reaches a model: it
 * describes a shape but holds none, so it is never a plate.
 *
 * Best-effort -- a script that won't store leaves the model itself there, since its plates are what the user asked
 * for. Line endings are put right by saveFileFromTemp, wherever a script comes from.
 */
export async function keepGeneratorScripts(userId: string, printId: string, inputs: NewPlateInput[]): Promise<void> {
  if (!inputs.length) return;
  // A model's own script comes down again with every profile imported after the first (see importService's
  // addProfiles), and storing it each time would leave the model holding "model.scad", "model (1).scad" and on.
  const keyOf = (filename: string, folder: string | null | undefined) =>
    nameKey(normalizeFolder(folder), normalizeFileName(filename));
  const stored = new Set(
    (await prisma.printFile.findMany({ where: { printId }, select: { filename: true, folder: true } })).map((file) =>
      keyOf(file.filename, file.folder),
    ),
  );
  for (const input of inputs) {
    if (!input.tempFilePath) {
      // Nothing reaches here today -- every caller that passes a script passes a temp file, and the ones that
      // build inputs another way can't carry a script at all -- so a skip means a new caller needs handling.
      console.warn(`Couldn't keep the generator script ${input.filename}: it came with no temporary file.`);
      continue;
    }
    // Compared as it will be stored, since that is the name a second copy would collide with.
    const key = keyOf(input.filename, input.folder);
    if (stored.has(key)) continue;
    try {
      // Plain text, which no mime table knows .scad for, so it is given rather than guessed.
      await saveFileFromTemp(userId, printId, input.tempFilePath, input.filename, "text/plain", {
        folder: input.folder,
      });
      stored.add(key);
    } catch (err) {
      console.warn(`Couldn't keep the generator script ${input.filename}:`, err);
    }
  }
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
  // An import that couldn't fetch the author still has their name: the author another import saved, if only one goes
  // by it. Never fails the import.
  const creator = meta.creator?.trim() || null;
  const authorId =
    meta.authorId ??
    (creator && meta.sourceProvider ? await authorIdByName(meta.sourceProvider, creator).catch(() => null) : null);

  const print = await prisma.print.create({
    data: {
      userId,
      name: finalName,
      nameNormalized: finalName.trim().toLowerCase(),
      title: meta.title ?? null,
      notes: meta.notes ?? null,
      creator,
      tags: normalizeTags(meta.tags || []),
      categoryId: meta.categoryId ?? null,
      categorySource: meta.categoryId ? (meta.categorySource ?? "MANUAL") : null,
      authorId,
      sourceProvider: meta.sourceProvider ?? null,
      sourceExternalId: meta.sourceExternalId ?? null,
      unfillableGaps: meta.unfillableGaps ?? [],
      generatorScriptWithheld: meta.generatorScriptWithheld ?? false,
      copiedFromId: meta.copiedFromId ?? null,
      originalId: meta.originalId ?? null,
      remoteSource: meta.remoteSource ?? undefined,
      ...meta.licenseColumns,
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

    await keepGeneratorScripts(userId, print.id, sourceInputs);
    // Once the files are in place, so LICENSE.txt lands in the folder they chose.
    if (meta.licenseColumns?.licenseReadAt) await afterLicenseChange(print.id);
    else if (print.sourceProvider) scheduleLicenseFill(print.id);
    // What made it goes on last, once nothing above can discard it: achievements count models by it, and a badge
    // given for one that never finished would stay.
    const made = meta.createdWith
      ? await prisma.print.update({
          where: { id: print.id },
          data: { createdWith: meta.createdWith.kind, createdWithRef: meta.createdWith.ref },
        })
      : print;

    // Background classification is intentionally detached: importing a model must not wait for,
    // or fail because of, a third-party AI provider.
    const quiet = importingQuietly();
    if (!print.categoryId && classify && !quiet) void enqueueAiCategorization(userId, print.id);
    if (describe && !quiet) enqueueAiDescription(userId, print.id);
    return { print: made, plates };
  } catch (err) {
    await discardPrint(print.id);
    throw err;
  }
}

/** Undoes a half-created print, so a failure doesn't leave a model with only some of its files. */
export async function discardPrint(printId: string): Promise<void> {
  try {
    await discardPrintOrThrow(printId);
  } catch (err) {
    console.error("Failed to discard half-created print", printId, err);
  }
}

/** The same, failing when the print couldn't be removed, for a caller that must know it's gone. One that isn't there
 *  is gone already. */
export async function discardPrintOrThrow(printId: string): Promise<void> {
  const went = await removeModel(printId);
  if (!went) return;
  // An author or tag only this model brought, as an import's can be, goes with it. Loaded here: the tag services lead
  // back to the provider registry, which loads this module.
  const { pruneWhatModelsLeft } = await import("./printEditService");
  await pruneWhatModelsLeft(went.userId, [went]);
}

export async function addPlatesToPrint(
  userId: string,
  printId: string,
  plateInputs: NewPlateInput[],
): Promise<Plate[]> {
  const print = await prisma.print.findFirst({ where: { id: printId, userId } });
  if (!print) throw new Error("Print not found");

  const created: Plate[] = [];
  for (const input of plateInputs) {
    created.push(
      input.clientUploadId
        ? await createPlateIdempotently(print, input, input.clientUploadId)
        : await appendPlate(print, input),
    );
  }
  return created;
}

const MAX_PLATE_APPEND_ATTEMPTS = 5;

async function appendPlate(
  print: Parameters<typeof createPlateAtPosition>[0],
  input: NewPlateInput,
  claim?: PlateUploadClaim,
): Promise<Plate> {
  for (let attempt = 0; attempt < MAX_PLATE_APPEND_ATTEMPTS; attempt++) {
    // A replay may have waited for a request that appended other files as well as the one it was waiting for.
    const maxPosition = await prisma.plate.aggregate({ where: { printId: print.id }, _max: { position: true } });
    const position = (maxPosition._max.position ?? -1) + 1;
    try {
      return (await createPlateAtPosition(print, input, position, claim)).record;
    } catch (error) {
      if (error instanceof PlateListChangedError) continue;
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
      const target = error.meta?.target;
      if (!Array.isArray(target) || !target.includes("printId") || !target.includes("position")) throw error;
    }
  }
  throw new HttpError(409, "The plate name or position changed during upload; try again");
}

const UPLOAD_ATTEMPT_POLL_MS = 100;
const UPLOAD_ATTEMPT_MAX_POLLS = 300;
const UPLOAD_LEASE_SECONDS = 30;
const UPLOAD_HEARTBEAT_MS = 5_000;

function uploadMarker(clientUploadId: string): string {
  return `thingport-upload-${clientUploadId}-`;
}

/** A plate an older server stored under this upload's marker with these bytes. The caller holds withPlateRenameLock,
 *  so a rename moving these files can't make one look missing. */
async function findPlateForUpload(
  printId: string,
  clientUploadId: string,
  contentSha256: string,
): Promise<Plate | undefined> {
  const candidates = await prisma.plate.findMany({
    where: { printId, filename: { startsWith: uploadMarker(clientUploadId) } },
  });
  const matches: Plate[] = [];
  for (const candidate of candidates) {
    const stored = resolvePlateFilePath(candidate);
    if (!stored) continue;
    try {
      if ((await sha256OfRegularFile(stored)) === contentSha256) matches.push(candidate);
    } catch (error) {
      if (!isMissingError(error)) throw error;
    }
  }
  if (matches.length > 1) throw new HttpError(409, "Multiple plates match this upload attempt");
  return matches[0];
}

function plateUploadOutcomeRecordingError(uploadError: unknown, attemptError: unknown): AggregateError {
  return new AggregateError([uploadError, attemptError], "Failed to record the plate upload outcome", {
    cause: uploadError,
  });
}

async function claimPlateUpload(
  { printId, clientUploadId, claimToken }: PlateUploadClaim,
  contentSha256: string,
): Promise<boolean> {
  // The first claim records the bytes; a later one only takes over an attempt for the same bytes.
  const count = await prisma.$executeRaw`
    INSERT INTO "PlateUploadAttempt"
      ("id", "printId", "clientUploadId", "status", "contentSha256", "claimToken", "leaseExpiresAt")
    VALUES (${claimToken}, ${printId}, ${clientUploadId}, 'pending', ${contentSha256}, ${claimToken},
            (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + make_interval(secs => ${UPLOAD_LEASE_SECONDS}::int))
    ON CONFLICT ("printId", "clientUploadId") DO UPDATE
      SET "status" = 'pending', "plateId" = NULL, "claimToken" = EXCLUDED."claimToken",
          "leaseExpiresAt" = EXCLUDED."leaseExpiresAt"
      WHERE "PlateUploadAttempt"."contentSha256" = EXCLUDED."contentSha256"
        AND ("PlateUploadAttempt"."status" = 'failed'
             OR ("PlateUploadAttempt"."status" = 'pending'
                 AND ("PlateUploadAttempt"."leaseExpiresAt" IS NULL
                      OR "PlateUploadAttempt"."leaseExpiresAt" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))))
  `;
  return count === 1;
}

async function renewPlateUploadClaim(claim: PlateUploadClaim, signal: AbortSignal): Promise<void> {
  try {
    for await (const _ of intervals(UPLOAD_HEARTBEAT_MS, undefined, { signal, ref: false })) {
      try {
        const count = await prisma.$executeRaw`
          UPDATE "PlateUploadAttempt"
          SET "leaseExpiresAt" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + make_interval(secs => ${UPLOAD_LEASE_SECONDS}::int)
          WHERE "printId" = ${claim.printId} AND "clientUploadId" = ${claim.clientUploadId}
            AND "claimToken" = ${claim.claimToken} AND "status" = 'pending'
            AND "leaseExpiresAt" > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
        `;
        if (count === 0) return;
      } catch (error) {
        console.warn("Couldn't renew the plate upload claim:", error);
      }
    }
  } catch (error) {
    if (!signal.aborted) throw error;
  }
}

async function completePlateUpload(db: Prisma.TransactionClient, claim: PlateUploadClaim, plateId: string) {
  const completed = await db.plateUploadAttempt.updateMany({
    where: { ...claim, status: "pending" },
    data: { status: "complete", plateId, claimToken: null, leaseExpiresAt: null },
  });
  // A worker whose lease was reclaimed must roll back its plate insert.
  if (completed.count !== 1) throw new HttpError(409, "The plate upload claim was lost; try again");
}

async function createClaimedPlateUpload(
  print: Parameters<typeof createPlateAtPosition>[0],
  input: NewPlateInput,
  claim: PlateUploadClaim,
  contentSha256: string,
): Promise<Plate> {
  const controller = new AbortController();
  const heartbeat = renewPlateUploadClaim(claim, controller.signal);
  try {
    // Older servers could store the plate before recording that the attempt completed.
    const existing = await withPlateRenameLock(print.id, () =>
      findPlateForUpload(print.id, claim.clientUploadId, contentSha256),
    );
    if (existing) {
      await completePlateUpload(prisma, claim, existing.id);
      return existing;
    }
    return await appendPlate(print, input, claim);
  } catch (error) {
    try {
      await prisma.plateUploadAttempt.updateMany({
        where: { ...claim, status: "pending" },
        data: { status: "failed", plateId: null, claimToken: null, leaseExpiresAt: null },
      });
    } catch (attemptError) {
      throw plateUploadOutcomeRecordingError(error, attemptError);
    }
    throw error;
  } finally {
    controller.abort();
    await heartbeat;
  }
}

async function createPlateIdempotently(
  print: Parameters<typeof createPlateAtPosition>[0],
  input: NewPlateInput,
  clientUploadId: string,
): Promise<Plate> {
  const submitted = input.tempFilePath ?? input.copyFromPath ?? input.sourcePath;
  if (!submitted) throw new HttpError(400, "An upload ID needs the uploaded file");
  // Read from what was sent, never from the stored plate, which may have been edited since or be moving.
  const contentSha256 = await sha256OfRegularFile(submitted);
  const where = { printId_clientUploadId: { printId: print.id, clientUploadId } };
  const claim = { ...where.printId_clientUploadId, claimToken: randomUUID() };

  for (let poll = 0; poll < UPLOAD_ATTEMPT_MAX_POLLS; poll += 1) {
    const attempt = await prisma.plateUploadAttempt.findUnique({ where });
    // An upload ID names one file: other bytes under it are another file, which a replay would report as saved.
    if (attempt && attempt.contentSha256 !== contentSha256) {
      throw new HttpError(409, "This upload ID was already used for a different file");
    }
    if (attempt?.status === "complete") {
      const completedPlate = attempt.plateId
        ? await prisma.plate.findFirst({ where: { id: attempt.plateId, printId: print.id } })
        : null;
      if (!completedPlate) throw new HttpError(409, "The original plate upload is no longer available");
      return completedPlate;
    }

    if (attempt && attempt.status !== "pending" && attempt.status !== "failed") {
      throw new HttpError(409, "The plate upload attempt has an invalid status");
    }

    if (await claimPlateUpload(claim, contentSha256)) {
      return createClaimedPlateUpload(print, input, claim, contentSha256);
    }
    await delay(UPLOAD_ATTEMPT_POLL_MS);
  }

  throw new HttpError(409, "The matching plate upload is still processing");
}

/** Removes one of the model's plates and its file. The only plate can't go: the model is deleted instead. */
export async function removePlate(print: Pick<Print, "id" | "assetsPath">, plateId: string): Promise<void> {
  // A rename moves its files after its names commit: held off until the file this row names is the one removed.
  await withPlateRenameLock(print.id, () => removePlateUnlocked(print, plateId));
}

async function removePlateUnlocked(print: Pick<Print, "id" | "assetsPath">, plateId: string): Promise<void> {
  // The removal and the renumbering commit together, so a failure leaves the plates as they were.
  const target = await prisma.$transaction(async (tx) => {
    await lockPlateList(tx, print.id);
    const plates = await tx.plate.findMany({ where: { printId: print.id }, orderBy: { position: "asc" } });
    const found = plates.find((p) => p.id === plateId);
    if (!found) throw new HttpError(404, "Plate not found");
    if (plates.length <= 1) {
      throw new HttpError(409, "Cannot remove the only plate of a print; delete the print instead.");
    }
    await tx.plate.delete({ where: { id: found.id } });
    await renumberPlates(
      tx,
      plates.filter((p) => p.id !== found.id).map((p) => p.id),
    );
    return found;
  });
  await deletePlateFiles(target);
  await removePlatePictures(target.id, print.assetsPath);
  if (target.position === 0) await refreshAutoPreparedMetadata(print.id);
}

/** Puts the model's plates in this order; `plateIds` must be exactly its plates. True when the first one changed. */
export async function reorderPlates(printId: string, plateIds: string[]): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    await lockPlateList(tx, printId);
    const plates = await tx.plate.findMany({ where: { printId }, orderBy: { position: "asc" }, select: { id: true } });
    if (new Set(plateIds).size !== plateIds.length) throw new HttpError(400, "plate_ids lists a plate twice");
    const known = new Set(plates.map((plate) => plate.id));
    // Coded, so the app can tell another editor's added or removed plate from a list it got wrong.
    if (plateIds.length !== plates.length || plateIds.some((id) => !known.has(id))) {
      throw new HttpError(400, "plate_ids must contain exactly the print's current plate ids", "plate_set_changed");
    }
    await renumberPlates(tx, plateIds);
    return plates[0]?.id !== plateIds[0];
  });
}

type PlateRename = { plate_id: string; filename: string };

async function applyPlateRenames(print: Print, edits: PlateRename[]): Promise<Plate[]> {
  return withPlateRenameLock(print.id, async () => {
    const renamed = await prisma.$transaction(async (tx) => {
      await lockPlateList(tx, print.id);
      const plates = await tx.plate.findMany({ where: { printId: print.id } });
      const byId = new Map(plates.map((plate) => [plate.id, plate]));
      const planned = edits.map(({ plate_id, filename }) => {
        const plate = byId.get(plate_id);
        if (!plate) throw new HttpError(404, "Plate not found", "plate_not_found");
        if (!preservesFileExtension(plate.filename, filename)) {
          throw new HttpError(400, "Keep the file's original extension");
        }
        return { plate, target: normalizeFileName(filename) };
      });
      // Every file the new names will move is looked at first, so a disk that can't answer stops this with no name
      // recorded. A move that fails after the commit keeps its source readable, and the same rename again retries it.
      for (const { plate } of planned) {
        if (!plate.sourcePath) await fileState(managedPlatePath(plate), "rename.look");
      }

      const movingNames = new Set(
        planned
          .filter(({ plate, target }) => target.toLowerCase() !== plate.filename.toLowerCase())
          .map(({ plate }) => plate.id),
      );
      const takenByFolder = new Map<string | null, Set<string>>();
      for (const plate of plates) {
        if (movingNames.has(plate.id)) continue;
        const taken = takenByFolder.get(plate.folder) ?? new Set<string>();
        taken.add(plate.filename.toLowerCase());
        takenByFolder.set(plate.folder, taken);
      }
      const updated: Plate[] = [];
      for (const { plate, target } of planned) {
        const taken = takenByFolder.get(plate.folder) ?? new Set<string>();
        const filename = movingNames.has(plate.id) ? freePlateFilename(target, taken) : target;
        taken.add(filename.toLowerCase());
        takenByFolder.set(plate.folder, taken);
        updated.push(
          filename === plate.filename ? plate : await tx.plate.update({ where: { id: plate.id }, data: { filename } }),
        );
      }
      return updated;
    });

    // Commit logical names together. Each storage move can be retried, and a failed move keeps its source readable.
    // A repeated request still runs relocation in case the names committed before an earlier move failed.
    await relocatePrint(print, renamed);
    if (renamed.some((plate) => plate.position === 0)) await refreshAutoPreparedMetadata(print.id);
    return renamed;
  });
}

/** Renames one plate, numbering apart from a sibling already using its target name. */
export async function renamePlate(print: Print, plateId: string, filename: string): Promise<string> {
  const [renamed] = await applyPlateRenames(print, [{ plate_id: plateId, filename }]);
  return renamed.filename;
}

/** Commits dependent names together so a swap can be retried, including its storage moves. */
export async function renamePlates(print: Print, edits: PlateRename[]): Promise<void> {
  await applyPlateRenames(print, edits);
}

export async function deletePlateFiles(plate: Pick<Plate, "id" | "storagePath" | "sourcePath">): Promise<void> {
  await deleteAdapted3mfs(plate.id);
  // A tool's plate reads the tool's file, which isn't the model's to remove.
  if (plate.sourcePath) return;
  const abs = path.join(STORAGE, plate.storagePath);
  try {
    await fs.rm(abs, { force: true });
    await pruneEmptyStorageDirs(path.dirname(abs));
  } catch {}
}

export function mimeForUpload(contentType: string | null | undefined, filename: string): string {
  return mimeFromContentType(contentType, filename);
}
