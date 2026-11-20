import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import type { Response } from "express";
import { prisma } from "../db";
import { HttpError } from "../utils/fileUtils";
import { folderPath, isInFolder } from "../utils/fileFolder";
import { writeZip, type ZipEntryDescriptor } from "../utils/zipWriter";
import { resolvePlateFilePath } from "./printCreation";
import { managedPrintFilePath } from "./printFileService";
import { LICENSE_FILENAME, licenseFileText } from "./licenseFile";
import { readableCollection, readablePrintWhere } from "./socialService";
import type { Category, Plate, Print, Prisma } from "@prisma/client";

type PrintWithPlatesAndCategory = Print & { plates: Plate[]; category: Category | null };

/** At least one must be set; multiple are ANDed. */
export type DownloadZipFilter = {
  print_ids?: string[];
  tag?: string;
  category_id?: string;
  collection_id?: string;
};

/** `tag` is applied in JS since tags aren't a filterable column. Throws 404 for a collection that
 *  isn't the user's, or another user's public one (services/socialService.ts). Models picked by id may be shared ones
 *  too; a category and a tag are the user's own library's. */
export async function resolvePrintsForDownload(
  userId: string,
  filter: DownloadZipFilter,
): Promise<PrintWithPlatesAndCategory[]> {
  let owner = userId;
  const where: Prisma.PrintWhereInput = {};
  if (filter.collection_id) {
    const collection = await readableCollection(userId, filter.collection_id);
    if (!collection) throw new HttpError(404, "Collection not found");
    owner = collection.userId;
    where.collectionItems = { some: { collectionId: filter.collection_id } };
  }
  const byIdOnly = Boolean(filter.print_ids?.length) && !filter.category_id && !filter.collection_id;
  where.AND = [byIdOnly ? await readablePrintWhere(userId) : { userId: owner }];
  if (filter.print_ids?.length) where.id = { in: filter.print_ids };
  if (filter.category_id) where.categoryId = filter.category_id;
  let prints = await prisma.print.findMany({
    where,
    include: { plates: { orderBy: { position: "asc" } }, category: true },
  });
  if (filter.tag) {
    const tag = filter.tag.trim();
    prints = prints.filter((p) => p.tags.includes(tag));
  }
  return prints;
}

/** An upper bound from stored sizes, without touching the filesystem. */
export async function estimateDownloadSize(prints: PrintWithPlatesAndCategory[]): Promise<number> {
  const plateBytes = prints.reduce((sum, p) => sum + p.plates.reduce((s, plate) => s + plate.size, 0), 0);
  const printIds = prints.map((p) => p.id);
  if (!printIds.length) return plateBytes;
  const supporting = await prisma.printFile.aggregate({
    where: { printId: { in: printIds }, role: "SUPPORTING", ready: true },
    _sum: { size: true },
  });
  return plateBytes + (supporting._sum.size ?? 0);
}

/** The folder each model's files go in: its name, or, where another model has that folder (a "Base" in each of two
 *  categories, with the categories left out), its name with a number no other model's folder has. A category's or a
 *  model's name is one folder however it's written: a slash in it ("A/B", or "A\B", which the zip stores alike)
 *  doesn't make it two, and one named "." or ".." is "_" or "__", as unzipped those name the folder it's in or the one
 *  above, and Thingport's own import drops a file under one. */
function modelFolders(prints: PrintWithPlatesAndCategory[], flatten: boolean): Map<PrintWithPlatesAndCategory, string> {
  const segment = (name: string) => {
    const one = name.replace(/[\\/]/g, "_");
    return /^\s*\.{1,2}\s*$/.test(one) ? one.replace(/\./g, "_") : one;
  };
  const own = (print: PrintWithPlatesAndCategory) =>
    flatten ? segment(print.name) : `${segment(print.category?.name || "unassigned")}/${segment(print.name)}`;
  const folders = new Map<PrintWithPlatesAndCategory, string>();
  const taken = new Set<string>();
  for (const print of prints) {
    const folder = own(print);
    if (taken.has(folder.toLowerCase())) continue;
    taken.add(folder.toLowerCase());
    folders.set(print, folder);
  }
  for (const print of prints) {
    if (folders.has(print)) continue;
    let folder = own(print);
    for (let n = 2; taken.has(folder.toLowerCase()); n++) folder = `${own(print)} (${n})`;
    taken.add(folder.toLowerCase());
    folders.set(print, folder);
  }
  return folders;
}

