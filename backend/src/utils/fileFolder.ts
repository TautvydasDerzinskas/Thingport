// The folder a model's file came in: a site's own (Printables, GrabCAD, PIXUP...), a zip's, or a partner instance's.
// Kept on Plate.folder and PrintFile.folder as its levels joined by "/", so "USB C version/Handles", and null for a
// file in none. Every source is untrusted, so everything that keeps one goes through normalizeFolder first.

/** How deep a folder may go, how long one level's name and the whole may be. Deeper levels are dropped. */
export const FOLDER_DEPTH_MAX = 8;
export const FOLDER_LEVEL_MAX = 120;
export const FOLDER_MAX = 500;

// oxlint-disable-next-line no-control-regex -- stripping control chars is the point here.
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

/** The levels of `raw` (a "/" or "\" path, or levels already split), each trimmed of control characters and spare
 *  spaces, without the ones that name no folder or climb out of one ("", ".", ".."). */
function levelsOf(raw: string | readonly string[]): string[] {
  const parts = typeof raw === "string" ? raw.split(/[\\/]+/) : raw.flatMap((part) => part.split(/[\\/]+/));
  return parts
    .map((part) => part.replace(CONTROL_CHARS, "").replace(/\s+/g, " ").trim().slice(0, FOLDER_LEVEL_MAX).trim())
    .filter((part) => part && part !== "." && part !== "..");
}

/** A folder as it's kept, or null for none. */
export function normalizeFolder(raw: string | readonly string[] | null | undefined): string | null {
  if (raw == null) return null;
  const levels: string[] = [];
  let length = 0;
  for (const level of levelsOf(raw).slice(0, FOLDER_DEPTH_MAX)) {
    length += level.length + (levels.length ? 1 : 0);
    if (length > FOLDER_MAX) break;
    levels.push(level);
  }
  return levels.length ? levels.join("/") : null;
}

/** A kept folder's levels; none for null. */
export function folderLevels(folder: string | null | undefined): string[] {
  return folder ? folder.split("/").filter(Boolean) : [];
}

/** `inner` inside `outer`: "Variant" and "Base/Arms" give "Variant/Base/Arms". */
export function joinFolders(...folders: (string | null | undefined)[]): string | null {
  return normalizeFolder(folders.flatMap((folder) => folderLevels(folder)));
}

/** Whether `folder` is `within` or one of the folders in it. A null `within` holds everything. */
export function isInFolder(folder: string | null | undefined, within: string | null | undefined): boolean {
  if (!within) return true;
  return folder === within || Boolean(folder?.startsWith(`${within}/`));
}

/** A file's place within its model, for a zip or a partner: "USB C/Plug.stl", or the name alone. */
export function folderPath(folder: string | null | undefined, filename: string): string {
  return folder ? `${folder}/${filename}` : filename;
}

/** What macOS leaves in a zip it made, never meant as content: its `__MACOSX` resource forks, `._` files beside each
 *  real one, and `.DS_Store`. */
export function isZipJunk(entryPath: string): boolean {
  const levels = entryPath.split(/[\\/]+/).filter(Boolean);
  const name = levels.at(-1) ?? "";
  return levels.includes("__MACOSX") || name.startsWith("._") || name === ".DS_Store";
}

/**
 * The folders of a set of files with the top levels they all share taken off: a zip named after its model that holds
 * one folder named after it again, or a site that keeps everything in "STL", says nothing about which file is which.
 * A file that sits at a level stops it there, so files beside folders keep them. Files are matched by index.
 */
export function withoutSharedTop<T extends { folder?: string | null }>(files: T[]): T[] {
  const shared = sharedTopLevels(files.map((file) => file.folder));
  return shared ? files.map((file) => ({ ...file, folder: withoutTopLevels(file.folder, shared) })) : files;
}

/** How many top levels every one of `folders` shares; none when one of them is no folder at all. */
export function sharedTopLevels(folders: readonly (string | null | undefined)[]): number {
  if (!folders.length) return 0;
  const levels = folders.map((folder) => folderLevels(folder));
  let shared = 0;
  for (;;) {
    const first = levels[0][shared];
    if (first === undefined || !levels.every((each) => each[shared] === first)) return shared;
    shared++;
  }
}

/** `folder` without its first `count` levels. */
export function withoutTopLevels(folder: string | null | undefined, count: number): string | null {
  return normalizeFolder(folderLevels(folder).slice(count));
}
