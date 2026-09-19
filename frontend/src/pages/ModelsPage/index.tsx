import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import { UnauthorizedError } from "../../api/client";
import { type Print, type PrintSortMode, printsApi } from "../../api/prints";
import { type Category, type CategoryMetaInput, categoriesApi } from "../../api/categories";
import { type PreviewMode } from "../../api/settings";
import type { AuthUser } from "../../api/auth";
import { type ResolvedTheme } from "../../constants/settingsOptions";
import { usePageHeader } from "../../components/Layout/PageHeaderContext";
import { useInfiniteScroll } from "../../hooks/useInfiniteScroll";
import CategoriesPanel from "./CategoriesPanel";
import CategoryBanner from "./CategoryBanner";
import ModelCard from "./ModelCard";
import SortTabs from "./SortTabs";

const PAGE_SIZE = 24;

type Props = {
  categoryId: string | null;
  onSelectCategory: (id: string | null) => void;
  categoriesVersion: number;
  onCategoriesChanged: () => void;
  /** Bumped whenever prints change elsewhere (e.g. the top bar's upload/import) so the grid
   *  refetches without needing a full remount -- keeps this page's own state (like the category
   *  manager modal) intact across those refreshes. */
  printsVersion: number;
  onUnauthorized?: () => void;
  theme: ResolvedTheme;
  previewMode: PreviewMode;
  viewer?: AuthUser | null;
};

