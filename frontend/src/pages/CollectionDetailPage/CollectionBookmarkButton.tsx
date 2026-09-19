import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Tooltip from "@mui/material/Tooltip";
import IconButton from "@mui/material/IconButton";
import BookmarkIcon from "@mui/icons-material/Bookmark";
import BookmarkBorderIcon from "@mui/icons-material/BookmarkBorder";
import { UnauthorizedError } from "../../api/client";
import { collectionsApi } from "../../api/collections";

type Props = {
  collectionId: string;
  bookmarked: boolean;
  onUnauthorized?: () => void;
  /** Called after a successful toggle so the sidebar's own bookmarked list can refetch. */
  onBookmarksChanged?: () => void;
  /** Called after a successful toggle with the new state, so a caller that also shows this
   *  collection's bookmark status elsewhere on the same page (e.g. the "..." menu) can stay in
   *  sync instead of reading a now-stale `bookmarked` prop. */
  onToggled?: (bookmarked: boolean) => void;
};

/** The collection detail page's title-row bookmark toggle -- adds/removes this collection from
 *  the sidebar's quick-access list. Identical optimistic-flip shape to TagBookmarkButton. */
export default function CollectionBookmarkButton({
  collectionId,
  bookmarked,
  onUnauthorized,
  onBookmarksChanged,
  onToggled,
}: Props) {
  const { t } = useTranslation(["models", "common"]);
  const [override, setOverride] = useState<boolean | null>(null);
  const isBookmarked = override ?? bookmarked;
  const pendingRef = useRef(false);

  const toggle = async () => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    const next = !isBookmarked;
    setOverride(next);
    try {
      await (next ? collectionsApi.bookmark(collectionId) : collectionsApi.unbookmark(collectionId));
      onToggled?.(next);
      onBookmarksChanged?.();
    } catch (err) {
      setOverride(bookmarked);
      if (err instanceof UnauthorizedError) {
        onUnauthorized?.();
        return;
      }
      console.error(err);
      alert(t("models:collections.bookmarkFailed"));
    } finally {
      pendingRef.current = false;
    }
  };

  const label = isBookmarked ? t("models:collections.unbookmarkCollection") : t("models:collections.bookmarkCollection");

  return (
    <Tooltip title={label}>
      <IconButton size="small" onClick={toggle} aria-label={label}>
        {isBookmarked ? <BookmarkIcon fontSize="small" color="primary" /> : <BookmarkBorderIcon fontSize="small" />}
      </IconButton>
    </Tooltip>
  );
}
