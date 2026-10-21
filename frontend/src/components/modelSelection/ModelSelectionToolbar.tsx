import { useEffect, useState } from "react";
import type React from "react";
import { useTranslation } from "react-i18next";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import CircularProgress from "@mui/material/CircularProgress";
import PlaylistAddIcon from "@mui/icons-material/PlaylistAdd";
import PlaylistRemoveIcon from "@mui/icons-material/PlaylistRemove";
import StarIcon from "@mui/icons-material/Star";
import StarBorderIcon from "@mui/icons-material/StarBorder";
import DownloadIcon from "@mui/icons-material/Download";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import AutoFixNormalIcon from "@mui/icons-material/AutoFixNormal";
import { UnauthorizedError } from "../../api/client";
import { BULK_LIMIT, type Print, printsApi } from "../../api/prints";
import { AiCategorizationError, aiCategorizationApi } from "../../api/aiCategorization";
import { aiDescriptionsApi } from "../../api/aiDescriptions";
import { collectionsApi } from "../../api/collections";
import type { ModelSelection } from "../../hooks/useModelSelection";
import { useAiDescriptionRun, useAiRun } from "../Layout/AiRunContext";
import { useConfirm } from "../ConfirmProvider";
import { useToast } from "../ToastProvider";
import DownloadZipConfirmDialog from "../DownloadZipConfirmDialog";
import BulkAddToCollectionDialog from "./BulkAddToCollectionDialog";
import SelectionToolbar, { SelectionAction } from "../selection/SelectionToolbar";

type Props = {
  selection: ModelSelection;
  /** Models the grid has loaded: "select all" takes these. */
  total: number;
  /** More are still to load, so "select all" says it only takes the loaded ones. */
  hasMore?: boolean;
  onDeleted: (ids: string[]) => void;
  onUpdated: (prints: Print[]) => void;
  onUnauthorized?: () => void;
  /** Only for a real collection; shows "Remove from collection". */
  collectionId?: string;
  onRemovedFromCollection?: (ids: string[]) => void;
};

type Busy = "favorite" | "removeFromCollection" | "delete" | "ai" | null;

