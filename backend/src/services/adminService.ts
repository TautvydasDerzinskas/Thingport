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
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { MANIFESTS } from "../providers/index.generated";
import { deleteAllPrintFiles } from "./printFileService";
import { deleteAllPreviewImages } from "./previewImageService";
import { deleteAllDescriptionImages } from "./descriptionImageService";
import { deletePlateFiles } from "./printCreation";
import { assetOwnerIds, removeAssetHome, removePlatePictures } from "./printService";
import { loadFullPrint } from "./printLoader";
import { pruneWhatModelsLeft } from "./printEditService";
import { removeUserTagMosaics } from "./tagMosaicService";

export type UserWithPrintCount = {
  id: string;
  email: string;
  displayName: string;
  role: "ADMIN" | "MEMBER";
  isOwner: boolean;
  printCount: number;
  collectionCount: number;
  /** Shown in the admin's users list, from before Configuration → Providers showed every provider's connection. */
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
      providerConnections: {
        where: { provider: MANIFESTS.makerworld.id, slot: "default", secret: { not: Prisma.DbNull } },
        select: { provider: true },
      },
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
    makerworldConnected: u.providerConnections.length > 0,
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

/**
 * Every model the user put there, gone.
 *
 * A model a tool brought isn't one of theirs to lose: it is the tool's part, listed in the tool's own collection,
 * and the tool gives it back the moment it is asked for anyway. What the models leave behind -- an author with
 * nothing else to show, the pictures and bookmarks of tags nothing is tagged with any more -- goes with them.
 */
export async function deleteAllPrintsForUser(userId: string): Promise<number> {
  const prints = await prisma.print.findMany({
    where: { userId, toolId: null },
    select: { id: true, authorId: true, tags: true },
  });
  for (const { id } of prints) {
    const full = await loadFullPrint(userId, id);
    const assetOwners = await assetOwnerIds(id);
    await deleteAllPrintFiles(id);
    await deleteAllPreviewImages(id);
    await deleteAllDescriptionImages(id);
    await prisma.print.delete({ where: { id } });
    for (const plate of full.plates) {
      await deletePlateFiles(plate);
      await removePlatePictures(plate.id, full.print.assetsPath);
    }
    await removeAssetHome(full.print.assetsPath, assetOwners);
  }
  await pruneWhatModelsLeft(userId, prints);
  // Nothing of theirs left at all, not even a tool's: the whole folder of their tag pictures goes, including any
  // for a tag the database has since forgotten.
  if ((await prisma.print.count({ where: { userId } })) === 0) await removeUserTagMosaics(userId);
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
  // Each model's pictures folder, beside its files, and the shared folders older ones may still be in.
  const pictureFolders = prisma.print
    .findMany({ where: { assetsPath: { not: null } }, select: { assetsPath: true } })
    .then((prints) => prints.map((print) => path.join(STORAGE, print.assetsPath!)));
  const value = Promise.all([
    folderBytes(STORAGE),
    pictureFolders.then((folders) =>
      sum([...folders, THUMBS, PREVIEWS, DESCRIPTION_IMAGES, MODEL_PREVIEWS, TAG_MOSAICS]),
    ),
    sum([NORMALIZED_3MFS, BUNDLES]),
  ]).then(([totalBytes, pictureBytes, otherGeneratedBytes]) => ({ totalBytes, pictureBytes, otherGeneratedBytes }));
  diskUsage = { at: Date.now(), value };
  // A failed walk isn't kept, so the next request tries again.
  value.catch(() => {
    if (diskUsage?.value === value) diskUsage = null;
  });
  return value;
}

/**
 * Plates plus supporting and prepared files, from stored sizes (matches dto.ts's total_size).
 *
 * A file read where it lies rather than copied -- every user's model from a tool is the tool's one file -- is
 * counted once, however many models point at it, so this is what the models take rather than what they would take
 * if each had a copy.
 */
export async function getStorageUsage(): Promise<StorageUsage> {
  const [owned, shared, files, modelCount, disk] = await Promise.all([
    prisma.plate.aggregate({ _sum: { size: true }, where: { sourcePath: null } }),
    prisma.$queryRaw<{ bytes: bigint | null }[]>`
      SELECT COALESCE(SUM(size), 0) AS bytes
      FROM (SELECT DISTINCT ON ("sourcePath") size FROM "Plate" WHERE "sourcePath" IS NOT NULL ORDER BY "sourcePath") s
    `,
    prisma.printFile.aggregate({ _sum: { size: true } }),
    prisma.print.count(),
    measureDisk(),
  ]);
  const sharedBytes = Number(shared[0]?.bytes ?? 0);
  return {
    modelBytes: (owned._sum.size ?? 0) + sharedBytes + (files._sum.size ?? 0),
    modelCount,
    ...disk,
  };
}
