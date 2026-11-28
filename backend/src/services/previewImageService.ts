import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { prisma } from "../db";
import { HttpError } from "../utils/fileUtils";
import { isMissingError } from "../modelFiles/storageFs";
import { generateModelImage } from "./modelPreviewCache";
import { photoJpeg, renderThumbShade } from "./imageProcessing";
import {
  assetExists,
  assetIsThere,
  assetPath,
  assetTarget,
  findAsset,
  galleryImageFile,
  galleryThumbFile,
  legacyAssetPath,
  plateAssetHome,
  plateThumbFile,
  printAssetHome,
  removeAsset,
  removeAssetOrThrow,
  type AssetHome,
} from "./modelAssets";
import { plainWriteMode, reuseMarker, shareStoredBytes, type ReuseMarker } from "./fileReuse";
import { findStoredCopies } from "./storedContent";
import { ensureAssetHome, plateThumbExists, plateThumbPath, saveThumbFromBytes } from "./printService";
import { Prisma, type PreviewImage } from "@prisma/client";

/** `home` is the image's model's Print.assetsPath. */
export function previewImagePath(id: string, home: AssetHome): string {
  return assetPath(home, galleryImageFile(id));
}

export function previewImageExists(id: string, home: AssetHome): boolean {
  return assetExists(home, galleryImageFile(id));
}

// Thumbnail-sized, as a plate's thumbnail is (printService saveThumbBuffer).
const GALLERY_THUMB_SIZE = 512;
const GALLERY_THUMB_QUALITY = 88;
const galleryThumbsMaking = new Map<string, Promise<string | null>>();

/**
 * The image at card size, made from it the first time it's asked for. Cards lead with the gallery's first image
 * (dto.ts coverThumbUrl), and the full one is sized for the model's page, too big for a page of cards. Each image's
 * own, so whichever comes first, by any route, already has one or makes it. Null when the image can't be read.
 */
export async function galleryThumbPath(id: string, home: AssetHome): Promise<string | null> {
  const file = galleryThumbFile(id);
  const existing = assetPath(home, file);
  if (fsSync.existsSync(existing)) return existing;
  const dest = home ? assetTarget(home, file) : legacyAssetPath(file);
  // A page of cards asks for it more than once at a time.
  const making = galleryThumbsMaking.get(dest);
  if (making) return making;
  const made = makeGalleryThumb(previewImagePath(id, home), dest).finally(() => galleryThumbsMaking.delete(dest));
  galleryThumbsMaking.set(dest, made);
  return made;
}

/**
 * What a card shows of the image: its card-sized copy, else the image itself where no copy can be written (a full
 * disk), as the card was handed this image's address either way. `copy` says which. Null when the image is gone.
 */
export async function galleryCardPicture(id: string, home: AssetHome): Promise<{ path: string; copy: boolean } | null> {
  const copy = await galleryThumbPath(id, home);
  if (copy) return { path: copy, copy: true };
  const image = previewImagePath(id, home);
  return fsSync.existsSync(image) ? { path: image, copy: false } : null;
}

async function makeGalleryThumb(source: string, dest: string): Promise<string | null> {
  const tmp = `${dest}.${process.pid}.${Date.now()}.tmp`;
  try {
    const input = await fs.readFile(source);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    // Without its metadata: a card has no use for a photo's camera details.
    await fs.writeFile(tmp, await photoJpeg(input, GALLERY_THUMB_SIZE, GALLERY_THUMB_QUALITY));
    await fs.rename(tmp, dest);
    // Removing an image takes it, then its copy (removeGalleryFiles, storageCleanup trimPhotos): a copy that lands
    // after that, made from it as it went, goes here instead of outliving it.
    if (!fsSync.existsSync(source)) {
      await fs.rm(dest, { force: true });
      return null;
    }
    return dest;
  } catch {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    return null;
  }
}

/** The image and its card-sized copy, wherever they are: the image first, which a copy being made looks for. */
export async function removeGalleryFiles(home: AssetHome, id: string): Promise<void> {
  await removeAsset(home, galleryImageFile(id));
  await removeAsset(home, galleryThumbFile(id));
}

