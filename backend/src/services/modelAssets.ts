import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { DESCRIPTION_IMAGES, MODEL_PREVIEWS, PREVIEWS, STORAGE, THUMBS } from "../config";
import { prisma } from "../db";

// A model's pictures -- its gallery and description images, and each plate's thumbnail and render -- live in an
// "Images" folder beside its files, at Print.assetsPath, so they move with the model. They used to share folders
// keyed by id (THUMBS, PREVIEWS, ...), and a model with no assetsPath still has them there. Reads look in both, so
// a model the storage move hasn't reached yet, or only part of, still finds every picture.

/** Print.assetsPath. */
export type AssetHome = string | null | undefined;
export type AssetKind = "image" | "description" | "thumb" | "render";
/** `legacyName` when the old shared folder named it differently. */
export type AssetFile = { kind: AssetKind; name: string; legacyName?: string };

export const ASSETS_FOLDER = "Images";
// Gallery images go straight in the folder: they're the pictures someone browsing it is after.
export const ASSET_SUBFOLDERS: Record<AssetKind, string> = {
  image: "",
  description: "Description",
  thumb: "Thumbnails",
  render: "Renders",
};
const LEGACY_DIRS: Record<AssetKind, string> = {
  image: PREVIEWS,
  description: DESCRIPTION_IMAGES,
  thumb: THUMBS,
  render: MODEL_PREVIEWS,
};

// Part of a render's name, so changing its look (modelPreviewCache's MODEL_IMAGE_KINDS) draws older ones again.
export const RENDER_FILE_TAG = "render.v2";

const DESCRIPTION_EXTS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

export function galleryImageFile(id: string): AssetFile {
  return { kind: "image", name: `${id}.jpg` };
}

/** Named with its extension now, so it opens from the folder; the shared folder had none. */
export function descriptionImageFile(image: { id: string; mime: string }): AssetFile {
  return { kind: "description", name: `${image.id}${DESCRIPTION_EXTS[image.mime] ?? ""}`, legacyName: image.id };
}

export function plateThumbFile(plateId: string): AssetFile {
  return { kind: "thumb", name: `${plateId}.jpg` };
}

/** A render in the shared 3D previews folder, of this look or an older one. */
export function isLegacyRender(name: string): boolean {
  return /\.render(\.v\d+)?\.png$/.test(name);
}

export function plateRenderFile(plateId: string, tag = RENDER_FILE_TAG): AssetFile {
  return { kind: "render", name: `${plateId}.${tag}.png` };
}

export function assetTarget(home: string, file: AssetFile): string {
  return path.join(STORAGE, home, ASSET_SUBFOLDERS[file.kind], file.name);
}

export function legacyAssetPath(file: AssetFile): string {
  return path.join(LEGACY_DIRS[file.kind], file.legacyName ?? file.name);
}

/** Where the file is: the model's folder, else the old shared one. With neither, where it would be. */
export function assetPath(home: AssetHome, file: AssetFile): string {
  const legacy = legacyAssetPath(file);
  if (!home) return legacy;
  const target = assetTarget(home, file);
  return fsSync.existsSync(target) || !fsSync.existsSync(legacy) ? target : legacy;
}

export function assetExists(home: AssetHome, file: AssetFile): boolean {
  return fsSync.existsSync(assetPath(home, file));
}

export async function printAssetHome(printId: string): Promise<AssetHome> {
  const print = await prisma.print.findUnique({ where: { id: printId }, select: { assetsPath: true } });
  return print?.assetsPath;
}

export async function plateAssetHome(plateId: string): Promise<AssetHome> {
  const plate = await prisma.plate.findUnique({
    where: { id: plateId },
    select: { print: { select: { assetsPath: true } } },
  });
  return plate?.print.assetsPath;
}

/** Wherever it is. */
export async function removeAsset(home: AssetHome, file: AssetFile): Promise<void> {
  if (home) await fs.rm(assetTarget(home, file), { force: true }).catch(() => undefined);
  await fs.rm(legacyAssetPath(file), { force: true }).catch(() => undefined);
}

/** Moves one picture from the old shared folder into the model's; true when it moved. One already in the model's
 *  folder is newer, and the old copy just goes. */
export async function adoptLegacyAsset(home: string, file: AssetFile): Promise<boolean> {
  const legacy = legacyAssetPath(file);
  if (!fsSync.existsSync(legacy)) return false;
  const target = assetTarget(home, file);
  if (fsSync.existsSync(target)) {
    await fs.rm(legacy, { force: true });
    return false;
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.rename(legacy, target);
  return true;
}

/** The files in a model's pictures folder that are its own -- named by one of `ids`, its plates' and images' --
 *  relative to it. Anything else is left alone: another model's files, when a category puts them in here. */
export async function ownedAssetFiles(home: string, ids: Iterable<string>): Promise<string[]> {
  const owners = new Set(ids);
  const found: string[] = [];
  for (const folder of new Set(Object.values(ASSET_SUBFOLDERS))) {
    const entries = await fs.readdir(path.join(STORAGE, home, folder), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isFile() && owners.has(entry.name.split(".")[0])) found.push(path.join(folder, entry.name));
    }
  }
  return found;
}

/** Every file under a model's pictures folder, relative to it with "/" separators. */
export async function listAssetFiles(home: string): Promise<{ path: string; size: number }[]> {
  const root = path.join(STORAGE, home);
  const found: { path: string; size: number }[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries: fsSync.Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      // Half-written pictures aren't the model's yet.
      else if (entry.isFile() && !entry.name.endsWith(".tmp")) {
        const size = await fs.stat(full).then(
          (stats) => stats.size,
          () => null,
        );
        if (size !== null) found.push({ path: path.relative(root, full).split(path.sep).join("/"), size });
      }
    }
  };
  await walk(root);
  return found;
}

/** Which kind a file in a model's pictures folder is, from the subfolder it's in. */
export function assetKindOf(relative: string): AssetKind {
  const folder = relative.includes("/") ? relative.slice(0, relative.indexOf("/")) : "";
  const kind = (Object.keys(ASSET_SUBFOLDERS) as AssetKind[]).find(
    (candidate) => candidate !== "image" && ASSET_SUBFOLDERS[candidate] === folder,
  );
  return kind ?? "image";
}
