import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { prisma } from "../db";
import { CONSUME_DIR, IMPORT_MAX_BYTES, RENDERABLE_MODEL_EXTS, UPLOADABLE_EXTS } from "../config";
import { HttpError, guessMimeFromPath, sanitizeFilename } from "../utils/fileUtils";
import { listZipEntries, readZipEntry } from "../utils/zipReader";
import { normalizeZipEntryPath, resolveZipCategoryId } from "./zipService";
import { createPrint, type NewPlateInput } from "./printCreation";
import { saveFileFromTemp } from "./printFileService";
import { addPreviewImage } from "./previewImageService";
import { plateThumbExists, saveThumbFromBytes } from "./printService";
import { createNotification } from "./notificationService";

export const CONSUME_MODES = ["separate", "folder"] as const;
export type ConsumeMode = (typeof CONSUME_MODES)[number];

const MODE_KEY = "consume_mode";
const USER_KEY = "consume_user_id";

/** Inside the consume folder; never scanned, so what can't be imported isn't retried forever. */
export const NOT_IMPORTED_DIR = "Not imported";

const POLL_MS = 2000;
const PREVIEW_IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp"]);
// As for uploads: a bigger image is attached as a file instead of being read in as a preview.
const PREVIEW_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
// OS metadata a copied folder drags along.
const SYSTEM_FILES = new Set(["thumbs.db", "desktop.ini"]);

export function consumeAvailable(dir = CONSUME_DIR): boolean {
  try {
    return fsSync.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

export async function getConsumeMode(): Promise<ConsumeMode> {
  const row = await prisma.setting.findUnique({ where: { key: MODE_KEY } });
  return row?.value === "folder" ? "folder" : "separate";
}

/** The chosen account, or the oldest admin when none is chosen or it no longer exists. */
export async function getConsumeUserId(): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key: USER_KEY } });
  if (typeof row?.value === "string") {
    const user = await prisma.user.findUnique({ where: { id: row.value }, select: { id: true } });
    if (user) return user.id;
  }
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" } });
  return admin?.id ?? null;
}

export async function setConsumeSettings(patch: { mode?: ConsumeMode; userId?: string }): Promise<void> {
  if (patch.userId && !(await prisma.user.findUnique({ where: { id: patch.userId }, select: { id: true } }))) {
    throw new HttpError(400, "User not found");
  }
  for (const [key, value] of [
    [MODE_KEY, patch.mode],
    [USER_KEY, patch.userId],
  ] as const) {
    if (value === undefined) continue;
    await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }
}

type FoundFile = { abs: string; rel: string; size: number; mtimeMs: number };

function isSystemName(name: string) {
  return name.startsWith(".") || SYSTEM_FILES.has(name.toLowerCase());
}

async function walk(root: string, dir = root, out: FoundFile[] = []): Promise<FoundFile[]> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (isSystemName(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (dir === root && entry.name === NOT_IMPORTED_DIR) continue;
      await walk(root, abs, out);
    } else if (entry.isFile()) {
      const stat = await fs.stat(abs);
      out.push({
        abs,
        rel: path.relative(root, abs).split(path.sep).join("/"),
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      });
    }
  }
  return out;
}

function signature(files: FoundFile[]) {
  return files
    .map((f) => `${f.rel}:${f.size}:${f.mtimeMs}`)
    .toSorted()
    .join("\n");
}

/**
 * One file to import. `rel` is its place in the tree, with a zip standing in for a folder. Files are
 * copied into storage and the source removed only once that worked, so a failure can still set it aside.
 */
type Item = { rel: string; path: string; size: number };

export type ConsumeSummary = { models: number; files: number; failed: string[]; printIds: string[] };

const extOf = (name: string) => path.extname(name).toLowerCase();
const foldersOf = (rel: string) => rel.split("/").slice(0, -1);
const byName = (a: Item, b: Item) =>
  path.basename(a.rel).localeCompare(path.basename(b.rel), undefined, { numeric: true, sensitivity: "base" });

function tempPath() {
  return path.join(os.tmpdir(), `thingport-consume-${crypto.randomBytes(8).toString("hex")}`);
}

async function moveFile(from: string, to: string) {
  await fs.mkdir(path.dirname(to), { recursive: true });
  try {
    await fs.rename(from, to);
  } catch (err: any) {
    if (err?.code !== "EXDEV") throw err;
    await fs.copyFile(from, to);
    await fs.rm(from, { force: true });
  }
}

async function freePath(target: string) {
  const { dir, name, ext } = path.parse(target);
  let candidate = target;
  for (let n = 2; fsSync.existsSync(candidate); n++) candidate = path.join(dir, `${name} (${n})${ext}`);
  return candidate;
}

/**
 * A zip is unpacked as if it were a folder named after it. When everything in it already sits in
 * one top folder (Benchy.zip holding Benchy/...), that folder is used instead of nesting it twice.
 */