/** Stores an already-encoded JPEG. The caller can undo this write by path even if the print has been deleted. */
async function storePreviewJpeg(
  home: string,
  id: string,
  jpeg: Buffer,
): Promise<{ dest: string; size: number; contentSha256: string | null } & ReuseMarker> {
  const dest = assetTarget(home, galleryImageFile(id));
  const tmp = `${dest}.${process.pid}.${Date.now()}.tmp`;
  let placed = false;
  try {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    const { contentSha256, shared } = await shareStoredBytes(jpeg, tmp, findStoredCopies, plainWriteMode());
    if (!shared) await fs.writeFile(tmp, jpeg, { flag: "wx" });
    await fs.rename(tmp, dest);
    placed = true;
    return { dest, size: jpeg.length, contentSha256, ...(await reuseMarker(dest, shared, contentSha256)) };
  } catch (error) {
    if (placed) await fs.rm(dest, { force: true }).catch(() => undefined);
    else await fs.rm(tmp, { force: true }).catch(() => strayStaging.add(tmp));
    throw error;
  }
}

/** Staging files a failed write couldn't remove, for the next gallery settlement: each is named for its own attempt,
 *  so nothing else ever names it. In-process, as every writer is. */
const strayStaging = new Set<string>();

async function removeStrayStaging(): Promise<void> {
  for (const file of strayStaging) {
    await fs.rm(file, { force: true }).then(
      () => strayStaging.delete(file),
      () => undefined,
    );
  }
}

async function encodePreviewUpload(buffer: Buffer): Promise<Buffer | null> {
  if (!buffer.length) return null;
  try {
    return await photoJpeg(buffer, 1600, 90, true);
  } catch (error) {
    // Sharp reports input rejection through Error messages. A different decoder or encoder failure is retryable. A
    // truncated PNG fails as a libpng read error or, as the decoder's warning comes first, through failOn. WebP, TIFF
    // and HEIF readers name themselves when a valid header leads to pixels they can't read (their writers don't).
    const rejected =
      /^(Input buffer (contains unsupported image format|has corrupt header:)|Input image exceeds (pixel|channel) limit|VipsJpeg: premature end of JPEG image|Warning treated as error due to failOn setting|(webp2vips|tiff2vips|heifload\w*): )/;
    if (error instanceof Error && (rejected.test(error.message) || error.message === "vipspng: libpng read error")) {
      return null;
    }
    throw error;
  }
}

/**
 * A row at the end of the model's gallery, or null where the place it wanted was taken as it wrote.
 *
 * The position is read and then claimed, so two pictures arriving at once can pick the same one and the gallery's
 * (printId, position) index refuses the second. They do arrive at once: an import adds its gallery pictures while
 * our own card render of the first plate finishes and takes the cover (see adoptRenderAsThumb), and an upload is
 * the same. The loser reads the position again rather than failing the import that was only adding a picture.
 */
async function createPreviewImageRow(
  printId: string,
  generated: boolean,
  replacing?: string,
): Promise<PreviewImage | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      // Under the gallery lock, so a renumbering can't run between the position read and the insert.
      return await prisma.$transaction(async (tx) => {
        await lockPreviewGallery(tx, printId);
        // A replacement goes in only while the image it replaces is still the gallery's only one.
        if (replacing) {
          const images = await tx.previewImage.findMany({ where: { printId }, select: { id: true } });
          if (images.length !== 1 || images[0].id !== replacing) return null;
        }
        const last = await tx.previewImage.findFirst({ where: { printId }, orderBy: { position: "desc" } });
        return tx.previewImage.create({ data: { printId, position: last ? last.position + 1 : 0, generated } });
      });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
    }
  }
  console.error(`Couldn't find a free gallery position for print ${printId}`);
  return null;
}

/** Null if the buffer isn't a decodable image; never throws. */
export async function addPreviewImage(
  printId: string,
  buffer: Buffer,
  {
    generated = false,
    keepExif = false,
    replacing,
  }: {
    generated?: boolean;
    keepExif?: boolean;
    /** Added only while this id is the gallery's only image. */
    replacing?: string;
  } = {},
): Promise<PreviewImage | null> {
  const row = await createPreviewImageRow(printId, generated, replacing);
  if (!row) return null;
  const saved = await photoJpeg(buffer, 1600, 90, keepExif)
    .then(async (jpeg) => storePreviewJpeg(await ensureAssetHome(printId), row.id, jpeg))
    .catch(() => null);
  if (!saved) {
    await prisma.previewImage.delete({ where: { id: row.id } }).catch(() => undefined);
    return null;
  }
  // Recorded after the file is in place, so a stored copy is only ever offered once it's there. The row may have been
  // deleted meanwhile (its print removed while the picture was being saved): then the file has no row, so it goes too.
  // It's removed by the path it was written to: with the print gone there's no folder left to look up.
  const { dest, ...stored } = saved;
  try {
    const { count } = await prisma.previewImage.updateMany({ where: { id: row.id }, data: stored });
    if (count === 0) {
      await fs.rm(dest, { force: true });
      return null;
    }
    return await prisma.previewImage.findUnique({ where: { id: row.id } });
  } catch (err) {
    console.error(`Failed to record preview image ${row.id}:`, err);
    await fs.rm(dest, { force: true }).catch(() => undefined);
    await prisma.previewImage.deleteMany({ where: { id: row.id } }).catch(() => undefined);
    return null;
  }
}

