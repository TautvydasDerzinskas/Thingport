import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { toPrintOut, type PrintOut } from "../dto";
import { getLinkedAuthorIds } from "./authorService";
import { systemCollectionKeyForId } from "./collectionService";
import { rankedPrintIds } from "./searchService";

// The library listing's filters and order, shared by GET /prints and the MCP tools so both list the
// same models for the same filters.

/** `author_id` sentinel for "prints with no real author". */
export const SELF_AUTHOR_ID = "self";

export type PrintFilters = {
  q?: string;
  categoryIds?: string[];
  /** A collection id, or a system collection's (Favourites, Browsing History). */
  collectionId?: string;
  /** An author id, or SELF_AUTHOR_ID. */
  authorId?: string;
  /** Every one of them, case-insensitively. */
  tags?: string[];
};

export const PRINT_SORT_MODES = ["newest", "popular", "downloads", "relevance"] as const;
export type PrintSortMode = (typeof PRINT_SORT_MODES)[number];

export function parseSortMode(raw: unknown): PrintSortMode {
  if (raw === "popular" || raw === "downloads" || raw === "relevance") return raw;
  return "newest";
}

/** A comma-separated query parameter as its trimmed, non-empty parts. */
export function splitList(raw: unknown): string[] {
  return (typeof raw === "string" ? raw : "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

// Postgres array containment is case-sensitive, so tags are matched in JS after fetching.
export function matchesTagList(printTags: string[], tagList: string[]): boolean {
  if (!tagList.length) return true;
  const printTagsLower = new Set(printTags.map((t) => t.toLowerCase()));
  return tagList.every((t) => printTagsLower.has(t.toLowerCase()));
}

/** `rankedIds` is set when `q` is: the matches, best first, for orderBy=relevance. Tags aren't in
 *  `where`: see matchesTagList. */
export async function buildPrintWhere(
  userId: string,
  filters: PrintFilters,
): Promise<{ where: Prisma.PrintWhereInput; rankedIds: string[] | null }> {
  const q = filters.q?.trim() ?? "";
  const categoryIds = filters.categoryIds ?? [];
  const collectionId = filters.collectionId?.trim() ?? "";
  const authorId = filters.authorId?.trim() ?? "";

  const where: Prisma.PrintWhereInput = { userId };
  // AND clauses so the self-author and search OR groups don't clobber each other.
  const andClauses: Prisma.PrintWhereInput[] = [];
  if (categoryIds.length === 1) where.categoryId = categoryIds[0];
  else if (categoryIds.length > 1) where.categoryId = { in: categoryIds };
  if (authorId === SELF_AUTHOR_ID) {
    // "My models": prints with no author at all, or by an Author the user linked as themselves.
    const linkedAuthorIds = await getLinkedAuthorIds(userId);
    andClauses.push({
      OR: [
        { authorId: null, creator: null, sourceProvider: null },
        ...(linkedAuthorIds.length ? [{ authorId: { in: linkedAuthorIds } }] : []),
      ],
    });
  } else if (authorId) {
    where.authorId = authorId;
  }
  if (collectionId) {
    const systemKey = systemCollectionKeyForId(collectionId);
    if (systemKey === "favorites") where.favoritedAt = { not: null };
    else if (systemKey === "history") where.lastViewedAt = { not: null };
    else where.collectionItems = { some: { collectionId } };
  }
  // Matched as the search palette matches, so its "see all results" lists what it found.
  const rankedIds = q ? await rankedPrintIds(userId, q) : null;
  if (rankedIds) andClauses.push({ id: { in: rankedIds } });
  if (andClauses.length) where.AND = andClauses;
  return { where, rankedIds };
}

export type PrintListPage = {
  prints: PrintOut[];
  /** Across every page. */
  total: number;
  hasMore: boolean;
  nextOffset: number;
};

/** Without `limit`, every match comes back on one page. */
export async function listPrints(
  userId: string,
  filters: PrintFilters,
  options: { sort?: PrintSortMode; limit?: number; offset?: number } = {},
): Promise<PrintListPage> {
  const { where, rankedIds } = await buildPrintWhere(userId, filters);
  const tagList = filters.tags ?? [];
  const allMatching = await prisma.print.findMany({
    where,
    include: {
      plates: { orderBy: { position: "asc" } },
      previewImages: { orderBy: { position: "asc" } },
      author: true,
      // A card's menu needs to know a folder from a category, as the detail page does.
      category: true,
    },
  });
  const prints = tagList.length ? allMatching.filter((p) => matchesTagList(p.tags, tagList)) : allMatching;
  // Under "newest", Favourites and Browsing History sort by when they were favorited/viewed.
  const systemKey = systemCollectionKeyForId(filters.collectionId?.trim() ?? "");
  const recencyField = systemKey === "favorites" ? "favoritedAt" : systemKey === "history" ? "lastViewedAt" : null;
  const sortMode = options.sort ?? "newest";

  // Relevance needs a query to rank by; without one it falls back to newest.
  const rank = sortMode === "relevance" && rankedIds ? new Map(rankedIds.map((id, i) => [id, i])) : null;
  const sortValue = (p: (typeof prints)[number]): number => {
    if (rank) return -(rank.get(p.id) ?? rank.size);
    if (sortMode === "popular") return p.viewCount;
    if (sortMode === "downloads") return p.printCount;
    if (recencyField) return p[recencyField]?.getTime() ?? 0;
    return p.createdAt.getTime();
  };

  const sorted = prints.toSorted((a, b) => {
    const diff = sortValue(b) - sortValue(a);
    if (diff !== 0) return diff;
    return a.id.localeCompare(b.id);
  });

  const start = options.limit !== undefined ? (options.offset ?? 0) : 0;
  const paged = options.limit !== undefined ? sorted.slice(start, start + options.limit) : sorted;
  // Files only for the page: the sort above reads nothing but Print columns.
  const pagedIds = paged.map((p) => p.id);
  const files = pagedIds.length ? await prisma.printFile.findMany({ where: { printId: { in: pagedIds } } }) : [];
  const filesByPrint = new Map<string, typeof files>();
  for (const f of files) {
    const list = filesByPrint.get(f.printId) ?? [];
    list.push(f);
    filesByPrint.set(f.printId, list);
  }

  return {
    prints: paged.map((p) => {
      const printFiles = filesByPrint.get(p.id) ?? [];
      const preparedFile = p.preparedFileId ? (printFiles.find((f) => f.id === p.preparedFileId) ?? null) : null;
      return toPrintOut(p, p.plates, printFiles, preparedFile, p.author, p.previewImages, p.category);
    }),
    total: sorted.length,
    hasMore: sorted.length > start + paged.length,
    nextOffset: start + paged.length,
  };
}

/** Every tag on the models these filters match, case-insensitively sorted. */
export async function listTagsOf(userId: string, filters: PrintFilters): Promise<string[]> {
  const { where } = await buildPrintWhere(userId, filters);
  const tagList = filters.tags ?? [];
  const allRows = await prisma.print.findMany({ where, select: { tags: true } });
  const rows = tagList.length ? allRows.filter((r) => matchesTagList(r.tags, tagList)) : allRows;
  const found = new Set<string>();
  for (const row of rows) {
    for (const tag of row.tags) {
      const cleaned = tag.trim();
      if (cleaned) found.add(cleaned);
    }
  }
  return [...found].toSorted((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}
