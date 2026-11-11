import { stemOf } from "./fileExtensions";

// A model's files grouped by the folder their source kept them in (Plate.folder: levels joined by "/"), as the model
// page lists them: the files in no folder first, then each folder in the order its first file comes.

export type FolderGroup<T> = { folder: string | null; items: T[] };

export function groupByFolder<T>(
  items: readonly T[],
  folderOf: (item: T) => string | null | undefined,
): FolderGroup<T>[] {
  const groups = new Map<string, FolderGroup<T>>();
  for (const item of items) {
    const folder = folderOf(item) || null;
    const key = folder ?? "";
    const group = groups.get(key) ?? { folder, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  const loose = groups.get("");
  return [...(loose ? [loose] : []), ...[...groups.values()].filter((group) => group.folder !== null)];
}

/** Whether any of the files is in a folder: without, a list shows as it always has. */
export function hasFolders<T>(items: readonly T[], folderOf: (item: T) => string | null | undefined): boolean {
  return items.some((item) => Boolean(folderOf(item)));
}

/** "USB C version / Handles". */
export function folderLabel(folder: string): string {
  return folder.split("/").filter(Boolean).join(" / ");
}

// A word and the separator after it: "Charger ", "Bandit_".
const WORD = /[^ _-]+[ _-]*/g;
const bare = (word: string) => word.replace(/[ _-]+$/, "").toLowerCase();

/**
 * Each file's name without its extension, and inside a folder without the words every name in it starts with, which
 * the folder's heading says already: "Charger Cable Organizer USB C Blank" and "… USB C Knurled" in one folder show as
 * "Blank" and "Knurled". Files in no folder keep their whole names, as do a folder's files when trimming would leave
 * one with nothing. The full name stays the file's tooltip.
 */
export function shortNames<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  filenameOf: (item: T) => string,
  folderOf: (item: T) => string | null | undefined,
): Map<string, string> {
  const names = new Map<string, string>();
  for (const group of groupByFolder(items, folderOf)) {
    const words = group.items.map((item) => stemOf(filenameOf(item)).match(WORD) ?? [stemOf(filenameOf(item))]);
    let shared = 0;
    if (group.folder && group.items.length > 1) {
      while (words.every((each) => each.length > shared + 1 && bare(each[shared]) === bare(words[0][shared]))) shared++;
    }
    group.items.forEach((item, index) => {
      const rest = words[index].slice(shared).join("").trim();
      names.set(keyOf(item), shared ? rest.charAt(0).toUpperCase() + rest.slice(1) : stemOf(filenameOf(item)));
    });
  }
  return names;
}
