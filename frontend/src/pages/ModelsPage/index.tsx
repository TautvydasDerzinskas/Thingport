import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { UnauthorizedError } from "../../api/client";
import { type Print, type PrintSortMode, printsApi } from "../../api/prints";
import { type Category, type CategoryKind, type CategoryMetaInput, categoriesApi } from "../../api/categories";
import { type CategoriesView, type PreviewMode } from "../../api/settings";
import type { AuthUser } from "../../api/auth";
import { type ResolvedTheme } from "../../constants/settingsOptions";
import { usePageHeader } from "../../components/Layout/PageHeaderContext";
import { buildCategoryTree, subtreeIds } from "../../utils/categoryTree";
import { useInfiniteScroll } from "../../hooks/useInfiniteScroll";
import { useCategoriesView } from "../../hooks/useCategoriesView";
import CategoriesPanel from "./CategoriesPanel";
import CategoriesViewToggle from "./CategoriesViewToggle";
import CategoryBanner from "./CategoryBanner";
import ModelCard from "./ModelCard";
import SortTabs from "./SortTabs";
import ModelsManagerDialog, { type ModelsManagerSection } from "./ModelsManagerDialog";
import { CardSkeletons } from "../../components/media/CardSkeleton";
import { cardGridSx } from "../../components/media/cardGrid";
import ModelSelectionToolbar from "../../components/modelSelection/ModelSelectionToolbar";
import { replacePrints, useModelSelection } from "../../hooks/useModelSelection";

const PAGE_SIZE = 24;

type Props = {
  categoryId: string | null;
  onSelectCategory: (id: string | null) => void;
  categoriesVersion: number;
  onCategoriesChanged: () => void;
  /** Bumped when prints change elsewhere, to refetch the grid. */
  printsVersion: number;
  onUnauthorized?: () => void;
  theme: ResolvedTheme;
  previewMode: PreviewMode;
  viewer?: AuthUser | null;
};

