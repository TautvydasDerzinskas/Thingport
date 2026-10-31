import { UnauthorizedError } from "../api/client";
import { categoriesApi, type Category } from "../api/categories";
import { printsApi, type Print } from "../api/prints";
import { MODEL_EXTS, UPLOAD_EXTS } from "../constants/fileTypes";

export type UploadEntry = {
  file: File;
  relativePath: string;
};

type FileSystemEntry = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (success: (file: File) => void, error?: (err: unknown) => void) => void;
  createReader?: () => FileSystemDirectoryReader;
};

type FileSystemDirectoryReader = {
  readEntries: (success: (entries: FileSystemEntry[]) => void, error?: (err: unknown) => void) => void;
};

function normalizeRelativePath(path: string) {
  const trimmed = (path || "").replace(/\\/g, "/").replace(/^\/+/, "");
  return trimmed || "";
}

export function entriesFromFileList(files: FileList | File[]): UploadEntry[] {
  return Array.from(files || []).map((file) => {
    const anyFile = file as File & { webkitRelativePath?: string };
    const relativePath = normalizeRelativePath(anyFile.webkitRelativePath || file.name);
    return { file, relativePath: relativePath || file.name };
  });
}

async function readAllEntries(reader: FileSystemDirectoryReader) {
  const entries: FileSystemEntry[] = [];
  while (true) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (!batch.length) break;
    entries.push(...batch);
  }
  return entries;
}

async function traverseEntry(entry: FileSystemEntry, parentPath: string, output: UploadEntry[]) {
  const entryPath = normalizeRelativePath(parentPath ? `${parentPath}/${entry.name}` : entry.name);
  if (entry.isFile && entry.file) {
    const file = await new Promise<File>((resolve, reject) => entry.file?.(resolve, reject));
    output.push({ file, relativePath: entryPath || file.name });
    return;
  }
  if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader();
    const entries = await readAllEntries(reader);
    await Promise.all(entries.map((child) => traverseEntry(child, entryPath, output)));
  }
}

export async function entriesFromDataTransfer(dataTransfer: DataTransfer): Promise<UploadEntry[]> {
  const output: UploadEntry[] = [];
  const items = Array.from(dataTransfer.items || []);
  const entryItems = items
    .map((item) => (item as unknown as { webkitGetAsEntry?: () => FileSystemEntry | null }).webkitGetAsEntry?.())
    .filter(Boolean) as FileSystemEntry[];

  if (entryItems.length) {
    await Promise.all(entryItems.map((entry) => traverseEntry(entry, "", output)));
    return output;
  }

  for (const item of items) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (!file) continue;
    const anyFile = file as File & { webkitRelativePath?: string };
    const relativePath = normalizeRelativePath(anyFile.webkitRelativePath || file.name);
    output.push({ file, relativePath: relativePath || file.name });
  }

  if (!output.length) {
    return entriesFromFileList(dataTransfer.files || []);
  }
  return output;
}

/** Finds or creates the category path under `baseCategoryId`, one segment per level. */
function categoryResolver(baseCategoryId: string | null) {
  const cache = new Map<string, string>();
  // Folders reuse a same-named category in the same place, so uploading a tree twice doesn't duplicate it.
  let existing: Category[] | null = null;

  const child = async (parentId: string | null, key: string, name: string) => {
    const cached = cache.get(key);
    if (cached) return cached;
    existing ??= await categoriesApi.list();
    // At the top level only a folder is reused: uploaded folders shouldn't merge into a starter category.
    const match = existing.find(
      (c) => (c.parent_id ?? null) === parentId && c.name === name && (parentId || c.kind === "folder"),
    );
    const id = match ? match.id : ((await categoriesApi.create(name, [], parentId || undefined)) as { id: string }).id;
    cache.set(key, id);
    return id;
  };

  return async (segments: string[]) => {
    let categoryId = baseCategoryId;
    let key = baseCategoryId || "root";
    for (const segment of segments) {
      key = `${key}/${segment}`;
      categoryId = await child(categoryId, key, segment);
    }
    return categoryId;
  };
}

function splitPath(entry: UploadEntry) {
  const segments = normalizeRelativePath(entry.relativePath || entry.file.name)
    .split("/")
    .filter(Boolean);
  segments.pop();
  return segments;
}

