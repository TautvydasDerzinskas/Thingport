import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Divider from "@mui/material/Divider";
import { UnauthorizedError } from "../../api/client";
import { type Print, type PrintSortMode, printsApi } from "../../api/prints";
import { type Collection, collectionsApi } from "../../api/collections";
import { type PreviewMode } from "../../api/settings";
import { tagsApi } from "../../api/tags";
import type { AuthUser } from "../../api/auth";
import { type ResolvedTheme } from "../../constants/settingsOptions";
import { usePageHeader } from "../../components/Layout/PageHeaderContext";
import { useFinishedVersion } from "../../components/importQueue/ImportQueueContext";
import { keepLoaded, useBackgroundReload } from "../../hooks/useBackgroundReload";
import { useInfiniteScroll } from "../../hooks/useInfiniteScroll";
import { useLibrarySources, useModelFilters } from "../../hooks/useModelFilters";
import ModelCard from "../ModelsPage/ModelCard";
import SortTabs from "../ModelsPage/SortTabs";
import ModelFiltersButton from "../../components/ModelFilters/ModelFiltersButton";
import FiltersEmptyNote from "../../components/ModelFilters/FiltersEmptyNote";
import CollectionCard from "../CollectionsPage/CollectionCard";
import TagBookmarkButton from "./TagBookmarkButton";
import TagActionsMenu from "./TagActionsMenu";
import { CardSkeletons } from "../../components/media/CardSkeleton";
import { cardGridSx } from "../../components/media/cardGrid";
import ModelSelectionToolbar from "../../components/modelSelection/ModelSelectionToolbar";
import { replacePrints, useModelSelection } from "../../hooks/useModelSelection";

const PAGE_SIZE = 24;

type Props = {
  theme: ResolvedTheme;
  previewMode: PreviewMode;
  onUnauthorized?: () => void;
  onBookmarksChanged?: () => void;
  viewer?: AuthUser | null;
};

