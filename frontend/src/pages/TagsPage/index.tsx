import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Switch from "@mui/material/Switch";
import FormControlLabel from "@mui/material/FormControlLabel";
import BookmarkIcon from "@mui/icons-material/Bookmark";
import BookmarkBorderIcon from "@mui/icons-material/BookmarkBorder";
import CallMergeIcon from "@mui/icons-material/CallMerge";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import LocalOfferOutlinedIcon from "@mui/icons-material/LocalOfferOutlined";
import { UnauthorizedError } from "../../api/client";
import { printsApi } from "../../api/prints";
import { type TagSortMode, type TagSummary, tagsApi } from "../../api/tags";
import SortTabs from "../../components/controls/SortTabs";
import MergeDialog, { type MergeItem } from "../../components/MergeDialog";
import SelectionToolbar, { SelectionAction } from "../../components/selection/SelectionToolbar";
import { useConfirm } from "../../components/ConfirmProvider";
import { useToast } from "../../components/ToastProvider";
import { useSelection } from "../../hooks/useSelection";
import { colorForTag } from "../../utils/tagColors";
import TagTile, { TagTileSkeletons } from "./TagTile";
import VirtualTagGrid from "./VirtualTagGrid";
import { useInfiniteScroll } from "../../hooks/useInfiniteScroll";

type Props = {
  onUnauthorized?: () => void;
  onBookmarksChanged?: () => void;
};

/** Enough tags to fill the screen about one and a half times, so a big one is filled by its first request. */
function pageSizeForScreen(): number {
  const tile = 172; // a 160px tile and its gap
  const columns = Math.max(2, Math.floor(window.innerWidth / tile));
  const rows = Math.ceil(window.innerHeight / tile);
  return Math.min(100, Math.max(30, Math.ceil(columns * rows * 1.5)));
}

const tagKey = (tag: TagSummary) => tag.name;

type Busy = "bookmark" | "delete" | null;

/** The tag's mosaic, or its colour and icon while it has no pictures. */
function TagThumbnail({ tag }: { tag: TagSummary }) {
  const fallback = colorForTag(tag.name);
  return tag.mosaic_url ? (
    <Box
      component="img"
      src={printsApi.fileUrl(tag.mosaic_url)}
      alt=""
      sx={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }}
    />
  ) : (
    <Stack
      alignItems="center"
      justifyContent="center"
      sx={{ height: "100%", bgcolor: fallback.bg, color: fallback.text }}
    >
      <LocalOfferOutlinedIcon fontSize="small" />
    </Stack>
  );
}

const TILE_GRID = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(min(160px, calc(50% - 6px)), 1fr))",
  gap: 1.5,
} as const;

/** Every tag as a square of its models' pictures, with its count and a bookmark toggle. Rarely-used tags
 *  (under 2 models) are hidden by default. */