export default function ModelsPage({
  categoryId,
  onSelectCategory,
  categoriesVersion,
  onCategoriesChanged,
  printsVersion,
  onUnauthorized,
  theme,
  previewMode,
  viewer,
}: Props) {
  const { t } = useTranslation(["models", "common"]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [items, setItems] = useState<Print[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const selection = useModelSelection(items);
  const [searchParams, setSearchParams] = useSearchParams();
  const [categoriesView, setCategoriesView] = useCategoriesView();
  const panelKind = categoriesView === "folders" ? "folder" : "category";
  const panelCategories = useMemo(() => categories.filter((c) => c.kind === panelKind), [categories, panelKind]);
  const [managerSection, setManagerSection] = useState<ModelsManagerSection | null>(null);
  // Bumped when AI categorization changes many models at once, to refetch the grid.
  const [libraryVersion, setLibraryVersion] = useState(0);
  const refreshLibrary = useCallback(() => setLibraryVersion((version) => version + 1), []);
  const sortModeParam = searchParams.get("orderBy");
  const sortMode: PrintSortMode =
    sortModeParam === "popular" || sortModeParam === "downloads" ? sortModeParam : "newest";

  const setSortMode = (mode: PrintSortMode) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (mode === "newest") next.delete("orderBy");
      else next.set("orderBy", mode);
      return next;
    });
  };

  // Mirrors the selected category into ?category=<id>. When the URL and state disagree, both sync
  // effects fire and undo each other, causing flicker; `syncingFromUrlRef` marks a change that came
  // from the URL so it isn't pushed straight back.
  const categoryParam = searchParams.get("category");
  const syncingFromUrlRef = useRef(false);

  useEffect(() => {
    if (categoryParam !== categoryId) {
      syncingFromUrlRef.current = true;
      onSelectCategory(categoryParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryParam]);

  useEffect(() => {
    if (syncingFromUrlRef.current) {
      syncingFromUrlRef.current = false;
      return;
    }
    if ((searchParams.get("category") || null) === categoryId) return;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (categoryId) next.set("category", categoryId);
      else next.delete("category");
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId]);

  // A category includes the models at every level beneath it.
  const categoryIdFilter = useMemo(() => {
    if (!categoryId) return undefined;
    const ids = subtreeIds(buildCategoryTree(categories), categoryId);
    return ids.length === 1 ? categoryId : ids;
  }, [categoryId, categories]);

  const selectedCategory = categoryId ? (categories.find((f) => f.id === categoryId) ?? null) : null;
  usePageHeader({
    title: selectedCategory ? selectedCategory.name || t("models:categories.untitled") : undefined,
    subtitle: selectedCategory
      ? t(selectedCategory.kind === "folder" ? "models:folders.subtitle" : "models:categories.subtitle")
      : undefined,
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
        const result = await printsApi.list({
          category_id: categoryIdFilter,
          order_by: sortMode,
          limit: PAGE_SIZE,
          offset: 0,
        });
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
  }, [categoryIdFilter, printsVersion, libraryVersion, sortMode]);

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const result = await printsApi.list({
        category_id: categoryIdFilter,
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

  const createCategory = async (name: string, parentId: string | null, kind: CategoryKind) => {
    try {
      await categoriesApi.create(name, [], parentId || undefined, kind);
      onCategoriesChanged();
    } catch (err) {
      handleError(err, t("models:errors.createCategoryFailed"));
    }
  };

  const renameCategory = async (id: string, name: string) => {
    const existing = categories.find((f) => f.id === id);
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

  // Models in removed categories move, so the list reloads too. Rethrows so the reset dialog stays open to retry.
  const resetCategories = async () => {
    try {
      const next = await categoriesApi.resetDefaults();
      if (categoryId && !next.some((c) => c.id === categoryId)) onSelectCategory(null);
      onCategoriesChanged();
      refreshLibrary();
    } catch (err) {
      handleError(err, t("models:errors.resetCategoriesFailed"));
      throw err;
    }
  };

  // Refetch even on failure: the manager shows the drop optimistically until fresh categories arrive.
  const reorderCategories = async (categoryIds: string[]) => {
    try {
      await categoriesApi.reorder(categoryIds);
    } catch (err) {
      handleError(err, t("models:errors.reorderCategoryFailed"));
    } finally {
      onCategoriesChanged();
    }
  };

  const moveCategory = async (id: string, parentId: string | null, position: number) => {
    try {
      await categoriesApi.move(id, parentId, position);
    } catch (err) {
      handleError(err, t("models:errors.moveCategoryFailed"));
    } finally {
      onCategoriesChanged();
    }
  };

  // A selection from the other box would be invisible after the switch.
  const switchCategoriesView = (view: CategoriesView) => {
    setCategoriesView(view);
    if (selectedCategory && selectedCategory.kind !== (view === "folders" ? "folder" : "category")) {
      onSelectCategory(null);
    }
  };

  const updateCategoryMeta = async (id: string, meta: CategoryMetaInput) => {
    try {
      await categoriesApi.updateMeta(id, meta);
      onCategoriesChanged();
    } catch (err) {
      // Rethrow so CategoryMetaDialog shows the error inline and keeps the user's edits.
      if (handleError(err)) return;
      throw err;
    }
  };

  return (
    <Stack spacing={2} sx={{ maxWidth: "1920px", mx: "auto" }}>
      <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 2, rowGap: 1 }}>
        <CategoriesViewToggle value={categoriesView} onChange={switchCategoriesView} />
        <ModelSelectionToolbar
          selection={selection}
          total={items.length}
          hasMore={hasMore}
          onDeleted={(ids) => setItems((prev) => prev.filter((i) => !ids.includes(i.id)))}
          onUpdated={(updated) => setItems((prev) => replacePrints(prev, updated))}
          onUnauthorized={onUnauthorized}
        />
        <Box sx={{ ml: "auto" }}>
          <SortTabs value={sortMode} onChange={setSortMode} />
        </Box>
      </Box>
      <ModelsManagerDialog
        open={managerSection}
        onClose={() => setManagerSection(null)}
        categories={categories}
        onCreate={createCategory}
        onRename={renameCategory}
        onDelete={deleteCategory}
        onReorder={reorderCategories}
        onMove={moveCategory}
        onUpdateMeta={updateCategoryMeta}
        onResetCategories={resetCategories}
        onPrintUpdated={(updated) => setItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))}
        onLibraryChanged={refreshLibrary}
        onUnauthorized={onUnauthorized}
      />
      <Stack direction="row" spacing={2} alignItems="flex-start">
        <CategoriesPanel
          kind={panelKind}
          categories={panelCategories}
          loading={categoriesLoading || categoriesView === null}
          selectedId={categoryId}
          onSelect={onSelectCategory}
          onManage={() => setManagerSection(panelKind === "folder" ? "folders" : "categories")}
        />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {selectedCategory?.meta_title && (
            <Box sx={{ mb: 2 }}>
              <CategoryBanner category={selectedCategory} />
            </Box>
          )}
          {loading ? (
            <Box sx={cardGridSx(5)}>
              <CardSkeletons count={10} />
            </Box>
          ) : items.length ? (
            <Stack spacing={2}>
              <Box sx={cardGridSx(5)}>
                {items.map((item) => (
                  <ModelCard
                    key={item.id}
                    item={item}
                    theme={theme}
                    previewMode={previewMode}
                    onDeleted={(deletedId) => setItems((prev) => prev.filter((i) => i.id !== deletedId))}
                    onFavoriteChange={(updated) =>
                      setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)))
                    }
                    onUpdated={(updated) => setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)))}
                    onUnauthorized={onUnauthorized}
                    viewer={viewer}
                    selectMode={selection.active}
                    selected={selection.isSelected(item.id)}
                    onToggleSelect={(range) => selection.toggle(item.id, range)}
                  />
                ))}
                {loadingMore && <CardSkeletons count={5} />}
              </Box>
              {hasMore && <Box ref={loadMoreSentinelRef} sx={{ height: 1 }} />}
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
