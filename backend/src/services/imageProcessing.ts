import sharp from "sharp";

const PHOTO_BACKGROUND = { r: 248, g: 250, b: 252 };

/** Orient pixels and strip camera metadata unless an owner-provided photo explicitly opts in. */
export async function writePhotoJpeg(
  input: Buffer,
  destination: string,
  maxSize: number,
  quality: number,
  keepExif = false,
): Promise<void> {
  const image = sharp(input).autoOrient();
  if (keepExif) image.keepExif();
  await image
    .flatten({ background: PHOTO_BACKGROUND })
    .resize(maxSize, maxSize, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true })
    .toFile(destination);
}

export async function rasterIconPng(input: Buffer, size: number): Promise<Buffer> {
  return sharp(input, { animated: false })
    .autoOrient()
    .resize(size, size, { fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();
}

/** Provider copies are small and deliberately omit private camera metadata. */
export async function aiPreviewJpeg(input: Buffer): Promise<Buffer> {
  return sharp(input).autoOrient().resize(512, 512, { fit: "inside" }).jpeg().toBuffer();
}

export async function renderThumbShade(renderPath: string, shade: number[]): Promise<Buffer> {
  return sharp(renderPath).linear(shade, [0, 0, 0, 0]).png().toBuffer();
}

export async function mosaicPiece(file: string, width: number, height: number, renders: boolean): Promise<Buffer> {
  return sharp(file)
    .autoOrient()
    .resize(width, height, renders ? { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } } : { fit: "cover" })
    .toBuffer();
}

export async function mosaicWebp(
  pieces: { input: Buffer; left: number; top: number }[],
  size: number,
): Promise<Buffer> {
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(pieces)
    .webp({ quality: 80 })
    .toBuffer();
}

export async function writeRgbaPng(pixels: Buffer, size: number, destination: string): Promise<void> {
  await sharp(pixels, { raw: { width: size, height: size, channels: 4 } })
    .png()
    .toFile(destination);
}

export async function imageFormat(buffer: Buffer): Promise<string | undefined> {
  return (await sharp(buffer, { animated: true }).metadata()).format;
}