async function expandZip(file: FoundFile): Promise<Item[]> {
  const entries = (await listZipEntries(file.abs))
    .filter((e) => !e.isDirectory)
    .map((e) => normalizeZipEntryPath(e.name))
    .filter((name): name is string => Boolean(name) && !name!.split("/").some(isSystemName));
  const parent = path.posix.dirname(file.rel) === "." ? "" : path.posix.dirname(file.rel);
  const tops = new Set(entries.map((e) => e.split("/")[0]));
  const selfFoldered = tops.size === 1 && entries.every((e) => e.includes("/"));
  const prefix = selfFoldered ? parent : path.posix.join(parent, path.parse(file.rel).name);

  const items: Item[] = [];
  try {
    for (const entry of entries) {
      // All or nothing: the zip is deleted afterwards, so a skipped entry would be lost.
      const buffer = await readZipEntry(file.abs, entry, IMPORT_MAX_BYTES);
      if (!buffer) throw new Error(`Couldn't extract ${entry} (too large or unreadable)`);
      const tmp = tempPath();
      await fs.writeFile(tmp, buffer);
      items.push({ rel: path.posix.join(prefix, entry), path: tmp, size: buffer.length });
    }
  } catch (err) {
    for (const item of items) await fs.rm(item.path, { force: true });
    throw err;
  }
  return items;
}

