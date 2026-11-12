import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "../db";
import { HttpError } from "../utils/fileUtils";
import { generateModelImage } from "./modelPreviewCache";
import { photoJpeg, renderThumbShade } from "./imageProcessing";
import {
  assetExists,
  assetPath,
  assetTarget,
  galleryImageFile,
  plateAssetHome,
  printAssetHome,
  removeAsset,
  type AssetHome,
} from "./modelAssets";
import { plainWriteMode, reuseMarker, shareStoredBytes, type ReuseMarker } from "./fileReuse";
import { findStoredCopies } from "./storedContent";
import {
  ensureAssetHome,
  plateThumbExists,
  plateThumbPath,
  plateThumbReplaceable,
  saveThumbFromBytes,
} from "./printService";
import { Prisma, type PreviewImage } from "@prisma/client";

/** `home` is the image's model's Print.assetsPath. */
export function previewImagePath(id: string, home: AssetHome): string {
  return assetPath(home, galleryImageFile(id));
}

export function previewImageExists(id: string, home: AssetHome): boolean {
  return assetExists(home, galleryImageFile(id));
}

/** Where the JPEG was stored, its size, and its SHA-256 when it was hashed for sharing (file reuse on),
 *  and the marker of a clone that was kept. Null when it
 *  couldn't be saved. The path is returned so a caller that has to undo the save removes exactly this file, without
 *  looking the folder up again through a print that may be gone. */
async function saveBuffer(
  printId: string,
  id: string,
  input: Buffer,
  keepExif: boolean,
): Promise<({ dest: string; size: number; contentSha256: string | null } & ReuseMarker) | null> {
  let tmp: string | null = null;
  try {
    const dest = assetTarget(await ensureAssetHome(printId), galleryImageFile(id));
    tmp = `${dest}.${process.pid}.${Date.now()}.tmp`;
    await fs.mkdir(path.dirname(dest), { recursive: true });
    // Hero-sized: this is the detail page's main image. Kept in memory rather than written by sharp: what's shared is
    // the re-encoded JPEG, not the download (the same picture fetched twice is rarely the same bytes, but encoded the
    // same way it is), so it's hashed before it's written.
    const out = await photoJpeg(input, 1600, 90, keepExif);
    // Cloned (or written) at the temp name, then renamed into place as before, so a half-written picture is never
    // served. A clone that can't be made is no reason to fail: the bytes are written as usual.
    const { contentSha256, shared } = await shareStoredBytes(out, tmp, findStoredCopies, plainWriteMode());
    if (!shared) await fs.writeFile(tmp, out, { flag: "wx" });
    await fs.rename(tmp, dest);
    // After the rename, which changes the file's ctime.
    return { dest, size: out.length, contentSha256, ...(await reuseMarker(dest, shared, contentSha256)) };
  } catch {
    if (tmp) await fs.rm(tmp, { force: true });
    return null;
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
async function createPreviewImageRow(printId: string, generated: boolean): Promise<PreviewImage | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const last = await prisma.previewImage.findFirst({ where: { printId }, orderBy: { position: "desc" } });
    const position = last ? last.position + 1 : 0;
    try {
      return await prisma.previewImage.create({ data: { printId, position, generated } });
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
  { generated = false, keepExif = false }: { generated?: boolean; keepExif?: boolean } = {},
): Promise<PreviewImage | null> {
  const row = await createPreviewImageRow(printId, generated);
  if (!row) return null;
  const saved = await saveBuffer(printId, row.id, buffer, keepExif);
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

/** Drops our own renders, so the images that replace them start at position 0. */
export async function removeGeneratedPreviewImages(printId: string): Promise<void> {
  const generated = await prisma.previewImage.findMany({ where: { printId, generated: true } });
  if (!generated.length) return;
  await prisma.previewImage.deleteMany({ where: { id: { in: generated.map((img) => img.id) } } });
  const remaining = await prisma.previewImage.findMany({ where: { printId }, orderBy: { position: "asc" } });
  await renumberPreviewImages(remaining.map((img) => img.id));
  const home = await printAssetHome(printId);
  for (const img of generated) await removeAsset(home, galleryImageFile(img.id));
}

/** Call once a real image is added: it takes over from our own render, as the cover and, when the plate's thumb is
 *  only that render (it can land first while the image is still uploading), as the thumb too. */
export async function preferImageOverRenders(
  printId: string,
  plateId: string | null | undefined,
  buffer: Buffer,
  keepExif = false,
): Promise<void> {
  await removeGeneratedPreviewImages(printId);
  if (plateId && (await plateThumbReplaceable(plateId))) await saveThumbFromBytes(plateId, buffer, keepExif);
}

export async function deleteAllPreviewImages(printId: string): Promise<void> {
  const rows = await prisma.previewImage.findMany({ where: { printId } });
  await prisma.previewImage.deleteMany({ where: { printId } });
  const home = await printAssetHome(printId);
  for (const row of rows) await removeAsset(home, galleryImageFile(row.id));
}

/** Removes one gallery image's file, wherever it is. */
export async function removePreviewImageFile(printId: string, id: string): Promise<void> {
  await removeAsset(await printAssetHome(printId), galleryImageFile(id));
}

/** Renumbers the model's gallery in this order. Two phases, as in plates.ts, to avoid (printId, position) collisions. */
async function renumberPreviewImages(ids: string[]): Promise<void> {
  await prisma.$transaction(
    ids.map((id, idx) => prisma.previewImage.update({ where: { id }, data: { position: -(idx + 1) } })),
  );
  await prisma.$transaction(
    ids.map((id, idx) => prisma.previewImage.update({ where: { id }, data: { position: idx } })),
  );
}

/** Removes one of the model's gallery images; the next one up becomes the cover if it was. */
export async function removePreviewImage(printId: string, imageId: string): Promise<void> {
  const images = await prisma.previewImage.findMany({ where: { printId }, orderBy: { position: "asc" } });
  if (!images.some((img) => img.id === imageId)) throw new HttpError(404, "Preview image not found");
  await prisma.previewImage.delete({ where: { id: imageId } });
  await renumberPreviewImages(images.filter((img) => img.id !== imageId).map((img) => img.id));
  await removePreviewImageFile(printId, imageId);
}

/** Puts the model's gallery in this order; `ids` must be exactly its images. The first is the cover. */
export async function reorderPreviewImages(printId: string, ids: string[]): Promise<void> {
  const images = await prisma.previewImage.findMany({ where: { printId }, select: { id: true } });
  const known = new Set(images.map((img) => img.id));
  if (ids.length !== images.length || new Set(ids).size !== ids.length || ids.some((id) => !known.has(id))) {
    throw new HttpError(400, "image_ids must contain exactly the print's current preview image ids");
  }
  await renumberPreviewImages(ids);
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
  const had = plateThumbExists(plateId, home);
  if (had && !(plate.thumbGenerated && (await writtenBefore(plateThumbPath(plateId, home), renderPath)))) return null;
  const buffer = await renderThumbShade(renderPath, RENDER_THUMB_SHADE);
  // An upload or an import may have put its picture in meanwhile, which stays.
  if (!(await plateThumbReplaceable(plateId))) return null;
  if (!(await saveThumbFromBytes(plateId, buffer))) return null;
  await prisma.plate.update({ where: { id: plateId }, data: { thumbGenerated: true } });
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
  const added = await addPreviewImage(plate.printId, cover, { generated: true });
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