export default function ModelsPage({ categoryId, onSelectCategory, categoriesVersion, onCategoriesChanged, printsVersion, onUnauthorized, theme, previewMode, viewer }: Props) {
  const { t } = useTranslation(["models", "common"]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [items, setItems] = useState<Print[]>([]);
  const [loading, setLoading] = useState(false);
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

  // Keeps the selected category mirrored into ?category=<id> so the URL is copy-able/bookmarkable
  // and a reload lands back on the same filtered view, while categoryId itself stays lifted to
  // AppShell (it also needs to survive navigating away to a model and back).
  //
  // Two effects, one per direction -- but whenever categoryId and the URL start a render already
  // disagreeing (a cold load of ?category=X while categoryId still defaults to null, or a browser
  // back/forward that changes the URL out from under an unrelated categoryId), BOTH used to fire
  // in that same commit, each reading the OTHER's still-stale value: the URL->state effect would
  // schedule categoryId to catch up to the URL, while the state->URL effect -- seeing that same
  // stale categoryId one commit longer -- would shove the URL back to match it, undoing the first
  // effect's work. That handoff repeated every render, each one node lagging the other by exactly
  // one step, which is the flicker. `syncingFromUrlRef` marks a categoryId change as having
  // originated from the URL (not a user click), so the state->URL effect knows to skip pushing it
  // right back.
  const categoryParam = searchParams.get("category");
  const syncingFromUrlRef = useRef(false);

  // URL -> state: adopts ?category on first load and on any navigation that changes it externally
  // (browser back/forward, a pasted link).
  useEffect(() => {
    if (categoryParam !== categoryId) {
      syncingFromUrlRef.current = true;
      onSelectCategory(categoryParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryParam]);

  // state -> URL: covers every other way categoryId can change -- clicking a category, or it being
  // cleared out from under the user (e.g. deleteCategory below clearing the active selection).
  useEffect(() => {
    if (syncingFromUrlRef.current) {
      syncingFromUrlRef.current = false;
      return;
    }
    if ((searchParams.get("category") || null) === categoryId) return;
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (categoryId) next.set("category", categoryId);
      else next.delete("category");
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId]);

  // A root category has no models of its own directly in the tree UI, so selecting one should
  // pull in every model filed under any of its subcategories (plus the root itself, since prints
  // can technically still be filed directly on it).
  const categoryIdFilter = useMemo(() => {
    if (!categoryId) return undefined;
    const isRoot = categories.some(f => f.id === categoryId && !f.parent_id);
    if (!isRoot) return categoryId;
    const childIds = categories.filter(f => f.parent_id === categoryId).map(f => f.id);
    return [categoryId, ...childIds];
  }, [categoryId, categories]);

  // Plain "Models" (and the route's default back-to-Dashboard) while nothing's selected; once a
  // category is active, the title becomes its name (with a small "Category" subtitle underneath
  // instead of a "Models - " prefix competing with the name for the same line's width -- same
  // treatment as the collection/tag/model detail pages' own subtitles) and back instead clears
  // the filter -- "back to all" one level at a time, matching the sidebar's own
  // initial-vs-filtered framing.
  const selectedCategory = categoryId ? categories.find(f => f.id === categoryId) ?? null : null;
  usePageHeader({
    title: selectedCategory ? selectedCategory.name || t("models:categories.untitled") : undefined,
    subtitle: selectedCategory ? t("models:categories.subtitle") : undefined,
    onBack: categoryId ? () => onSelectCategory(null) : undefined,
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
    setCategoriesLoading(true);
    (async () => {
      try {
        setCategories(await categoriesApi.list());
      } catch (err) {
        handleError(err, t("models:errors.loadCategoriesFailed"));
      } finally {
        setCategoriesLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoriesVersion]);

  useEffect(() => {
    setLoading(true);
    (async () => {
      try {
        const result = await printsApi.list({ category_id: categoryIdFilter, order_by: sortMode, limit: PAGE_SIZE, offset: 0 });
        setItems(result.items);
        setOffset(result.items.length);
        setHasMore(result.hasMore);
      } catch (err) {
        handleError(err, t("models:errors.loadFailed"));
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryIdFilter, printsVersion, sortMode]);

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const result = await printsApi.list({ category_id: categoryIdFilter, order_by: sortMode, limit: PAGE_SIZE, offset });
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

  const createCategory = async (name: string, parentId: string | null) => {
    try {
      await categoriesApi.create(name, [], parentId || undefined);
      onCategoriesChanged();
    } catch (err) {
      handleError(err, t("models:errors.createCategoryFailed"));
    }
  };

  const renameCategory = async (id: string, name: string) => {
    const existing = categories.find(f => f.id === id);
    try {
      await categoriesApi.update(id, name, existing?.tags || [], existing?.parent_id || undefined);
      onCategoriesChanged();
    } catch (err) {
      handleError(err, t("models:errors.renameCategoryFailed"));
    }
  };

  const deleteCategory = async (id: string) => {
    try {
      await categoriesApi.delete(id);
      onCategoriesChanged();
      if (categoryId === id) onSelectCategory(null);
    } catch (err) {
      handleError(err, t("models:errors.deleteCategoryFailed"));
    }
  };

  const reorderCategories = async (categoryIds: string[]) => {
    try {
      await categoriesApi.reorder(categoryIds);
      onCategoriesChanged();
    } catch (err) {
      handleError(err, t("models:errors.reorderCategoryFailed"));
    }
  };

  const updateCategoryMeta = async (id: string, meta: CategoryMetaInput) => {
    try {
      await categoriesApi.updateMeta(id, meta);
      onCategoriesChanged();
    } catch (err) {
      // Unlike the other handlers here, this one rethrows anything but the auth-redirect case:
      // CategoryMetaDialog shows the specific message (e.g. a bad category-id string naming the
      // exact typo) inline and keeps the dialog open with the user's edits intact, instead of a
      // generic alert() that closes the dialog and discards what they typed either way.
      if (handleError(err)) return;
      throw err;
    }
  };

  return (
    <Stack spacing={2} sx={{ maxWidth: "1920px", mx: "auto" }}>
      <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
        <SortTabs value={sortMode} onChange={setSortMode} />
      </Box>
      <Stack direction="row" spacing={2} alignItems="flex-start">
        <CategoriesPanel
          categories={categories}
          loading={categoriesLoading}
          selectedId={categoryId}
          onSelect={onSelectCategory}
          onCreate={createCategory}
          onRename={renameCategory}
          onDelete={deleteCategory}
          onReorder={reorderCategories}
          onUpdateMeta={updateCategoryMeta}
        />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {selectedCategory?.meta_title && (
            <Box sx={{ mb: 2 }}>
              <CategoryBanner category={selectedCategory} />
            </Box>
          )}
          {loading ? (
            <Stack alignItems="center" sx={{ py: 8 }}>
              <CircularProgress size={22} />
            </Stack>
          ) : items.length ? (
            <Stack spacing={2}>
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: "repeat(5, 1fr)",
                  columnGap: "20px",
                  rowGap: "20px",
                  "@media (max-width: 1979px)": { gridTemplateColumns: "repeat(5, 1fr)" },
                  "@media (max-width: 1684px)": { gridTemplateColumns: "repeat(4, 1fr)" },
                  "@media (max-width: 1404px)": { gridTemplateColumns: "repeat(3, 1fr)" },
                  "@media (max-width: 1124px)": { gridTemplateColumns: "repeat(2, 1fr)" },
                  "@media (max-width: 860px)": { gridTemplateColumns: "repeat(1, 1fr)" },
                }}
              >
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
              <Typography variant="body2">{t("models:grid.empty")}</Typography>
            </Stack>
          )}
        </Box>
      </Stack>
    </Stack>
  );
}