/** Imports everything currently in `dir` for its owner, then notifies them. */
export async function consumeFolder(dir = CONSUME_DIR): Promise<ConsumeSummary | null> {
  const files = await walk(dir);
  if (!files.length) return null;
  const userId = await getConsumeUserId();
  if (!userId) {
    console.warn("Consume folder: no admin account to import for; leaving files in place.");
    return null;
  }
  const mode = await getConsumeMode();
  const summary: ConsumeSummary = { models: 0, files: 0, failed: [], printIds: [] };

  const notImported = async (item: Item) => {
    summary.failed.push(item.rel);
    try {
      await moveFile(item.path, await freePath(path.join(dir, NOT_IMPORTED_DIR, item.rel)));
    } catch (err) {
      console.error("Consume folder: couldn't set aside", item.rel, err);
    }
  };

  const items: Item[] = [];
  const zips: FoundFile[] = [];
  for (const file of files) {
    if (extOf(file.abs) !== ".zip") {
      items.push({ rel: file.rel, path: file.abs, size: file.size });
      continue;
    }
    try {
      items.push(...(await expandZip(file)));
      zips.push(file);
    } catch (err) {
      console.error("Consume folder: unreadable zip", file.rel, err);
      await notImported({ rel: file.rel, path: file.abs, size: file.size });
    }
  }

  // The same cap as every other way in.
  const importable: Item[] = [];
  for (const item of items) {
    if (item.size > IMPORT_MAX_BYTES) await notImported(item);
    else importable.push(item);
  }

  const categoryCache = new Map<string, string>();
  const categoryFor = (folders: string[]) =>
    resolveZipCategoryId(userId, null, [...folders, "_"].join("/"), categoryCache);

  const importEach = async (item: Item) => {
    if (!UPLOADABLE_EXTS.has(extOf(item.rel))) return notImported(item);
    try {
      const filename = sanitizeFilename(path.basename(item.rel));
      const { print } = await createPrint(
        userId,
        {
          categoryId: await categoryFor(foldersOf(item.rel)),
          categorySource: "MANUAL",
        },
        path.parse(filename).name,
        [{ filename, mime: guessMimeFromPath(filename), copyFromPath: item.path }],
      );
      await fs.rm(item.path, { force: true });
      summary.models += 1;
      summary.files += 1;
      summary.printIds.push(print.id);
    } catch (err) {
      console.error("Consume folder: import failed for", item.rel, err);
      await notImported(item);
    }
  };

  // Same rules as uploading folders with "each folder is one model": a folder holding model files is
  // one model named after it; its images are the previews, anything else is attached.
  const importFolder = async (folders: string[], group: Item[]) => {
    const sorted = group.toSorted(byName);
    const plates = sorted.filter((i) => RENDERABLE_MODEL_EXTS.has(extOf(i.rel)));
    const rest = sorted.filter((i) => !plates.includes(i));
    const name = folders[folders.length - 1];
    let printId: string;
    let firstPlateId: string | undefined;
    try {
      const inputs: NewPlateInput[] = plates.map((i) => {
        const filename = sanitizeFilename(path.basename(i.rel));
        return { filename, mime: guessMimeFromPath(filename), copyFromPath: i.path };
      });
      const { print, plates: created } = await createPrint(
        userId,
        {
          title: name,
          categoryId: await categoryFor(folders.slice(0, -1)),
          categorySource: "MANUAL",
        },
        name,
        inputs,
      );
      printId = print.id;
      firstPlateId = created[0]?.id;
      for (const item of plates) await fs.rm(item.path, { force: true });
    } catch (err) {
      console.error("Consume folder: import failed for", folders.join("/"), err);
      for (const item of group) await notImported(item);
      return;
    }
    summary.models += 1;
    summary.files += plates.length;
    summary.printIds.push(printId);

    let thumbSeeded = !firstPlateId || plateThumbExists(firstPlateId);
    for (const item of rest) {
      try {
        if (PREVIEW_IMAGE_EXTS.has(extOf(item.rel)) && item.size <= PREVIEW_IMAGE_MAX_BYTES) {
          const buffer = await fs.readFile(item.path);
          if (await addPreviewImage(printId, buffer)) {
            if (!thumbSeeded) thumbSeeded = await saveThumbFromBytes(firstPlateId!, buffer);
            await fs.rm(item.path, { force: true });
            summary.files += 1;
            continue;
          }
        }
        // saveFileFromTemp moves what it's given, so hand it a copy.
        const filename = path.basename(item.rel);
        const copy = tempPath();
        await fs.copyFile(item.path, copy);
        try {
          await saveFileFromTemp(userId, printId, copy, filename, guessMimeFromPath(filename));
        } finally {
          await fs.rm(copy, { force: true });
        }
        await fs.rm(item.path, { force: true });
        summary.files += 1;
      } catch (err) {
        console.error("Consume folder: couldn't add", item.rel, err);
        await notImported(item);
      }
    }
  };

  if (mode === "folder") {
    const groups = new Map<string, Item[]>();
    for (const item of importable) {
      const key = foldersOf(item.rel).join("/");
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    for (const [key, group] of groups) {
      if (key && group.some((i) => RENDERABLE_MODEL_EXTS.has(extOf(i.rel)))) {
        await importFolder(key.split("/"), group);
      } else {
        for (const item of group) await importEach(item);
      }
    }
  } else {
    for (const item of importable) await importEach(item);
  }

  for (const zip of zips) await fs.rm(zip.abs, { force: true });
  await removeEmptyFolders(dir, files);

  if (summary.models || summary.failed.length) {
    await createNotification(userId, consumeNotification(summary)).catch((err) =>
      console.error("Consume folder: notification failed", err),
    );
  }
  return summary;
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function consumeNotification({ models, files, failed, printIds }: ConsumeSummary) {
  const bodyParts = [`${plural(files, "file")} moved into the library.`];
  if (failed.length) {
    bodyParts.push(
      `${plural(failed.length, "file")} couldn't be imported and ${failed.length === 1 ? "was" : "were"} moved to "${NOT_IMPORTED_DIR}" in the consume folder.`,
    );
  }
  return {
    title: `Imported ${plural(models, "model")} from the consume folder`,
    body: bodyParts.join(" "),
    internalPath: models === 1 ? `/models/${printIds[0]}` : "/models",
  };
}

/** Only folders this batch emptied, so a folder being copied in right now isn't touched. */
async function removeEmptyFolders(root: string, files: FoundFile[]) {
  const dirs = new Set<string>();
  for (const file of files) {
    for (let dir = path.dirname(file.abs); dir.startsWith(root + path.sep); dir = path.dirname(dir)) dirs.add(dir);
  }
  // Deepest first, so a parent is checked after its children are gone.
  for (const dir of [...dirs].toSorted((a, b) => b.length - a.length)) {
    try {
      const left = (await fs.readdir(dir)).filter((name) => !isSystemName(name));
      if (left.length) continue;
      await fs.rm(dir, { recursive: true, force: true });
    } catch {}
  }
}

let timer: NodeJS.Timeout | null = null;

/**
 * Polls rather than watching for events: those don't reliably cross Docker bind mounts or network
 * shares. A batch is taken once two polls in a row see the same files, so a copy still in progress
 * isn't picked up half-written.
 */
export function startConsumeWatcher(dir = CONSUME_DIR): void {
  if (timer) return;
  console.log(
    consumeAvailable(dir) ? `Watching consume folder ${dir}` : `No consume folder at ${dir}; not watching it`,
  );
  let running = false;
  let previous: string | null = null;
  // What a batch left behind (e.g. a file that couldn't even be set aside), so it isn't redone.
  let leftover: string | null = null;
  timer = setInterval(async () => {
    if (running || !consumeAvailable(dir)) return;
    running = true;
    try {
      const current = signature(await walk(dir));
      if (!current || current !== previous || current === leftover) {
        previous = current;
        return;
      }
      await consumeFolder(dir);
      leftover = previous = signature(await walk(dir));
    } catch (err) {
      console.error("Consume folder: scan failed", err);
    } finally {
      running = false;
    }
  }, POLL_MS);
  timer.unref();
}
