import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Divider from "@mui/material/Divider";
import { UnauthorizedError } from "../../api/client";
import { type Collection, collectionsApi } from "../../api/collections";
import { type Print, type PrintSortMode, printsApi } from "../../api/prints";
import { type PreviewMode } from "../../api/settings";
import type { AuthUser } from "../../api/auth";
import { type ResolvedTheme } from "../../constants/settingsOptions";
import { usePageHeader } from "../../components/Layout/PageHeaderContext";
import { useInfiniteScroll } from "../../hooks/useInfiniteScroll";
import { useLibrarySources, useModelFilters } from "../../hooks/useModelFilters";
import { collectionDisplayName } from "../../utils/collectionDisplay";
import ModelCard from "../ModelsPage/ModelCard";
import SortTabs from "../ModelsPage/SortTabs";
import ModelFiltersButton from "../../components/ModelFilters/ModelFiltersButton";
import FiltersEmptyNote from "../../components/ModelFilters/FiltersEmptyNote";
import CollectionActionsMenu from "./CollectionActionsMenu";
import CollectionBookmarkButton from "./CollectionBookmarkButton";
import CollectionSyncDialog from "./CollectionSyncDialog";
import CollectionSyncIndicator from "../../components/CollectionSyncIndicator";
import InfoBanner from "../../components/InfoBanner";
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

export default function CollectionDetailPage({
  theme,
  previewMode,
  onUnauthorized,
  onBookmarksChanged,
  viewer,
}: Props) {
  const { collectionId } = useParams<{ collectionId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation(["models", "common"]);
  const [collection, setCollection] = useState<Collection | null>(null);
  const [syncOpen, setSyncOpen] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [items, setItems] = useState<Print[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
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

  const goBack = () => navigate("/models/collections");

  usePageHeader({
    title: collection
      ? t("models:collections.detail.title", { name: collectionDisplayName(collection, t) })
      : undefined,
    subtitle: collection ? t("models:collections.detail.subtitle") : undefined,
    actions:
      collection && !collection.system_key ? (
        <Stack direction="row" alignItems="center" spacing={0.5}>
          <CollectionBookmarkButton
            collectionId={collection.id}
            bookmarked={collection.bookmarked}
            onUnauthorized={onUnauthorized}
            onBookmarksChanged={onBookmarksChanged}
            onToggled={(bookmarked) => setCollection((prev) => (prev ? { ...prev, bookmarked } : prev))}
          />
          {/* A tool's collection can be bookmarked, nothing more. */}
          {!collection.tool_id && (
            <CollectionActionsMenu
              collection={collection}
              onUpdated={setCollection}
              onUnauthorized={onUnauthorized}
              onDeleted={goBack}
              onBookmarksChanged={onBookmarksChanged}
            />
          )}
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
    if (!collectionId) return;
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    (async () => {
      try {
        const [collectionResult, printsResult] = await Promise.all([
          collectionsApi.get(collectionId),
          printsApi.list({
            collection_id: collectionId,
            generative: generative || undefined,
            hide_providers: hiddenProviders,
            order_by: sortMode,
            limit: PAGE_SIZE,
            offset: 0,
          }),
        ]);
        if (cancelled) return;
        setCollection(collectionResult);
        setItems(printsResult.items);
        setOffset(printsResult.items.length);
        setHasMore(printsResult.hasMore);
      } catch (err) {
        if (cancelled) return;
        if (handleError(err)) return;
        setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionId, sortMode, generative, hiddenProviders]);

  const loadMore = async () => {
    if (loadingMore || !hasMore || !collectionId) return;
    setLoadingMore(true);
    try {
      const result = await printsApi.list({
        collection_id: collectionId,
        generative: generative || undefined,
        hide_providers: hiddenProviders,
        order_by: sortMode,
        limit: PAGE_SIZE,
        offset,
      });
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

  if (notFound || !collection) {
    return (
      <Stack alignItems="center" spacing={1} sx={{ py: 8, color: "text.secondary" }}>
        <Typography variant="body2">{t("models:collections.errors.notFound")}</Typography>
      </Stack>
    );
  }

  return (
    <Stack spacing={2} sx={{ maxWidth: "1920px", mx: "auto" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
        {collection.sync && <CollectionSyncIndicator sync={collection.sync} onClick={() => setSyncOpen(true)} />}
        <ModelSelectionToolbar
          selection={selection}
          total={items.length}
          hasMore={hasMore}
          onDeleted={(ids) => setItems((prev) => prev.filter((i) => !ids.includes(i.id)))}
          onUpdated={(updated) =>
            setItems((prev) =>
              // As for one card: unfavoriting inside Favourites drops them immediately.
              collection.system_key === "favorites"
                ? replacePrints(prev, updated).filter((i) => i.is_favorite)
                : replacePrints(prev, updated),
            )
          }
          onUnauthorized={onUnauthorized}
          collectionId={collection.system_key || collection.tool_id ? undefined : collection.id}
          toolOwned={Boolean(collection.tool_id)}
          onRemovedFromCollection={(ids) => setItems((prev) => prev.filter((i) => !ids.includes(i.id)))}
        />
        <Box sx={{ ml: "auto", display: "flex", alignItems: "center", gap: 1.5 }}>
          <SortTabs value={sortMode} onChange={setSortMode} />
          <Divider orientation="vertical" flexItem sx={{ my: 0.5 }} />
          <ModelFiltersButton filters={filters} sources={sources} />
        </Box>
      </Box>
      {/* Its name is already the page's title. */}
      <InfoBanner description={collection.description} />
      {syncOpen && collection.sync && (
        <CollectionSyncDialog
          collection={{ ...collection, sync: collection.sync }}
          onClose={() => setSyncOpen(false)}
          onUpdated={setCollection}
          onUnauthorized={onUnauthorized}
        />
      )}
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
                onFavoriteChange={(updated) =>
                  setItems((prev) =>
                    // Unfavoriting inside Favourites drops the item immediately.
                    collection?.system_key === "favorites" && !updated.is_favorite
                      ? prev.filter((i) => i.id !== updated.id)
                      : prev.map((i) => (i.id === updated.id ? updated : i)),
                  )
                }
                collectionId={collection && !collection.system_key && !collection.tool_id ? collection.id : undefined}
                onRemovedFromCollection={(removedId) => setItems((prev) => prev.filter((i) => i.id !== removedId))}
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
            <Typography variant="body2">{t("models:collections.detail.empty")}</Typography>
          )}
        </Stack>
      )}
    </Stack>
  );
}
