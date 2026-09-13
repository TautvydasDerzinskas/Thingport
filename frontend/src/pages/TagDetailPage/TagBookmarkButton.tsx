import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Tooltip from "@mui/material/Tooltip";
import IconButton from "@mui/material/IconButton";
import BookmarkIcon from "@mui/icons-material/Bookmark";
import BookmarkBorderIcon from "@mui/icons-material/BookmarkBorder";
import { UnauthorizedError } from "../../api/client";
import { tagsApi } from "../../api/tags";

type Props = {
  tag: string;
  bookmarked: boolean;
  onUnauthorized?: () => void;
  /** Called after a successful toggle so the sidebar's own bookmarked-tags list can refetch. */
  onBookmarksChanged?: () => void;
};

/** The tag detail page's title-row bookmark toggle -- adds/removes this tag from the sidebar's
 *  quick-access list. Same optimistic-flip shape as FavoriteButton, but derives its displayed
 *  state from `bookmarked` during render (an `overrideRef` from the last optimistic flip/rollback
 *  wins when set) instead of mirroring the prop into local state via an effect. */
export default function TagBookmarkButton({ tag, bookmarked, onUnauthorized, onBookmarksChanged }: Props) {
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
      await (next ? tagsApi.bookmark(tag) : tagsApi.unbookmark(tag));
      onBookmarksChanged?.();
    } catch (err) {
      setOverride(bookmarked);
      if (err instanceof UnauthorizedError) {
        onUnauthorized?.();
        return;
      }
      console.error(err);
      alert(t("models:tags.bookmarkFailed"));
    } finally {
      pendingRef.current = false;
    }
  };

  const label = isBookmarked ? t("models:tags.unbookmarkTag") : t("models:tags.bookmarkTag");

  return (
    <Tooltip title={label}>
      <IconButton size="small" onClick={toggle} aria-label={label}>
        {isBookmarked ? <BookmarkIcon fontSize="small" color="primary" /> : <BookmarkBorderIcon fontSize="small" />}
      </IconButton>
    </Tooltip>
  );
}
