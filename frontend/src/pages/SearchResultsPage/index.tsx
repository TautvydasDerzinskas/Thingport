import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Divider from "@mui/material/Divider";
import { UnauthorizedError } from "../../api/client";
import { type Print, type PrintSortMode, printsApi } from "../../api/prints";
import { type PreviewMode } from "../../api/settings";
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
import { CardSkeletons } from "../../components/media/CardSkeleton";
import { cardGridSx } from "../../components/media/cardGrid";
import ModelSelectionToolbar from "../../components/modelSelection/ModelSelectionToolbar";
import { replacePrints, useModelSelection } from "../../hooks/useModelSelection";

const PAGE_SIZE = 24;
const SORT_MODES: PrintSortMode[] = ["relevance", "newest", "popular", "downloads"];

type Props = {
  theme: ResolvedTheme;
  previewMode: PreviewMode;
  onUnauthorized?: () => void;
  viewer?: AuthUser | null;
};

/** Every model matching `?q=`, where the search palette's "see all results" leads. GlobalSearch
 *  leaves `?q=` alone on this page. */
export default function SearchResultsPage({ theme, previewMode, onUnauthorized, viewer }: Props) {
  const { t } = useTranslation(["models", "app"]);
  const [searchParams, setSearchParams] = useSearchParams();
  const query = (searchParams.get("q") ?? "").trim();
  const [items, setItems] = useState<Print[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const finishedVersion = useFinishedVersion();
  const isBackgroundReload = useBackgroundReload(finishedVersion);
  // A page on its way when the list reloads belongs to the old list, and is dropped.
  const listRun = useRef(0);
  const selection = useModelSelection(items);
  const sortModeParam = searchParams.get("orderBy");
  const sortMode: PrintSortMode =
    sortModeParam === "newest" || sortModeParam === "popular" || sortModeParam === "downloads"
      ? sortModeParam
      : "relevance";

  const filters = useModelFilters();
  const { generative, hiddenProviders } = filters;
  const sources = useLibrarySources(null);

  const setSortMode = (mode: PrintSortMode) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (mode === "relevance") next.delete("orderBy");
      else next.set("orderBy", mode);
      return next;
    });
  };

  usePageHeader({
    title: query ? t("app:search.resultsTitle", { query }) : undefined,
    subtitle: query ? t("app:search.resultsSubtitle") : undefined,
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
    const background = isBackgroundReload();
    listRun.current += 1;
    if (!query) {
      setItems([]);
      setHasMore(false);
      setLoading(false);
      return;
    }
    let cancelled = false;
    if (!background) setLoading(true);
    (async () => {
      try {
        const result = await printsApi.list({
          q: query,
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
  }, [query, sortMode, generative, hiddenProviders, finishedVersion]);

  const loadMore = async () => {
    if (loadingMore || !hasMore || !query) return;
    const run = listRun.current;
    setLoadingMore(true);
    try {
      const result = await printsApi.list({
        q: query,
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
          <SortTabs value={sortMode} modes={SORT_MODES} onChange={setSortMode} />
          <Divider orientation="vertical" flexItem sx={{ my: 0.5 }} />
          <ModelFiltersButton filters={filters} sources={sources} />
        </Box>
      </Box>
      {items.length ? (
        <Stack spacing={2}>
          <Box sx={cardGridSx(6)}>
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
          {query && filters.active ? (
            <FiltersEmptyNote filters={filters} />
          ) : (
            <Typography variant="body2">
              {query ? t("app:search.noResults", { query }) : t("app:search.keepTyping")}
            </Typography>
          )}
        </Stack>
      )}
    </Stack>
  );
}
