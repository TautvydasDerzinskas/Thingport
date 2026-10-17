import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
  BUNDLES,
  DESCRIPTION_IMAGES,
  MODEL_PREVIEWS,
  NORMALIZED_3MFS,
  PREVIEWS,
  STORAGE,
  TAG_MOSAICS,
  THUMBS,
} from "../config";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { deleteAllPrintFiles } from "./printFileService";
import { deleteAllPreviewImages } from "./previewImageService";
import { deleteAllDescriptionImages } from "./descriptionImageService";
import { deletePlateFiles } from "./printCreation";
import { plateThumbPath } from "./printService";
import { loadFullPrint } from "./printLoader";
import { removeUserTagMosaics } from "./tagMosaicService";

export type UserWithPrintCount = {
  id: string;
  email: string;
  displayName: string;
  role: "ADMIN" | "MEMBER";
  isOwner: boolean;
  printCount: number;
  collectionCount: number;
  makerworldConnected: boolean;
  hasPassword: boolean;
  /** The single sign-on providers they've connected, by name, and whether each is still on. */
  signInProviders: Array<{ name: string; enabled: boolean }>;
  createdAt: Date;
};

export async function listUsersWithPrintCounts(): Promise<UserWithPrintCount[]> {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      email: true,
      displayName: true,
      role: true,
      isOwner: true,
      createdAt: true,
      makerworldCookie: true,
      passwordHash: true,
      identities: {
        select: { provider: { select: { name: true, enabled: true, position: true } } },
      },
      _count: { select: { prints: true, collections: true } },
    },
  });
  return users.map((u) => ({
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    role: u.role,
    isOwner: u.isOwner,
    createdAt: u.createdAt,
    printCount: u._count.prints,
    collectionCount: u._count.collections,
    makerworldConnected: Boolean(u.makerworldCookie),
    hasPassword: Boolean(u.passwordHash),
    signInProviders: u.identities
      .map((identity) => identity.provider)
      .toSorted((a, b) => a.position - b.position)
      .map(({ name, enabled }) => ({ name, enabled })),
  }));
}

export type LogEntry = {
  id: string;
  userId: string;
  userDisplayName: string;
  userEmail: string;
  action: string;
  targetId: string | null;
  details: Record<string, unknown>;
  createdAt: Date;
};

const LOG_LIST_LIMIT = 500;

/** Inclusive date bounds; without them, the latest LOG_LIST_LIMIT entries. */
export async function listLogs(filter: { userId?: string; from?: Date; to?: Date }): Promise<LogEntry[]> {
  const where: Prisma.LogWhereInput = {};
  if (filter.userId) where.userId = filter.userId;
  if (filter.from || filter.to) {
    where.createdAt = {};
    if (filter.from) where.createdAt.gte = filter.from;
    if (filter.to) where.createdAt.lte = filter.to;
  }
  const logs = await prisma.log.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: LOG_LIST_LIMIT,
    include: { user: { select: { displayName: true, email: true } } },
  });
  return logs.map((l) => ({
    id: l.id,
    userId: l.userId,
    userDisplayName: l.user.displayName,
    userEmail: l.user.email,
    action: l.action,
    targetId: l.targetId,
    details: l.details as Record<string, unknown>,
    createdAt: l.createdAt,
  }));
}

export async function deleteAllPrintsForUser(userId: string): Promise<number> {
  const prints = await prisma.print.findMany({ where: { userId }, select: { id: true } });
  for (const { id } of prints) {
    const full = await loadFullPrint(userId, id);
    await deleteAllPrintFiles(id);
    await deleteAllPreviewImages(id);
    await deleteAllDescriptionImages(id);
    await prisma.print.delete({ where: { id } });
    for (const plate of full.plates) {
      await deletePlateFiles(plate);
      await fs.rm(plateThumbPath(plate.id), { force: true }).catch(() => undefined);
    }
  }
  // With no models left the user has no tags, so none of their tag pictures is needed.
  await removeUserTagMosaics(userId);
  return prints.length;
}

export type StorageUsage = {
  modelBytes: number;
  modelCount: number;
  /** All of storage on disk: model files plus everything made from them. */
  totalBytes: number;
  /** Thumbnails, gallery and description images, 3D previews, tag mosaics. */
  pictureBytes: number;
  /** Slicer-ready 3MF copies and download bundles. */
  otherGeneratedBytes: number;
};

/** Bytes under `dir`, following no links; a missing folder counts as empty. */
async function folderBytes(dir: string): Promise<number> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let total = 0;
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await folderBytes(full);
    else if (entry.isFile())
      total += await fs.stat(full).then(
        (stats) => stats.size,
        () => 0,
      );
  }
  return total;
}

type DiskUsage = Pick<StorageUsage, "totalBytes" | "pictureBytes" | "otherGeneratedBytes">;

// Walking a large library takes a while, and the overview asks each time it opens: measured at most every few
// minutes, and one walk shared by requests that overlap it.
const DISK_USAGE_TTL_MS = 5 * 60 * 1000;
let diskUsage: { at: number; value: Promise<DiskUsage> } | null = null;

function measureDisk(): Promise<DiskUsage> {
  if (diskUsage && Date.now() - diskUsage.at < DISK_USAGE_TTL_MS) return diskUsage.value;
  const sum = async (dirs: string[]) => (await Promise.all(dirs.map(folderBytes))).reduce((a, b) => a + b, 0);
  const value = Promise.all([
    folderBytes(STORAGE),
    sum([THUMBS, PREVIEWS, DESCRIPTION_IMAGES, MODEL_PREVIEWS, TAG_MOSAICS]),
    sum([NORMALIZED_3MFS, BUNDLES]),
  ]).then(([totalBytes, pictureBytes, otherGeneratedBytes]) => ({ totalBytes, pictureBytes, otherGeneratedBytes }));
  diskUsage = { at: Date.now(), value };
  // A failed walk isn't kept, so the next request tries again.
  value.catch(() => {
    if (diskUsage?.value === value) diskUsage = null;
  });
  return value;
}

/** Plates plus supporting and prepared files, from stored sizes (matches dto.ts's total_size). */
export async function getStorageUsage(): Promise<StorageUsage> {
  const [plates, files, modelCount, disk] = await Promise.all([
    prisma.plate.aggregate({ _sum: { size: true } }),
    prisma.printFile.aggregate({ _sum: { size: true } }),
    prisma.print.count(),
    measureDisk(),
  ]);
  return { modelBytes: (plates._sum.size ?? 0) + (files._sum.size ?? 0), modelCount, ...disk };
}
