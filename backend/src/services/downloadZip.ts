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
    where: { printId: { in: printIds }, role: "SUPPORTING" },
    _sum: { size: true },
  });
  return plateBytes + (supporting._sum.size ?? 0);
}

/** The folder each model's files go in: its name, or, where another model has that folder (a "Base" in each of two
 *  categories, with the categories left out), its name with a number no other model's folder has. */
function modelFolders(prints: PrintWithPlatesAndCategory[], flatten: boolean): Map<PrintWithPlatesAndCategory, string> {
  const own = (print: PrintWithPlatesAndCategory) =>
    flatten ? print.name : `${print.category?.name || "unassigned"}/${print.name}`;
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
    const supporting = await prisma.printFile.findMany({
      where: { printId: { in: printIds }, role: "SUPPORTING" },
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
    // Every name the model takes in the zip, which can't hold one twice: a supporting file steps around these.
    const taken = new Set<string>();
    const sortedPlates = print.plates
      .filter((plate) => isInFolder(plate.folder, opts.folder))
      .toSorted((a, b) => a.position - b.position);
    for (const plate of sortedPlates) {
      const filePath = resolvePlateFilePath(plate);
      if (!filePath) continue;
      const arcname = `${prefix}/${folderPath(plate.folder, plate.filename)}`;
      taken.add(arcname.toLowerCase());
      entries.push({ arcname, filePath });
    }
    // Made now rather than read from disk: it's then there whether or not LICENSE.txt files are written beside them.
    const license = licenseFileText({ ...print, author: print.authorId ? authors.get(print.authorId) : null });
    if (license) {
      const arcname = `${prefix}/${LICENSE_FILENAME}`;
      taken.add(arcname.toLowerCase());
      entries.push({ arcname, content: Buffer.from(license, "utf8"), mtime: print.licenseReadAt ?? undefined });
    }
    // A model file in a folder named "supporting" can hold a supporting file's name, and two supporting files may share
    // one (a merge brings each model's along).
    for (const file of supportingByPrint.get(print.id) ?? []) {
      const filePath = managedPrintFilePath(file);
      if (!fs.existsSync(filePath)) continue;
      const { name, ext } = path.parse(file.filename);
      let arcname = `${prefix}/supporting/${folderPath(file.folder, file.filename)}`;
      for (let n = 2; taken.has(arcname.toLowerCase()); n++) {
        arcname = `${prefix}/supporting/${folderPath(file.folder, `${name} (${n})${ext}`)}`;
      }
      taken.add(arcname.toLowerCase());
      entries.push({ arcname, filePath });
    }
  }
  return entries;
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
