import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import BookmarkIcon from "@mui/icons-material/Bookmark";
import BookmarkBorderIcon from "@mui/icons-material/BookmarkBorder";
import { UnauthorizedError } from "../../api/client";
import { type TagSortMode, type TagSummary, tagsApi } from "../../api/tags";
import TagSortTabs from "./TagSortTabs";

type Props = {
  onUnauthorized?: () => void;
  onBookmarksChanged?: () => void;
};

/** The standalone Tags list: every tag across the user's library as a small row --
 *  "<name> (<count>)" plus a bookmark toggle -- sorted Popular (most models, default) or Name.
 *  Bookmarking surfaces the tag in the sidebar's own quick-access list (see Sidebar). */
export default function TagsPage({ onUnauthorized, onBookmarksChanged }: Props) {
  const { t } = useTranslation(["models", "common"]);
  const navigate = useNavigate();
  const [tags, setTags] = useState<TagSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortMode, setSortMode] = useState<TagSortMode>("popular");
  const [pendingTag, setPendingTag] = useState<string | null>(null);

  const handleError = (err: unknown, message?: string) => {
    if (err instanceof UnauthorizedError) {
      onUnauthorized?.();
      return true;
    }
    console.error(err);
    if (message) alert(message);
    return false;
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const result = await tagsApi.listSummary(sortMode);
        if (!cancelled) setTags(result);
      } catch (err) {
        if (!cancelled) handleError(err, t("models:errors.loadFailed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortMode]);

  const toggleBookmark = async (tag: TagSummary) => {
    if (pendingTag) return;
    setPendingTag(tag.name);
    const nextBookmarked = !tag.bookmarked;
    setTags(prev => prev.map(t2 => (t2.name === tag.name ? { ...t2, bookmarked: nextBookmarked } : t2)));
    try {
      await (nextBookmarked ? tagsApi.bookmark(tag.name) : tagsApi.unbookmark(tag.name));
      onBookmarksChanged?.();
    } catch (err) {
      setTags(prev => prev.map(t2 => (t2.name === tag.name ? { ...t2, bookmarked: tag.bookmarked } : t2)));
      if (err instanceof UnauthorizedError) {
        onUnauthorized?.();
        return;
      }
      console.error(err);
      alert(t("models:tags.bookmarkFailed"));
    } finally {
      setPendingTag(null);
    }
  };

  if (loading) {
    return (
      <Stack alignItems="center" sx={{ py: 8 }}>
        <CircularProgress size={22} />
      </Stack>
    );
  }

  return (
    <Stack spacing={2} sx={{ maxWidth: 640 }}>
      <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
        <TagSortTabs value={sortMode} onChange={setSortMode} />
      </Box>

      {tags.length ? (
        <Stack spacing={0.5}>
          {tags.map(tag => (
            <Stack
              key={tag.name}
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              onClick={() => navigate(`/models/tags/${encodeURIComponent(tag.name)}`)}
              sx={{
                px: 1.5,
                py: 0.75,
                borderRadius: 1.5,
                cursor: "pointer",
                "&:hover": { bgcolor: "action.hover" },
              }}
            >
              <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>
                {tag.name}
                <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 0.75 }}>
                  ({tag.count})
                </Typography>
              </Typography>
              <IconButton
                size="small"
                disabled={pendingTag === tag.name}
                onClick={(e) => { e.stopPropagation(); void toggleBookmark(tag); }}
                aria-label={tag.bookmarked ? t("models:tags.unbookmarkTag") : t("models:tags.bookmarkTag")}
              >
                {tag.bookmarked ? <BookmarkIcon fontSize="small" color="primary" /> : <BookmarkBorderIcon fontSize="small" />}
              </IconButton>
            </Stack>
          ))}
        </Stack>
      ) : (
        <Stack alignItems="center" spacing={1} sx={{ py: 8, color: "text.secondary" }}>
          <Typography variant="body2">{t("models:tags.empty")}</Typography>
        </Stack>
      )}
    </Stack>
  );
}
