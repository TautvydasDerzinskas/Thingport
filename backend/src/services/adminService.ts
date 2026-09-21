import fs from "node:fs/promises";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { deleteAllPrintFiles } from "./printFileService";
import { deleteAllPreviewImages } from "./previewImageService";
import { deletePlateFiles } from "./printCreation";
import { plateThumbPath } from "./printService";
import { loadFullPrint } from "./printLoader";

export type UserWithPrintCount = {
  id: string;
  email: string;
  displayName: string;
  role: "ADMIN" | "MEMBER";
  printCount: number;
  collectionCount: number;
  makerworldConnected: boolean;
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
      createdAt: true,
      makerworldCookie: true,
      _count: { select: { prints: true, collections: true } },
    },
  });
  return users.map((u) => ({
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    role: u.role,
    createdAt: u.createdAt,
    printCount: u._count.prints,
    collectionCount: u._count.collections,
    makerworldConnected: Boolean(u.makerworldCookie),
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

/** Backs GET /admin/logs. `from`/`to` are inclusive date bounds; omitting both returns the most
 * recent entries up to LOG_LIST_LIMIT. */
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

/** Deletes every print (and its on-disk files) belonging to `userId` -- the same per-print
 * cleanup DELETE /print/:id already does, just looped across the whole user's library. Backs
 * the admin "delete all models for a user" trigger. */
export async function deleteAllPrintsForUser(userId: string): Promise<number> {
  const prints = await prisma.print.findMany({ where: { userId }, select: { id: true } });
  for (const { id } of prints) {
    const full = await loadFullPrint(userId, id);
    await deleteAllPrintFiles(id);
    await deleteAllPreviewImages(id);
    await prisma.print.delete({ where: { id } });
    for (const plate of full.plates) {
      await deletePlateFiles(plate);
      await fs.rm(plateThumbPath(plate.id), { force: true }).catch(() => undefined);
    }
  }
  return prints.length;
}

export type StorageUsage = {
  modelBytes: number;
  modelCount: number;
};

/** Instance-wide disk use by models, across every user: every plate plus every supporting and
 *  prepared file -- the same files a model detail page's Size sums for one model (dto.ts's
 *  total_size), so the two always agree. Read from the stored per-file sizes rather than walking
 *  the storage directory, so it stays instant however large the library is. Gallery preview
 *  images and generated caches (thumbnails, 3D previews) aren't model files and aren't counted. */
export async function getStorageUsage(): Promise<StorageUsage> {
  const [plates, files, modelCount] = await Promise.all([
    prisma.plate.aggregate({ _sum: { size: true } }),
    prisma.printFile.aggregate({ _sum: { size: true } }),
    prisma.print.count(),
  ]);
  return { modelBytes: (plates._sum.size ?? 0) + (files._sum.size ?? 0), modelCount };
}
