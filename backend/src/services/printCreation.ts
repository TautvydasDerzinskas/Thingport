import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { prisma } from "../db";
import { STORAGE, PARAMETRIC_SOURCE_EXTS } from "../config";
import { withStorageLock } from "../utils/storageLock";
import { HttpError, sanitizeFilename, guessMimeFromPath, mimeFromContentType } from "../utils/fileUtils";
import { normalizeFolder } from "../utils/fileFolder";
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
import { printAssetHome, type AssetHome } from "./modelAssets";
import { deleteAdapted3mfs } from "./adapted3mfCache";
import { storePlateFormat } from "./threeMfFormat";
import { getPreviewMode } from "./settingsService";
import { reuseMarker, shareStoredCopy, type ReuseMarker } from "./fileReuse";
import { findStoredCopies } from "./storedContent";
import { Prisma } from "@prisma/client";
import type { CategorySource, Plate, Print } from "@prisma/client";
import { enqueueAiCategorization } from "./aiCategorizationService";
import { enqueueAiDescription } from "./aiDescriptionService";
import { deleteAllPrintFiles, removePrintFileIfGone, saveFileFromTemp } from "./printFileService";
import { importingQuietly } from "../utils/quietImport";
import { createKeyedLock } from "../utils/concurrency";
import { authorIdByName } from "./authorService";
import { afterLicenseChange, scheduleLicenseFill } from "./licenseService";

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

export function resolvePlateFilePath(plate: Pick<Plate, "storagePath" | "sourcePath">): string | null {
  const managed = managedPlatePath(plate);
  if (fsSync.existsSync(managed)) return managed;
  if (plate.sourcePath && fsSync.existsSync(plate.sourcePath)) return plate.sourcePath;
  return null;
}

/** What a model's first plate reads as when it's a sliced print, which stands for a prepared print where the model has
 *  none of its own; null when it isn't one. `first`, the plate that is or will be first; the first plate by default. */
async function firstPlateReading(
  printId: string,
  first?: Plate | null,
): Promise<Prisma.InputJsonValue | Prisma.NullTypes.JsonNull> {
  const plate0 =
    first === undefined ? await prisma.plate.findFirst({ where: { printId }, orderBy: { position: "asc" } }) : first;
  const filePath = plate0 ? resolvePlateFilePath(plate0) : null;
  const sniffed = plate0 && filePath ? await inspectPreparedPrint(filePath, plate0.filename) : null;
  return sniffed ? (sniffed as unknown as Prisma.InputJsonValue) : Prisma.JsonNull;
}

/** Reads the model's first plate again for its prepared metadata, with the plate order held: a reorder between the
 *  reading and its saving would leave the reading of a plate that's no longer first. */
export function refreshAutoPreparedMetadata(printId: string): Promise<void> {
  return withPlateOrder(printId, () => refreshPreparedReading(printId));
}

/** The same, for a caller holding the plate order already. */
async function refreshPreparedReading(printId: string): Promise<void> {
  await prisma.print.update({ where: { id: printId }, data: { preparedMetadata: await firstPlateReading(printId) } });
}

/** Reads the model's first plate again when it's `plateId`, as after that plate was renamed: whether it's sliced goes
 *  by its name too. Asked with the plate order held, as a reorder may have made it first, or not, since it was read. */
export function refreshIfFirstPlate(printId: string, plateId: string): Promise<void> {
  return withPlateOrder(printId, async () => {
    const first = await prisma.plate.findFirst({
      where: { printId },
      orderBy: { position: "asc" },
      select: { id: true },
    });
    if (first?.id === plateId) await refreshPreparedReading(printId);
  });
}

type CreatedPlate = { record: Plate; effectivePath: string | null };