/** Prints with this tag, preceded by collections carrying it. */
export default function TagDetailPage({ theme, previewMode, onUnauthorized, onBookmarksChanged, viewer }: Props) {
  const { tagName } = useParams<{ tagName: string }>();
  const tag = tagName ? decodeURIComponent(tagName) : "";
  const { t } = useTranslation(["models", "common"]);
  const [items, setItems] = useState<Print[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [bookmarked, setBookmarked] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const finishedVersion = useFinishedVersion();
  const isBackgroundReload = useBackgroundReload(finishedVersion);
  // A page on its way when the list reloads belongs to the old list, and is dropped.
  const listRun = useRef(0);
  const selection = useModelSelection(items);
  const [searchParams, setSearchParams] = useSearchParams();
  const sortModeParam = searchParams.get("orderBy");
  const sortMode: PrintSortMode =
    sortModeParam === "popular" || sortModeParam === "downloads" ? sortModeParam : "newest";

  const filters = useModelFilters();
  const { generative, hiddenProviders } = filters;
  const sources = useLibrarySources(null);

  const setSortMode = (mode: PrintSortMode) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (mode === "newest") next.delete("orderBy");
      else next.set("orderBy", mode);
      return next;
    });
  };

  const navigate = useNavigate();
  usePageHeader({
    title: tag ? t("models:tags.detail.title", { name: tag }) : undefined,
    subtitle: tag ? t("models:tags.detail.subtitle") : undefined,
    actions: tag ? (
      <Stack direction="row" alignItems="center" spacing={0.5}>
        <TagBookmarkButton
          tag={tag}
          bookmarked={bookmarked}
          onUnauthorized={onUnauthorized}
          onBookmarksChanged={onBookmarksChanged}
        />
        <TagActionsMenu
          tag={tag}
          onUnauthorized={onUnauthorized}
          onDeleted={() => {
            onBookmarksChanged?.();
            navigate("/models/tags");
          }}
        />
      </Stack>
    ) : undefined,
  });

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
    if (!tag) return;
    let cancelled = false;
    listRun.current += 1;
    const background = isBackgroundReload();
    if (!background) setLoading(true);
    (async () => {
      try {
        const result = await printsApi.list({
          tags: [tag],
          generative: generative || undefined,
          hide_providers: hiddenProviders,
          order_by: sortMode,
          limit: background ? keepLoaded(PAGE_SIZE, offset) : PAGE_SIZE,
          offset: 0,
        });
        if (cancelled) return;
        setItems(result.items);
        setOffset(result.items.length);
        setHasMore(result.hasMore);
      } catch (err) {
        if (cancelled) return;
        handleError(err, background ? undefined : t("models:errors.loadFailed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tag, sortMode, generative, hiddenProviders, finishedVersion]);

  useEffect(() => {
    if (!tag) return;
    let cancelled = false;
    (async () => {
      try {
        const bookmarks = await tagsApi.listBookmarked();
        if (!cancelled) setBookmarked(bookmarks.includes(tag));
      } catch (err) {
        if (!cancelled) handleError(err);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tag]);

  // Collections aren't paginated or tag-filterable server-side, so filter here.
  useEffect(() => {
    if (!tag) return;
    let cancelled = false;
    (async () => {
      try {
        const all = await collectionsApi.list();
        if (cancelled) return;
        const tagLower = tag.toLowerCase();
        setCollections(all.filter((c) => c.tags.some((ct) => ct.toLowerCase() === tagLower)));
      } catch (err) {
        if (cancelled) return;
        handleError(err, t("models:errors.loadFailed"));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tag]);

  const loadMore = async () => {
    if (loadingMore || !hasMore || !tag) return;
    const run = listRun.current;
    setLoadingMore(true);
    try {
      const result = await printsApi.list({
        tags: [tag],
        generative: generative || undefined,
        hide_providers: hiddenProviders,
        order_by: sortMode,
        limit: PAGE_SIZE,
        offset,
      });
      if (run !== listRun.current) return;
      setItems((prev) => [...prev, ...result.items]);
      setOffset(offset + result.items.length);
      setHasMore(result.hasMore);
    } catch (err) {
      handleError(err, t("models:errors.loadFailed"));
    } finally {
      setLoadingMore(false);
    }
  };

  const loadMoreSentinelRef = useInfiniteScroll(loadMore, hasMore, loading || loadingMore);

  if (loading) {
    return (
      <Box sx={{ maxWidth: "1920px", mx: "auto", pt: 7 }}>
        <Box sx={cardGridSx(6)}>
          <CardSkeletons count={12} />
        </Box>
      </Box>
    );
  }

  return (
    <Stack spacing={2} sx={{ maxWidth: "1920px", mx: "auto" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
        <ModelSelectionToolbar
          selection={selection}
          total={items.length}
          hasMore={hasMore}
          onDeleted={(ids) => setItems((prev) => prev.filter((i) => !ids.includes(i.id)))}
          onUpdated={(updated) => setItems((prev) => replacePrints(prev, updated))}
          onUnauthorized={onUnauthorized}
        />
        <Box sx={{ ml: "auto", display: "flex", alignItems: "center", gap: 1.5 }}>
          <SortTabs value={sortMode} onChange={setSortMode} />
          <Divider orientation="vertical" flexItem sx={{ my: 0.5 }} />
          <ModelFiltersButton filters={filters} sources={sources} />
        </Box>
      </Box>
      {collections.length || items.length ? (
        <Stack spacing={2}>
          <Box sx={cardGridSx(6)}>
            {collections.map((collection) => (
              // Only models are selectable; the collections step back while select mode is on.
              <Box
                key={collection.id}
                // inert also keeps keyboard focus out; React 18 only passes it through as a string.
                {...(selection.active && { inert: "" })}
                sx={{
                  minWidth: 0,
                  opacity: selection.active ? 0.35 : 1,
                  transition: "opacity .2s ease",
                  "@media (prefers-reduced-motion: reduce)": { transition: "none" },
                }}
              >
                <CollectionCard
                  collection={collection}
                  theme={theme}
                  previewMode={previewMode}
                  onUpdated={(updated) =>
                    setCollections((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
                  }
                  onDeleted={(deletedId) => setCollections((prev) => prev.filter((c) => c.id !== deletedId))}
                  onUnauthorized={onUnauthorized}
                  onBookmarksChanged={onBookmarksChanged}
                />
              </Box>
            ))}
            {items.map((item) => (
              <ModelCard
                key={item.id}
                item={item}
                theme={theme}
                previewMode={previewMode}
                onDeleted={(deletedId) => setItems((prev) => prev.filter((i) => i.id !== deletedId))}
                onFavoriteChange={(updated) => setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)))}
                onUpdated={(updated) => setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)))}
                onUnauthorized={onUnauthorized}
                viewer={viewer}
                selectMode={selection.active}
                selected={selection.isSelected(item.id)}
                onToggleSelect={(range) => selection.toggle(item.id, range)}
              />
            ))}
            {loadingMore && <CardSkeletons count={6} />}
          </Box>
          {hasMore && <Box ref={loadMoreSentinelRef} sx={{ height: 1 }} />}
        </Stack>
      ) : (
        <Stack alignItems="center" spacing={1} sx={{ py: 8, color: "text.secondary" }}>
          {filters.active ? (
            <FiltersEmptyNote filters={filters} />
          ) : (
            <Typography variant="body2">{t("models:tags.detail.empty")}</Typography>
          )}
        </Stack>
      )}
    </Stack>
  );
}
