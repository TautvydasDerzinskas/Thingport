import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import type { Response } from "express";
import { prisma } from "../db";
import { HttpError } from "../utils/fileUtils";
import { writeZip, type ZipEntryDescriptor } from "../utils/zipWriter";
import { resolvePlateFilePath } from "./printCreation";
import { managedPrintFilePath } from "./printFileService";
import type { Category, Plate, Print, Prisma } from "@prisma/client";

type PrintWithPlatesAndCategory = Print & { plates: Plate[]; category: Category | null };

/** The filters GET /download/zip, POST /download/zip/summary, and their category/tag/collection
 *  callers all resolve the same way -- see resolvePrintsForDownload. At least one of these must
 *  be set; combining more than one ANDs them together (e.g. category_id + tag). */
export type DownloadZipFilter = {
  print_ids?: string[];
  tag?: string;
  category_id?: string;
  collection_id?: string;
};

/** Resolves `filter` (see DownloadZipFilter) to this user's own matching prints, plates included
 *  (needed both to build the zip and to size-estimate it without building one). `tag` is applied
 *  client-side after the DB query, same as GET /tags in prints.ts -- a tag is just a value inside
 *  Print.tags, not a column a `where` can filter on directly. Throws 404 if `collection_id` is
 *  given but doesn't name one of this user's own (real, non-system) collections. */
export async function resolvePrintsForDownload(
  userId: string,
  filter: DownloadZipFilter,
): Promise<PrintWithPlatesAndCategory[]> {
  const where: Prisma.PrintWhereInput = { userId };
  if (filter.print_ids?.length) where.id = { in: filter.print_ids };
  if (filter.category_id) where.categoryId = filter.category_id;
  if (filter.collection_id) {
    const collection = await prisma.collection.findFirst({ where: { id: filter.collection_id, userId } });
    if (!collection) throw new HttpError(404, "Collection not found");
    where.collectionItems = { some: { collectionId: filter.collection_id } };
  }
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

/** Sum of every resolved print's plate + supporting-file sizes, straight from their stored
 *  Plate.size/PrintFile.size columns -- no filesystem access and no zip actually built. This is
 *  necessarily an *upper bound* on the real zip's size (DEFLATE only ever shrinks), not the exact
 *  byte count, but it's cheap enough to compute on every "are you sure?" confirmation (see
 *  POST /download/zip/summary) without pregenerating anything. */
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

/**
 * Builds zip entries for a set of prints: `{category_or_unassigned}/{print.name}/{plate.filename}`
 * for every plate, and `.../supporting/{file.filename}` for each print's supporting files --
 * or, with `flatten: true`, the same without the leading category folder (just
 * `{print.name}/{plate.filename}`). Used for collection/tag downloads, which by nature cut across
 * categories -- nesting under whatever category each model happens to also be in would just be
 * noise there, unlike a plain category download (where every entry shares the same category
 * anyway) or an arbitrary print_ids selection (existing behavior, left unchanged).
 */
export async function buildZipEntries(
  prints: PrintWithPlatesAndCategory[],
  opts: { flatten?: boolean } = {},
): Promise<ZipEntryDescriptor[]> {
  const printIds = prints.map((p) => p.id);
  const supportingByPrint = new Map<string, { filename: string; storagePath: string }[]>();
  if (printIds.length) {
    const supporting = await prisma.printFile.findMany({
      where: { printId: { in: printIds }, role: "SUPPORTING" },
    });
    for (const file of supporting) {
      const list = supportingByPrint.get(file.printId) ?? [];
      list.push({ filename: file.filename, storagePath: file.storagePath });
      supportingByPrint.set(file.printId, list);
    }
  }

  const entries: ZipEntryDescriptor[] = [];
  for (const print of prints) {
    const prefix = opts.flatten ? print.name : `${print.category?.name || "unassigned"}/${print.name}`;
    const sortedPlates = print.plates.toSorted((a, b) => a.position - b.position);
    for (const plate of sortedPlates) {
      const filePath = resolvePlateFilePath(plate);
      if (filePath) entries.push({ arcname: `${prefix}/${plate.filename}`, filePath });
    }
    for (const file of supportingByPrint.get(print.id) ?? []) {
      const filePath = managedPrintFilePath(file);
      if (fs.existsSync(filePath)) {
        entries.push({ arcname: `${prefix}/supporting/${file.filename}`, filePath });
      }
    }
  }
  return entries;
}

/** Builds a zip from `prints` and streams it as the HTTP response, deleting the temp file after.
 *  See buildZipEntries for `flatten`. */
export async function sendPrintsZip(
  res: Response,
  prints: PrintWithPlatesAndCategory[],
  downloadName: string,
  opts: { flatten?: boolean } = {},
): Promise<void> {
  const entries = await buildZipEntries(prints, opts);
  if (!entries.length) throw new HttpError(404, "No files available for download");

  const tmpPath = path.join(os.tmpdir(), `thingport-zip-${crypto.randomBytes(8).toString("hex")}.zip`);
  await writeZip(tmpPath, entries);
  res.download(tmpPath, downloadName, (err) => {
    fs.rm(tmpPath, { force: true }, () => undefined);
    if (err && !res.headersSent) {
      res.status(500).json({ detail: "Failed to send zip file" });
    }
  });
}
