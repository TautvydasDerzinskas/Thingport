import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth";
import { asyncHandler } from "../utils/asyncHandler";
import { normalizeTag } from "../utils/tagNormalization";
import { parseBody } from "../utils/validate";
import { addTagBookmark, listBookmarkedTagSet, removeTagBookmark } from "../services/bookmarkService";
import { createLog } from "../services/auditLog";
import { HttpError } from "../utils/fileUtils";
import {
  ensureTagMosaic,
  listTaggedPrints,
  tagMosaicUrl,
  tagPictures,
  type MosaicKind,
} from "../services/tagMosaicService";
import { deleteTags, mergeTags, previewTagMerge } from "../services/tagService";

const router = Router();
router.use(requireAuth);

function sortedBookmarks(tags: Iterable<string>): string[] {
  return [...tags].toSorted((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

// Every tag in the library (unlike GET /tags, which follows the grid filter).

const summaryQuery = z.object({
  sort: z.enum(["popular", "name", "newest"]).catch("popular"),
  limit: z.coerce.number().int().min(1).max(100).catch(48),
  offset: z.coerce.number().int().min(0).catch(0),
  // Tags on fewer models are left out, so a page holds only what's shown.
  min_count: z.coerce.number().int().min(1).catch(1),
});

router.get(
  "/tags/summary",
  asyncHandler(async (req, res) => {
    const { sort, limit, offset, min_count: minCount } = summaryQuery.parse(req.query);
    const [prints, bookmarked] = await Promise.all([listTaggedPrints(req.userId!), listBookmarkedTagSet(req.userId!)]);
    const counts = new Map<string, number>();
    for (const print of prints) {
      for (const tag of new Set(print.tags.map(normalizeTag))) {
        if (tag) counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    // Prints come newest first, so a map's insertion order is each tag's newest model; "newest" keeps it.
    const byName = (a: string, b: string) => a.toLowerCase().localeCompare(b.toLowerCase());
    const entries = [...counts.entries()].filter(([, count]) => count >= minCount);
    const matching =
      sort === "newest"
        ? entries
        : entries.toSorted(([a, countA], [b, countB]) =>
            sort === "name" ? byName(a, b) : countB - countA || byName(a, b),
          );
    const page = matching.slice(offset, offset + limit);

    // Pictures for this page's tags alone, joined in one query; the browser picks which mosaic to show.
    const pictures = await tagPictures(
      prints,
      page.map(([name]) => name),
      ["images", "renders"],
    );

    res.json({
      items: page.map(([name, count]) => ({
        name,
        count,
        bookmarked: bookmarked.has(name),
        mosaic_url: tagMosaicUrl(name, pictures.get("images")?.get(name) ?? []),
        render_mosaic_url: tagMosaicUrl(name, pictures.get("renders")?.get(name) ?? [], "renders"),
      })),
      total: matching.length,
      // Every tag, whatever its count: tells "none match the filter" from "no tags at all".
      total_all: counts.size,
      has_more: offset + page.length < matching.length,
    });
  }),
);

// The tag's tile picture; its URL carries a version, so it's cached for good and asked for anew when it changes.
function mosaicHandler(kind: MosaicKind) {
  return asyncHandler(async (req, res) => {
    const file = await ensureTagMosaic(req.userId!, req.params.tag, kind);
    if (!file) throw new HttpError(404, "Not found");
    res.setHeader("Content-Type", "image/webp");
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.sendFile(file);
  });
}
router.get("/tags/:tag/mosaic.webp", mosaicHandler("images"));
router.get("/tags/:tag/render-mosaic.webp", mosaicHandler("renders"));

// Just the bookmarked names, without scanning every print like /tags/summary.

router.get(
  "/tags/bookmarked",
  asyncHandler(async (req, res) => {
    res.json(sortedBookmarks(await listBookmarkedTagSet(req.userId!)));
  }),
);

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

const tagsSchema = z.object({ tags: z.array(z.string()).min(1).max(1000) });
const mergeSchema = z.object({ primary: z.string(), tags: z.array(z.string()).min(1).max(1000) });

router.post(
  "/tags/merge/preview",
  asyncHandler(async (req, res) => {
    const body = parseBody(tagsSchema, req.body);
    res.json(await previewTagMerge(req.userId!, body.tags));
  }),
);

// `tags` are put under `primary` and removed; it may list `primary` too.
router.post(
  "/tags/merge",
  asyncHandler(async (req, res) => {
    const body = parseBody(mergeSchema, req.body);
    const { primary, merged, added } = await mergeTags(req.userId!, body.primary, body.tags);
    res.json({ tag: primary, merged, added });
    void createLog({ userId: req.userId!, action: "tags_merged", details: { name: primary, merged, added } });
  }),
);

function logDeleted(userId: string, counts: Map<string, number>) {
  for (const [name, models] of counts) void createLog({ userId, action: "tag_deleted", details: { name, models } });
}

router.post(
  "/tags/delete",
  asyncHandler(async (req, res) => {
    const body = parseBody(tagsSchema, req.body);
    const counts = await deleteTags(req.userId!, body.tags);
    res.json({ deleted: [...counts.keys()] });
    logDeleted(req.userId!, counts);
  }),
);

// Takes the tag off every model of the user's that has it, in whatever case it was saved.
router.delete(
  "/tags/:tag",
  asyncHandler(async (req, res) => {
    const counts = await deleteTags(req.userId!, [req.params.tag]);
    res.json({ models: [...counts.values()][0] });
    logDeleted(req.userId!, counts);
  }),
);

export default router;
