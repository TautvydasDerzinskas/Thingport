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
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  const modelKeys = new Set([...groups].filter(([key, group]) => key && group.some(isModelFile)).map(([key]) => key));
  // A subfolder with no model files of its own belongs to the model folder above it, rather than coming in file by
  // file: its documents are that model's, in their folder, and its pictures are that model's photos. The nearest
  // folder above that is a model, found by walking up from it rather than by looking through every model.
  const ownerOf = (key: string) => {
    for (let cut = key.lastIndexOf("/"); cut > 0; cut = key.lastIndexOf("/", cut - 1)) {
      if (modelKeys.has(key.slice(0, cut))) return key.slice(0, cut);
    }
    return null;
  };
  const attached = new Map<string, { item: T; folder: string }[]>();
  for (const [key, group] of groups) {
    if (!key || modelKeys.has(key)) continue;
    const owner = ownerOf(key);
    if (!owner) continue;
    const folder = key.slice(owner.length + 1);
    const list = attached.get(owner) ?? [];
    if (!attached.has(owner)) attached.set(owner, list);
    for (const item of group) list.push({ item, folder });
  }
  const taken = new Set([...attached.values()].flat().map((entry) => entry.item));
  return [...groups].flatMap(([key, group]): ModelFolderUnit<T>[] =>
    modelKeys.has(key)
      ? [{ kind: "model", folder: key, files: group, attached: attached.get(key) ?? [] }]
      : group.filter((item) => !taken.has(item)).map((item) => ({ kind: "file", item })),
  );
}