function extOf(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function isModelFile(name: string) {
  return MODEL_EXTS.has(extOf(name)) || isGltf(name);
}

const isGltf = (name: string) => extOf(name) === "gltf";
const isDataUri = (uri: string) => uri.startsWith("data:");
const isRemoteUri = (uri: string) => /^[a-z][a-z0-9+.-]*:/i.test(uri) && !isDataUri(uri);

/** `path` with its `.` and `..` segments resolved, as the server resolves a .gltf's references. */
function normalizeSegments(path: string) {
  const out: string[] = [];
  for (const segment of path.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") out.pop();
    else out.push(segment);
  }
  return out.join("/");
}

/** The files a .gltf points at (its .bin buffers and textures), as written in it. None when it doesn't parse: the
 *  server says what's wrong with it when it's uploaded. */
async function gltfReferences(file: File): Promise<string[]> {
  try {
    const json = JSON.parse(await file.text()) as { buffers?: { uri?: unknown }[]; images?: { uri?: unknown }[] };
    return [...(json.buffers ?? []), ...(json.images ?? [])]
      .map((entry) => entry?.uri)
      .filter((uri): uri is string => typeof uri === "string" && !isDataUri(uri) && !isRemoteUri(uri));
  } catch {
    return [];
  }
}

/**
 * For each .gltf among `entries`, the entries it points at. A .gltf keeps its geometry in a .bin and its textures in
 * images beside it; they upload with it as one model, which the server packs into a .glb, rather than as models or
 * gallery pictures of their own. Found by path from the .gltf's folder, or by name when only one file in that folder or below has it.
 */
export async function gltfBundles(entries: UploadEntry[]): Promise<Map<UploadEntry, UploadEntry[]>> {
  const bundles = new Map<UploadEntry, UploadEntry[]>();
  const pathOf = (entry: UploadEntry) =>
    normalizeSegments(normalizeRelativePath(entry.relativePath || entry.file.name));
  const nameOf = (entry: UploadEntry) => entry.file.name.toLowerCase();
  const others = entries.filter((entry) => !isGltf(entry.file.name));
  for (const gltf of entries.filter((entry) => isGltf(entry.file.name))) {
    const folder = pathOf(gltf).split("/").slice(0, -1).join("/");
    const found = new Set<UploadEntry>();
    for (const uri of await gltfReferences(gltf.file)) {
      let decoded = uri;
      try {
        decoded = decodeURIComponent(uri);
      } catch {
        // A stray % in a file name: match it as written.
      }
      const wanted = normalizeSegments(`${folder}/${decoded.replace(/\\/g, "/")}`);
      const byPath = others.find((entry) => pathOf(entry) === wanted);
      const name = wanted.split("/").pop()!.toLowerCase();
      // Only within the scene's own folder tree, so it can't take another model's file; a flat pick has no folders.
      const byName = others.filter(
        (entry) => nameOf(entry) === name && (!folder || pathOf(entry).startsWith(`${folder}/`)),
      );
      const match = byPath ?? (byName.length === 1 ? byName[0] : undefined);
      if (match) found.add(match);
    }
    bundles.set(gltf, [...found]);
  }
  return bundles;
}

// Larger images than the preview-image endpoint takes are attached to the model as files instead.
const PREVIEW_IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "bmp"]);
const PREVIEW_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

// OS metadata a folder pick drags along, never meant as content.
const SYSTEM_FILES = new Set(["thumbs.db", "desktop.ini"]);

export function isSystemFile(name: string) {
  return name.startsWith(".") || SYSTEM_FILES.has(name.toLowerCase());
}

function isPreviewImage(file: File) {
  return PREVIEW_IMAGE_EXTS.has(extOf(file.name)) && file.size <= PREVIEW_IMAGE_MAX_BYTES;
}

/** True when some folder in the upload holds a model file, so the folder-as-model choice means something. */
export function hasModelFolders(entries: UploadEntry[]) {
  return entries.some((entry) => splitPath(entry).length > 0 && isModelFile(entry.file.name));
}

const byName = (a: UploadEntry, b: UploadEntry) =>
  a.file.name.localeCompare(b.file.name, undefined, { numeric: true, sensitivity: "base" });

function failureLabel(name: string, err: unknown) {
  const message = err instanceof Error ? err.message.trim() : "";
  return message && message !== "Upload failed" ? `${name} (${message})` : name;
}

export function uploadEntriesToCategory(
  entries: UploadEntry[],
  parentCategoryId: string | null,
  onUnauthorized?: () => void,
) {
  return uploadEach(entries, categoryResolver(parentCategoryId), onUnauthorized);
}

// A folder pick isn't filtered by the file picker, so skip what couldn't become a model on its own.
const uploadable = (entries: UploadEntry[]) => entries.filter((e) => UPLOAD_EXTS.includes(extOf(e.file.name)));

/** `batched`: more than one request, each sent without a notification; the caller sends the summary.
 *  A lone request notifies by itself, so it's recorded even if the page closes mid-upload. */
