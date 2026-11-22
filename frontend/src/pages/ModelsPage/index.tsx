import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Collapse from "@mui/material/Collapse";
import Divider from "@mui/material/Divider";
import useMediaQuery from "@mui/material/useMediaQuery";
import type { Theme } from "@mui/material/styles";
import FilterListIcon from "@mui/icons-material/FilterList";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { translateCategoryDisplay } from "../../utils/translateCategoryDisplay";
import { UnauthorizedError } from "../../api/client";
import { type Print, printsApi } from "../../api/prints";
import { type Category, type CategoryKind, type CategoryMetaInput, categoriesApi } from "../../api/categories";
import { type CategoriesView, type PreviewMode } from "../../api/settings";
import type { AuthUser } from "../../api/auth";
import { type ResolvedTheme } from "../../constants/settingsOptions";
import { usePageHeader } from "../../components/Layout/PageHeaderContext";
import { buildCategoryTree, subtreeIds } from "../../utils/categoryTree";
import { keepLoaded, useBackgroundReload } from "../../hooks/useBackgroundReload";
import { useInfiniteScroll } from "../../hooks/useInfiniteScroll";
import { useRememberedList } from "../../hooks/useRememberedList";
import { useLibrarySources, useModelFilters } from "../../hooks/useModelFilters";
import { useCategoriesView } from "../../hooks/useCategoriesView";
import CategoriesPanel from "./CategoriesPanel";
import CategoriesViewToggle from "./CategoriesViewToggle";
import CategoryBanner from "./CategoryBanner";
import ModelCard from "./ModelCard";
import { usePrintSort } from "../../hooks/usePrintSort";
import SortTabs from "./SortTabs";
import ModelFiltersButton from "../../components/ModelFilters/ModelFiltersButton";
import ModelsManagerDialog, { type ModelsManagerSection } from "./ModelsManagerDialog";
import { CardSkeletons } from "../../components/media/CardSkeleton";
import { cardGridSx } from "../../components/media/cardGrid";
import ModelSelectionToolbar from "../../components/modelSelection/ModelSelectionToolbar";
import { replacePrints, useModelSelection } from "../../hooks/useModelSelection";
import { useToast } from "../../components/ToastProvider";
import LoadMoreFailed from "../../components/LoadMoreFailed";

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

