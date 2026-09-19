import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams, useSearchParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import { UnauthorizedError } from "../../api/client";
import { type Print, type PrintSortMode, printsApi } from "../../api/prints";
import { type Collection, collectionsApi } from "../../api/collections";
import { type PreviewMode } from "../../api/settings";
import { tagsApi } from "../../api/tags";
import type { AuthUser } from "../../api/auth";
import { type ResolvedTheme } from "../../constants/settingsOptions";
import { usePageHeader } from "../../components/Layout/PageHeaderContext";
import { useInfiniteScroll } from "../../hooks/useInfiniteScroll";
import ModelCard from "../ModelsPage/ModelCard";
import SortTabs from "../ModelsPage/SortTabs";
import CollectionCard from "../CollectionsPage/CollectionCard";
import TagBookmarkButton from "./TagBookmarkButton";
import TagActionsMenu from "./TagActionsMenu";

const PAGE_SIZE = 24;

type Props = {
  theme: ResolvedTheme;
  previewMode: PreviewMode;
  onUnauthorized?: () => void;
  onBookmarksChanged?: () => void;
  viewer?: AuthUser | null;
};

/** Same list/grid/sort/infinite-scroll shape as CollectionDetailPage, but for a tag: tags aren't
 *  entities with their own id/description, just a string carried in the URL, so there's no
 *  fetch-by-id step (or "not found" state) -- the page header title comes directly from the
 *  route param and the list is prints filtered by that tag, plus (since collections can carry
 *  tags too) any collections carrying it, shown first in the same grid as CollectionCards. The
 *  title row has a bookmark toggle (TagBookmarkButton) plus a "..." menu (TagActionsMenu, so far
 *  just "Download all Tag models as zip") -- same two-control layout as CollectionDetailPage's
 *  own title row. */
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

  usePageHeader({
    title: tag ? t("models:tags.detail.title", { name: tag }) : undefined,
    actions: tag ? (
      <Stack direction="row" alignItems="center" spacing={0.5}>
        <TagBookmarkButton
          tag={tag}
          bookmarked={bookmarked}
          onUnauthorized={onUnauthorized}
          onBookmarksChanged={onBookmarksChanged}
        />
        <TagActionsMenu tag={tag} onUnauthorized={onUnauthorized} />
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
    setLoading(true);
    (async () => {
      try {
        const result = await printsApi.list({ tags: [tag], order_by: sortMode, limit: PAGE_SIZE, offset: 0 });
        if (cancelled) return;
        setItems(result.items);
        setOffset(result.items.length);
        setHasMore(result.hasMore);
      } catch (err) {
        if (cancelled) return;
        handleError(err, t("models:errors.loadFailed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tag, sortMode]);

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
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tag]);

  // Collections list has no server-side tag filter (and isn't paginated -- CollectionsPage
  // fetches all of them too), so this filters client-side and refetches only on tag change, not
  // sortMode -- collections here aren't sorted, just shown ahead of the prints grid.
  useEffect(() => {
    if (!tag) return;
    let cancelled = false;
    (async () => {
      try {
        const all = await collectionsApi.list();
        if (cancelled) return;
        const tagLower = tag.toLowerCase();
        setCollections(all.filter(c => c.tags.some(ct => ct.toLowerCase() === tagLower)));
      } catch (err) {
        if (cancelled) return;
        handleError(err, t("models:errors.loadFailed"));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tag]);

  const loadMore = async () => {
    if (loadingMore || !hasMore || !tag) return;
    setLoadingMore(true);
    try {
      const result = await printsApi.list({ tags: [tag], order_by: sortMode, limit: PAGE_SIZE, offset });
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

  return (
    <Stack spacing={2} sx={{ maxWidth: "1920px", mx: "auto" }}>
      <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
        <SortTabs value={sortMode} onChange={setSortMode} />
      </Box>
      {collections.length || items.length ? (
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
            {collections.map(collection => (
              <CollectionCard
                key={collection.id}
                collection={collection}
                theme={theme}
                previewMode={previewMode}
                onUpdated={updated => setCollections(prev => prev.map(c => (c.id === updated.id ? updated : c)))}
                onDeleted={deletedId => setCollections(prev => prev.filter(c => c.id !== deletedId))}
                onUnauthorized={onUnauthorized}
                onBookmarksChanged={onBookmarksChanged}
              />
            ))}
            {items.map(item => (
              <ModelCard
                key={item.id}
                item={item}
                theme={theme}
                previewMode={previewMode}
                onDeleted={deletedId => setItems(prev => prev.filter(i => i.id !== deletedId))}
                onFavoriteChange={updated => setItems(prev => prev.map(i => (i.id === updated.id ? updated : i)))}
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
          <Typography variant="body2">{t("models:tags.detail.empty")}</Typography>
        </Stack>
      )}
    </Stack>
  );
}