/** A grid's select-mode toggle and, while it's on, the actions for the selected models. */
export default function ModelSelectionToolbar({
  selection,
  total,
  hasMore = false,
  onDeleted,
  onUpdated,
  onUnauthorized,
  collectionId,
  onRemovedFromCollection,
}: Props) {
  const { t } = useTranslation(["models", "common"]);
  const confirm = useConfirm();
  const showToast = useToast();
  const categorization = useAiRun();
  const descriptions = useAiDescriptionRun();
  const [aiEnabled, setAiEnabled] = useState(false);
  const [descriptionsEnabled, setDescriptionsEnabled] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [aiMenuAnchor, setAiMenuAnchor] = useState<HTMLElement | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const { active, selected } = selection;
  const ids = selected.map((item) => item.id);
  const count = ids.length;
  const allFavorite = count > 0 && selected.every((item) => item.is_favorite);
  const disabled = count === 0 || busy !== null;
  // An AI run is one request, so unlike delete and favourite it can't be split.
  const tooManyForAi = count > BULK_LIMIT;

  // Both statuses are cached for the session, so this costs nothing after the first grid.
  useEffect(() => {
    if (!active) return;
    let live = true;
    void aiCategorizationApi
      .status()
      .then((status) => live && setAiEnabled(status.enabled))
      .catch(() => undefined);
    void aiDescriptionsApi
      .status()
      .then((status) => live && setDescriptionsEnabled(status.enabled))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [active]);

  const failed = (err: unknown, fallback: string) => {
    if (err instanceof UnauthorizedError) {
      onUnauthorized?.();
      return;
    }
    console.error(err);
    showToast({ message: err instanceof Error ? err.message : fallback, severity: "error" });
  };

  const toggleFavorite = async () => {
    setBusy("favorite");
    const favorite = !allFavorite;
    try {
      onUpdated(await printsApi.bulkFavorite(ids, favorite));
      showToast({
        message: t(favorite ? "models:selection.favorited" : "models:selection.unfavorited", { count }),
      });
    } catch (err) {
      failed(err, t("models:detail.favoriteFailed"));
    } finally {
      setBusy(null);
    }
  };

  const removeFromCollection = async () => {
    if (!collectionId) return;
    const confirmed = await confirm({
      message: t("models:selection.confirmRemoveFromCollection", { count }),
      confirmLabel: t("common:remove"),
    });
    if (!confirmed) return;
    setBusy("removeFromCollection");
    try {
      await collectionsApi.removeItems(collectionId, ids);
      onRemovedFromCollection?.(ids);
      showToast({ message: t("models:selection.removedFromCollection", { count }) });
    } catch (err) {
      failed(err, t("models:detail.removeFromCollectionFailed"));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    const confirmed = await confirm({
      message: t("models:selection.confirmDelete", { count }),
      destructive: true,
    });
    if (!confirmed) return;
    setBusy("delete");
    try {
      const result = await printsApi.bulkDelete(ids);
      onDeleted(result.deleted);
      if (result.failed) {
        showToast({ message: t("models:selection.deletePartlyFailed", { count: result.failed }), severity: "error" });
      } else {
        showToast({ message: t("models:selection.deleted", { count: result.deleted.length }) });
      }
    } catch (err) {
      failed(err, t("models:detail.deleteFailed"));
    } finally {
      setBusy(null);
    }
  };

  const runFailed = (err: unknown, fallback: string) => {
    if (err instanceof AiCategorizationError && err.code === "running") {
      showToast({ message: t("models:selection.aiRunActive"), severity: "warning" });
    } else failed(err, fallback);
  };

  const categorize = async () => {
    setAiMenuAnchor(null);
    // Ones with a category picked by hand, or set before anything recorded how: replacing those is the user's call.
    const handPicked = selected.filter(
      (item) =>
        item.category_id &&
        item.category_kind !== "folder" &&
        item.category_source !== "ai" &&
        item.category_source !== "rule",
    ).length;
    const includeManual =
      handPicked > 0
        ? await confirm({
            message: t("models:selection.confirmManual", { count: handPicked }),
            confirmLabel: t("models:selection.includeManual"),
            cancelLabel: t("models:selection.skipManual"),
          })
        : false;
    // Dismissed: neither "include" nor "skip", so nothing runs.
    if (includeManual === null) return;
    setBusy("ai");
    try {
      await categorization.startRun({
        include_uncategorized: true,
        include_folders: true,
        include_ai: true,
        include_rule: true,
        include_manual: includeManual,
        print_ids: ids,
      });
      showToast({ message: t("models:selection.categorizeQueued", { count }) });
    } catch (err) {
      runFailed(err, t("models:aiCategorization.failed"));
    } finally {
      setBusy(null);
    }
  };

  const improveDescriptions = async () => {
    setAiMenuAnchor(null);
    setBusy("ai");
    try {
      await descriptions.startRun(ids);
      showToast({ message: t("models:selection.improveQueued", { count }) });
    } catch (err) {
      runFailed(err, t("models:aiDescriptions.failed"));
    } finally {
      setBusy(null);
    }
  };

  const action = (label: string, icon: React.ReactNode, onClick: (e: React.MouseEvent<HTMLElement>) => void) => (
    <SelectionAction label={label} icon={icon} disabled={disabled} onClick={onClick} />
  );

  const aiHint = (running: boolean) =>
    running
      ? t("models:selection.aiRunActive")
      : tooManyForAi
        ? t("models:selection.aiTooMany", { max: BULK_LIMIT })
        : undefined;

  const favoriteLabel = allFavorite ? t("models:detail.removeFromFavorites") : t("models:detail.addToFavorites");

  return (
    <SelectionToolbar
      selection={selection}
      total={total}
      hasMore={hasMore}
      busy={busy !== null}
      labels={{
        enter: t("models:selection.enter"),
        exit: t("models:selection.exit"),
        toolbar: t("models:selection.toolbar"),
        selectAllLoaded: t("models:selection.selectAllLoaded"),
      }}
      dialogs={
        <>
          <Menu anchorEl={aiMenuAnchor} open={Boolean(aiMenuAnchor)} onClose={() => setAiMenuAnchor(null)}>
            {aiEnabled && (
              <MenuItem onClick={() => void categorize()} disabled={categorization.running || tooManyForAi}>
                <ListItemIcon>
                  <AutoAwesomeIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText secondary={aiHint(categorization.running)}>
                  {t("models:aiCategorization.categorize")}
                </ListItemText>
              </MenuItem>
            )}
            {descriptionsEnabled && (
              <MenuItem onClick={() => void improveDescriptions()} disabled={descriptions.running || tooManyForAi}>
                <ListItemIcon>
                  <AutoFixNormalIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText secondary={aiHint(descriptions.running)}>
                  {t("models:selection.improveDescriptions")}
                </ListItemText>
              </MenuItem>
            )}
          </Menu>

          <BulkAddToCollectionDialog
            open={addOpen}
            onClose={() => setAddOpen(false)}
            printIds={ids}
            onUnauthorized={onUnauthorized}
          />
          <DownloadZipConfirmDialog
            open={downloadOpen}
            onClose={() => setDownloadOpen(false)}
            filter={{ print_ids: ids }}
            filename="thingport.zip"
            title={t("models:selection.downloadTitle", { count })}
            onUnauthorized={onUnauthorized}
          />
        </>
      }
    >
      {action(t("models:detail.addToCollection"), <PlaylistAddIcon fontSize="small" />, () => setAddOpen(true))}
      {collectionId &&
        action(
          t("models:detail.removeFromCollection"),
          busy === "removeFromCollection" ? <CircularProgress size={18} /> : <PlaylistRemoveIcon fontSize="small" />,
          () => void removeFromCollection(),
        )}
      {action(
        favoriteLabel,
        busy === "favorite" ? (
          <CircularProgress size={18} />
        ) : allFavorite ? (
          <StarIcon fontSize="small" sx={{ color: "warning.main" }} />
        ) : (
          <StarBorderIcon fontSize="small" />
        ),
        () => void toggleFavorite(),
      )}
      {action(t("common:download"), <DownloadIcon fontSize="small" />, () => setDownloadOpen(true))}
      {action(
        t("common:delete"),
        busy === "delete" ? (
          <CircularProgress size={18} />
        ) : (
          <DeleteOutlineIcon fontSize="small" color={disabled ? undefined : "error"} />
        ),
        () => void remove(),
      )}
      {(aiEnabled || descriptionsEnabled) &&
        action(
          t("models:selection.aiActions"),
          busy === "ai" ? <CircularProgress size={18} /> : <AutoAwesomeIcon fontSize="small" />,
          (e) => setAiMenuAnchor(e.currentTarget),
        )}
    </SelectionToolbar>
  );
}