/** Shares category selection between desktop filters and the collapsible mobile panel above the model grid. */
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
  const { t, i18n } = useTranslation(["models", "common"]);
  const showToast = useToast();
  // A next page that couldn't be read waits for the user's retry, rather than being asked for again and again.
  const [moreFailed, setMoreFailed] = useState(false);
  const mobile = useMediaQuery((muiTheme: Theme) => muiTheme.breakpoints.down("md"));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  // The category reaches the address only after it's been picked, so it's named here too: picking one is a new list.
  const { items, setItems, hasMore, setHasMore, loading, setLoading, returning } = useRememberedList<Print>({
    extra: categoryId ?? "",
  });
  const [loadingMore, setLoadingMore] = useState(false);
  const selection = useModelSelection(items);
  const [searchParams, setSearchParams] = useSearchParams();
  const [categoriesView, setCategoriesView] = useCategoriesView();
  const panelKind = categoriesView === "folders" ? "folder" : "category";
  const panelCategories = useMemo(() => categories.filter((c) => c.kind === panelKind), [categories, panelKind]);
  const [managerSection, setManagerSection] = useState<ModelsManagerSection | null>(null);
  // Bumped when AI categorization changes many models at once, to refetch the grid.
  const [libraryVersion, setLibraryVersion] = useState(0);
  const refreshLibrary = useCallback(() => setLibraryVersion((version) => version + 1), []);
  const reloadAfterRename = useRef(false);
  // A page that finishes after its list has been replaced must be discarded.
  const listRun = useRef(0);
  const { sortMode, direction, setSortMode, setDirection } = usePrintSort();

  const filters = useModelFilters();
  const { generative, hiddenProviders, licenseAllows, licensed } = filters;
  // Bumped when a model is removed from the list here, so the site it came from loses its chip once it holds nothing.
  const [sourcesVersion, setSourcesVersion] = useState(0);
  const refreshSources = useCallback(() => setSourcesVersion((version) => version + 1), []);

  // Bumped when models leave the list here: a page asked for before that counted from where they were.
  const listDrops = useRef(0);
  const dropFromList = (ids: string[]) => {
    listDrops.current += 1;
    setItems((prev) => prev.filter((item) => !ids.includes(item.id)));
  };

  // Linking a model can bring in a new source, moving it can take it out of the open category,
  // and renaming it can change its place in a Name-sorted list.
  const applyUpdates = (updated: Print[]) => {
    const linked = updated.some(
      (print) => print.source_provider && !items.find((item) => item.id === print.id)?.source_provider,
    );
    const open = categoryIdFilter === undefined ? null : [categoryIdFilter].flat();
    const left = open
      ? updated.filter((print) => !open.includes(print.category_id ?? "")).map((print) => print.id)
      : [];
    const renamed =
      sortMode === "name" &&
      updated.some((print) => {
        const current = items.find((item) => item.id === print.id);
        return current && (current.title || current.name) !== (print.title || print.name);
      });
    if (renamed) {
      // A title can move the model across a page boundary while the next page is on its way.
      listRun.current += 1;
      setMoreFailed(false);
      reloadAfterRename.current = true;
      setHasMore(false);
      setLoading(true);
      refreshLibrary();
    } else {
      setItems((prev) => replacePrints(prev, updated));
      if (left.length) dropFromList(left);
    }
    if (linked) refreshSources();
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
    if (message) showToast({ message, severity: "error" });
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

  const sources = useLibrarySources(`${printsVersion}/${libraryVersion}/${sourcesVersion}`, handleError);
  // Every site the library has is off, so the grid says so rather than looking empty for no visible reason.
  const noSources = sources.length > 0 && sources.every((source) => hiddenProviders.includes(source.provider));

  const isBackgroundReload = useBackgroundReload(printsVersion);

  useEffect(() => {
    const run = ++listRun.current;
    // A reloaded list may page again, whatever its last next page did.
    setMoreFailed(false);
    setLoadingMore(false);
    const renamed = reloadAfterRename.current;
    reloadAfterRename.current = false;
    // Back to this list puts it back as it was left, then checks it quietly, like a reload nobody asked for.
    const kept = renamed ? null : returning();
    const background = (isBackgroundReload() || kept !== null) && !renamed;
    if (!background) {
      // Only a successful replacement can make this list pageable again.
      setItems([]);
      setHasMore(false);
      setLoading(true);
    }
    (async () => {
      try {
        let result: Awaited<ReturnType<typeof printsApi.list>>;
        let drops: number;
        // Asked again if models left the list while this was on its way, as it may still hold them.
        do {
          drops = listDrops.current;
          result = await printsApi.list({
            category_id: categoryIdFilter,
            generative: generative || undefined,
            hide_providers: hiddenProviders,
            license_allows: licenseAllows,
            licensed: licensed || undefined,
            order_by: sortMode,
            order_direction: direction,
            limit: background ? keepLoaded(PAGE_SIZE, kept ?? items.length) : PAGE_SIZE,
            offset: 0,
          });
          if (run !== listRun.current) return;
        } while (drops !== listDrops.current);
        setItems(result.items);
        setHasMore(result.hasMore);
      } catch (err) {
        if (run !== listRun.current) return;
        handleError(err, background ? undefined : t("models:errors.loadFailed"));
      } finally {
        if (run === listRun.current) setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    categoryIdFilter,
    printsVersion,
    libraryVersion,
    sortMode,
    direction,
    generative,
    hiddenProviders,
    licenseAllows,
    licensed,
  ]);

  const loadMore = async () => {
    if (loading || loadingMore || !hasMore) return;
    const run = listRun.current;
    const drops = listDrops.current;
    setLoadingMore(true);
    try {
      const result = await printsApi.list({
        category_id: categoryIdFilter,
        generative: generative || undefined,
        hide_providers: hiddenProviders,
        license_allows: licenseAllows,
        licensed: licensed || undefined,
        order_by: sortMode,
        order_direction: direction,
        limit: PAGE_SIZE,
        // What's on screen, so models that left the list here don't make the next page skip any.
        offset: items.length,
      });
      // A filter changed while this page was on its way: appending it would mix two lists together. Models leaving the
      // list shift it too, so that page is asked for again from the new place.
      if (run !== listRun.current || drops !== listDrops.current) return;
      setItems((prev) => [...prev, ...result.items]);
      setHasMore(result.hasMore);
    } catch (err) {
      if (run !== listRun.current) return;
      handleError(err);
      setMoreFailed(true);
    } finally {
      if (run === listRun.current) setLoadingMore(false);
    }
  };

  const loadMoreSentinelRef = useInfiniteScroll(loadMore, hasMore && !moreFailed, loading || loadingMore);

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
    if (mobile) setFiltersOpen(true);
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
          onDeleted={(ids) => {
            dropFromList(ids);
            refreshSources();
          }}
          onUpdated={applyUpdates}
          onUnauthorized={onUnauthorized}
          foldersView={categoriesView === "folders"}
        />
        <Box sx={{ ml: "auto", display: "flex", alignItems: "center", gap: 1.5, width: { xs: "100%", md: "auto" } }}>
          <Box sx={{ minWidth: 0 }}>
            <SortTabs value={sortMode} onChange={setSortMode} direction={direction} onDirectionChange={setDirection} />
          </Box>
          <Divider orientation="vertical" flexItem sx={{ my: 0.5 }} />
          <ModelFiltersButton filters={filters} sources={sources} />
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
      <Button
        variant="outlined"
        startIcon={<FilterListIcon />}
        endIcon={
          <ExpandMoreIcon sx={{ transform: filtersOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
        }
        aria-expanded={filtersOpen}
        onClick={() => setFiltersOpen((open) => !open)}
        sx={{ display: { xs: "flex", md: "none" }, minHeight: 44, justifyContent: "flex-start", textTransform: "none" }}
      >
        <Box
          component="span"
          sx={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            textAlign: "left",
          }}
        >
          {t(panelKind === "folder" ? "models:view.folders" : "models:view.categories")}:{" "}
          {selectedCategory?.kind === panelKind
            ? translateCategoryDisplay(selectedCategory, i18n).name || t("models:categories.untitled")
            : t("models:categories.all")}
        </Box>
      </Button>
      <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems="flex-start">
        <Collapse
          id="model-category-filters"
          in={!mobile || filtersOpen}
          unmountOnExit
          sx={{
            width: { xs: "100%", md: 260 },
            flexShrink: 0,
            "& .MuiCollapse-wrapperInner > .MuiPaper-root": { width: "100%", boxSizing: "border-box" },
          }}
        >
          <CategoriesPanel
            kind={panelKind}
            categories={panelCategories}
            loading={categoriesLoading || categoriesView === null}
            selectedId={categoryId}
            onSelect={(id) => {
              onSelectCategory(id);
              if (mobile) setFiltersOpen(false);
            }}
            onManage={() => setManagerSection(panelKind === "folder" ? "folders" : "categories")}
          />
        </Collapse>
        <Box sx={{ flex: 1, minWidth: 0, width: { xs: "100%", md: "auto" } }}>
          {selectedCategory?.meta_title && (
            <Box sx={{ mb: 2 }}>
              <CategoryBanner category={selectedCategory} />
            </Box>
          )}
          {loading ? (
            <Box sx={cardGridSx(5)}>
              <CardSkeletons count={10} />
            </Box>
          ) : items.length || hasMore ? (
            <Stack spacing={2}>
              <Box sx={cardGridSx(5)}>
                {items.map((item) => (
                  <ModelCard
                    key={item.id}
                    item={item}
                    theme={theme}
                    previewMode={previewMode}
                    onDeleted={(deletedId) => {
                      dropFromList([deletedId]);
                      refreshSources();
                    }}
                    onFavoriteChange={(updated) =>
                      setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)))
                    }
                    onUpdated={(updated) => applyUpdates([updated])}
                    onUnauthorized={onUnauthorized}
                    viewer={viewer}
                    selectMode={selection.active}
                    selected={selection.isSelected(item.id)}
                    onToggleSelect={(range) => selection.toggle(item.id, range)}
                    offerLink={categoriesView === "folders"}
                  />
                ))}
                {loadingMore && <CardSkeletons count={5} />}
              </Box>
              {hasMore &&
                (moreFailed ? (
                  <LoadMoreFailed message={t("models:errors.loadFailed")} onRetry={() => setMoreFailed(false)} />
                ) : (
                  <Box ref={loadMoreSentinelRef} sx={{ height: 1 }} />
                ))}
            </Stack>
          ) : (
            <Stack alignItems="center" spacing={1} sx={{ py: 8, color: "text.secondary" }}>
              <Typography variant="body2">
                {t(noSources ? "models:filters.noneSelected" : "models:grid.empty")}
              </Typography>
              {noSources && (
                <Button size="small" onClick={() => filters.setHiddenProviders([])}>
                  {t("models:filters.allSources")}
                </Button>
              )}
            </Stack>
          )}
        </Box>
      </Stack>
    </Stack>
  );
}
