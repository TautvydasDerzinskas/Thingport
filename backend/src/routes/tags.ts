import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth } from "../auth";
import { asyncHandler } from "../utils/asyncHandler";
import { normalizeTag } from "../utils/tagNormalization";
import { addTagBookmark, listBookmarkedTagSet, removeTagBookmark } from "../services/bookmarkService";

const router = Router();
router.use(requireAuth);

function sortedBookmarks(tags: Iterable<string>): string[] {
  return [...tags].toSorted((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
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
    const [prints, bookmarked] = await Promise.all([
      prisma.print.findMany({ where: { userId: req.userId }, select: { tags: true } }),
      listBookmarkedTagSet(req.userId!),
    ]);
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
// Just the bookmarked tag names -- for TagsPage/TagDetailPage's own bookmark toggles, so they can
// tell whether the tag they're showing is already bookmarked. Deliberately not /tags/summary,
// which scans every print. The sidebar's quick-access list itself reads GET /bookmarks instead
// (routes/bookmarks.ts), which also carries the manual sort order and the bookmarked collections.

router.get(
  "/tags/bookmarked",
  asyncHandler(async (req, res) => {
    res.json(sortedBookmarks(await listBookmarkedTagSet(req.userId!)));
  }),
);

// ---- POST/DELETE /tags/:tag/bookmark --------------------------------------------------------------
// Adds/removes this tag from the sidebar's quick-access "Bookmarks" section (see
// services/bookmarkService.ts and GET /bookmarks in routes/bookmarks.ts, which is what the
// sidebar itself actually reads -- these two just flip membership from the Tags list/detail
// pages' own toggle).

router.post(
  "/tags/:tag/bookmark",
  asyncHandler(async (req, res) => {
    await addTagBookmark(req.userId!, req.params.tag);
    res.json({ ok: true });
  }),
);

router.delete(
  "/tags/:tag/bookmark",
  asyncHandler(async (req, res) => {
    await removeTagBookmark(req.userId!, req.params.tag);
    res.json({ ok: true });
  }),
);

export default router;
