import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Collapse from "@mui/material/Collapse";
import Badge from "@mui/material/Badge";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import useMediaQuery from "@mui/material/useMediaQuery";
import type { Theme } from "@mui/material/styles";
import FilterListIcon from "@mui/icons-material/FilterList";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { translateCategoryDisplay } from "../../utils/translateCategoryDisplay";
import { UnauthorizedError } from "../../api/client";
import { type Print, type PrintSortMode, type PrintSource, printsApi } from "../../api/prints";
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
import TuneIcon from "@mui/icons-material/Tune";
import SortTabs from "./SortTabs";
import ModelFiltersPopover from "./ModelFiltersPopover";
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
  const mobile = useMediaQuery((muiTheme: Theme) => muiTheme.breakpoints.down("md"));
  const [filtersOpen, setFiltersOpen] = useState(false);
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

  // Only the models that came with the script they were generated from -- "Generative models" in the filters.
  // In the URL, so the narrowed library can be linked to and comes back on reload, as the sort order does.
  const generative = searchParams.get("generative") === "1";
  const setGenerative = (on: boolean) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (on) next.set("generative", "1");
      else next.delete("generative");
      return next;
    });
  };

  // The sites turned off in the filters. What to hide rather than what to show, so a site the library gains later
  // is listed from the start rather than arriving already filtered out.
  const hiddenParam = searchParams.get("hideProviders") ?? "";
  const hiddenProviders = useMemo(() => hiddenParam.split(",").filter(Boolean), [hiddenParam]);
  const setHiddenProviders = (next: string[]) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (next.length) params.set("hideProviders", next.join(","));
      else params.delete("hideProviders");
      return params;
    });
  };
  const [filtersAnchor, setFiltersAnchor] = useState<HTMLElement | null>(null);
  const [sources, setSources] = useState<PrintSource[]>([]);
  // Bumped when a model is removed from the list here, so the site it came from loses its chip once it holds nothing.
  const [sourcesVersion, setSourcesVersion] = useState(0);
  const refreshSources = useCallback(() => setSourcesVersion((version) => version + 1), []);
  const activeFilters = (generative ? 1 : 0) + (hiddenProviders.length ? 1 : 0);
  // Every site the library has is off, so the grid says so rather than looking empty for no visible reason.
  const noSources = sources.length > 0 && sources.every((source) => hiddenProviders.includes(source.provider));

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
    // An answer belonging to an older library is dropped rather than written over the newer list of sites:
    // two requests a refresh apart can land out of order.
    let current = true;
    (async () => {
      try {
        const next = await printsApi.sources();
        if (current) setSources(next);
      } catch (err) {
        // The filter falls back to listing no sites; the grid itself is unaffected.
        if (current) handleError(err);
      }
    })();
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printsVersion, libraryVersion, sourcesVersion]);

  // Which set of filters the list on screen belongs to. Changing one -- a category, the sort, or anything behind
  // the filter button -- starts a new set, and an answer belonging to an older one is dropped rather than written over the newer
  // list: the two requests are a page apart and the slower one can land last.
  const listRun = useRef(0);

  useEffect(() => {
    const run = ++listRun.current;
    setLoading(true);
    (async () => {
      try {
        const result = await printsApi.list({
          category_id: categoryIdFilter,
          generative: generative || undefined,
          hide_providers: hiddenProviders,
          order_by: sortMode,
          limit: PAGE_SIZE,
          offset: 0,
        });
        if (run !== listRun.current) return;
        setItems(result.items);
        setOffset(result.items.length);
        setHasMore(result.hasMore);
      } catch (err) {
        if (run !== listRun.current) return;
        handleError(err, t("models:errors.loadFailed"));
      } finally {
        if (run === listRun.current) setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryIdFilter, printsVersion, libraryVersion, sortMode, generative, hiddenProviders]);

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    const run = listRun.current;
    setLoadingMore(true);
    try {
      const result = await printsApi.list({
        category_id: categoryIdFilter,
        generative: generative || undefined,
        hide_providers: hiddenProviders,
        order_by: sortMode,
        limit: PAGE_SIZE,
        offset,
      });
      // A filter changed while this page was on its way: appending it would mix two lists together.
      if (run !== listRun.current) return;
      setItems((prev) => [...prev, ...result.items]);
      setOffset(offset + result.items.length);
      setHasMore(result.hasMore);
    } catch (err) {
      if (run !== listRun.current) return;
      handleError(err, t("models:errors.loadFailed"));
    } finally {
      // Cleared whether or not this page still belongs to the list on screen: left set, it would turn
      // "a page is on its way" into "no page may ever be asked for again".
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
            setItems((prev) => prev.filter((i) => !ids.includes(i.id)));
            refreshSources();
          }}
          onUpdated={(updated) => setItems((prev) => replacePrints(prev, updated))}
          onUnauthorized={onUnauthorized}
        />
        <Box sx={{ ml: "auto", display: "flex", alignItems: "center", gap: 1.5, width: { xs: "100%", md: "auto" } }}>
          <Box sx={{ overflowX: "auto" }}>
            <SortTabs value={sortMode} onChange={setSortMode} />
          </Box>
          <Divider orientation="vertical" flexItem sx={{ my: 0.5 }} />
          <Tooltip title={t("models:filters.title")}>
            <Badge color="primary" badgeContent={activeFilters} overlap="circular">
              <IconButton
                size="small"
                aria-label={t("models:filters.title")}
                aria-haspopup="dialog"
                aria-expanded={Boolean(filtersAnchor)}
                onClick={(event) => setFiltersAnchor(event.currentTarget)}
                color={activeFilters ? "primary" : "default"}
              >
                <TuneIcon fontSize="small" />
              </IconButton>
            </Badge>
          </Tooltip>
        </Box>
      </Box>
      <ModelFiltersPopover
        anchorEl={filtersAnchor}
        onClose={() => setFiltersAnchor(null)}
        sources={sources}
        hidden={hiddenProviders}
        onHiddenChange={setHiddenProviders}
        generative={generative}
        onGenerativeChange={setGenerative}
      />
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
          ) : items.length ? (
            <Stack spacing={2}>
              <Box sx={cardGridSx(5)}>
                {items.map((item) => (
                  <ModelCard
                    key={item.id}
                    item={item}
                    theme={theme}
                    previewMode={previewMode}
                    onDeleted={(deletedId) => {
                      setItems((prev) => prev.filter((i) => i.id !== deletedId));
                      refreshSources();
                    }}
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
              <Typography variant="body2">
                {t(noSources ? "models:filters.noneSelected" : "models:grid.empty")}
              </Typography>
              {noSources && (
                <Button size="small" onClick={() => setHiddenProviders([])}>
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
