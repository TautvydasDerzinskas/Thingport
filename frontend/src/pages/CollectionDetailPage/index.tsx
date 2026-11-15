import { useEffect, useRef, useState } from "react";
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
import { useRememberedList } from "../../hooks/useRememberedList";
import { useLibrarySources, useModelFilters } from "../../hooks/useModelFilters";
import { collectionDisplayName } from "../../utils/collectionDisplay";
import ModelCard from "../ModelsPage/ModelCard";
import SortTabs from "../ModelsPage/SortTabs";
import ModelFiltersButton from "../../components/ModelFilters/ModelFiltersButton";
import FiltersEmptyNote from "../../components/ModelFilters/FiltersEmptyNote";
import CollectionActionsMenu, { type CollectionActionsHandle } from "./CollectionActionsMenu";
import SharedWithChip from "./SharedWithChip";
import { useSocialStatus } from "../../hooks/useSocialStatus";
import CollectionBookmarkButton from "./CollectionBookmarkButton";
import CollectionSyncDialog from "./CollectionSyncDialog";
import SharedCollectionActions from "./SharedCollectionActions";
import CollectionSyncIndicator from "../../components/CollectionSyncIndicator";
import InfoBanner from "../../components/InfoBanner";
import { CardSkeletons } from "../../components/media/CardSkeleton";
import { cardGridSx } from "../../components/media/cardGrid";
import ModelSelectionToolbar from "../../components/modelSelection/ModelSelectionToolbar";
import { replacePrints, useModelSelection } from "../../hooks/useModelSelection";
import { useFinishedVersion } from "../../components/importQueue/ImportQueueContext";
import { keepLoaded, useBackgroundReload } from "../../hooks/useBackgroundReload";

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
  const { items, setItems, hasMore, setHasMore, loading, setLoading, returning, restored } = useRememberedList<
    Print,
    Collection | null
  >({ loadingAtFirst: true, alongside: (): Collection | null => collection });
  const [collection, setCollection] = useState<Collection | null>(restored ?? null);
  const [syncOpen, setSyncOpen] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offset, setOffset] = useState(items.length);
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
  const { generative, hiddenProviders, licenseAllows, licensed } = filters;
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
  // Another user's public collection: theirs to change. Its models can be opened, downloaded and filed into the
  // user's own collections, which copies them.
  const owner = collection?.owner ?? null;
  const menuRef = useRef<CollectionActionsHandle>(null);
  const socialOn = useSocialStatus()?.enabled === true;
  // Who sees the user's own shared one, beside its menu.
  const sharedWith =
    socialOn && collection && !owner && collection.visibility === "shared" ? (collection.shared_with ?? null) : null;
  const ownCollectionId =
    collection && !collection.system_key && !collection.tool_id && !owner ? collection.id : undefined;

  usePageHeader({
    title: collection
      ? t("models:collections.detail.title", { name: collectionDisplayName(collection, t) })
      : undefined,
    subtitle: collection
      ? owner
        ? t("models:shared.collectionSubtitle", { name: owner.display_name })
        : t("models:collections.detail.subtitle")
      : undefined,
    actions:
      collection && owner ? (
        <SharedCollectionActions collection={collection} owner={owner} onUnauthorized={onUnauthorized} />
      ) : collection && !collection.system_key ? (
        <Stack direction="row" alignItems="center" spacing={0.5}>
          {sharedWith && !collection.tool_id && (
            <SharedWithChip sharedWith={sharedWith} onClick={() => menuRef.current?.openShare()} />
          )}
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
              ref={menuRef}
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
    listRun.current += 1;
    // Back to this list puts it back as it was left, then checks it quietly, like a reload nobody asked for.
    const kept = returning();
    if (kept !== null) setOffset(kept);
    const background = isBackgroundReload() || kept !== null;
    if (!background) {
      setLoading(true);
      setNotFound(false);
    }
    (async () => {
      try {
        const [collectionResult, printsResult] = await Promise.all([
          collectionsApi.get(collectionId),
          printsApi.list({
            collection_id: collectionId,
            generative: generative || undefined,
            hide_providers: hiddenProviders,
            license_allows: licenseAllows,
            licensed: licensed || undefined,
            order_by: sortMode,
            limit: background ? keepLoaded(PAGE_SIZE, kept ?? offset) : PAGE_SIZE,
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
        if (handleError(err) || background) return;
        setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionId, sortMode, generative, hiddenProviders, licenseAllows, licensed, finishedVersion]);

  const loadMore = async () => {
    if (loadingMore || !hasMore || !collectionId) return;
    const run = listRun.current;
    setLoadingMore(true);
    try {
      const result = await printsApi.list({
        collection_id: collectionId,
        generative: generative || undefined,
        hide_providers: hiddenProviders,
        license_allows: licenseAllows,
        licensed: licensed || undefined,
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
        {collection.syncs.length > 0 && (
          <CollectionSyncIndicator syncs={collection.syncs} onClick={() => setSyncOpen(true)} />
        )}
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
          collectionId={ownCollectionId}
          toolOwned={Boolean(collection.tool_id)}
          shared={Boolean(owner)}
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
      {syncOpen && collection.syncs.length > 0 && (
        <CollectionSyncDialog
          collection={collection}
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
                collectionId={ownCollectionId}
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
