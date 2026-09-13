import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth } from "../auth";
import { HttpError } from "../utils/fileUtils";
import { asyncHandler } from "../utils/asyncHandler";
import { normalizeTag } from "../utils/tagNormalization";

const router = Router();
router.use(requireAuth);

function sortedBookmarks(tags: string[]): string[] {
  return tags.toSorted((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

// ---- GET /tags/summary?sort=popular|name -------------------------------------------------------
// Every tag across this user's whole library (unfiltered -- unlike GET /tags in prints.ts, which
// scopes to whatever grid filter is active), with its model count and whether it's bookmarked.
// Backs the standalone Tags list page.

const sortSchema = z.enum(["popular", "name"]).catch("popular");

router.get(
  "/tags/summary",
  asyncHandler(async (req, res) => {
    const sort = sortSchema.parse(req.query.sort);
    const [prints, user] = await Promise.all([
      prisma.print.findMany({ where: { userId: req.userId }, select: { tags: true } }),
      prisma.user.findUnique({ where: { id: req.userId }, select: { bookmarkedTags: true } }),
    ]);
    const bookmarked = new Set(user?.bookmarkedTags ?? []);
    const counts = new Map<string, number>();
    for (const print of prints) {
      for (const tag of print.tags) {
        const cleaned = normalizeTag(tag);
        if (!cleaned) continue;
        counts.set(cleaned, (counts.get(cleaned) ?? 0) + 1);
      }
    }
    const tags = [...counts.entries()]
      .map(([name, count]) => ({ name, count, bookmarked: bookmarked.has(name) }))
      .toSorted((a, b) =>
        sort === "name"
          ? a.name.toLowerCase().localeCompare(b.name.toLowerCase())
          : b.count - a.count || a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
      );
    res.json(tags);
  }),
);

// ---- GET /tags/bookmarked ------------------------------------------------------------------------
// Just the bookmarked tag names, for the sidebar's quick-access list -- deliberately not
// /tags/summary, which scans every print; this is a single-row lookup.

router.get(
  "/tags/bookmarked",
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { bookmarkedTags: true } });
    res.json(sortedBookmarks(user?.bookmarkedTags ?? []));
  }),
);

// ---- POST/DELETE /tags/:tag/bookmark --------------------------------------------------------------

router.post(
  "/tags/:tag/bookmark",
  asyncHandler(async (req, res) => {
    const tag = normalizeTag(req.params.tag);
    if (!tag) throw new HttpError(400, "Tag is required");
    const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { bookmarkedTags: true } });
    const next = user?.bookmarkedTags.includes(tag) ? user.bookmarkedTags : [...(user?.bookmarkedTags ?? []), tag];
    await prisma.user.update({ where: { id: req.userId! }, data: { bookmarkedTags: next } });
    res.json(sortedBookmarks(next));
  }),
);

router.delete(
  "/tags/:tag/bookmark",
  asyncHandler(async (req, res) => {
    const tag = normalizeTag(req.params.tag);
    const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { bookmarkedTags: true } });
    const next = (user?.bookmarkedTags ?? []).filter((t) => t !== tag);
    await prisma.user.update({ where: { id: req.userId! }, data: { bookmarkedTags: next } });
    res.json(sortedBookmarks(next));
  }),
);

export default router;
