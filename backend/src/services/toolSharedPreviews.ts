import sharp from "sharp";
import { prisma } from "../db";
import { modelImagePath } from "./modelPreviewCache";
import { previewImagePath } from "./previewImageService";

const PREVIEW_KEY = /^(image|render):([a-zA-Z0-9_-]{1,100})$/;

async function previewPixels(file: string) {
  // A model copy can re-encode the same gallery photo. Compare downsampled pixels so JPEG noise and
  // metadata changes do not split a photo's notes. Keep the geometry and color of the displayed image.
  const image = sharp(file);
  const { width, height } = await image.metadata();
  if (!width || !height) return null;
  const pixels = await image
    .resize(128, 128, { fit: "fill" })
    .flatten({ background: "#ffffff" })
    .toColourspace("srgb")
    .raw()
    .toBuffer();
  return { aspect: width / height, pixels };
}

type PreviewPixels = NonNullable<Awaited<ReturnType<typeof previewPixels>>>;

function samePicture(a: PreviewPixels, b: PreviewPixels) {
  if (Math.abs(a.aspect / b.aspect - 1) > 0.01 || a.pixels.length !== b.pixels.length) return false;
  // A re-encoded JPEG can have isolated color spikes along hard edges. Require both low
  // average error and a small proportion of those outliers.
  let difference = 0;
  let outliers = 0;
  for (let i = 0; i < a.pixels.length; i++) {
    const delta = Math.abs(a.pixels[i] - b.pixels[i]);
    if (delta > 24) outliers++;
    difference += delta;
  }
  return difference <= 2 * a.pixels.length && outliers <= a.pixels.length / 1000;
}

/** Resolve legacy writer-local preview keys only for entries the reader can already see about the same model. */
export async function matchingSharedPreviews(
  modelId: string,
  preview: string,
  prefix: string,
  rows: { key: string; printId: string | null }[],
): Promise<boolean[]> {
  const match = PREVIEW_KEY.exec(preview);
  if (!match) return rows.map(() => false);
  const [, kind, localId] = match;
  const writerIds = rows.map(({ key, printId }) => {
    if (!printId) return null;
    const start = prefix + printId + ":" + kind + ":";
    if (!key.startsWith(start)) return null;
    const [id, suffix] = key.slice(start.length).split(":", 2);
    return suffix && /^[a-zA-Z0-9_-]{1,100}$/.test(id) ? id : null;
  });
  const candidates = new Set(
    writerIds.filter((id, index): id is string => Boolean(id) && rows[index].printId !== modelId),
  );
  const localMatches = rows.map((row, index) => row.printId === modelId && writerIds[index] === localId);
  if (!candidates.size) return localMatches;

  const ids = [localId, ...candidates];
  const query = {
    where: { id: { in: ids } },
    select: { id: true, printId: true, print: { select: { assetsPath: true } } },
  } as const;
  const previews = kind === "image" ? await prisma.previewImage.findMany(query) : await prisma.plate.findMany(query);
  const local = previews.find((row) => row.id === localId && row.printId === modelId);
  if (!local) return localMatches;
  const fileFor = kind === "image" ? previewImagePath : modelImagePath;
  const read = (row: (typeof previews)[number]) =>
    previewPixels(fileFor(row.id, row.print.assetsPath)).catch(() => null);
  const current = await read(local);
  if (!current) return localMatches;

  const referenced = new Set(rows.map((row, index) => row.printId + ":" + writerIds[index]));
  const others = previews.filter((row) => row.printId !== modelId && referenced.has(row.printId + ":" + row.id));
  const matched = new Set<string>();
  for (let i = 0; i < others.length; i += 8) {
    await Promise.all(
      others.slice(i, i + 8).map(async (row) => {
        const pixels = await read(row);
        if (pixels && samePicture(current, pixels)) matched.add(row.printId + ":" + row.id);
      }),
    );
  }
  return rows.map((row, index) => localMatches[index] || matched.has(row.printId + ":" + writerIds[index]));
}