export function lockPreviewGallery(tx: Prisma.TransactionClient, printId: string) {
  return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('preview-gallery'), hashtext(${printId}))`;
}

/** Plates whose first thumbnail a generated save has written and not yet kept or taken back, with where it went and,
 *  once the save failed, when: whose that file is isn't settled, so cover recovery leaves it alone, and the next writer
 *  under the gallery lock takes it back first. In-process, as every writer of a thumbnail is. */
const unsettledThumbs = new Map<string, { file: string; failedAt?: number; over: Promise<void> }>();

/** Takes back the first thumbnail a failed save left, under the caller's gallery lock: only while the flag shows the
 *  save didn't commit, and only the file that attempt wrote. A look that fails keeps it recorded for the next try. */
async function settleThumb(tx: Prisma.TransactionClient, plateId: string): Promise<void> {
  const unsettled = unsettledThumbs.get(plateId);
  if (unsettled?.failedAt === undefined) return;
  const plate = await tx.plate.findFirst({ where: { id: plateId }, select: { thumbGenerated: true } });
  if (plate && !plate.thumbGenerated) {
    let written: fsSync.Stats | null = null;
    try {
      written = await fs.stat(unsettled.file);
    } catch (error) {
      if (!isMissingError(error)) throw error;
    }
    if (written?.isFile() && written.mtimeMs <= unsettled.failedAt) await fs.rm(unsettled.file, { force: true });
  }
  unsettledThumbs.delete(plateId);
}

/** Generated thumbnails and recovered covers must read and update the same thumbnail under the gallery lock. */
export async function saveGeneratedPlateThumbnail(
  printId: string,
  plateId: string,
  buffer: Buffer,
): Promise<"saved" | "skipped" | "invalid"> {
  await ensureAssetHome(printId);
  // This attempt's record when it writes the plate's first thumbnail, while whose that is isn't settled. Only that
  // record is cleared: once the lock is let go, another attempt on the plate may have set its own.
  let mine: { file: string; failedAt?: number; over: Promise<void> } | undefined;
  let finish = () => {};
  const over = new Promise<void>((resolve) => (finish = resolve));
  try {
    const outcome = await prisma.$transaction(async (tx) => {
      await lockPreviewGallery(tx, printId);
      await settleThumb(tx, plateId);
      const plate = await tx.plate.findFirst({
        where: { id: plateId, printId },
        select: { thumbGenerated: true, print: { select: { assetsPath: true } } },
      });
      const home = plate?.print.assetsPath;
      if (!plate || !home) return "skipped";
      const had = await assetIsThere(home, plateThumbFile(plateId));
      if (!plate.thumbGenerated && had) return "skipped";
      if (!had) {
        mine = { file: assetTarget(home, plateThumbFile(plateId)), over };
        unsettledThumbs.set(plateId, mine);
      }
      // Where the file really went, which the folder a move gave the model since can change.
      const placed = (dest: string) => {
        if (mine) mine.file = dest;
      };
      if (!(await saveThumbFromBytes(plateId, buffer, false, { home, db: tx, placed }))) return "invalid";
      await tx.plate.update({ where: { id: plateId }, data: { thumbGenerated: true } });
      return "saved";
    });
    if (mine && unsettledThumbs.get(plateId) === mine) unsettledThumbs.delete(plateId);
    return outcome;
  } catch (error) {
    if (mine && unsettledThumbs.get(plateId) === mine) {
      mine.failedAt = Date.now();
      await takeBackRolledBackThumb(printId, plateId);
    }
    throw error;
  } finally {
    finish();
  }
}

/** Takes back a first thumbnail a failed save wrote, once a locked read confirms its flag rolled back: left in place,
 *  later renders would take it for one the owner chose. When this fails too, the next writer under the lock does it. */
async function takeBackRolledBackThumb(printId: string, plateId: string) {
  await prisma
    .$transaction(async (tx) => {
      await lockPreviewGallery(tx, printId);
      await settleThumb(tx, plateId);
    })
    .catch((error) => console.error(`Couldn't take back plate ${plateId}'s thumbnail yet:`, error));
}

/** Publishes the stored image and receipt together. Each worker writes under its own image id so a concurrent
 *  loser can discard its file without touching the winner. Every published image may take over as the cover:
 *  resumePreviewUploadCover acts only for the first current manual one, which needn't be its batch's first. */
export async function addPreviewImageForUpload(
  printId: string,
  uploadId: string,
  buffer: Buffer,
): Promise<string | null> {
  const where = { printId_uploadId: { printId, uploadId } };
  // An upload ID names one picture: other bytes under it are another picture, which a replay would report as saved.
  const contentSha256 = createHash("sha256").update(buffer).digest("hex");
  const replay = (receipt: { imageId: string | null; contentSha256: string }) => {
    if (receipt.contentSha256 !== contentSha256) {
      throw new HttpError(409, "This upload ID was already used for a different picture");
    }
    return receipt.imageId;
  };
  const previous = await prisma.previewImageUpload.findUnique({ where });
  if (previous) return replay(previous);

  const id = randomUUID();
  const jpeg = await encodePreviewUpload(buffer);
  const home = jpeg && (await ensureAssetHome(printId));
  const saved = jpeg && home && (await storePreviewJpeg(home, id, jpeg));
  // A file that can't be removed now waits for the gallery's next locked read, which removes it while no row names it.
  const discard = async () => {
    if (saved) await fs.rm(saved.dest, { force: true }).catch(() => leaveUnsettled(printId, home, [id]));
  };

  for (let attempt = 0; attempt < 5; attempt++) {
    let readyToCommit = false;
    try {
      const imageId = await prisma.$transaction(async (tx) => {
        await lockPreviewGallery(tx, printId);
        const receipt = await tx.previewImageUpload.findUnique({ where });
        if (receipt) return replay(receipt);
        if (saved) {
          const { dest: _dest, ...stored } = saved;
          const last = await tx.previewImage.findFirst({ where: { printId }, orderBy: { position: "desc" } });
          await tx.previewImage.create({ data: { id, printId, position: (last?.position ?? -1) + 1, ...stored } });
        }
        const published = saved ? id : null;
        await tx.previewImageUpload.create({
          data: { printId, uploadId, imageId: published, contentSha256, coverPending: Boolean(saved) },
        });
        readyToCommit = true;
        return published;
      });
      if (imageId !== id) await discard();
      return imageId;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue;
      if (!readyToCommit) {
        await discard();
      } else if (saved) {
        // Wait for the publishing transaction to release the gallery lock before checking a disputed commit.
        const owner = await prisma
          .$transaction(async (tx) => {
            await lockPreviewGallery(tx, printId);
            return tx.previewImage.findUnique({ where: { id }, select: { id: true } });
          })
          .catch(() => undefined);
        if (owner === null) await discard();
        // Unread, the file waits for the gallery's next locked read: kept with its row, removed without one.
        else if (owner === undefined) leaveUnsettled(printId, home, [id]);
      }
      throw error;
    }
  }

  await discard();
  throw new HttpError(409, "Could not record the preview upload; try again");
}

/** An existing image (e.g. an import's cover) always wins. True when this one became the cover. */
export async function addGeneratedPreviewImageIfNone(printId: string, buffer: Buffer): Promise<boolean> {
  const count = await prisma.previewImage.count({ where: { printId } });
  if (count > 0) return false;
  const added = await addPreviewImage(printId, buffer, { generated: true });
  if (!added) return false;
  // Something landed while this render was being written -- another plate's, or a picture. Anywhere but the
  // front of the gallery means it wasn't first after all, and only the first render stands in for a picture.
  if (added.position > 0) {
    await removePreviewImage(printId, added.id).catch(() => undefined);
    return false;
  }
  return true;
}

async function removeGeneratedRows(
  tx: Prisma.TransactionClient,
  images: { id: string; generated: boolean }[],
): Promise<string[]> {
  const generated = images.filter((image) => image.generated).map((image) => image.id);
  if (generated.length) {
    await tx.previewImage.deleteMany({ where: { id: { in: generated } } });
    await renumberPreviewImages(
      tx,
      images.filter((image) => !image.generated).map((image) => image.id),
    );
  }
  return generated;
}

/** Drops our own renders, so the images that replace them start at position 0. */
export async function removeGeneratedPreviewImages(printId: string): Promise<void> {
  await dropGalleryRows(printId, (dropping) =>
    prisma.$transaction(async (tx) => {
      await lockPreviewGallery(tx, printId);
      const images = await tx.previewImage.findMany({ where: { printId }, orderBy: { position: "asc" } });
      const generated = await removeGeneratedRows(tx, images);
      if (generated.length) dropping(await galleryHome(tx, printId), generated);
    }),
  );
}

async function galleryHome(tx: Prisma.TransactionClient, printId: string): Promise<AssetHome> {
  return (await tx.print.findUnique({ where: { id: printId }, select: { assetsPath: true } }))?.assetsPath;
}

/** Gallery rows a transaction dropped or added without hearing whether it committed, by model, each with where its
 *  files are. */
const unsettledDrops = new Map<string, Map<string, { home: AssetHome }>>();

/** Runs `drop`, a transaction that removes gallery rows and names them through `dropping`, then removes their files.
 *  A failed commit may still have committed: a locked read then decides which rows went, and when that read fails
 *  too, the model's next cover work does. */
async function dropGalleryRows<T>(
  printId: string,
  drop: (dropping: (home: AssetHome, ids: string[]) => void) => Promise<T>,
): Promise<T> {
  const dropped: { home: AssetHome; ids: string[] } = { home: undefined, ids: [] };
  let result: T;
  try {
    result = await drop((home, ids) => {
      dropped.home = home;
      dropped.ids = ids;
    });
  } catch (error) {
    if (dropped.ids.length) {
      leaveUnsettled(printId, dropped.home, dropped.ids);
      await settleGalleryDrops(printId);
    }
    throw error;
  }
  for (const id of dropped.ids) await removeGalleryFiles(dropped.home, id);
  return result;
}

function leaveUnsettled(printId: string, home: AssetHome, ids: string[]) {
  const unsettled = unsettledDrops.get(printId) ?? new Map<string, { home: AssetHome }>();
  // A new entry each time, so a read that began before it doesn't retire it.
  for (const id of ids) unsettled.set(id, { home });
  unsettledDrops.set(printId, unsettled);
}

/** Removes the files of rows a disputed commit dropped or never added, once a locked read finds those rows absent. */
async function settleGalleryDrops(printId: string): Promise<void> {
  await removeStrayStaging();
  const unsettled = unsettledDrops.get(printId);
  if (!unsettled) return;
  // Only the ids this read checks are settled by it, each at the home it was left with; any added meanwhile wait.
  const checked = [...unsettled];
  let left: Set<string>;
  try {
    left = await prisma.$transaction(async (tx) => {
      await lockPreviewGallery(tx, printId);
      const ids = checked.map(([id]) => id);
      const rows = await tx.previewImage.findMany({ where: { id: { in: ids } }, select: { id: true } });
      return new Set(rows.map((row) => row.id));
    });
  } catch (error) {
    console.error(`Couldn't settle the gallery of print ${printId} yet:`, error);
    return;
  }
  for (const [id, entry] of checked) {
    // A row that survived needs nothing; one that went is retired once its files are confirmed gone, else retried.
    if (!left.has(id)) {
      try {
        await removeAssetOrThrow(entry.home, galleryImageFile(id));
        await removeAssetOrThrow(entry.home, galleryThumbFile(id));
      } catch (error) {
        console.error(`Couldn't remove gallery image ${id}'s files yet:`, error);
        continue;
      }
    }
    if (unsettled.get(id) === entry) unsettled.delete(id);
  }
  if (!unsettled.size && unsettledDrops.get(printId) === unsettled) unsettledDrops.delete(printId);
}