async function createPlateAtPosition(
  print: Pick<Print, "id" | "name" | "creator" | "tags" | "categoryId" | "userId" | "authorId" | "sourceProvider">,
  input: NewPlateInput,
  position: number,
): Promise<CreatedPlate> {
  const sanitized = sanitizeFilename(input.filename);
  const folder = normalizeFolder(input.folder);
  const desiredFilename = await availablePlateFilename(print.id, sanitized, undefined, folder);
  const storagePath = await renderPlateStoragePath(print, desiredFilename, position, folder);
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
        folder,
        mime,
        size,
        storagePath,
        sourcePath: input.sourcePath ?? null,
        sourceInstanceId: input.sourceInstanceId ?? null,
        profile: input.profile == null ? undefined : (input.profile as Prisma.InputJsonValue),
        contentSha256,
        ...marker,
      },
    });
  } catch (err) {
    // e.g. a concurrent import of the same profile won; don't orphan the placed file.
    if (effectivePath && !input.sourcePath) await fs.rm(effectivePath, { force: true }).catch(() => undefined);
    throw err;
  }

  try {
    await thumbnailAndSniff(record.id, desiredFilename, mime, effectivePath);
  } catch (err) {
    // Nothing of it left: the caller never learns this plate's id, so a retry would bring it in twice. Its row is read
    // again under the storage lock, as a reorganisation may have moved its file meanwhile, and the file only goes once
    // the row has: a plate listed without its file is worse than a file nothing lists.
    const removed = await withStorageLock(async () => {
      const now = await prisma.plate.findUnique({ where: { id: record.id } });
      if (now) {
        await prisma.plate.delete({ where: { id: record.id } });
        if (!input.sourcePath) await fs.rm(managedPlatePath(now), { force: true }).catch(() => undefined);
      }
      // Its pictures' folder read here too: a move of the model's pictures holds the lock, and once the row is gone,
      // none takes this plate's along.
      return { home: await printAssetHome(print.id) };
    }).catch((failure: unknown) => {
      console.error(`Couldn't take back the plate ${record.id} after its file couldn't be read:`, failure);
      return null;
    });
    if (removed) await removePlatePictures(record.id, removed.home).catch(() => undefined);
    throw err;
  }
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
    `${normalizeFolder(folder) ?? ""}\0${filename.toLowerCase()}`;
  const stored = new Map<string, string[]>();
  const keptNow = new Set<string>();
  for (const file of await prisma.printFile.findMany({
    where: { printId },
    select: { id: true, filename: true, folder: true },
  })) {
    const key = keyOf(file.filename, file.folder);
    stored.set(key, [...(stored.get(key) ?? []), file.id]);
  }
  for (const input of inputs) {
    if (!input.tempFilePath) {
      // Nothing reaches here today -- every caller that passes a script passes a temp file, and the ones that
      // build inputs another way can't carry a script at all -- so a skip means a new caller needs handling.
      console.warn(`Couldn't keep the generator script ${input.filename}: it came with no temporary file.`);
      continue;
    }
    // Compared as it will be stored, since that is the name a second copy would collide with. One whose file is gone
    // for sure, a row a failed sweep of a repair left, makes way for this one rather than keep it out, as does one
    // whose row another sweep has taken since the list was read.
    const safeName = sanitizeFilename(input.filename);
    const key = keyOf(safeName, input.folder);
    if (keptNow.has(key)) continue;
    let held = false;
    for (const id of stored.get(key) ?? []) if (!(await removePrintFileIfGone(id))) held = true;
    if (held) continue;
    // Asked again just before saving, as a copy saved since the list was read is one too.
    const now = await prisma.printFile.findMany({
      where: { printId, filename: { equals: safeName, mode: "insensitive" } },
      select: { filename: true, folder: true },
    });
    if (now.some((file) => keyOf(file.filename, file.folder) === key)) continue;
    try {
      // Plain text, which no mime table knows .scad for, so it is given rather than guessed.
      await saveFileFromTemp(userId, printId, input.tempFilePath, input.filename, "text/plain", {
        folder: input.folder,
      });
      keptNow.add(key);
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
  if (!(await prisma.print.findUnique({ where: { id: printId }, select: { id: true } }))) return;
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
}

/** One model's plate order at a time: where the next plate goes is read and taken, and the plates renumbered, by one
 *  request at a time, so two can't take one place, nor one read the place another is passing through. */
export const withPlateOrder = createKeyedLock();

/** The model's plates in `ids`' order, through negative places first so no two meet on one; one transaction, so no
 *  other request sees the places in between. `before` runs in it first. */
export async function renumberPlates(ids: string[], before: Prisma.PrismaPromise<unknown>[] = []): Promise<void> {
  await prisma.$transaction([
    ...before,
    ...ids.map((id, idx) => prisma.plate.update({ where: { id }, data: { position: -(idx + 1) } })),
    ...ids.map((id, idx) => prisma.plate.update({ where: { id }, data: { position: idx } })),
  ]);
}

/** Plates made from `inputs` after the model's others, each put in `made` as it's made, so a caller whose batch fails
 *  part-way knows every one there is to take back. With the plate order held. */
async function addPlatesAfter(print: Print, inputs: NewPlateInput[], made: Plate[] = []): Promise<Plate[]> {
  const maxPosition = await prisma.plate.aggregate({ where: { printId: print.id }, _max: { position: true } });
  let nextPosition = (maxPosition._max.position ?? -1) + 1;
  const created: Plate[] = [];
  for (const input of inputs) {
    const { record } = await createPlateAtPosition(print, input, nextPosition);
    created.push(record);
    made.push(record);
    nextPosition += 1;
  }
  return created;
}

export async function addPlatesToPrint(
  userId: string,
  printId: string,
  plateInputs: NewPlateInput[],
): Promise<Plate[]> {
  return withPlateOrder(printId, async () => {
    // Read once it's this one's turn: where the plates go is the model's place as it is then.
    const print = await prisma.print.findFirst({ where: { id: printId, userId } });
    if (!print) throw new Error("Print not found");
    return addPlatesAfter(print, plateInputs);
  });
}

/**
 * Runs `run` with the model's plate order held until it's done, for a request that adds plates and must take them all
 * back when a later step fails: no other change to the model's plates made through the plate order (adding, removing,
 * reordering) comes in between, so the others are all still there and these can't become the model's only ones. A
 * repair of a model whose files are gone, and a merge, change plates outside it. `add` adds plates after the others;
 * when `run` fails, every one it added goes again.
 */
export async function withPlateBatch<T>(
  userId: string,
  printId: string,
  run: (add: (inputs: NewPlateInput[]) => Promise<Plate[]>) => Promise<T>,
): Promise<T> {
  return withPlateOrder(printId, async () => {
    // Read once it's this one's turn: where the plates go is the model's place as it is then.
    const print = await prisma.print.findFirst({ where: { id: printId, userId } });
    if (!print) throw new HttpError(404, "Print not found");
    const added: Plate[] = [];
    try {
      return await run((inputs) => addPlatesAfter(print, inputs, added));
    } catch (err) {
      await takeBackPlates(printId, added).catch((failure: unknown) =>
        console.error(`Couldn't take back the plates a failed request added to model ${printId}:`, failure),
      );
      throw err;
    }
  });
}

/** The plates a request added, taken back. Never the model's last: one left with none is a model the scan passes over,
 *  so those stay, and the caller says what went wrong. With the plate order held. */
async function takeBackPlates(printId: string, added: Plate[]): Promise<void> {
  if (!added.length) return;
  const plates = await prisma.plate.findMany({ where: { printId }, orderBy: { position: "asc" } });
  const ids = new Set(added.map((plate) => plate.id));
  const gone = plates.filter((plate) => ids.has(plate.id));
  if (!gone.length) return;
  if (gone.length === plates.length) throw new Error("Taking them back would leave the model with no plate");
  await afterPlatesRemoved(await removePlateRows(printId, gone, plates));
}

type RemovedPlates = { plates: Plate[]; home: AssetHome };

/**
 * Takes `gone` out of the model's plates, `plates` in their order: their rows go and the others are renumbered in one
 * transaction, with a new first plate's reading for the prepared metadata, as a reorder saves it (reorderPlates); then
 * their files go. Under the storage lock, the rows read there, as a move holds it while it renames a file and saves
 * where it went: a path read before it could be one the file has just left. The pictures' folder is read there too.
 * With the plate order held.
 */
async function removePlateRows(printId: string, gone: Plate[], plates: Plate[]): Promise<RemovedPlates> {
  const ids = [...new Set(gone.map((plate) => plate.id))];
  const rest = plates.filter((plate) => !ids.includes(plate.id));
  // Read before the lock, which nothing else may use while a file is read through.
  const reading =
    plates[0] && ids.includes(plates[0].id)
      ? [
          prisma.print.update({
            where: { id: printId },
            data: { preparedMetadata: await firstPlateReading(printId, rest[0] ?? null) },
          }),
        ]
      : [];
  return withStorageLock(async () => {
    const now = await prisma.plate.findMany({ where: { id: { in: ids } } });
    await renumberPlates(
      rest.map((plate) => plate.id),
      [prisma.plate.deleteMany({ where: { id: { in: ids } } }), ...reading],
    );
    for (const plate of now) await fs.rm(managedPlatePath(plate), { force: true }).catch(() => undefined);
    return { plates: now, home: await printAssetHome(printId) };
  });
}

/** What's left of plates whose rows and files have gone: their adapted copies, emptied folders and pictures. */
async function afterPlatesRemoved({ plates, home }: RemovedPlates): Promise<void> {
  for (const plate of plates) {
    await deleteAdapted3mfs(plate.id).catch(() => undefined);
    await pruneEmptyStorageDirs(path.dirname(managedPlatePath(plate))).catch(() => undefined);
    await removePlatePictures(plate.id, home).catch(() => undefined);
  }
}

/** Removes one of the model's plates and its file. The only plate can't go: the model is deleted instead. */
export async function removePlate(print: Pick<Print, "id">, plateId: string): Promise<void> {
  const removed = await withPlateOrder(print.id, async () => {
    const plates = await prisma.plate.findMany({ where: { printId: print.id }, orderBy: { position: "asc" } });
    const found = plates.find((p) => p.id === plateId);
    if (!found) throw new HttpError(404, "Plate not found");
    if (plates.length <= 1) {
      throw new HttpError(409, "Cannot remove the only plate of a print; delete the print instead.");
    }
    return removePlateRows(print.id, [found], plates);
  });
  await afterPlatesRemoved(removed);
}

/**
 * Puts the model's plates in `ids`' order, which must name each of them once. A new first plate's reading for the
 * prepared metadata is saved in the same transaction as the order: neither is saved without the other, so asking again
 * after a failure finds the old first plate and reads the new one again.
 */
export function reorderPlates(printId: string, ids: string[]): Promise<void> {
  return withPlateOrder(printId, async () => {
    const plates = await prisma.plate.findMany({ where: { printId }, orderBy: { position: "asc" } });
    const byId = new Map(plates.map((plate) => [plate.id, plate]));
    if (ids.length !== plates.length || new Set(ids).size !== ids.length || ids.some((id) => !byId.has(id))) {
      throw new HttpError(400, "plate_ids must contain exactly the print's current plate ids");
    }
    const reading =
      ids[0] === plates[0]?.id
        ? []
        : [
            prisma.print.update({
              where: { id: printId },
              data: { preparedMetadata: await firstPlateReading(printId, byId.get(ids[0])) },
            }),
          ];
    await renumberPlates(ids, reading);
  });
}

/** Renames one of the model's plates, suffixed when another plate has the name. Returns the name it got. */
export async function renamePlate(print: Print, plateId: string, filename: string): Promise<string> {
  const plate = await prisma.plate.findUnique({ where: { id: plateId } });
  if (!plate || plate.printId !== print.id) throw new HttpError(404, "Plate not found");
  const nextFilename = await availablePlateFilename(print.id, sanitizeFilename(filename), plate.id, plate.folder);
  if (nextFilename !== plate.filename) {
    await prisma.plate.update({ where: { id: plate.id }, data: { filename: nextFilename } });
    await relocatePrint(print, [{ ...plate, filename: nextFilename }]);
    await refreshIfFirstPlate(print.id, plate.id);
  }
  return nextFilename;
}

export async function deletePlateFiles(plate: Pick<Plate, "id" | "storagePath">): Promise<void> {
  await deleteAdapted3mfs(plate.id);
  const abs = path.join(STORAGE, plate.storagePath);
  try {
    await fs.rm(abs, { force: true });
    await pruneEmptyStorageDirs(path.dirname(abs));
  } catch {}
}

export function mimeForUpload(contentType: string | null | undefined, filename: string): string {
  return mimeFromContentType(contentType, filename);
}
