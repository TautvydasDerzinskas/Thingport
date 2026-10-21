import { createHash } from "node:crypto";
import { prisma } from "../db";
import { RENDERABLE_MODEL_EXTS } from "../config";
import { plateThumbUrl, renderUrl } from "../dto";

const TOP_MODELS_PREVIEW = 3;
const TOP_MODELS_LIST_MAX = 50;
const TOP_AUTHORS_PREVIEW = 5;
const TOP_AUTHORS_LIST_MAX = 50;
const RECENTLY_ADDED_LIMIT = 3;

export type DashboardModel = {
  id: string;
  name: string;
  thumbUrl: string | null;
  /** The first plate's render for the browser to tint. Unversioned until it exists: asking for it queues it. */
  renderUrl: string | null;
  viewCount: number;
  printCount: number;
  createdAt: Date;
};

export type DashboardAuthor = {
  id: string;
  name: string | null;
  handle: string | null;
  avatarUrl: string | null;
  modelCount: number;
};

export type DashboardProvider = {
  provider: string;
  modelCount: number;
};

export type DashboardSummary = {
  collectionCount: number;
  modelCount: number;
  authorCount: number;
  categoryCount: number;
  topViewed: DashboardModel[];
  topPrinted: DashboardModel[];
  topAuthors: DashboardAuthor[];
  topProviders: DashboardProvider[];
  recentlyAdded: DashboardModel[];
};

type PrintForModelSummary = {
  id: string;
  name: string;
  viewCount: number;
  printCount: number;
  createdAt: Date;
  assetsPath: string | null;
  plates: { id: string; filename: string }[];
};

export function toModelSummary(print: PrintForModelSummary): DashboardModel {
  const first = print.plates[0];
  const plateId = first?.id ?? null;
  return {
    id: print.id,
    name: print.name,
    thumbUrl: plateId ? plateThumbUrl(plateId, print.assetsPath) : null,
    renderUrl: first ? renderUrl(first, print.assetsPath) : null,
    viewCount: print.viewCount,
    printCount: print.printCount,
    createdAt: print.createdAt,
  };
}

export const MODEL_SUMMARY_SELECT = {
  id: true,
  name: true,
  viewCount: true,
  printCount: true,
  createdAt: true,
  assetsPath: true,
  plates: { take: 1, orderBy: { position: "asc" as const }, select: { id: true, filename: true } },
};

async function fetchTopViewed(userId: string, limit: number): Promise<DashboardModel[]> {
  const prints = await prisma.print.findMany({
    where: { userId, viewCount: { gt: 0 } },
    orderBy: { viewCount: "desc" },
    take: limit,
    select: MODEL_SUMMARY_SELECT,
  });
  return prints.map(toModelSummary);
}

async function fetchTopPrinted(userId: string, limit: number): Promise<DashboardModel[]> {
  const prints = await prisma.print.findMany({
    where: { userId, printCount: { gt: 0 } },
    orderBy: { printCount: "desc" },
    take: limit,
    select: MODEL_SUMMARY_SELECT,
  });
  return prints.map(toModelSummary);
}

async function fetchRecentlyAdded(userId: string, limit: number): Promise<DashboardModel[]> {
  const prints = await prisma.print.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: MODEL_SUMMARY_SELECT,
  });
  return prints.map(toModelSummary);
}

// Sorted in JS: groupBy can't reliably order by an aggregate here.
async function fetchTopAuthors(userId: string, limit: number): Promise<DashboardAuthor[]> {
  const grouped = await prisma.print.groupBy({
    by: ["authorId"],
    where: { userId, authorId: { not: null } },
    _count: true,
  });
  const top = grouped.toSorted((a, b) => b._count - a._count).slice(0, limit);
  if (!top.length) return [];
  const authorIds = top.map((g) => g.authorId as string);
  const authors = await prisma.author.findMany({ where: { id: { in: authorIds } } });
  const byId = new Map(authors.map((a) => [a.id, a]));
  return top
    .map((g) => {
      const author = byId.get(g.authorId as string);
      if (!author) return null;
      return {
        id: author.id,
        name: author.name,
        handle: author.handle,
        avatarUrl: author.avatarUrl,
        modelCount: g._count,
      };
    })
    .filter((a): a is DashboardAuthor => a !== null);
}

async function fetchTopProviders(userId: string): Promise<DashboardProvider[]> {
  const grouped = await prisma.print.groupBy({
    by: ["sourceProvider"],
    where: { userId },
    _count: true,
  });
  const buckets = new Map<string, number>();
  for (const g of grouped) {
    const key = g.sourceProvider ?? "thingport";
    buckets.set(key, (buckets.get(key) ?? 0) + g._count);
  }
  return [...buckets.entries()]
    .map(([provider, modelCount]) => ({ provider, modelCount }))
    .toSorted((a, b) => b.modelCount - a.modelCount);
}

export async function getDashboardSummary(userId: string): Promise<DashboardSummary> {
  const [
    collectionCount,
    modelCount,
    authorGroups,
    categoryCount,
    topViewed,
    topPrinted,
    topAuthors,
    topProviders,
    recentlyAdded,
  ] = await Promise.all([
    prisma.collection.count({ where: { userId } }),
    prisma.print.count({ where: { userId } }),
    prisma.print.groupBy({ by: ["authorId"], where: { userId, authorId: { not: null } } }),
    prisma.category.count({ where: { userId } }),
    fetchTopViewed(userId, TOP_MODELS_PREVIEW),
    fetchTopPrinted(userId, TOP_MODELS_PREVIEW),
    fetchTopAuthors(userId, TOP_AUTHORS_PREVIEW),
    fetchTopProviders(userId),
    fetchRecentlyAdded(userId, RECENTLY_ADDED_LIMIT),
  ]);

  return {
    collectionCount,
    modelCount,
    authorCount: authorGroups.length,
    categoryCount,
    topViewed,
    topPrinted,
    topAuthors,
    topProviders,
    recentlyAdded,
  };
}

export function getTopViewedList(userId: string): Promise<DashboardModel[]> {
  return fetchTopViewed(userId, TOP_MODELS_LIST_MAX);
}

export function getTopPrintedList(userId: string): Promise<DashboardModel[]> {
  return fetchTopPrinted(userId, TOP_MODELS_LIST_MAX);
}

export function getTopAuthorsList(userId: string): Promise<DashboardAuthor[]> {
  return fetchTopAuthors(userId, TOP_AUTHORS_LIST_MAX);
}

/**
 * One of the user's models whose first file can be shown in 3D, the same one all day. The day is the
 * caller's own date, so the pick changes at the user's midnight rather than the server's.
 */
export async function getFeaturedModelId(userId: string, day: string): Promise<string | null> {
  // Plates are renumbered from 0 on every delete and reorder, so position 0 is the one a preview shows.
  const where = {
    userId,
    plates: {
      some: {
        position: 0,
        OR: [...RENDERABLE_MODEL_EXTS].map((ext) => ({ filename: { endsWith: ext, mode: "insensitive" as const } })),
      },
    },
  };
  const count = await prisma.print.count({ where });
  if (!count) return null;
  const seed = createHash("sha256").update(`${userId}:${day}`).digest().readUInt32BE(0);
  const pick = await prisma.print.findFirst({
    where,
    orderBy: { id: "asc" },
    skip: seed % count,
    select: { id: true },
  });
  return pick?.id ?? null;
}
