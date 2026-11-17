import path from "node:path";
import { IMPORT_ALLOWED_EXTS, IMPORT_MAX_BYTES, PARAMETRIC_SOURCE_EXTS } from "../config";
import { sharedTopFolder, withoutTopLevels, withoutTopOf } from "../utils/fileFolder";
import { getImportSupportingFiles } from "./settingsService";

// The files a site gives beside a model's own -- instructions, notes, a parts list, sources -- which an import keeps as
// its supporting files, within the admin's limits (Administration → Storage).

// Not kept: pictures, which the model's gallery has from its page; scenes only the CG suite that made them opens;
// programs, which nobody should run from a model's files.
const SKIPPED_EXTS = new Set([
  ".jpg",
  ".jpeg",
  ".jfif",
  ".png",
  ".gif",
  ".webp",
  ".bmp",
  ".tif",
  ".tiff",
  ".heic",
  ".heif",
  ".avif",
  ".max",
  ".c4d",
  ".ma",
  ".mb",
  ".fbx",
  ".3ds",
  ".dae",
  ".lwo",
  ".lxo",
  ".abc",
  ".usd",
  ".usda",
  ".usdc",
  ".usdz",
  ".exe",
  ".msi",
  ".dll",
  ".bat",
  ".cmd",
  ".com",
  ".scr",
  ".ps1",
  ".vbs",
  ".jar",
  ".apk",
  ".app",
  ".dmg",
  ".pkg",
  ".deb",
  ".rpm",
  ".sh",
]);
// What an OS leaves in a folder it shows, never meant as content.
const JUNK_NAMES = new Set(["thumbs.db", "desktop.ini", ".ds_store"]);

/** A file a site gives with a model that's kept beside it as a supporting file. Not one a plate takes, nor the script
 *  the model is generated from (kept as one already), nor a zip (opened instead), nor what SKIPPED_EXTS names. */
export function isSupportingImportFile(name: string): boolean {
  const base = path.posix.basename(name.replace(/\\/g, "/"));
  if (!base || base.startsWith("._") || JUNK_NAMES.has(base.toLowerCase())) return false;
  const ext = path.extname(base).toLowerCase();
  if (IMPORT_ALLOWED_EXTS.has(ext) || PARAMETRIC_SOURCE_EXTS.has(ext)) return false;
  return !SKIPPED_EXTS.has(ext);
}

/** A model may keep this many times the largest supporting file in all. */
const PER_MODEL_FACTOR = 2.5;

export type SupportingLimits = { perFile: number; perModel: number };

/** How large a supporting file an import keeps, and how much of them one model takes in all; null when an admin keeps
 *  none. Never past what an import downloads at all. */
export async function supportingLimits(): Promise<SupportingLimits | null> {
  const limit = await getImportSupportingFiles();
  if (limit === "off") return null;
  if (limit === "any") return { perFile: IMPORT_MAX_BYTES, perModel: Number.POSITIVE_INFINITY };
  const perFile = Math.min(limit * 1024 * 1024, IMPORT_MAX_BYTES);
  return { perFile, perModel: perFile * PER_MODEL_FACTOR };
}

/** The name a site's file is kept under. A licence file of the site's own at the top keeps its text beside the
 *  LICENSE.txt Thingport writes (services/licenseFile.ts), rather than taking that name and pushing it aside. */
export function supportingImportName(filename: string, folder: string | null | undefined): string {
  return !folder && filename.toLowerCase() === "license.txt" ? "LICENSE (original).txt" : filename;
}

/** withoutSharedTop for a model's files with its supporting files among them: the levels come off where every one of
 *  its own files shares them, and a supporting file loses as much of those as its folder starts with. So a model's own
 *  files land where they would without them, and the documents beside them keep their folder ("docs"). */
export function withoutModelsSharedTop<T extends { folder?: string | null; supporting?: boolean }>(files: T[]): T[] {
  const top = sharedTopFolder(files.filter((file) => !file.supporting).map((file) => file.folder));
  if (!top.length) return files;
  return files.map((file) => ({
    ...file,
    folder: file.supporting ? withoutTopOf(file.folder, top) : withoutTopLevels(file.folder, top.length),
  }));
}
