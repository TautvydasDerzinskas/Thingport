import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import type { Response } from "express";
import { prisma } from "../db";
import { HttpError } from "../utils/fileUtils";
import { folderLevels, isInFolder } from "../utils/fileFolder";
import { ZipPaths } from "../files/zipPaths";
import { fileState } from "../modelFiles/storageFs";
import { plateStillNames, printFileStillNames } from "../modelFiles/stillNames";
import { writeZip, zipFits, type ZipEntryDescriptor } from "../utils/zipWriter";
import { resolvePlateFilePath } from "./printCreation";
import { managedPrintFilePath } from "./printFileService";
import { LICENSE_FILENAME, licenseFileText } from "./licenseFile";
import { readableCollection, readablePrintWhere } from "./socialService";
import type { Category, Plate, Print, PrintFile, Prisma } from "@prisma/client";

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
  const files = await prisma.printFile.aggregate({
    where: { printId: { in: printIds }, role: { in: ["SUPPORTING", "PREPARED"] } },
    _sum: { size: true },
  });
  return plateBytes + (files._sum.size ?? 0);
}

type ZipOptions = {
  /** Drops the category folder, for downloads that span categories. */
  flatten?: boolean;
  /** Only the files in this folder and the folders in it (Plate.folder); the rest are left out. */
  folder?: string | null;
};

/**
 * `{category-or-folder}/{print.name}/{plate.folder}/{plate.filename}`, with supporting files under `.../supporting/`
 * (in their folders too), the prepared print under `.../prepared/` and the model's LICENSE.txt beside its plates. Every
 * path is placed by ZipPaths, so two models named alike get two folders and no two files share a path, ignoring case.
 */
export async function buildZipEntries(
  prints: PrintWithPlatesAndCategory[],
  opts: ZipOptions = {},
): Promise<ZipEntryDescriptor[]> {
  const printIds = prints.map((p) => p.id);
  const supportingByPrint = new Map<string, PrintFile[]>();
  const preparedByPrint = new Map<string, PrintFile>();
  if (printIds.length) {
    const files = await prisma.printFile.findMany({
      where: { printId: { in: printIds }, role: { in: ["SUPPORTING", "PREPARED"] } },
      orderBy: [{ folder: "asc" }, { filename: "asc" }],
    });
    const preparedIds = new Set(prints.flatMap((print) => (print.preparedFileId ? [print.preparedFileId] : [])));
    for (const file of files) {
      const isPrepared = preparedIds.has(file.id);
      if (!isInFolder(file.folder, opts.folder) || (!isPrepared && file.role !== "SUPPORTING")) continue;
      // Fs 1: only a file that's gone, or a folder in its place, is left out; one that can't be looked at fails the zip.
      if ((await fileState(managedPrintFilePath(file), "zip.entry")).state !== "file") continue;
      if (isPrepared) preparedByPrint.set(file.printId, file);
      else {
        const list = supportingByPrint.get(file.printId) ?? [];
        list.push(file);
        supportingByPrint.set(file.printId, list);
      }
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

  const zip = new ZipPaths();
  const entries: ZipEntryDescriptor[] = [];
  for (const print of prints) {
    const owner = `model:${print.id}`;
    const top = opts.flatten ? "" : zip.folder("", print.category?.name || "unassigned", "categories");
    const home = zip.folder(top, print.name, owner);
    const supporting = supportingByPrint.get(print.id) ?? [];
    const prepared = preparedByPrint.get(print.id);
    // Made now rather than read from disk: it's then there whether or not LICENSE.txt files are written beside them.
    const license = licenseFileText({ ...print, author: print.authorId ? authors.get(print.authorId) : null });
    // Thingport's own places are claimed first, so a plate named like one of them is numbered rather than taking it;
    // the entries still go in the order a person reads them, plates first.
    const licensePath = license ? zip.file(home, LICENSE_FILENAME) : null;
    const supportingHome = supporting.length ? zip.folder(home, "supporting", `supporting:${print.id}`) : null;
    const preparedHome = prepared ? zip.folder(home, "prepared", `prepared:${print.id}`) : null;
    const sortedPlates = print.plates
      .filter((plate) => isInFolder(plate.folder, opts.folder))
      .toSorted((a, b) => a.position - b.position);
    // Each file from storage is written from the handle it's opened with, while its row still names it (Fs 2).
    for (const plate of sortedPlates) {
      const filePath = resolvePlateFilePath(plate);
      if (filePath) {
        entries.push({
          arcname: zip.file(zip.nested(home, folderLevels(plate.folder), owner), plate.filename),
          filePath,
          site: "zip.entry",
          stillNames: plateStillNames(plate),
        });
      }
    }
    if (license && licensePath) {
      entries.push({
        arcname: licensePath,
        content: Buffer.from(license, "utf8"),
        mtime: print.licenseReadAt ?? undefined,
      });
    }
    if (supportingHome) {
      for (const file of supporting) {
        const folder = zip.nested(supportingHome, folderLevels(file.folder), `supporting:${print.id}`);
        entries.push({
          arcname: zip.file(folder, file.filename),
          filePath: managedPrintFilePath(file),
          site: "zip.entry",
          stillNames: printFileStillNames(file),
        });
      }
    }
    if (prepared && preparedHome) {
      entries.push({
        arcname: zip.file(preparedHome, prepared.filename),
        filePath: managedPrintFilePath(prepared),
        site: "zip.entry",
        stillNames: printFileStillNames(prepared, { prepared: true }),
      });
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
  // Refused before any of it is written: past this, the zip would come out broken.
  if (!zipFits(entries)) {
    throw new HttpError(
      413,
      "That's too much for one zip: at most 65,534 files and about 4 GB. Download fewer models, or files one by one.",
      "zip_too_large",
    );
  }

  const tmpPath = path.join(os.tmpdir(), `thingport-zip-${crypto.randomBytes(8).toString("hex")}.zip`);
  await writeZip(tmpPath, entries);
  res.download(tmpPath, downloadName, (err) => {
    fs.rm(tmpPath, { force: true }, () => undefined);
    if (err && !res.headersSent) {
      res.status(500).json({ detail: "Failed to send zip file" });
    }
  });
}