/** The first of `images` whose file is there, and that file, by a look that throws on any error but a missing file. */
async function firstImageThere<T extends { id: string }>(
  images: T[],
  home: AssetHome,
): Promise<{ image: T; file: string } | undefined> {
  for (const image of images) {
    const file = await findAsset(home, galleryImageFile(image.id));
    if (file) return { image, file };
  }
  return undefined;
}

/** resumePreviewUploadCover for a request that has more to answer than the cover: a failure is logged, and the work
 *  stays pending for the next upload or receipt lookup. */
export async function resumePreviewUploadCoverQuietly(printId: string): Promise<void> {
  await resumePreviewUploadCover(printId).catch((error) =>
    console.error(`Couldn't finish the cover work for print ${printId}:`, error),
  );
}

/** Finishes the first uploaded photo's cover work on upload or receipt lookup. A new cover choice, a removed
 *  photo, or a different first manual photo supersedes the pending receipt. */
export async function resumePreviewUploadCover(printId: string): Promise<void> {
  await settleGalleryDrops(printId);
  const pending = { printId, coverPending: true };
  if (!(await prisma.previewImageUpload.findFirst({ where: pending, select: { uploadId: true } }))) return;
  await dropGalleryRows(printId, (dropping) => resumeCoverWork(printId, dropping));
}