export default function TagsPage({ onUnauthorized, onBookmarksChanged }: Props) {
  const { t } = useTranslation(["models", "common"]);
  const confirm = useConfirm();
  const showToast = useToast();
  const [tags, setTags] = useState<TagSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [anyTags, setAnyTags] = useState(false);
  const [sortMode, setSortMode] = useState<TagSortMode>("popular");
  const [hideRarelyUsed, setHideRarelyUsed] = useState(true);
  const minCount = hideRarelyUsed ? 2 : 1;
  const [pageSize] = useState(pageSizeForScreen);
  // Bumped whenever the sort or filter changes, so a page still on its way for the old one is dropped.
  const generation = useRef(0);
  // Bumped to load the list again from the top, e.g. after a merge changed the counts.
  const [reloadKey, setReloadKey] = useState(0);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const selection = useSelection(tags, tagKey);
  const { selected } = selection;
  const count = selected.length;
  const allBookmarked = count > 0 && selected.every((tag) => tag.bookmarked);
  // A ref, so the callback the tiles get stays the same while the selection changes.
  const toggleRef = useRef(selection.toggle);
  toggleRef.current = selection.toggle;
  const onToggleSelect = useCallback((tag: TagSummary, range: boolean) => toggleRef.current(tag.name, range), []);

  const handleError = (err: unknown, message: string) => {
    if (err instanceof UnauthorizedError) {
      onUnauthorized?.();
      return;
    }
    console.error(err);
    showToast({ message: err instanceof Error && err.message ? err.message : message, severity: "error" });
  };

  useEffect(() => {
    const current = ++generation.current;
    setLoading(true);
    setTags([]);
    (async () => {
      try {
        const page = await tagsApi.listSummary({ sort: sortMode, limit: pageSize, offset: 0, minCount });
        if (current !== generation.current) return;
        setTags(page.items);
        setHasMore(page.has_more);
        setAnyTags(page.total_all > 0);
      } catch (err) {
        if (current === generation.current) handleError(err, t("models:errors.loadFailed"));
      } finally {
        if (current === generation.current) setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortMode, minCount, pageSize, reloadKey]);

  const loadMore = useCallback(async () => {
    const current = generation.current;
    setLoadingMore(true);
    try {
      const page = await tagsApi.listSummary({ sort: sortMode, limit: pageSize, offset: tags.length, minCount });
      if (current !== generation.current) return;
      setTags((prev) => [...prev, ...page.items]);
      setHasMore(page.has_more);
    } catch (err) {
      if (current === generation.current) handleError(err, t("models:errors.loadFailed"));
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortMode, minCount, pageSize, tags.length]);

  const sentinelRef = useInfiniteScroll(() => void loadMore(), hasMore, loading || loadingMore);

  // A ref, not state: the callbacks below stay the same between renders, so the memoized tiles don't redraw.
  const pendingTag = useRef<string | null>(null);
  const toggleBookmark = useCallback(async (tag: TagSummary) => {
    if (pendingTag.current) return;
    pendingTag.current = tag.name;
    const nextBookmarked = !tag.bookmarked;
    setTags((prev) => prev.map((t2) => (t2.name === tag.name ? { ...t2, bookmarked: nextBookmarked } : t2)));
    try {
      await (nextBookmarked ? tagsApi.bookmark(tag.name) : tagsApi.unbookmark(tag.name));
      onBookmarksChanged?.();
    } catch (err) {
      setTags((prev) => prev.map((t2) => (t2.name === tag.name ? { ...t2, bookmarked: tag.bookmarked } : t2)));
      if (err instanceof UnauthorizedError) {
        onUnauthorized?.();
        return;
      }
      console.error(err);
      showToast({ message: t("models:tags.bookmarkFailed"), severity: "error" });
    } finally {
      pendingTag.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const removeTag = useCallback(
    (tag: TagSummary) => {
      setTags((prev) => prev.filter((other) => other.name !== tag.name));
      if (tag.bookmarked) onBookmarksChanged?.();
    },
    [onBookmarksChanged],
  );
  const onToggleBookmark = useCallback((tag: TagSummary) => void toggleBookmark(tag), [toggleBookmark]);

  // One at a time: each new bookmark takes the next place in the list.
  const toggleBookmarks = async () => {
    const bookmark = !allBookmarked;
    setBusy("bookmark");
    try {
      for (const tag of selected) {
        if (tag.bookmarked === bookmark) continue;
        await (bookmark ? tagsApi.bookmark(tag.name) : tagsApi.unbookmark(tag.name));
        setTags((prev) => prev.map((other) => (other.name === tag.name ? { ...other, bookmarked: bookmark } : other)));
      }
      showToast({
        message: t(bookmark ? "models:tags.selection.bookmarked" : "models:tags.selection.unbookmarked", { count }),
      });
    } catch (err) {
      handleError(err, t("models:tags.bookmarkFailed"));
    } finally {
      onBookmarksChanged?.();
      setBusy(null);
    }
  };

  const removeSelected = async () => {
    const confirmed = await confirm({
      title: t("models:tags.selection.deleteTitle", { count }),
      message: t("models:tags.selection.deleteMessage", { count }),
      confirmLabel: t("models:tags.selection.deleteConfirm", { count }),
      destructive: true,
    });
    if (!confirmed) return;
    setBusy("delete");
    try {
      const { deleted } = await tagsApi.removeMany(selected.map((tag) => tag.name));
      setTags((prev) => prev.filter((tag) => !deleted.includes(tag.name)));
      if (selected.some((tag) => tag.bookmarked)) onBookmarksChanged?.();
      showToast({ message: t("models:tags.selection.deleted", { count: deleted.length }) });
    } catch (err) {
      handleError(err, t("models:tags.deleteFailed"));
    } finally {
      setBusy(null);
    }
  };

  const mergeItems: MergeItem[] = selected.map((tag) => ({
    key: tag.name,
    name: tag.name,
    count: tag.count,
    bookmarked: tag.bookmarked,
    thumbnail: <TagThumbnail tag={tag} />,
  }));

  const merge = async (primary: MergeItem, others: MergeItem[]) => {
    await tagsApi.merge(
      primary.key,
      others.map((item) => item.key),
    );
    if (others.some((item) => item.bookmarked)) onBookmarksChanged?.();
    selection.setActive(false);
    // Counts and pictures changed on the server, so the list comes again rather than being patched here.
    setReloadKey((key) => key + 1);
    showToast({
      message: t("models:tags.selection.merged", { count: others.length, name: primary.name }),
      severity: "success",
    });
  };

  const sortOptions: { value: TagSortMode; label: string }[] = [
    { value: "popular", label: t("models:sort.popular") },
    { value: "newest", label: t("models:sort.newest") },
    { value: "name", label: t("models:tags.sortByName") },
  ];
  const disabled = count === 0 || busy !== null;
  const bookmarkLabel = allBookmarked ? t("models:tags.unbookmarkTag") : t("models:tags.bookmarkTag");

  return (
    <Stack spacing={2}>
      <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 2, rowGap: 1 }}>
        <FormControlLabel
          control={
            <Switch size="small" checked={hideRarelyUsed} onChange={(e) => setHideRarelyUsed(e.target.checked)} />
          }
          label={
            <Typography variant="body2" color="text.secondary">
              {t("models:tags.hideRarelyUsed")}
            </Typography>
          }
        />
        {anyTags && (
          <SelectionToolbar
            selection={selection}
            total={tags.length}
            hasMore={hasMore}
            busy={busy !== null}
            labels={{
              enter: t("models:tags.selection.enter"),
              exit: t("models:selection.exit"),
              toolbar: t("models:tags.selection.toolbar"),
              selectAllLoaded: t("models:tags.selection.selectAllLoaded"),
            }}
            dialogs={
              <MergeDialog
                open={mergeOpen}
                onClose={() => setMergeOpen(false)}
                kind="tag"
                items={mergeItems}
                loadPreview={() => tagsApi.previewMerge(mergeItems.map((item) => item.key))}
                onMerge={merge}
                onUnauthorized={onUnauthorized}
              />
            }
          >
            <SelectionAction
              label={t("models:merge.action")}
              hint={t("models:merge.needTwo")}
              icon={<CallMergeIcon fontSize="small" />}
              disabled={count < 2 || busy !== null}
              onClick={() => setMergeOpen(true)}
            />
            <SelectionAction
              label={bookmarkLabel}
              icon={
                busy === "bookmark" ? (
                  <CircularProgress size={18} />
                ) : allBookmarked ? (
                  <BookmarkIcon fontSize="small" color="primary" />
                ) : (
                  <BookmarkBorderIcon fontSize="small" />
                )
              }
              disabled={disabled}
              onClick={() => void toggleBookmarks()}
            />
            <SelectionAction
              label={t("common:delete")}
              icon={
                busy === "delete" ? (
                  <CircularProgress size={18} />
                ) : (
                  <DeleteOutlineIcon fontSize="small" color={disabled ? undefined : "error"} />
                )
              }
              disabled={disabled}
              onClick={() => void removeSelected()}
            />
          </SelectionToolbar>
        )}
        <Box sx={{ ml: "auto" }}>
          <SortTabs value={sortMode} options={sortOptions} onChange={setSortMode} />
        </Box>
      </Box>

      {loading ? (
        <Box sx={TILE_GRID}>
          <TagTileSkeletons count={12} />
        </Box>
      ) : tags.length ? (
        <>
          <VirtualTagGrid
            tags={tags}
            skeletons={loadingMore ? 6 : 0}
            renderTile={(tag) => (
              <TagTile
                key={tag.name}
                tag={tag}
                onToggleBookmark={onToggleBookmark}
                onUnauthorized={onUnauthorized}
                onDeleted={removeTag}
                selectMode={selection.active}
                selected={selection.isSelected(tag.name)}
                onToggleSelect={onToggleSelect}
              />
            )}
          />
          {hasMore && <Box ref={sentinelRef} sx={{ height: 1 }} />}
        </>
      ) : (
        <Stack alignItems="center" spacing={1} sx={{ py: 8, color: "text.secondary" }}>
          <Typography variant="body2">{anyTags ? t("models:tags.allHidden") : t("models:tags.empty")}</Typography>
        </Stack>
      )}
    </Stack>
  );
}
