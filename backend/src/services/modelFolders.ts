/** A folder tree's files as "Each folder is a model" takes them, in the order their folders were first met: each folder
 *  that directly holds a model file is one model, named after it, and the files of a subfolder below it that holds none
 *  are attached to it, each with its folder below the model's; the other files stand on their own. A file's folder is
 *  its path joined by "/", "" at the top. Shared by the consume folder's folder mode and an imported zip's "A model per
 *  folder", so the two make the same models of the same tree. */
export type ModelFolderUnit<T> =
  { kind: "model"; folder: string; files: T[]; attached: { item: T; folder: string }[] } | { kind: "file"; item: T };

export function modelFolderUnits<T>(
  items: T[],
  folderOf: (item: T) => string,
  isModelFile: (item: T) => boolean,
): ModelFolderUnit<T>[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = folderOf(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const modelKeys = [...groups].filter(([key, group]) => key && group.some(isModelFile)).map(([key]) => key);
  // A subfolder with no model files of its own belongs to the model folder above it, rather than coming in file by
  // file: its documents are that model's, in their folder, and its pictures are that model's photos.
  const attached = new Map<string, { item: T; folder: string }[]>();
  for (const [key, group] of groups) {
    if (!key || modelKeys.includes(key)) continue;
    const owner = modelKeys.filter((m) => key.startsWith(`${m}/`)).toSorted((a, b) => b.length - a.length)[0];
    if (!owner) continue;
    const folder = key.slice(owner.length + 1);
    attached.set(owner, [...(attached.get(owner) ?? []), ...group.map((item) => ({ item, folder }))]);
  }
  const taken = new Set([...attached.values()].flat().map((entry) => entry.item));
  return [...groups].flatMap(([key, group]): ModelFolderUnit<T>[] =>
    modelKeys.includes(key)
      ? [{ kind: "model", folder: key, files: group, attached: attached.get(key) ?? [] }]
      : group.filter((item) => !taken.has(item)).map((item) => ({ kind: "file", item })),
  );
}