async function uploadEach(
  entries: UploadEntry[],
  resolveCategory: ReturnType<typeof categoryResolver>,
  onUnauthorized?: () => void,
  partOfBatch = false,
) {
  const failed: string[] = [];
  let uploaded = 0;
  const uploadedEntries: UploadEntry[] = [];
  const prints: Print[] = [];
  const bundles = await gltfBundles(entries);
  const bundled = new Set([...bundles.values()].flat());
  const todo = uploadable(entries).filter((entry) => !bundled.has(entry));
  const batched = partOfBatch || todo.length > 1;

  for (const entry of todo) {
    try {
      const segments = splitPath(entry);
      let categoryId: string | null;
      try {
        categoryId = await resolveCategory(segments);
      } catch (err) {
        if (err instanceof UnauthorizedError) throw err;
        console.error("Category creation failed for", entry.relativePath, err);
        failed.push(entry.file.name);
        continue;
      }
      // Folder-tree leaves are always single-plate prints; a .gltf brings the files it points at along.
      const parts = [entry, ...(bundles.get(entry) ?? [])];
      const result = await printsApi.upload(
        parts.map((part) => part.file),
        { category_id: categoryId || undefined, notify: !batched, ...(parts.length > 1 ? { mode: "multiplate" } : {}) },
      );
      uploaded += 1;
      uploadedEntries.push(...parts);
      prints.push(...result.prints);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onUnauthorized?.();
        break;
      }
      console.error("Upload failed for", entry.file.name, err);
      failed.push(failureLabel(entry.file.name, err));
    }
  }
  return { uploaded, failed, uploadedEntries, prints, batched };
}

/**
 * Each folder that directly holds model files becomes one model named after the folder: its model files
 * are the plates, its images the preview images, anything else is attached. The folders above it become
 * categories; files outside any model folder upload one model each, as usual.
 */
export async function uploadFoldersAsModels(
  entries: UploadEntry[],
  parentCategoryId: string | null,
  onUnauthorized?: () => void,
) {
  const groups = new Map<string, { segments: string[]; entries: UploadEntry[] }>();
  // A .gltf's .bin and textures go in its folder's model, wherever they sit below it (a "textures" folder, often).
  const bundles = await gltfBundles(entries);
  const bundled = new Set([...bundles.values()].flat());
  for (const entry of entries) {
    if (bundled.has(entry)) continue;
    const segments = splitPath(entry);
    const key = segments.join("/");
    const group = groups.get(key) ?? { segments, entries: [] };
    // Two scenes in a folder can share a file: it goes once.
    for (const part of [entry, ...(bundles.get(entry) ?? [])])
      if (!group.entries.includes(part)) group.entries.push(part);
    groups.set(key, group);
  }

  const modelGroups = [...groups.values()].filter(
    (g) => g.segments.length > 0 && g.entries.some((e) => isModelFile(e.file.name)),
  );
  const rest = [...groups.values()].filter((g) => !modelGroups.includes(g)).flatMap((g) => g.entries);

  const failed: string[] = [];
  let uploaded = 0;
  const uploadedEntries: UploadEntry[] = [];
  const prints: Print[] = [];
  const resolveCategory = categoryResolver(parentCategoryId);
  const batched = modelGroups.length + uploadable(rest).length > 1;

  for (const group of modelGroups) {
    const folderName = group.segments[group.segments.length - 1];
    const sorted = group.entries.toSorted(byName);
    // A texture is part of the scene that uses it, not a picture of the model.
    const images = sorted.filter((e) => isPreviewImage(e.file) && !bundled.has(e));
    const files = sorted.filter((e) => !images.includes(e));
    try {
      let categoryId: string | null;
      try {
        categoryId = await resolveCategory(group.segments.slice(0, -1));
      } catch (err) {
        if (err instanceof UnauthorizedError) throw err;
        console.error("Category creation failed for", group.segments.join("/"), err);
        failed.push(folderName);
        continue;
      }
      const result = await printsApi.upload(
        files.map((e) => e.file),
        { title: folderName, category_id: categoryId || undefined, mode: "multiplate", notify: !batched },
      );
      uploaded += 1;
      uploadedEntries.push(...files);
      let print = result.prints[0];
      if (print && images.length) {
        try {
          print = (
            await printsApi.addPreviewImages(
              print.id,
              images.map((e) => e.file),
            )
          ).print;
          uploadedEntries.push(...images);
        } catch (err) {
          if (err instanceof UnauthorizedError) throw err;
          console.error("Preview images failed for", folderName, err);
          failed.push(failureLabel(`${folderName} (images)`, err));
        }
      }
      if (print) prints.push(print);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onUnauthorized?.();
        return { uploaded, failed, uploadedEntries, prints, batched };
      }
      console.error("Upload failed for", folderName, err);
      failed.push(failureLabel(folderName, err));
    }
  }

  if (rest.length) {
    const result = await uploadEach(rest, resolveCategory, onUnauthorized, batched);
    uploaded += result.uploaded;
    failed.push(...result.failed);
    uploadedEntries.push(...result.uploadedEntries);
    prints.push(...result.prints);
  }
  return { uploaded, failed, uploadedEntries, prints, batched };
}
