import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Tooltip from "@mui/material/Tooltip";
import IconButton from "@mui/material/IconButton";
import BookmarkIcon from "@mui/icons-material/Bookmark";
import BookmarkBorderIcon from "@mui/icons-material/BookmarkBorder";
import { UnauthorizedError } from "../../api/client";
import { collectionsApi } from "../../api/collections";
import { useToast } from "../../components/ToastProvider";

type Props = {
  collectionId: string;
  bookmarked: boolean;
  onUnauthorized?: () => void;
  onBookmarksChanged?: () => void;
  /** Lets other controls on the page showing this state stay in sync. */
  onToggled?: (bookmarked: boolean) => void;
};

export default function CollectionBookmarkButton({
  collectionId,
  bookmarked,
  onUnauthorized,
  onBookmarksChanged,
  onToggled,
}: Props) {
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
      showToast({ message: t("models:collections.bookmarkFailed"), severity: "error" });
    } finally {
      pendingRef.current = false;
    }
  };

  const label = isBookmarked
    ? t("models:collections.unbookmarkCollection")
    : t("models:collections.bookmarkCollection");

  return (
    <Tooltip title={label}>
      <IconButton size="small" onClick={toggle} aria-label={label}>
        {isBookmarked ? <BookmarkIcon fontSize="small" color="primary" /> : <BookmarkBorderIcon fontSize="small" />}
      </IconButton>
    </Tooltip>
  );
}