async function resumeCoverWork(printId: string, dropping: (home: AssetHome, ids: string[]) => void): Promise<void> {
  const pending = { printId, coverPending: true };
  await prisma.$transaction(async (tx) => {
    await lockPreviewGallery(tx, printId);
    const receipts = await tx.previewImageUpload.findMany({ where: pending });
    if (!receipts.length) return;
    const images = await tx.previewImage.findMany({ where: { printId }, orderBy: { position: "asc" } });
    const home = (await tx.print.findUnique({ where: { id: printId }, select: { assetsPath: true } }))?.assetsPath;
    // A look that fails throws, so the pending work stays for when the disk answers again.
    const found = await firstImageThere(
      images.filter((image) => !image.generated),
      home,
    );
    const receipt = receipts.find((upload) => upload.imageId === found?.image.id);
    if (!home || !found || !receipt) {
      await tx.previewImageUpload.updateMany({ where: pending, data: { coverPending: false } });
      return;
    }

    const plate = await tx.plate.findFirst({ where: { printId }, orderBy: { position: "asc" } });
    let thumbnailReady = true;
    if (plate) await settleThumb(tx, plate.id);
    // A render's save may still take back the file it wrote: whose thumbnail it is waits, and so does this receipt.
    if (plate && unsettledThumbs.has(plate.id)) thumbnailReady = false;
    else if (plate && (plate.thumbGenerated || !(await assetIsThere(home, plateThumbFile(plate.id))))) {
      // The file the look found, which a folder at the model's own path can't stand in for.
      const jpeg = await fs.readFile(found.file);
      thumbnailReady = await saveThumbFromBytes(plate.id, jpeg, true, { home, db: tx });
    }
    dropping(home, await removeGeneratedRows(tx, images));
    await tx.previewImageUpload.updateMany({
      where: thumbnailReady ? pending : { ...pending, uploadId: { not: receipt.uploadId } },
      data: { coverPending: false },
    });
  });
}

