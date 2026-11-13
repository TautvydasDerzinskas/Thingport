import fs from "node:fs/promises";
import path from "node:path";
import {
  ADAPTED_3MFS,
  BUNDLES,
  DESCRIPTION_IMAGES,
  MODEL_PREVIEWS,
  PREVIEWS,
  STORAGE,
  TAG_MOSAICS,
  THUMBS,
} from "../config";
import { prisma } from "../db";
import { assetKindOf, isLegacyRender, isSupersededAsset, type AssetKind } from "./modelAssets";
import { isPreviewCompressed } from "./modelPreviewCache";
import { PHOTO_KEEP_OPTIONS, type PhotoKeep } from "./settingsService";

// What Thingport keeps beside the model files, by kind, read from disk: each model's pictures folder and the shared
// folders older files may still be in. Administration → Storage shows it, and the clean-ups in storageCleanup.ts
// take their files from it.

// Measured on real previews: packed, one is about a fifth of its size.
const COMPRESSED_SHARE = 0.2;

export type StorageKindBytes = {
  /** 3D previews of the current format. */
  previews: number;
  /** 3D previews and renders of an earlier format, and previews of plates that are gone. */
  old: number;
  /** Gallery images. */
  photos: number;
  /** Plate thumbnails and current renders. */
  thumbnails: number;
  description: number;
  slicer: number;
  tagPictures: number;
  /** Download bundles from before supporting files moved in beside the model files. */
  bundles: number;
};

export type StorageInventory = {
  bytes: StorageKindBytes;
  /** About how much packing the current 3D previews that aren't yet would save. */
  compressSaving: number;
  /** Bytes of the photos past the first N of each model, for each N on offer. */
  photosBeyond: Record<PhotoKeep, number>;
  /** Absolute paths, for the clean-ups. */
  oldFiles: string[];
  slicerFiles: string[];
};

type FoundFile = { file: string; size: number; mtimeMs: number };

/** Every file under `dir`, following no links; a missing folder has none. */
async function walk(dir: string, found: FoundFile[] = []): Promise<FoundFile[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(file, found);
    else if (entry.isFile() && !entry.name.endsWith(".tmp")) {
      const stats = await fs.stat(file).catch(() => null);
      if (stats) found.push({ file, size: stats.size, mtimeMs: stats.mtimeMs });
    }
  }
  return found;
}

const stem = (file: string) => path.basename(file).split(".")[0];

export async function takeInventory(): Promise<StorageInventory> {
  const bytes: StorageKindBytes = {
    previews: 0,
    old: 0,
    photos: 0,
    thumbnails: 0,
    description: 0,
    slicer: 0,
    tagPictures: 0,
    bundles: 0,
  };
  let uncompressed = 0;
  const photoBytes = new Map<string, number>();
  const oldFiles: string[] = [];
  const slicerFiles: string[] = [];
  const seen = new Set<string>();

  const count = async (kind: AssetKind, found: FoundFile, plateGone = false): Promise<void> => {
    if (seen.has(found.file)) return;
    seen.add(found.file);
    const name = path.basename(found.file);
    if (plateGone || isSupersededAsset(kind, name)) {
      bytes.old += found.size;
      oldFiles.push(found.file);
      return;
    }
    switch (kind) {
      case "image":
        bytes.photos += found.size;
        photoBytes.set(stem(found.file), found.size);
        break;
      case "description":
        bytes.description += found.size;
        break;
      case "thumb":
      case "render":
        bytes.thumbnails += found.size;
        break;
      case "preview":
        bytes.previews += found.size;
        if ((await isPreviewCompressed(found.file, found)) === false) uncompressed += found.size;
        break;
      case "slicer":
        bytes.slicer += found.size;
        slicerFiles.push(found.file);
        break;
    }
  };

  // Deepest first, so a model's pictures folder inside another's counts as its own.
  const homes = await prisma.print.findMany({ where: { assetsPath: { not: null } }, select: { assetsPath: true } });
  const homeDirs = [...new Set(homes.map((print) => path.join(STORAGE, print.assetsPath!)))].toSorted(
    (a, b) => b.length - a.length,
  );
  for (const home of homeDirs) {
    for (const found of await walk(home)) {
      await count(assetKindOf(path.relative(home, found.file).split(path.sep).join("/")), found);
    }
  }

  for (const [dir, kind] of [
    [PREVIEWS, "image"],
    [DESCRIPTION_IMAGES, "description"],
    [THUMBS, "thumb"],
  ] as const) {
    for (const found of await walk(dir)) await count(kind, found);
  }
  // Shared with the cache's failure markers, which are left out. A preview there whose plate is gone is no one's.
  const plateIds = new Set((await prisma.plate.findMany({ select: { id: true } })).map((plate) => plate.id));
  for (const found of await walk(MODEL_PREVIEWS)) {
    const name = path.basename(found.file);
    if (name.endsWith(".glb")) await count("preview", found, !plateIds.has(stem(found.file)));
    else if (isLegacyRender(name)) await count("render", found, !plateIds.has(stem(found.file)));
  }
  for (const found of await walk(ADAPTED_3MFS)) {
    if (found.file.endsWith(".3mf")) await count("slicer", found);
  }
  for (const found of await walk(TAG_MOSAICS)) bytes.tagPictures += found.size;
  for (const found of await walk(BUNDLES)) bytes.bundles += found.size;

  const photosBeyond = Object.fromEntries(PHOTO_KEEP_OPTIONS.map((keep) => [keep, 0])) as Record<PhotoKeep, number>;
  for (const images of (await photosByModel()).values()) {
    images.forEach((image, index) => {
      if (image.generated) return;
      const size = photoBytes.get(image.id) ?? 0;
      for (const keep of PHOTO_KEEP_OPTIONS) if (index >= keep) photosBeyond[keep] += size;
    });
  }

  return {
    bytes,
    compressSaving: Math.round(uncompressed * (1 - COMPRESSED_SHARE)),
    photosBeyond,
    oldFiles,
    slicerFiles,
  };
}

/** Each model's gallery, cover first. */
export async function photosByModel(): Promise<Map<string, { id: string; generated: boolean }[]>> {
  const rows = await prisma.previewImage.findMany({
    select: { id: true, printId: true, generated: true },
    orderBy: [{ printId: "asc" }, { position: "asc" }],
  });
  const byModel = new Map<string, { id: string; generated: boolean }[]>();
  for (const row of rows) {
    const images = byModel.get(row.printId) ?? [];
    images.push({ id: row.id, generated: row.generated });
    byModel.set(row.printId, images);
  }
  return byModel;
}
