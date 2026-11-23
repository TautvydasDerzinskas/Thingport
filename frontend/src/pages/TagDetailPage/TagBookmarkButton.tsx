import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Tooltip from "@mui/material/Tooltip";
import IconButton from "@mui/material/IconButton";
import BookmarkIcon from "@mui/icons-material/Bookmark";
import BookmarkBorderIcon from "@mui/icons-material/BookmarkBorder";
import { UnauthorizedError } from "../../api/client";
import { tagsApi } from "../../api/tags";
import { useToast } from "../../components/ToastProvider";

type Props = {
  tag: string;
  bookmarked: boolean;
  onUnauthorized?: () => void;
  onBookmarksChanged?: () => void;
};

/** Derives its state from `bookmarked` during render, with an `overrideRef` from the last
 *  optimistic flip taking precedence. */
export default function TagBookmarkButton({ tag, bookmarked, onUnauthorized, onBookmarksChanged }: Props) {
  const { t } = useTranslation(["models", "common"]);
  const showToast = useToast();
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
      showToast({ message: t("models:tags.bookmarkFailed"), severity: "error" });
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
