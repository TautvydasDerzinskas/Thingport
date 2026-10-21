import { useTranslation } from "react-i18next";
import { useEffect, useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import BookmarkIcon from "@mui/icons-material/Bookmark";
import BookmarkBorderIcon from "@mui/icons-material/BookmarkBorder";
import CallMergeIcon from "@mui/icons-material/CallMerge";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import { UnauthorizedError } from "../../api/client";
import { type Collection, type CollectionInput, collectionsApi } from "../../api/collections";
import { type PreviewMode } from "../../api/settings";
import { type ResolvedTheme } from "../../constants/settingsOptions";
import { usePageHeader } from "../../components/Layout/PageHeaderContext";
import { useConfirm } from "../../components/ConfirmProvider";
import { useToast } from "../../components/ToastProvider";
import SortTabs from "../../components/controls/SortTabs";
import MergeDialog, { type MergeItem } from "../../components/MergeDialog";
import SelectionToolbar, { SelectionAction } from "../../components/selection/SelectionToolbar";
import { renderPreviewContent } from "../../components/media/renderPreviewContent";
import { useSelection } from "../../hooks/useSelection";
import { collectionDisplayName } from "../../utils/collectionDisplay";
import { importProviderInfo } from "../../constants/importProviders";
import CollectionCard from "./CollectionCard";
import CollectionFormModal from "./CollectionFormModal";
import CollectionsActionsMenu from "./CollectionsActionsMenu";
import { CardSkeletons } from "../../components/media/CardSkeleton";
import { cardGridSx } from "../../components/media/cardGrid";

type Props = {
  onUnauthorized?: () => void;
  onBookmarksChanged?: () => void;
  theme: ResolvedTheme;
  previewMode: PreviewMode;
};

type SortMode = "newest" | "name" | "models";
type Busy = "bookmark" | "delete" | null;

const collectionKey = (collection: Collection) => collection.id;
// Favourites and History are built in: nothing to merge or delete.
const isOwn = (collection: Collection) => !collection.system_key;

export default function CollectionsPage({ onUnauthorized, onBookmarksChanged, theme, previewMode }: Props) {
  const { t } = useTranslation(["models", "common"]);
  const confirm = useConfirm();
  const showToast = useToast();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [mergeOpen, setMergeOpen] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);

  usePageHeader({
    actions: <CollectionsActionsMenu onAddCollection={() => setFormOpen(true)} />,
  });

  const handleError = (err: unknown, message: string) => {
    if (err instanceof UnauthorizedError) {
      onUnauthorized?.();
      return;
    }
    console.error(err);
    showToast({ message: err instanceof Error && err.message ? err.message : message, severity: "error" });
  };

  const load = async () => {
    setLoading(true);
    try {
      setCollections(await collectionsApi.list());
    } catch (err) {
      handleError(err, t("models:collections.errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The built-in ones stay first; the server sends the rest newest first.
  const sorted = useMemo(() => {
    const system = collections.filter((c) => c.system_key);
    const own = collections.filter(isOwn);
    const byName = (a: Collection, b: Collection) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    if (sortMode === "name") own.sort(byName);
    if (sortMode === "models") own.sort((a, b) => b.item_count - a.item_count || byName(a, b));
    return [...system, ...own];
  }, [collections, sortMode]);

  const selection = useSelection(sorted, collectionKey, isOwn);
  const { selected } = selection;
  const count = selected.length;
  const allBookmarked = count > 0 && selected.every((c) => c.bookmarked);

  const createCollection = async (input: CollectionInput) => {
    await collectionsApi.create(input);
    await load();
  };

  const handleCollectionUpdated = (updated: Collection) => {
    setCollections((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  };

  const handleCollectionDeleted = (id: string) => {
    setCollections((prev) => prev.filter((c) => c.id !== id));
  };

  // One at a time: each new bookmark takes the next place in the list.
  const toggleBookmarks = async () => {
    const bookmark = !allBookmarked;
    setBusy("bookmark");
    try {
      for (const collection of selected) {
        if (collection.bookmarked === bookmark) continue;
        await (bookmark ? collectionsApi.bookmark(collection.id) : collectionsApi.unbookmark(collection.id));
        handleCollectionUpdated({ ...collection, bookmarked: bookmark });
      }
      onBookmarksChanged?.();
      showToast({
        message: t(bookmark ? "models:collections.selection.bookmarked" : "models:collections.selection.unbookmarked", {
          count,
        }),
      });
    } catch (err) {
      handleError(err, t("models:collections.bookmarkFailed"));
      onBookmarksChanged?.();
    } finally {
      setBusy(null);
    }
  };

  const removeSelected = async () => {
    const confirmed = await confirm({
      title: t("models:collections.selection.deleteTitle", { count }),
      message: t("models:collections.selection.deleteMessage", { count }),
      confirmLabel: t("common:delete"),
      destructive: true,
    });
    if (!confirmed) return;
    setBusy("delete");
    try {
      const { deleted } = await collectionsApi.deleteMany(selected.map((c) => c.id));
      setCollections((prev) => prev.filter((c) => !deleted.includes(c.id)));
      if (selected.some((c) => c.bookmarked)) onBookmarksChanged?.();
      showToast({ message: t("models:collections.selection.deleted", { count: deleted.length }) });
    } catch (err) {
      handleError(err, t("models:collections.detail.deleteFailed"));
    } finally {
      setBusy(null);
    }
  };

  const mergeItems: MergeItem[] = selected.map((collection) => ({
    key: collection.id,
    name: collectionDisplayName(collection, t),
    count: collection.item_count,
    bookmarked: collection.bookmarked,
    syncProvider: collection.sync
      ? (importProviderInfo(collection.sync.provider)?.label ?? collection.sync.provider)
      : null,
    thumbnail: collection.cover_items[0] ? (
      renderPreviewContent(collection.cover_items[0], "card", theme, t, previewMode)
    ) : (
      <Stack alignItems="center" justifyContent="center" sx={{ height: "100%", color: "text.disabled" }}>
        <Inventory2OutlinedIcon fontSize="small" />
      </Stack>
    ),
  }));

  const merge = async (primary: MergeItem, others: MergeItem[]) => {
    const result = await collectionsApi.merge(
      primary.key,
      others.map((item) => item.key),
    );
    setCollections((prev) =>
      prev
        .filter((c) => !result.merged_ids.includes(c.id))
        .map((c) => (c.id === result.collection.id ? result.collection : c)),
    );
    if (others.some((item) => item.bookmarked)) onBookmarksChanged?.();
    selection.setActive(false);
    showToast({
      message: t("models:collections.selection.merged", { count: others.length, name: primary.name }),
      severity: "success",
    });
  };

  const sortOptions: { value: SortMode; label: string }[] = [
    { value: "newest", label: t("models:sort.newest") },
    { value: "name", label: t("models:tags.sortByName") },
    { value: "models", label: t("models:collections.sortByModels") },
  ];
  const ownCount = collections.filter(isOwn).length;
  const disabled = count === 0 || busy !== null;
  const bookmarkLabel = allBookmarked
    ? t("models:collections.unbookmarkCollection")
    : t("models:collections.bookmarkCollection");

  return (
    <Stack spacing={2}>
      <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 2, rowGap: 1 }}>
        {ownCount > 0 && (
          <SelectionToolbar
            selection={selection}
            total={ownCount}
            busy={busy !== null}
            labels={{
              enter: t("models:collections.selection.enter"),
              exit: t("models:selection.exit"),
              toolbar: t("models:collections.selection.toolbar"),
              selectAllLoaded: t("common:selectAll"),
            }}
            dialogs={
              <MergeDialog
                open={mergeOpen}
                onClose={() => setMergeOpen(false)}
                kind="collection"
                items={mergeItems}
                loadPreview={() => collectionsApi.previewMerge(mergeItems.map((item) => item.key))}
                onMerge={merge}
                onUnauthorized={onUnauthorized}
              />
            }
          >
            <SelectionAction
              label={t("models:merge.action")}
              hint={t("models:merge.needTwo")}
              icon={<CallMergeIcon fontSize="small" />}
              disabled={count < 2 || busy !== null}
              onClick={() => setMergeOpen(true)}
            />
            <SelectionAction
              label={bookmarkLabel}
              icon={
                busy === "bookmark" ? (
                  <CircularProgress size={18} />
                ) : allBookmarked ? (
                  <BookmarkIcon fontSize="small" color="primary" />
                ) : (
                  <BookmarkBorderIcon fontSize="small" />
                )
              }
              disabled={disabled}
              onClick={() => void toggleBookmarks()}
            />
            <SelectionAction
              label={t("common:delete")}
              icon={
                busy === "delete" ? (
                  <CircularProgress size={18} />
                ) : (
                  <DeleteOutlineIcon fontSize="small" color={disabled ? undefined : "error"} />
                )
              }
              disabled={disabled}
              onClick={() => void removeSelected()}
            />
          </SelectionToolbar>
        )}
        <Box sx={{ ml: "auto" }}>
          <SortTabs value={sortMode} options={sortOptions} onChange={setSortMode} />
        </Box>
      </Box>

      {loading ? (
        <Box sx={cardGridSx(6)}>
          <CardSkeletons count={12} variant="collection" />
        </Box>
      ) : collections.length ? (
        <Box sx={cardGridSx(6)}>
          {sorted.map((collection) => (
            <CollectionCard
              key={collection.id}
              collection={collection}
              theme={theme}
              previewMode={previewMode}
              onUpdated={handleCollectionUpdated}
              onDeleted={handleCollectionDeleted}
              onUnauthorized={onUnauthorized}
              onBookmarksChanged={onBookmarksChanged}
              selectMode={selection.active}
              selected={selection.isSelected(collection.id)}
              onToggleSelect={(range) => selection.toggle(collection.id, range)}
            />
          ))}
        </Box>
      ) : (
        <Stack alignItems="center" spacing={1.5} sx={{ py: 8, color: "text.secondary" }}>
          <Typography variant="body2">{t("models:collections.empty")}</Typography>
          <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => setFormOpen(true)}>
            {t("models:collections.newCollection")}
          </Button>
        </Stack>
      )}

      {formOpen && <CollectionFormModal onClose={() => setFormOpen(false)} onSubmit={createCollection} />}
    </Stack>
  );
}