/** Call once a real image is added: it takes over from our own render, as the cover and, when the plate's thumb is
 *  only that render (it can land first while the image is still uploading), as the thumb too. The image is stored
 *  already, so a thumbnail that fails is logged rather than failing the caller. */
export async function preferImageOverRenders(
  printId: string,
  plateId: string | null | undefined,
  buffer: Buffer,
  keepExif = false,
): Promise<void> {
  await removeGeneratedPreviewImages(printId);
  if (!plateId) return;
  await takeOverPlateThumb(printId, plateId, buffer, keepExif).catch((error) =>
    console.error(`Couldn't make the new picture plate ${plateId}'s thumbnail:`, error),
  );
}

async function takeOverPlateThumb(printId: string, plateId: string, buffer: Buffer, keepExif: boolean) {
  await ensureAssetHome(printId);
  for (let attempt = 0; attempt < 5; attempt++) {
    // Under the gallery lock, as cover recovery and our own renders write the thumbnail, so none of them lands between
    // the look and the write.
    const waiting = await prisma.$transaction(async (tx) => {
      await lockPreviewGallery(tx, printId);
      const plate = await tx.plate.findFirst({
        where: { id: plateId, printId },
        select: { thumbGenerated: true, print: { select: { assetsPath: true } } },
      });
      const home = plate?.print.assetsPath;
      if (!plate || !home) return null;
      await settleThumb(tx, plateId);
      // A render's save may still take back the file it wrote: this waits for it, then looks again.
      const unsettled = unsettledThumbs.get(plateId);
      if (unsettled) return { over: unsettled.over };
      if (!plate.thumbGenerated && (await assetIsThere(home, plateThumbFile(plateId)))) return null;
      await saveThumbFromBytes(plateId, buffer, keepExif, { home, db: tx });
      return null;
    });
    if (!waiting) return;
    await waiting.over;
  }
  throw new Error("Our own render's thumbnail kept being saved meanwhile");
}

