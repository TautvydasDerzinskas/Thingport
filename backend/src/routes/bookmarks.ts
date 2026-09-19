import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth";
import { parseBody } from "../utils/validate";
import { asyncHandler } from "../utils/asyncHandler";
import { listBookmarks, reorderBookmarks } from "../services/bookmarkService";

const router = Router();
router.use(requireAuth);

// ---- GET /bookmarks -------------------------------------------------------------------------
// Every bookmarked tag and collection for this user, tags and collections interleaved in one
// list ordered by Bookmark.order -- backs the sidebar's quick-access "Bookmarks" section (see
// Sidebar/index.tsx). A new bookmark (POST /tags/:tag/bookmark, POST /collection/:id/bookmark)
// always lands at the bottom; dragging a row in the sidebar calls POST /bookmarks/reorder below
// to persist the dropped order.
router.get(
  "/bookmarks",
  asyncHandler(async (req, res) => {
    res.json(await listBookmarks(req.userId!));
  }),
);

const reorderSchema = z.object({ bookmark_ids: z.array(z.string()).min(1) });

router.post(
  "/bookmarks/reorder",
  asyncHandler(async (req, res) => {
    const body = parseBody(reorderSchema, req.body);
    await reorderBookmarks(req.userId!, body.bookmark_ids);
    res.json(await listBookmarks(req.userId!));
  }),
);

export default router;