type ZipOptions = {
  /** Drops the category folder, for downloads that span categories. */
  flatten?: boolean;
  /** Only the files in this folder and the folders in it (Plate.folder); the rest are left out. */
  folder?: string | null;
};

/**
 * `{category-or-folder}/{print.name}/{plate.folder}/{plate.filename}`, with supporting files under `.../supporting/`
 * (in their folders too) and the model's LICENSE.txt beside its plates.
 */
export async function buildZipEntries(
  prints: PrintWithPlatesAndCategory[],
  opts: ZipOptions = {},
): Promise<ZipEntryDescriptor[]> {
  const printIds = prints.map((p) => p.id);
  const supportingByPrint = new Map<string, { filename: string; folder: string | null; storagePath: string }[]>();
  if (printIds.length) {
    // Only files whose saves are done: one on its way in isn't whole yet.
    const supporting = await prisma.printFile.findMany({
      where: { printId: { in: printIds }, role: "SUPPORTING", ready: true },
    });
    for (const file of supporting) {
      if (!isInFolder(file.folder, opts.folder)) continue;
      const list = supportingByPrint.get(file.printId) ?? [];
      list.push({ filename: file.filename, folder: file.folder, storagePath: file.storagePath });
      supportingByPrint.set(file.printId, list);
    }
  }

  // LICENSE.txt names the creator as the model page does, its author first.
  const authorIds = [...new Set(prints.flatMap((print) => (print.authorId ? [print.authorId] : [])))];
  const authors = new Map(
    authorIds.length
      ? (
          await prisma.author.findMany({
            where: { id: { in: authorIds } },
            select: { id: true, name: true, handle: true },
          })
        ).map((author) => [author.id, author])
      : [],
  );

  const folders = modelFolders(prints, Boolean(opts.flatten));
  const entries: ZipEntryDescriptor[] = [];
  for (const print of prints) {
    const prefix = folders.get(print)!;
    // Every name the model takes in the zip: a supporting file steps around these.
    const taken = new ZipNames();
    // Made now rather than read from disk: it's then there whether or not LICENSE.txt files are written beside them.
    // Its place is held first, as it's the model's own: a plate of that name (a model of text files is all plates) is
    // the one numbered.
    const license = licenseFileText({ ...print, author: print.authorId ? authors.get(print.authorId) : null });
    const licensePath = `${prefix}/${LICENSE_FILENAME}`;
    if (license) taken.take(licensePath);
    const plates = print.plates
      .filter((plate) => isInFolder(plate.folder, opts.folder))
      .toSorted((a, b) => a.position - b.position)
      .flatMap((plate) => {
        const filePath = resolvePlateFilePath(plate);
        return filePath ? [{ plate, filePath, arcname: `${prefix}/${folderPath(plate.folder, plate.filename)}` }] : [];
      });
    // Each plate keeps its own path where it's the first to have it ("Parts/lid.stl" beside "parts/lid.stl"), and the
    // rest are numbered once every one is held, so none is numbered onto another's own ("lid (2).stl").
    const clashing = new Set<(typeof plates)[number]>();
    for (const each of plates) {
      if (taken.free(each.arcname)) taken.take(each.arcname);
      else clashing.add(each);
    }
    for (const each of plates) {
      const arcname = clashing.has(each)
        ? freeArcname(prefix, each.plate.folder, each.plate.filename, taken)
        : each.arcname;
      taken.take(arcname);
      entries.push({ arcname, filePath: each.filePath });
    }
    if (license) {
      entries.push({
        arcname: licensePath,
        content: Buffer.from(license, "utf8"),
        mtime: print.licenseReadAt ?? undefined,
      });
    }
    // A model file in a folder named "supporting" can hold a supporting file's name, or be called as a supporting
    // file's folder is, and two supporting files may share one (a merge brings each model's along).
    for (const file of supportingByPrint.get(print.id) ?? []) {
      const filePath = managedPrintFilePath(file);
      if (!fs.existsSync(filePath)) continue;
      const folder = file.folder ? `supporting/${file.folder}` : "supporting";
      const arcname = freeArcname(prefix, folder, file.filename, taken);
      taken.take(arcname);
      entries.push({ arcname, filePath });
    }
  }
  return entries;
}

