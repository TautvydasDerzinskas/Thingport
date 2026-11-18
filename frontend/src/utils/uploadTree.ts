import i18next from "i18next";
import { UnauthorizedError } from "../api/client";
import { categoriesApi, type Category } from "../api/categories";
import { printsApi, type Print } from "../api/prints";
import { MODEL_EXTS, UPLOAD_EXTS } from "../constants/fileTypes";
import { keptExt, keptName } from "./fileExtensions";

export type UploadEntry = {
  file: File;
  relativePath: string;
  /** The path a zip named it by, where another entry of that path made this a numbered copy ("mesh (2).bin"): a scene
   *  naming that path could mean either. */
  zipPath?: string;
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

/** A file as it goes up. A zip's numbered copy a scene took ("mesh (2).bin") goes under the name the zip gave it, the
 *  one the scene names, as the server finds a scene's files by name; anything else as picked. */
function sentFile(entry: UploadEntry, scenePart: boolean): File {
  if (!scenePart || !entry.zipPath) return entry.file;
  return new File([entry.file], entry.zipPath.split("/").pop()!, { type: entry.file.type });
}

/** Where a file was in the pick, for a scene's references: a zip's numbered copy a scene took, where the zip had it. */
function sourceFolderOf(entry: UploadEntry, scenePart: boolean): string | null {
  const path = scenePart && entry.zipPath ? entry.zipPath : entry.relativePath || entry.file.name;
  return normalizeRelativePath(path).split("/").filter(Boolean).slice(0, -1).join("/") || null;
}

/** By the name it's kept by, as the server tells what a file is: "part.stl " is a model file, "stl" isn't. */
function extOf(name: string) {
  return keptExt(name);
}

/** A model file, by its name or its path. */
export function isModelFile(name: string) {
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
 * gallery pictures of their own. Found as the server finds them: by path from the .gltf's folder, or by name when only one
 * file in that folder or below has it. Where more than one file could be the one it means, none is taken, and the name
 * goes in `ambiguous`, under the scene.
 */
export async function gltfBundles(
  entries: UploadEntry[],
  ambiguous?: Map<UploadEntry, string[]>,
): Promise<Map<UploadEntry, UploadEntry[]>> {
  const bundles = new Map<UploadEntry, UploadEntry[]>();
  // By their paths as they were picked, as the server finds them (gltfPacker's findReferenced), and the path a zip
  // gave a numbered copy too, which the scene could mean as well.
  const pathOf = (entry: UploadEntry) =>
    normalizeSegments(normalizeRelativePath(entry.relativePath || entry.file.name));
  const pathsOf = (entry: UploadEntry) =>
    entry.zipPath ? [pathOf(entry), normalizeSegments(normalizeRelativePath(entry.zipPath))] : [pathOf(entry)];
  const nameOf = (path: string) => path.split("/").pop()!.toLowerCase();
  // Each file's places worked out once, as every name each scene points at is looked for among them.
  const others = entries
    .filter((entry) => !isGltf(entry.file.name))
    .map((entry) => ({
      entry,
      places: pathsOf(entry).map((path) => ({ path, name: nameOf(path), kept: keptName(nameOf(path)) })),
    }));
  type Place = (typeof others)[number]["places"][number];
  const matching = (test: (place: Place) => boolean) =>
    others.filter(({ places }) => places.some(test)).map(({ entry }) => entry);
  for (const gltf of entries.filter((entry) => isGltf(entry.file.name))) {
    const folder = pathOf(gltf).split("/").slice(0, -1).join("/");
    // Only within the scene's own folder tree, so it can't take another model's file; a flat pick has no folders.
    const inFolder = (path: string) => !folder || path.startsWith(`${folder}/`);
    const found = new Set<UploadEntry>();
    for (const uri of await gltfReferences(gltf.file)) {
      let decoded = uri;
      try {
        decoded = decodeURIComponent(uri);
      } catch {
        // A stray % in a file name: match it as written.
      }
      const wanted = normalizeSegments(`${folder}/${decoded.replace(/\\/g, "/")}`);
      const named = wanted.split("/").pop()!;
      const name = named.toLowerCase();
      const kept = keptName(name);
      // Each looked for only when the one before found none: at its path, by its name in the scene's folder, then by
      // the name one is kept by ("mesh.bin " for "mesh.bin").
      let candidates = matching((place) => place.path === wanted);
      if (!candidates.length) candidates = matching((place) => place.name === name && inFolder(place.path));
      if (!candidates.length) candidates = matching((place) => place.kept === kept && inFolder(place.path));
      // Two entries of one file are one file; two files are two the scene could mean, and it takes neither.
      const distinct = new Set(candidates.map((entry) => entry.file));
      if (distinct.size === 1) found.add(candidates[0]);
      else if (distinct.size > 1) ambiguous?.set(gltf, [...new Set([...(ambiguous.get(gltf) ?? []), named])]);
    }
    bundles.set(gltf, [...found]);
  }
  return bundles;
}

/** The pictures the gallery took, by the id its answer gave each in turn: one it couldn't keep (null) is named among
 *  the failures rather than counted as up. An answer without ids, from an older backend, took them all. */
function photosKept(images: UploadEntry[], ids: (string | null)[] | undefined, failed: string[]): UploadEntry[] {
  if (!ids) return images;
  images.forEach((entry, index) => {
    if (ids[index] === null) failed.push(entry.file.name);
  });
  return images.filter((_, index) => ids[index] !== null);
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

/** Why a model whose .gltf names a file more than one picked file could be stays out: the server couldn't tell which
 *  either, and would keep the scene without it. */
function unclearScene(names: string[]): Error {
  return new Error(i18next.t("uploadBar.gltfAmbiguous", { ns: "app", names: names.join(", ") }));
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
 *  A lone request notifies by itself, so it's recorded even if the page closes mid-upload. `skipped`: the files that
 *  can't be a model on their own (a PDF, notes), for the caller to say so. `unclearBefore`: the scenes a look at the
 *  whole pick found more than one file for, which a look at only these can't see once another model took those. */
async function uploadEach(
  entries: UploadEntry[],
  resolveCategory: ReturnType<typeof categoryResolver>,
  onUnauthorized?: () => void,
  partOfBatch = false,
  unclearBefore?: Map<UploadEntry, string[]>,
) {
  const failed: string[] = [];
  let uploaded = 0;
  const uploadedEntries: UploadEntry[] = [];
  const prints: Print[] = [];
  const unclear = new Map<UploadEntry, string[]>(unclearBefore);
  const bundles = await gltfBundles(entries, unclear);
  const bundled = new Set([...bundles.values()].flat());
  const todo = uploadable(entries).filter((entry) => !bundled.has(entry));
  const skipped = entries
    .filter((entry) => !bundled.has(entry) && !todo.includes(entry) && !isSystemFile(entry.file.name))
    .map((entry) => entry.file.name);
  const batched = partOfBatch || todo.length > 1;

  for (const entry of todo) {
    const names = unclear.get(entry);
    if (names) {
      failed.push(failureLabel(entry.file.name, unclearScene(names)));
      continue;
    }
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
        parts.map((part) => sentFile(part, part !== entry)),
        {
          category_id: categoryId || undefined,
          notify: !batched,
          // A scene's files by where each was in the pick: two of one name in two folders are two files to the server.
          ...(parts.length > 1
            ? { mode: "multiplate", sourceFolders: parts.map((part) => sourceFolderOf(part, part !== entry)) }
            : {}),
        },
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
  return { uploaded, failed, uploadedEntries, prints, batched, skipped };
}

/** The folder of each entry below the folders every one of them shares: a zip named after its model holding one
 *  folder named after it again keeps none of that. */
function foldersBelowShared(entries: UploadEntry[]): (string | null)[] {
  const paths = entries.map(splitPath);
  let shared = 0;
  while (
    paths.length > 0 &&
    paths.every((segments) => segments.length > shared && segments[shared] === paths[0][shared])
  )
    shared += 1;
  return paths.map((segments) => (segments.length > shared ? segments.slice(shared).join("/") : null));
}

/**
 * All of `entries` as one model, as an uploaded zip's "one model" makes it: its model files are the plates and its
 * other files supporting ones, each in its folder below those they all share, and its pictures are the photos. One
 * with no model file has its pictures as plates, as an upload of only pictures has. Documents alone can't be a model:
 * nothing is sent, and they come back in `skipped`. Named `title`, or by the server from its files.
 * The plates keep the order of `entries`: a pick of several files is the model in the order they were picked.
 * `folder` is where they sat in the upload, a zip's in a picked folder ("Kits/Frog"): a category, as a folder pick
 * makes one, so the model lands where the zip was, as the zip itself would.
 */
export async function uploadEntriesAsOneModel(
  entries: UploadEntry[],
  title: string | null,
  parentCategoryId: string | null,
  onUnauthorized?: () => void,
  folder = "",
) {
  const failed: string[] = [];
  const uploadedEntries: UploadEntry[] = [];
  const prints: Print[] = [];
  const kept = entries.filter((entry) => !isSystemFile(entry.file.name));
  if (!uploadable(kept).length) {
    return { uploaded: 0, failed, uploadedEntries, prints, batched: false, skipped: kept.map((e) => e.file.name) };
  }
  const label = title ?? kept[0]?.file.name ?? "";
  // A texture is part of the scene that uses it, not a picture of the model.
  const unclear = new Map<UploadEntry, string[]>();
  const bundled = new Set([...(await gltfBundles(kept, unclear)).values()].flat());
  if (unclear.size) {
    failed.push(failureLabel(label, unclearScene([...new Set([...unclear.values()].flat())])));
    return { uploaded: 0, failed, uploadedEntries, prints, batched: false, skipped: [] as string[] };
  }
  const hasModel = kept.some((entry) => isModelFile(entry.file.name));
  const images = hasModel ? kept.filter((entry) => isPreviewImage(entry.file) && !bundled.has(entry)) : [];
  const files = kept.filter((entry) => !images.includes(entry));
  const folders = foldersBelowShared(kept);
  try {
    const segments = folder.split("/").filter(Boolean);
    const categoryId = segments.length ? await categoryResolver(parentCategoryId)(segments) : parentCategoryId;
    const result = await printsApi.upload(
      files.map((entry) => sentFile(entry, bundled.has(entry))),
      {
        ...(title ? { title } : {}),
        category_id: categoryId || undefined,
        mode: "multiplate",
        folders: files.map((entry) => folders[kept.indexOf(entry)]),
        // Where each was in the pick, for a .gltf's references: a scene can name a file above the folders kept.
        sourceFolders: files.map((entry) => sourceFolderOf(entry, bundled.has(entry))),
      },
    );
    uploadedEntries.push(...files);
    let print = result.prints[0];
    if (print && images.length) {
      try {
        const added = await printsApi.addPreviewImages(
          print.id,
          images.map((entry) => entry.file),
        );
        print = added.print;
        uploadedEntries.push(...photosKept(images, added.image_ids, failed));
      } catch (err) {
        if (err instanceof UnauthorizedError) {
          // Up already, without its photos: still one of those uploaded.
          prints.push(print);
          throw err;
        }
        console.error("Preview images failed for", label, err);
        failed.push(failureLabel(i18next.t("uploadBar.photosOf", { ns: "app", name: label }), err));
      }
    }
    if (print) prints.push(print);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      onUnauthorized?.();
    } else {
      console.error("Upload failed for", label, err);
      failed.push(failureLabel(label, err));
    }
  }
  return { uploaded: prints.length, failed, uploadedEntries, prints, batched: false, skipped: [] as string[] };
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
  const unclear = new Map<UploadEntry, string[]>();
  const bundles = await gltfBundles(entries, unclear);
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
  // A subfolder with no model files of its own belongs to the model folder above it, rather than coming in file by
  // file: its documents are that model's, in their folder ("docs"), and its pictures are that model's photos.
  const attachedTo = new Map<(typeof modelGroups)[number], { entry: UploadEntry; folder: string }[]>();
  const rest: UploadEntry[] = [];
  for (const group of groups.values()) {
    if (modelGroups.includes(group)) continue;
    const key = group.segments.join("/");
    const owner = modelGroups
      .filter((model) => key.startsWith(`${model.segments.join("/")}/`))
      .toSorted((a, b) => b.segments.length - a.segments.length)[0];
    if (!owner) {
      rest.push(...group.entries);
      continue;
    }
    const folder = group.segments.slice(owner.segments.length).join("/");
    attachedTo.set(owner, [...(attachedTo.get(owner) ?? []), ...group.entries.map((entry) => ({ entry, folder }))]);
  }

  const failed: string[] = [];
  let uploaded = 0;
  const uploadedEntries: UploadEntry[] = [];
  const prints: Print[] = [];
  const resolveCategory = categoryResolver(parentCategoryId);
  const batched = modelGroups.length + uploadable(rest).length > 1;

  for (const group of modelGroups) {
    const folderName = group.segments[group.segments.length - 1];
    const names = [...new Set(group.entries.flatMap((entry) => unclear.get(entry) ?? []))];
    if (names.length) {
      failed.push(failureLabel(folderName, unclearScene(names)));
      continue;
    }
    const sorted = group.entries.toSorted(byName);
    const attached = (attachedTo.get(group) ?? []).toSorted((a, b) => byName(a.entry, b.entry));
    // A texture is part of the scene that uses it, not a picture of the model.
    const images = [
      ...sorted.filter((e) => isPreviewImage(e.file) && !bundled.has(e)),
      ...attached.filter((a) => isPreviewImage(a.entry.file)).map((a) => a.entry),
    ];
    const attachedFiles = attached.filter((a) => !isPreviewImage(a.entry.file) && !isSystemFile(a.entry.file.name));
    const files = [...sorted.filter((e) => !images.includes(e)), ...attachedFiles.map((a) => a.entry)];
    // A scene's .bin and textures by their path below the model's folder, so the server packs each into the scene that
    // names it though two share a name (textures/body.png, variant/body.png). One outside it goes by its name alone.
    const belowModel = (entry: UploadEntry) => {
      const segments = splitPath(entry);
      const inside = group.segments.every((segment, index) => segments[index] === segment);
      return (inside && segments.slice(group.segments.length).join("/")) || null;
    };
    const folders = [
      ...sorted.filter((e) => !images.includes(e)).map(belowModel),
      ...attachedFiles.map((a) => a.folder),
    ];
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
      // Where each was in the pick, for a scene that names a file outside its model's folder ("../shared/mesh.bin").
      const sourceFolders = files.map((e) => sourceFolderOf(e, bundled.has(e)));
      const result = await printsApi.upload(
        files.map((e) => sentFile(e, bundled.has(e))),
        {
          title: folderName,
          category_id: categoryId || undefined,
          mode: "multiplate",
          notify: !batched,
          folders,
          sourceFolders,
        },
      );
      uploaded += 1;
      uploadedEntries.push(...files);
      let print = result.prints[0];
      if (print && images.length) {
        try {
          const added = await printsApi.addPreviewImages(
            print.id,
            images.map((e) => e.file),
          );
          print = added.print;
          uploadedEntries.push(...photosKept(images, added.image_ids, failed));
        } catch (err) {
          if (err instanceof UnauthorizedError) {
            prints.push(print);
            throw err;
          }
          console.error("Preview images failed for", folderName, err);
          failed.push(failureLabel(i18next.t("uploadBar.photosOf", { ns: "app", name: folderName }), err));
        }
      }
      if (print) prints.push(print);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onUnauthorized?.();
        return { uploaded, failed, uploadedEntries, prints, batched, skipped: [] as string[] };
      }
      console.error("Upload failed for", folderName, err);
      failed.push(failureLabel(folderName, err));
    }
  }

  const skipped: string[] = [];
  if (rest.length) {
    // With what the whole pick showed: a scene beside the folders whose texture is in two of them is still unclear,
    // though those folders' models have taken both by now.
    const result = await uploadEach(rest, resolveCategory, onUnauthorized, batched, unclear);
    uploaded += result.uploaded;
    failed.push(...result.failed);
    uploadedEntries.push(...result.uploadedEntries);
    prints.push(...result.prints);
    skipped.push(...result.skipped);
  }
  return { uploaded, failed, uploadedEntries, prints, batched, skipped };
}
