import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import { UnauthorizedError } from "../../api/client";
import { type Collection, collectionsApi } from "../../api/collections";
import { type Print, type PrintSortMode, printsApi } from "../../api/prints";
import { type PreviewMode } from "../../api/settings";
import type { AuthUser } from "../../api/auth";
import { type ResolvedTheme } from "../../constants/settingsOptions";
import { usePageHeader } from "../../components/Layout/PageHeaderContext";
import { useInfiniteScroll } from "../../hooks/useInfiniteScroll";
import { collectionDisplayName } from "../../utils/collectionDisplay";
import ModelCard from "../ModelsPage/ModelCard";
import SortTabs from "../ModelsPage/SortTabs";
import CollectionActionsMenu from "./CollectionActionsMenu";
import CollectionBookmarkButton from "./CollectionBookmarkButton";

const PAGE_SIZE = 24;

type Props = {
  theme: ResolvedTheme;
  previewMode: PreviewMode;
  onUnauthorized?: () => void;
  onBookmarksChanged?: () => void;
  viewer?: AuthUser | null;
};

export default function CollectionDetailPage({ theme, previewMode, onUnauthorized, onBookmarksChanged, viewer }: Props) {
  const { collectionId } = useParams<{ collectionId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation(["models", "common"]);
  const [collection, setCollection] = useState<Collection | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [items, setItems] = useState<Print[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const sortModeParam = searchParams.get("orderBy");
  const sortMode: PrintSortMode = sortModeParam === "popular" || sortModeParam === "downloads" ? sortModeParam : "newest";

  const setSortMode = (mode: PrintSortMode) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (mode === "newest") next.delete("orderBy");
      else next.set("orderBy", mode);
      return next;
    });
  };

  const goBack = () => navigate("/models/collections");

  usePageHeader({
    title: collection ? t("models:collections.detail.title", { name: collectionDisplayName(collection, t) }) : undefined,
    subtitle: collection ? t("models:collections.detail.subtitle") : undefined,
    actions: collection && !collection.system_key ? (
      <Stack direction="row" alignItems="center" spacing={0.5}>
        <CollectionBookmarkButton
          collectionId={collection.id}
          bookmarked={collection.bookmarked}
          onUnauthorized={onUnauthorized}
          onBookmarksChanged={onBookmarksChanged}
          onToggled={bookmarked => setCollection(prev => (prev ? { ...prev, bookmarked } : prev))}
        />
        <CollectionActionsMenu
          collection={collection}
          onUpdated={setCollection}
          onUnauthorized={onUnauthorized}
          onDeleted={goBack}
          onBookmarksChanged={onBookmarksChanged}
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
    if (!collectionId) return;
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    (async () => {
      try {
        const [collectionResult, printsResult] = await Promise.all([
          collectionsApi.get(collectionId),
          printsApi.list({ collection_id: collectionId, order_by: sortMode, limit: PAGE_SIZE, offset: 0 }),
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
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionId, sortMode]);

  const loadMore = async () => {
    if (loadingMore || !hasMore || !collectionId) return;
    setLoadingMore(true);
    try {
      const result = await printsApi.list({ collection_id: collectionId, order_by: sortMode, limit: PAGE_SIZE, offset });
      setItems(prev => [...prev, ...result.items]);
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
      <Stack alignItems="center" sx={{ py: 8 }}>
        <CircularProgress size={22} />
      </Stack>
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
      {collection.description && (
        <Typography variant="body2" color="text.secondary">{collection.description}</Typography>
      )}
      <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
        <SortTabs value={sortMode} onChange={setSortMode} />
      </Box>
      {items.length ? (
        <Stack spacing={2}>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "repeat(6, 1fr)",
              columnGap: "20px",
              rowGap: "20px",
              "@media (max-width: 1979px)": { gridTemplateColumns: "repeat(6, 1fr)" },
              "@media (max-width: 1684px)": { gridTemplateColumns: "repeat(5, 1fr)" },
              "@media (max-width: 1404px)": { gridTemplateColumns: "repeat(4, 1fr)" },
              "@media (max-width: 1124px)": { gridTemplateColumns: "repeat(3, 1fr)" },
              "@media (max-width: 860px)": { gridTemplateColumns: "repeat(2, 1fr)" },
            }}
          >
            {items.map(item => (
              <ModelCard
                key={item.id}
                item={item}
                theme={theme}
                previewMode={previewMode}
                onDeleted={deletedId => setItems(prev => prev.filter(i => i.id !== deletedId))}
                onFavoriteChange={updated =>
                  setItems(prev =>
                    // Viewing the built-in Favourites collection itself: unfavoriting an item here
                    // should drop it from view immediately, same as any other removal, instead of
                    // leaving a now-stale entry until the next full reload.
                    collection?.system_key === "favorites" && !updated.is_favorite
                      ? prev.filter(i => i.id !== updated.id)
                      : prev.map(i => (i.id === updated.id ? updated : i)),
                  )
                }
                collectionId={collection && !collection.system_key ? collection.id : undefined}
                onRemovedFromCollection={removedId => setItems(prev => prev.filter(i => i.id !== removedId))}
                onUpdated={updated => setItems(prev => prev.map(i => (i.id === updated.id ? updated : i)))}
                onUnauthorized={onUnauthorized}
                viewer={viewer}
              />
            ))}
          </Box>
          {hasMore && (
            <Stack ref={loadMoreSentinelRef} direction="row" justifyContent="center" sx={{ py: 1 }}>
              {loadingMore && (
                <Stack direction="row" alignItems="center" spacing={1} sx={{ color: "text.secondary" }}>
                  <CircularProgress size={14} />
                  <Typography variant="caption">{t("models:grid.loadingMore")}</Typography>
                </Stack>
              )}
            </Stack>
          )}
        </Stack>
      ) : (
        <Stack alignItems="center" spacing={1} sx={{ py: 8, color: "text.secondary" }}>
          <Typography variant="body2">{t("models:collections.detail.empty")}</Typography>
        </Stack>
      )}
    </Stack>
  );
}