/** The paths a model takes in a zip, as files and as the folders above them, lower-cased: unzipped, a path can't be
 *  both, nor two that differ only in case (one on Windows or a Mac). */
class ZipNames {
  private readonly files = new Set<string>();
  private readonly folders = new Set<string>();

  private static above(lower: string): string[] {
    const out: string[] = [];
    for (let at = lower.indexOf("/"); at > 0; at = lower.indexOf("/", at + 1)) out.push(lower.slice(0, at));
    return out;
  }

  isFile(arcname: string): boolean {
    return this.files.has(arcname.toLowerCase());
  }

  /** No file or folder has the path, and no file is called as a folder above it is. */
  free(arcname: string): boolean {
    const lower = arcname.toLowerCase();
    return !this.files.has(lower) && !this.folders.has(lower) && !ZipNames.above(lower).some((f) => this.files.has(f));
  }

  take(arcname: string): void {
    const lower = arcname.toLowerCase();
    this.files.add(lower);
    for (const folder of ZipNames.above(lower)) this.folders.add(folder);
  }
}

/** `base/folder/filename`, or the file numbered "name (2).ext" and on where the zip has that path already, and a
 *  folder on the way numbered where a file is called as it is ("lid.stl (2)/notes.txt"). A sliced print keeps all of
 *  ".gcode.3mf" after the number, as that's what says it's one. */
function freeArcname(base: string, folder: string | null, filename: string, taken: ZipNames): string {
  const sliced = filename.toLowerCase().endsWith(".gcode.3mf") ? filename.length - ".gcode.3mf".length : -1;
  const dot = sliced > 0 ? sliced : filename.lastIndexOf(".");
  const [stem, ext] = dot > 0 ? [filename.slice(0, dot), filename.slice(dot)] : [filename, ""];
  let dir = base;
  for (const segment of folder ? folder.split("/") : []) {
    let next = `${dir}/${segment}`;
    for (let n = 2; taken.isFile(next); n++) next = `${dir}/${segment} (${n})`;
    dir = next;
  }
  let arcname = `${dir}/${filename}`;
  for (let n = 2; !taken.free(arcname); n++) arcname = `${dir}/${stem} (${n})${ext}`;
  return arcname;
}

export async function sendPrintsZip(
  res: Response,
  prints: PrintWithPlatesAndCategory[],
  downloadName: string,
  opts: ZipOptions = {},
): Promise<void> {
  const entries = await buildZipEntries(prints, opts);
  if (!entries.some((entry) => "filePath" in entry)) throw new HttpError(404, "No files available for download");

  const tmpPath = path.join(os.tmpdir(), `thingport-zip-${crypto.randomBytes(8).toString("hex")}.zip`);
  await writeZip(tmpPath, entries);
  res.download(tmpPath, downloadName, (err) => {
    fs.rm(tmpPath, { force: true }, () => undefined);
    if (err && !res.headersSent) {
      res.status(500).json({ detail: "Failed to send zip file" });
    }
  });
}
