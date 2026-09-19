import { prisma } from "../db";
import { HttpError } from "../utils/fileUtils";
import { normalizeTag } from "../utils/tagNormalization";

// ---- Shared "Bookmarks" quick-access list ------------------------------------------------------
//
// A Bookmark row is either a TAG (a plain string -- see normalizeTag) or a COLLECTION (a real,
// non-system Collection row). Both share one `order` sequence per user so the sidebar can show
// them interleaved, sorted by that single field -- see the Bookmark model's own doc comment in
// schema.prisma for the full reasoning. This module is the only place that touches the Bookmark
// table; routes/tags.ts, routes/collections.ts and routes/bookmarks.ts all go through it.

/** The next `order` value for a new bookmark of this user's -- current max + 1 (or 0 if they have
 *  none yet), so a fresh bookmark always lands at the bottom of the list. */
async function nextBookmarkOrder(userId: string): Promise<number> {
  const result = await prisma.bookmark.aggregate({ where: { userId }, _max: { order: true } });
  return (result._max.order ?? -1) + 1;
}

/** Every tag this user has bookmarked, for TagsPage/summary and TagDetailPage's title toggle. */
export async function listBookmarkedTagSet(userId: string): Promise<Set<string>> {
  const rows = await prisma.bookmark.findMany({ where: { userId, type: "TAG" }, select: { tag: true } });
  return new Set(rows.map((r) => r.tag).filter((tag): tag is string => Boolean(tag)));
}

/** Every collection id this user has bookmarked, for the Collections grid/detail page's "..."
 *  menu and title toggle. */
export async function listBookmarkedCollectionIdSet(userId: string): Promise<Set<string>> {
  const rows = await prisma.bookmark.findMany({ where: { userId, type: "COLLECTION" }, select: { collectionId: true } });
  return new Set(rows.map((r) => r.collectionId).filter((id): id is string => Boolean(id)));
}

/** Idempotent -- bookmarking an already-bookmarked tag is a no-op rather than an error, so a
 *  double-click (or a stale optimistic UI) never surfaces a failure. */
export async function addTagBookmark(userId: string, rawTag: string): Promise<void> {
  const tag = normalizeTag(rawTag);
  if (!tag) throw new HttpError(400, "Tag is required");
  const existing = await prisma.bookmark.findFirst({ where: { userId, type: "TAG", tag } });
  if (existing) return;
  const order = await nextBookmarkOrder(userId);
  await prisma.bookmark.create({ data: { userId, type: "TAG", tag, order } });
}

export async function removeTagBookmark(userId: string, rawTag: string): Promise<void> {
  const tag = normalizeTag(rawTag);
  await prisma.bookmark.deleteMany({ where: { userId, type: "TAG", tag } });
}

/** Same idempotent shape as addTagBookmark. Callers are responsible for checking the collection
 *  exists, belongs to this user, and isn't one of the built-in system pseudo-collections (which
 *  have no real Collection row for the FK to point at) -- see routes/collections.ts. */
export async function addCollectionBookmark(userId: string, collectionId: string): Promise<void> {
  const existing = await prisma.bookmark.findFirst({ where: { userId, type: "COLLECTION", collectionId } });
  if (existing) return;
  const order = await nextBookmarkOrder(userId);
  await prisma.bookmark.create({ data: { userId, type: "COLLECTION", collectionId, order } });
}

export async function removeCollectionBookmark(userId: string, collectionId: string): Promise<void> {
  await prisma.bookmark.deleteMany({ where: { userId, type: "COLLECTION", collectionId } });
}

export type BookmarkEntryOut =
  | { id: string; type: "tag"; tag: string }
  | { id: string; type: "collection"; collection_id: string; name: string };

/** The full merged, ordered bookmark list -- backs GET /bookmarks (the sidebar's quick-access
 *  section) and the response of POST /bookmarks/reorder. A COLLECTION row's `collection` is never
 *  null here: the FK cascades (see schema.prisma), so a bookmark for a deleted collection is
 *  deleted right along with it, unlike a TAG bookmark, which can quietly outlive every print that
 *  ever carried that tag. */
export async function listBookmarks(userId: string): Promise<BookmarkEntryOut[]> {
  const rows = await prisma.bookmark.findMany({
    where: { userId },
    orderBy: { order: "asc" },
    include: { collection: { select: { id: true, name: true } } },
  });
  return rows.map((row) =>
    row.type === "TAG"
      ? { id: row.id, type: "tag" as const, tag: row.tag! }
      : { id: row.id, type: "collection" as const, collection_id: row.collection!.id, name: row.collection!.name },
  );
}

/** Persists a full drag-and-drop reorder of the sidebar's bookmark list: `orderedIds` must name
 *  exactly this user's current bookmarks (tags and collections together), in their new order --
 *  same "must be exactly the current sibling set" validation as POST /categories/reorder. Every
 *  bookmark is renumbered 0..n-1 in one transaction. */
export async function reorderBookmarks(userId: string, orderedIds: string[]): Promise<void> {
  const bookmarks = await prisma.bookmark.findMany({ where: { userId }, select: { id: true } });
  const currentIds = new Set(bookmarks.map((b) => b.id));
  if (orderedIds.length !== bookmarks.length || !orderedIds.every((id) => currentIds.has(id))) {
    throw new HttpError(400, "bookmark_ids must contain exactly this user's current bookmarks");
  }
  await prisma.$transaction(
    orderedIds.map((id, idx) => prisma.bookmark.update({ where: { id }, data: { order: idx } })),
  );
}
