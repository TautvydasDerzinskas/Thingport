import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { ADAPTED_3MFS, DESCRIPTION_IMAGES, MODEL_PREVIEWS, PREVIEWS, STORAGE, THUMBS } from "../config";
import { prisma } from "../db";

// Everything Thingport makes for a model -- its gallery and description images, and each plate's thumbnail, render,
// 3D preview and slicer copies -- lives in an "Images" folder beside its files, at Print.assetsPath, so it moves and
// goes with the model. They used to share folders keyed by id (THUMBS, PREVIEWS, MODEL_PREVIEWS, ...), and a model
// the storage move hasn't reached yet, or only part of, still has some there. Reads look in both.

/** Print.assetsPath. */
export type AssetHome = string | null | undefined;
/** "preview" is a plate's 3D preview (GLB), "slicer" a copy of its 3MF adapted for a slicer. */
export type AssetKind = "image" | "description" | "thumb" | "render" | "preview" | "slicer";
/** `legacyName` when the old shared folder named it differently. */
export type AssetFile = { kind: AssetKind; name: string; legacyName?: string };

export const ASSETS_FOLDER = "Images";
// Gallery images go straight in the folder: they're the pictures someone browsing it is after.
export const ASSET_SUBFOLDERS: Record<AssetKind, string> = {
  image: "",
  description: "Description",
  thumb: "Thumbnails",
  render: "Renders",
  preview: "3D previews",
  slicer: "Slicer copies",
};
const LEGACY_DIRS: Record<AssetKind, string> = {
  image: PREVIEWS,
  description: DESCRIPTION_IMAGES,
  thumb: THUMBS,
  render: MODEL_PREVIEWS,
  preview: MODEL_PREVIEWS,
  slicer: ADAPTED_3MFS,
};

// Part of a render's name, so changing its look (modelPreviewCache's MODEL_IMAGE_KINDS) draws older ones again.
export const RENDER_FILE_TAG = "render.v4";
// The same, for the picture drawn in a model's own colours rather than in one the app tints.
export const COLOR_RENDER_FILE_TAG = "color.v2";
// Part of a 3D preview's name, so bumping it draws older GLBs again on next view. Failure markers carry it too, so a
// file an older renderer refused gets another attempt.
export const PREVIEW_FORMAT_VERSION = 5;

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
  return /\.(?:render|color)(\.v\d+)?\.png$/.test(name);
}

export function plateRenderFile(plateId: string, tag = RENDER_FILE_TAG): AssetFile {
  return { kind: "render", name: `${plateId}.${tag}.png` };
}

export function plateGlbFile(plateId: string, version = PREVIEW_FORMAT_VERSION): AssetFile {
  return { kind: "preview", name: `${plateId}.v${version}.glb` };
}

/** `name` is the copy's file name: the plate's id, what it was adapted for, and the adapter's version. */
export function slicerCopyFile(name: string): AssetFile {
  return { kind: "slicer", name };
}

/** "render.v4" to ["render", "render.v1", ..., "render.v3"]: the names an earlier look of it had. */
function olderTags(tag: string): string[] {
  const match = /^(.+)\.v(\d+)$/.exec(tag);
  if (!match) return [];
  return [match[1], ...Array.from({ length: Number(match[2]) - 1 }, (_, index) => `${match[1]}.v${index + 1}`)];
}

/** The plate's 3D previews and renders of an earlier format, which nothing shows any more. */
export function olderPlateFiles(plateId: string): AssetFile[] {
  return [
    { kind: "preview", name: `${plateId}.glb` },
    ...Array.from({ length: PREVIEW_FORMAT_VERSION - 1 }, (_, index) => plateGlbFile(plateId, index + 1)),
    ...[...olderTags(RENDER_FILE_TAG), ...olderTags(COLOR_RENDER_FILE_TAG)].map((tag) => plateRenderFile(plateId, tag)),
  ];
}

/** Whether a file named `name`, of this kind, is a 3D preview or render of an earlier format. */
export function isSupersededAsset(kind: AssetKind, name: string): boolean {
  if (kind === "preview") return name.endsWith(".glb") && !name.endsWith(`.v${PREVIEW_FORMAT_VERSION}.glb`);
  if (kind === "render") {
    return (
      isLegacyRender(name) && ![RENDER_FILE_TAG, COLOR_RENDER_FILE_TAG].some((tag) => name.endsWith(`.${tag}.png`))
    );
  }
  return false;
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

/** Every file of this kind that's the plate's, of any version, in the model's folder and the old shared one (and
 *  whatever else of the plate's is in that, such as its failure markers): named by its id, then a dot. Bytes freed. */
export async function removePlateAssets(home: AssetHome, kind: AssetKind, plateId: string): Promise<number> {
  const dirs = [LEGACY_DIRS[kind], ...(home ? [path.join(STORAGE, home, ASSET_SUBFOLDERS[kind])] : [])];
  let freed = 0;
  for (const dir of dirs) {
    const names = await fs.readdir(dir).catch(() => [] as string[]);
    for (const name of names.filter((entry) => entry.startsWith(`${plateId}.`))) {
      freed += await removeFile(path.join(dir, name));
    }
  }
  return freed;
}

/** Its size, once it's gone; 0 when it wasn't there or stays. */
export async function removeFile(file: string): Promise<number> {
  try {
    const { size } = await fs.stat(file);
    await fs.rm(file, { force: true });
    return size;
  } catch {
    return 0;
  }
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
