import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import Chip from "@mui/material/Chip";
import Switch from "@mui/material/Switch";
import FormControlLabel from "@mui/material/FormControlLabel";
import BookmarkIcon from "@mui/icons-material/Bookmark";
import BookmarkBorderIcon from "@mui/icons-material/BookmarkBorder";
import { UnauthorizedError } from "../../api/client";
import { type TagSortMode, type TagSummary, tagsApi } from "../../api/tags";
import { dividerBorderColor } from "../../theme";
import TagSortTabs from "./TagSortTabs";

type Props = {
  onUnauthorized?: () => void;
  onBookmarksChanged?: () => void;
};

/** The standalone Tags list: every tag across the user's library as a small chip --
 *  "<name> (<count>)" plus a bookmark toggle (Chip's own deleteIcon slot, repurposed -- its click
 *  target is already separate from the chip's own onClick, exactly the two independent actions
 *  this needs) -- wrapping left-to-right instead of one per row, so far more fit on screen at
 *  once. Colored like the sidebar's own inactive nav rows (thingport.navInactiveText) with the
 *  same divider-in-light/invisible-in-dark border used by Sidebar/CategoriesPanel/ModelSidePanel
 *  (dividerBorderColor), so this reads as an extension of that same nav chrome rather than a
 *  one-off style. Sorted Popular (most models, default) or Name. Bookmarking surfaces the tag in
 *  the sidebar's own quick-access list (see Sidebar). A "hide rarely-used tags" switch (on by
 *  default) filters out anything used by fewer than 2 models -- purely a client-side filter over
 *  the same already-fetched list, not a separate API call. */
export default function TagsPage({ onUnauthorized, onBookmarksChanged }: Props) {
  const { t } = useTranslation(["models", "common"]);
  const navigate = useNavigate();
  const [tags, setTags] = useState<TagSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortMode, setSortMode] = useState<TagSortMode>("popular");
  const [pendingTag, setPendingTag] = useState<string | null>(null);
  const [hideRarelyUsed, setHideRarelyUsed] = useState(true);
  const visibleTags = hideRarelyUsed ? tags.filter(tag => tag.count >= 2) : tags;

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
    <Stack spacing={2}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={hideRarelyUsed}
              onChange={(e) => setHideRarelyUsed(e.target.checked)}
            />
          }
          label={<Typography variant="body2" color="text.secondary">{t("models:tags.hideRarelyUsed")}</Typography>}
        />
        <TagSortTabs value={sortMode} onChange={setSortMode} />
      </Stack>

      {visibleTags.length ? (
        <Stack direction="row" flexWrap="wrap" useFlexGap spacing={1}>
          {visibleTags.map(tag => (
            <Chip
              key={tag.name}
              size="small"
              clickable
              variant="outlined"
              onClick={() => navigate(`/models/tags/${encodeURIComponent(tag.name)}`)}
              label={`${tag.name} (${tag.count})`}
              deleteIcon={tag.bookmarked ? <BookmarkIcon fontSize="inherit" /> : <BookmarkBorderIcon fontSize="inherit" />}
              onDelete={() => void toggleBookmark(tag)}
              aria-label={tag.bookmarked ? (t("models:tags.unbookmarkTag") ?? undefined) : (t("models:tags.bookmarkTag") ?? undefined)}
              sx={{
                color: (theme) => theme.thingport.navInactiveText,
                borderColor: dividerBorderColor,
                "& .MuiChip-deleteIcon": {
                  color: tag.bookmarked ? "primary.main" : "inherit",
                  "&:hover": { color: tag.bookmarked ? "primary.main" : "inherit" },
                },
              }}
            />
          ))}
        </Stack>
      ) : (
        <Stack alignItems="center" spacing={1} sx={{ py: 8, color: "text.secondary" }}>
          <Typography variant="body2">
            {tags.length ? t("models:tags.allHidden") : t("models:tags.empty")}
          </Typography>
        </Stack>
      )}
    </Stack>
  );
}