export async function deleteAllPreviewImages(printId: string): Promise<void> {
  const rows = await prisma.previewImage.findMany({ where: { printId } });
  await prisma.previewImage.deleteMany({ where: { printId } });
  const home = await printAssetHome(printId);
  for (const row of rows) await removeGalleryFiles(home, row.id);
}

/** Removes one gallery image's file, and its card-sized copy, wherever they are. */
export async function removePreviewImageFile(printId: string, id: string): Promise<void> {
  await removeGalleryFiles(await printAssetHome(printId), id);
}

/** Renumbers in two phases to avoid (printId, position) collisions. The caller holds the gallery lock. */
async function renumberPreviewImages(tx: Prisma.TransactionClient, ids: string[]): Promise<void> {
  await Promise.all(ids.map((id, idx) => tx.previewImage.update({ where: { id }, data: { position: -(idx + 1) } })));
  await Promise.all(ids.map((id, idx) => tx.previewImage.update({ where: { id }, data: { position: idx } })));
}

/** Removes one of the model's gallery images; the next one up becomes the cover if it was. */
export async function removePreviewImage(printId: string, imageId: string): Promise<void> {
  await dropGalleryRows(printId, (dropping) =>
    prisma.$transaction(async (tx) => {
      await lockPreviewGallery(tx, printId);
      const images = await tx.previewImage.findMany({ where: { printId }, orderBy: { position: "asc" } });
      if (!images.some((img) => img.id === imageId)) throw new HttpError(404, "Preview image not found");
      await tx.previewImage.delete({ where: { id: imageId } });
      await renumberPreviewImages(
        tx,
        images.filter((img) => img.id !== imageId).map((img) => img.id),
      );
      dropping(await galleryHome(tx, printId), [imageId]);
    }),
  );
}

/** Puts the model's gallery in this order; `ids` must be exactly its images, bar those whose file is gone, which no one
 *  is shown (toPrintOut leaves them out) and so no one can list: they keep their order after the rest. The first is
 *  the cover. */
export async function reorderPreviewImages(printId: string, ids: string[]): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockPreviewGallery(tx, printId);
    const print = await tx.print.findUnique({ where: { id: printId }, select: { assetsPath: true } });
    const images = await tx.previewImage.findMany({
      where: { printId },
      orderBy: { position: "asc" },
      select: { id: true },
    });
    const known = new Set(images.map((img) => img.id));
    const listed = new Set(ids);
    // Each picture's file is looked at once, and every decision below goes by that one look.
    const there = new Map<string, boolean>();
    for (const img of images) there.set(img.id, await assetIsThere(print?.assetsPath, galleryImageFile(img.id)));
    const unseen = images.filter((img) => !listed.has(img.id) && !there.get(img.id)).map((img) => img.id);
    if (
      ids.length + unseen.length !== images.length ||
      listed.size !== ids.length ||
      ids.some((id) => !known.has(id))
    ) {
      throw new HttpError(400, "image_ids must contain exactly the print's current preview image ids");
    }
    // The cover in view before and after: a picture listed first whose file is gone isn't one.
    const before = images.find((img) => there.get(img.id))?.id;
    const order = [...ids, ...unseen];
    const after = order.find((id) => there.get(id));
    await renumberPreviewImages(tx, order);
    if (before !== after) {
      await tx.previewImageUpload.updateMany({ where: { printId, coverPending: true }, data: { coverPending: false } });
    }
  });
}

// The card render is white shading for the cards to tint, too pale on a light background as it is; as a thumb it's
// slate, like the live viewer's model.
const RENDER_THUMB_SHADE = [0.58, 0.64, 0.72, 1];

/** Whether `file` was last written before `other`; false where either can't be read. */
async function writtenBefore(file: string, other: string): Promise<boolean> {
  try {
    const [a, b] = await Promise.all([fs.stat(file), fs.stat(other)]);
    return a.mtimeMs < b.mtimeMs;
  } catch {
    return false;
  }
}

