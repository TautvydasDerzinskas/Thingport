import fs from "node:fs/promises";
import { kindUnder } from "./categoryService";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { prisma } from "../db";
import { HttpError, sanitizeFilename, guessMimeFromPath } from "../utils/fileUtils";
import { IMPORT_MAX_BYTES } from "../config";
import { listZipEntries as listRawZipEntries, readZipEntry } from "../utils/zipReader";
import { validateParentCategory } from "./categoryService";
import { attachImportedPreviewImages } from "./importService";
import { localizeDescriptionImages } from "./descriptionImageService";
import { createPrint, type PrintMetaInput } from "./printCreation";
import type { Print, Plate, PreviewImage } from "@prisma/client";

export type ZipEntrySummary = { path: string; size: number };

/** Normalizes a raw zip entry name: backslashes -> slashes, strips leading slash, rejects
 * empty/directory/".."-containing paths. Returns null if the entry should be ignored. */
export function normalizeZipEntryPath(name: string): string | null {
  let cleaned = (name || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!cleaned || cleaned.endsWith("/")) return null;
  const parts = cleaned.split("/").filter((p) => p.length > 0);
  if (!parts.length || parts.some((p) => p === "..")) return null;
  const filtered = parts.filter((p) => p !== ".");
  if (!filtered.length) return null;
  return filtered.join("/");
}

function sanitizeCategoryName(name: string): string {
  const cleaned = (name || "").replace(/\0/g, "").trim().replace(/\//g, "_").replace(/\\/g, "_");
  return cleaned || "category";
}

/** Lists every real (non-directory) entry in a zip archive, path-normalized and sorted. */
export async function listZipEntries(zipPath: string): Promise<ZipEntrySummary[]> {
  const raw = await listRawZipEntries(zipPath);
  const entries: ZipEntrySummary[] = [];
  for (const entry of raw) {
    if (entry.isDirectory) continue;
    const name = normalizeZipEntryPath(entry.name);
    if (!name) continue;
    entries.push({ path: name, size: entry.size });
  }
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return entries;
}

type CategoryCache = Map<string, string>;

async function getOrCreateCategory(
  userId: string,
  parentId: string | null,
  parentKey: string,
  name: string,
  cache: CategoryCache,
): Promise<string> {
  const key = `${parentKey}/${name}`;
  const cached = cache.get(key);
  if (cached) return cached;
  // At the top level only a folder is reused: a zip's folders shouldn't merge into a starter category.
  const kind = await kindUnder(userId, parentId, "folder");
  const existing = await prisma.category.findFirst({ where: { userId, parentId, name, kind } });
  if (existing) {
    cache.set(key, existing.id);
    return existing.id;
  }
  const category = await prisma.category.create({ data: { userId, name, parentId, kind, tags: [] } });
  cache.set(key, category.id);
  return category.id;
}

/** Recreates the zip's directory structure as nested Categories, returning the leaf category id
 * for one entry's path. */
export async function resolveZipCategoryId(
  userId: string,
  baseCategoryId: string | null,
  entryPath: string,
  cache: CategoryCache,
): Promise<string | null> {
  const segments = entryPath.split("/").slice(0, -1).filter(Boolean);
  if (!segments.length) return baseCategoryId;
  let targetId = baseCategoryId;
  let parentKey = baseCategoryId || "root";
  for (const segment of segments) {
    const safe = sanitizeCategoryName(segment);
    if (!safe) continue;
    targetId = await getOrCreateCategory(userId, targetId, parentKey, safe, cache);
    parentKey = `${parentKey}/${safe}`;
  }
  return targetId;
}

export type ZipExtractOptions = {
  title?: string | null;
  notes?: string | null;
  tags?: string[];
  categoryId?: string | null;
  creator?: string | null;
  authorId?: string | null;
  previewImageUrl?: string | null;
  galleryImages?: { url: string; filename: string }[];
};

/**
 * Extracts selected zip entries into individual single-plate Prints (one per entry). Each
 * entry lands in a Category tree recreated from its path within the zip (nested under
 * options.categoryId, if any). Returns the created prints plus the list of entry names that
 * failed to extract (missing, a directory, or over the size cap).
 */
export async function extractZipEntriesToPrints(
  userId: string,
  zipPath: string,
  selections: string[],
  options: ZipExtractOptions,
  onProgress?: (processed: number, total: number, imported: number, failed: number) => void,
): Promise<{ prints: (Print & { plates: Plate[]; previewImages: PreviewImage[] })[]; failed: string[] }> {
  const normalized = selections.map((s) => normalizeZipEntryPath(s));
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const name of normalized) {
    if (!name || seen.has(name)) continue;
    seen.add(name);
    ordered.push(name);
  }
  if (!ordered.length) throw new HttpError(400, "No zip entries selected");

  if (options.categoryId) {
    await validateParentCategory(userId, options.categoryId);
  }

  const raw = await listRawZipEntries(zipPath);
  const entryMap = new Map<string, { isDirectory: boolean; size: number }>();
  for (const entry of raw) {
    const name = normalizeZipEntryPath(entry.name);
    if (!name) continue;
    entryMap.set(name, { isDirectory: entry.isDirectory, size: entry.size });
  }

  const prints: (Print & { plates: Plate[]; previewImages: PreviewImage[] })[] = [];
  const failed: string[] = [];
  const categoryCache: CategoryCache = new Map();
  let processedCount = 0;

  for (const entryName of ordered) {
    const info = entryMap.get(entryName);
    if (!info || info.isDirectory) {
      failed.push(entryName);
      continue;
    }
    let tempPath: string | null = null;
    try {
      const targetCategoryId = await resolveZipCategoryId(userId, options.categoryId ?? null, entryName, categoryCache);
      const filename = sanitizeFilename(path.basename(entryName));
      const buffer = await readZipEntry(zipPath, entryName, IMPORT_MAX_BYTES);
      if (!buffer) throw new Error("Extracted file exceeds size limit or could not be read");

      tempPath = path.join(os.tmpdir(), `thingport-zip-${crypto.randomBytes(8).toString("hex")}`);
      await fs.writeFile(tempPath, buffer);

      // A resolved page title (e.g. MakerWorld's design name) is the same for every entry in
      // the zip, so when more than one entry is being extracted into its own Print, keep them
      // distinguishable by tagging the entry's own filename onto it instead of overwriting it
      // outright the way a single-entry extraction does.
      const resolvedTitle =
        options.title && ordered.length > 1 ? `${options.title} (${path.parse(filename).name})` : options.title;
      const meta: PrintMetaInput = {
        title: resolvedTitle ?? null,
        notes: options.notes ?? null,
        tags: options.tags ?? [],
        categoryId: targetCategoryId,
        categorySource: targetCategoryId ? "MANUAL" : null,
        creator: options.creator ?? null,
        authorId: options.authorId ?? null,
      };
      const mime = guessMimeFromPath(filename);
      const { print, plates } = await createPrint(userId, meta, path.parse(filename).name, [
        { filename, mime, tempFilePath: tempPath },
      ]);
      tempPath = null;
      await attachImportedPreviewImages(print.id, plates[0]?.id, options.previewImageUrl, options.galleryImages ?? []);
      await localizeDescriptionImages(print.id);
      const previewImages = await prisma.previewImage.findMany({
        where: { printId: print.id },
        orderBy: { position: "asc" },
      });
      prints.push({ ...print, plates, previewImages });
    } catch {
      if (tempPath) await fs.rm(tempPath, { force: true }).catch(() => undefined);
      failed.push(entryName);
    }
    onProgress?.(++processedCount, ordered.length, prints.length, failed.length);
  }

  return { prints, failed };
}