/**
 * Our own render stands in as the plate's thumb, and the model's cover, while it has no picture at all, so
 * mosaics and lists that show thumbs have one without the model being opened. A thumb of our own older than the
 * render is drawn again from it: the render was drawn anew since, by a renderer that may draw differently (an older
 * one turned rotated parts the wrong way), and a redraw that failed gets another go the next time the card render is
 * asked for and found drawn. One from an import or an upload stays, also when it lands while the render is shaded.
 *
 * The thumb is always the one-colour render, tinted: a list of models reads as one set in whatever colour the
 * reader picked, and the Appearance panel's render colour goes on working. The cover is the picture in the
 * model's own colours where the file carried any -- that one is the model's page shown large, where the thing
 * as it would be printed is what someone is looking for.
 *
 * "covered" when this render became the cover too, "adopted" when it's the thumb only.
 */
async function adoptRenderAsThumb(
  plateId: string,
  renderPath: string,
  colorPath: string | null,
): Promise<"covered" | "adopted" | "redrawn" | null> {
  const plate = await prisma.plate.findUnique({
    where: { id: plateId },
    select: { printId: true, thumbGenerated: true },
  });
  if (!plate) return null;
  const home = await plateAssetHome(plateId);
  // A rolled-back render's leftover isn't a thumbnail: the save below, under the lock, takes it back first.
  const leftover = unsettledThumbs.get(plateId)?.failedAt !== undefined;
  const had = !leftover && plateThumbExists(plateId, home);
  if (had && !(plate.thumbGenerated && (await writtenBefore(plateThumbPath(plateId, home), renderPath)))) return null;
  const buffer = await renderThumbShade(renderPath, RENDER_THUMB_SHADE);
  // An upload or an import may have put its picture in meanwhile, which stays.
  if ((await saveGeneratedPlateThumbnail(plate.printId, plateId, buffer)) !== "saved") return null;
  if (had) return "redrawn";
  const cover = colorPath ? await fs.readFile(colorPath).catch(() => buffer) : buffer;
  return (await addGeneratedPreviewImageIfNone(plate.printId, cover)) ? "covered" : "adopted";
}

/**
 * Puts a newly drawn picture in place of the one of our own standing in as the cover: the one in the model's colours
 * where it has any, for a model whose cover was made before Thingport could draw them or whose file gained them,
 * else the render, which an older renderer may have drawn differently.
 *
 * Only our own picture is replaced (`generated`): right after a render (`drawn`), or later while it's older than the
 * render, as a replacement that failed leaves it, so a model's cover isn't taken apart and rebuilt each time the
 * render is asked for.
 */
async function replaceGeneratedCover(
  plateId: string,
  renderPath: string,
  colorPath: string | null,
  drawn: boolean,
): Promise<void> {
  const plate = await prisma.plate.findUnique({ where: { id: plateId }, select: { printId: true } });
  if (!plate) return;
  // The model's first plate, whichever finished rendering first: with several, each would otherwise take the
  // cover from the last in turn, and which one a model leads with shouldn't depend on the order they drew in.
  const first = await prisma.plate.findFirst({
    where: { printId: plate.printId },
    orderBy: { position: "asc" },
    select: { id: true },
  });
  if (first?.id !== plateId) return;
  const images = await prisma.previewImage.findMany({ where: { printId: plate.printId } });
  if (images.length !== 1 || !images[0].generated) return;
  const current = previewImagePath(images[0].id, await plateAssetHome(plateId));
  if (!drawn && !(await writtenBefore(current, renderPath))) return;
  const cover = colorPath ? await fs.readFile(colorPath) : await renderThumbShade(renderPath, RENDER_THUMB_SHADE);
  // A picture uploaded while this was drawn has taken over: then nothing goes in.
  const added = await addPreviewImage(plate.printId, cover, { generated: true, replacing: images[0].id });
  if (added) await removePreviewImage(plate.printId, images[0].id);
}

/** Queues the model card's render. Never throws. */
export function generateCardRender(plateId: string, srcPath: string, filename: string): Promise<void> {
  return generateModelImage(plateId, srcPath, filename, "render", async (renderPath, colorPath, drawn) => {
    const thumb = await adoptRenderAsThumb(plateId, renderPath, colorPath).catch((err: unknown) => {
      console.error(`Render thumb failed for ${plateId}:`, err);
      return null;
    });
    // A cover just made from this render is this render already. One a later plate's render made first is the
    // first plate's to take.
    if (thumb === "covered") return;
    try {
      await replaceGeneratedCover(plateId, renderPath, colorPath, drawn);
    } catch (err) {
      console.error(`Cover failed for ${plateId}:`, err);
    }
  });
}
