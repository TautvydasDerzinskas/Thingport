import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Divider from "@mui/material/Divider";
import CircularProgress from "@mui/material/CircularProgress";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import DownloadIcon from "@mui/icons-material/Download";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import PlaylistAddIcon from "@mui/icons-material/PlaylistAdd";
import PlaylistRemoveIcon from "@mui/icons-material/PlaylistRemove";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import LaunchIcon from "@mui/icons-material/Launch";
import type { SxProps, Theme } from "@mui/material/styles";
import { UnauthorizedError } from "../../api/client";
import { type Print, PrintApiError, printsApi } from "../../api/prints";
import { aiCategorizationApi } from "../../api/aiCategorization";
import { useToast } from "../../components/ToastProvider";
import type { AuthUser } from "../../api/auth";
import { collectionsApi } from "../../api/collections";
import { useConfirm } from "../../components/ConfirmProvider";
import { importProviderInfo } from "../../constants/importProviders";
import { useDownloadPrint } from "./useDownloadPrint";
import { useOpenInSlicer } from "./useOpenInSlicer";
import SlicerFileMenu from "./SlicerFileMenu";
import NormalizeInfoIcon from "./NormalizeInfoIcon";
import { useNormalizedOpen } from "./useNormalizedOpen";
import DownloadPickerDialog from "./DownloadPickerDialog";
import AddToCollectionModal from "./AddToCollectionModal";
import EditModelModal from "./EditModelModal";
import FillGapsDialog from "./FillGapsDialog";

type Props = {
  print: Print;
  onUnauthorized?: () => void;
  onDeleted: () => void;
  onUpdated?: (print: Print) => void;
  /** Only for a real collection; shows "Remove from collection". */
  collectionId?: string;
  onRemovedFromCollection?: () => void;
  triggerSx?: SxProps<Theme>;
  /** Glyph size in px; defaults to fontSize="small". */
  iconFontSize?: number;
  viewer?: AuthUser | null;
};

/** The "..." menu for a model, shared by the detail header and grid cards. */
export default function ModelActionsMenu({
  print,
  onUnauthorized,
  onDeleted,
  onUpdated,
  collectionId,
  onRemovedFromCollection,
  triggerSx,
  iconFontSize,
  viewer,
}: Props) {
  const { t } = useTranslation(["models", "common"]);
  const confirmDialog = useConfirm();
  const showToast = useToast();
  const [aiEnabled, setAiEnabled] = useState(false);
  const [recategorizing, setRecategorizing] = useState(false);
  useEffect(() => {
    let active = true;
    void aiCategorizationApi
      .status()
      .then((status) => {
        if (active) setAiEnabled(status.enabled);
      })
      .catch((err: unknown) => {
        if (err instanceof UnauthorizedError) onUnauthorized?.();
      });
    return () => {
      active = false;
    };
  }, [onUnauthorized]);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [slicerMenuAnchor, setSlicerMenuAnchor] = useState<HTMLElement | null>(null);
  const [normalizedMenuAnchor, setNormalizedMenuAnchor] = useState<HTMLElement | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [removingFromCollection, setRemovingFromCollection] = useState(false);
  const [addToCollectionOpen, setAddToCollectionOpen] = useState(false);
  const [fillGapsOpen, setFillGapsOpen] = useState(false);
  const sourceGaps = print.source_gaps ?? [];
  // Driven by ?edit=<id> so links and the back button open/close it.
  const editOpen = searchParams.get("edit") === print.id;
  const {
    pickerOpen,
    setPickerOpen,
    downloading,
    handleDownload,
    downloadPlate,
    downloadAllZip,
    sortedPlates,
    recordUse,
  } = useDownloadPrint(print, onUnauthorized, onUpdated);

  const closeMenu = () => setAnchorEl(null);

  const openEdit = () => {
    closeMenu();
    navigate(`/models/${print.id}?edit=${print.id}`);
  };

  const closeEdit = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("edit");
    setSearchParams(next, { replace: true });
  };

  const onDownloadClick = () => {
    closeMenu();
    handleDownload();
  };

  const handleRemoveFromCollection = async () => {
    closeMenu();
    if (!collectionId) return;
    const confirmed = await confirmDialog({
      message: t("models:detail.confirmRemoveFromCollection", { name: print.title || print.name }),
      confirmLabel: t("common:remove"),
    });
    if (!confirmed) return;
    setRemovingFromCollection(true);
    try {
      await collectionsApi.removeItem(collectionId, print.id);
      onRemovedFromCollection?.();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onUnauthorized?.();
        return;
      }
      console.error(err);
      alert(t("models:detail.removeFromCollectionFailed"));
    } finally {
      setRemovingFromCollection(false);
    }
  };

  const handleDelete = async () => {
    closeMenu();
    const confirmed = await confirmDialog({
      message: t("models:detail.confirmDelete", { name: print.title || print.name }),
      destructive: true,
    });
    if (!confirmed) return;
    setDeleting(true);
    try {
      await printsApi.delete(print.id);
      onDeleted();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onUnauthorized?.();
        return;
      }
      console.error(err);
      alert(t("models:detail.deleteFailed"));
    } finally {
      setDeleting(false);
    }
  };

  const recategorize = async (force = false) => {
    closeMenu();
    setRecategorizing(true);
    try {
      const result = await printsApi.recategorize(print.id, force);
      onUpdated?.(result.print);
      showToast({ message: t(`models:aiCategorization.outcome.${result.outcome}`) });
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else if (err instanceof PrintApiError && err.code === "manual_category" && !force) {
        const confirmed = await confirmDialog({
          message: t("models:aiCategorization.confirmManual", { name: print.title || print.name }),
          confirmLabel: t("models:aiCategorization.recategorize"),
        });
        if (confirmed) await recategorize(true);
      } else if (err instanceof PrintApiError && err.code === "folder") {
        showToast({ message: t("models:aiCategorization.folderSkipped"), severity: "warning" });
      } else {
        showToast({
          message: err instanceof Error ? err.message : t("models:aiCategorization.failed"),
          severity: "error",
        });
      }
    } finally {
      setRecategorizing(false);
    }
  };

  const providerInfo = importProviderInfo(print.source_provider);
  const { slicerOption, targets: slicerTargets, normalizedTargets } = useOpenInSlicer(print);
  const openInSlicerHref = slicerTargets.length === 1 ? slicerTargets[0].href : undefined;
  const normalized = useNormalizedOpen(print.id, recordUse, onUnauthorized);
  const normalizedMenuLabel = (slicer: string) => {
    const state = normalizedTargets.length === 1 ? normalized.stateOf(normalizedTargets[0]) : "idle";
    if (state === "preparing") return t("models:detail.normalizePreparing");
    if (state === "ready") return t("models:detail.normalizeReady", { slicer });
    return t("models:detail.openNormalizedInSlicer", { slicer });
  };

  return (
    <>
      <Tooltip title={t("common:moreActions")}>
        <span>
          <IconButton
            size="small"
            onClick={(e) => setAnchorEl(e.currentTarget)}
            aria-label={t("common:moreActions") ?? undefined}
            disabled={deleting || removingFromCollection}
            sx={triggerSx}
          >
            {deleting || removingFromCollection ? (
              <CircularProgress size={18} />
            ) : iconFontSize ? (
              <MoreVertIcon sx={{ fontSize: iconFontSize }} />
            ) : (
              <MoreVertIcon fontSize="small" />
            )}
          </IconButton>
        </span>
      </Tooltip>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={closeMenu}>
        <MenuItem
          onClick={() => {
            closeMenu();
            setAddToCollectionOpen(true);
          }}
        >
          <ListItemIcon>
            <PlaylistAddIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t("models:detail.addToCollection")}</ListItemText>
        </MenuItem>
        {collectionId && (
          <MenuItem onClick={handleRemoveFromCollection}>
            <ListItemIcon>
              <PlaylistRemoveIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("models:detail.removeFromCollection")}</ListItemText>
          </MenuItem>
        )}
        <MenuItem onClick={onDownloadClick} disabled={downloading}>
          <ListItemIcon>
            <DownloadIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t("common:download")}</ListItemText>
        </MenuItem>
        <MenuItem onClick={openEdit}>
          <ListItemIcon>
            <EditIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t("common:edit")}</ListItemText>
        </MenuItem>
        {aiEnabled && (
          <MenuItem onClick={() => void recategorize()} disabled={recategorizing}>
            <ListItemIcon>
              {recategorizing ? <CircularProgress size={18} /> : <AutoAwesomeIcon fontSize="small" />}
            </ListItemIcon>
            <ListItemText>{t("models:aiCategorization.recategorize")}</ListItemText>
          </MenuItem>
        )}
        <MenuItem onClick={handleDelete}>
          <ListItemIcon>
            <DeleteIcon fontSize="small" color="error" />
          </ListItemIcon>
          <ListItemText sx={{ color: "error.main" }}>{t("common:delete")}</ListItemText>
        </MenuItem>
        <Divider />
        {/* One target: a plain link to it. Several: this menu hands over to SlicerFileMenu,
            anchored on the same trigger, to pick which. */}
        <MenuItem
          component="a"
          href={openInSlicerHref}
          onClick={() => {
            if (slicerTargets.length > 1) {
              setSlicerMenuAnchor(anchorEl);
              closeMenu();
              return;
            }
            closeMenu();
            recordUse();
          }}
          disabled={slicerTargets.length === 0}
        >
          <ListItemIcon>
            <LaunchIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>
            {slicerOption
              ? t("models:detail.openInSlicer", { slicer: slicerOption.label })
              : t("models:detail.openInSlicerGeneric")}
          </ListItemText>
        </MenuItem>
        {slicerOption && normalizedTargets.length > 0 && (
          <MenuItem
            disabled={normalizedTargets.length === 1 && normalized.stateOf(normalizedTargets[0]) === "preparing"}
            onClick={() => {
              if (normalizedTargets.length > 1) {
                setNormalizedMenuAnchor(anchorEl);
                closeMenu();
                return;
              }
              // Stays open while preparing, so the item can show progress and then "ready".
              void normalized.open(normalizedTargets[0]).then((launched) => launched && closeMenu());
            }}
            sx={{ color: "warning.main" }}
          >
            <ListItemIcon sx={{ color: "inherit" }}>
              {normalizedTargets.length === 1 && normalized.stateOf(normalizedTargets[0]) === "preparing" ? (
                <CircularProgress size={18} color="inherit" />
              ) : (
                <NormalizeInfoIcon slicerLabel={slicerOption.label} />
              )}
            </ListItemIcon>
            <ListItemText>{normalizedMenuLabel(slicerOption.label)}</ListItemText>
          </MenuItem>
        )}
        {providerInfo && print.source_url && (
          <MenuItem component="a" href={print.source_url} target="_blank" rel="noopener noreferrer" onClick={closeMenu}>
            <ListItemIcon>
              <OpenInNewIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("models:detail.openInProvider", { provider: providerInfo.label })}</ListItemText>
          </MenuItem>
        )}
        {providerInfo && print.source_url && sourceGaps.length > 0 && (
          <MenuItem
            onClick={() => {
              closeMenu();
              setFillGapsOpen(true);
            }}
          >
            <ListItemIcon>
              <AutoFixHighIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("models:detail.fillGaps", { provider: providerInfo.label })}</ListItemText>
          </MenuItem>
        )}
      </Menu>

      {slicerOption && normalizedTargets.length > 1 && (
        <SlicerFileMenu
          anchorEl={normalizedMenuAnchor}
          onClose={() => setNormalizedMenuAnchor(null)}
          slicerLabel={slicerOption.label}
          title={t("models:detail.openNormalizedInSlicer", { slicer: slicerOption.label })}
          targets={normalizedTargets}
          onOpen={recordUse}
          normalized={normalized}
        />
      )}
      {slicerOption && slicerTargets.length > 1 && (
        <SlicerFileMenu
          anchorEl={slicerMenuAnchor}
          onClose={() => setSlicerMenuAnchor(null)}
          slicerLabel={slicerOption.label}
          targets={slicerTargets}
          onOpen={recordUse}
        />
      )}

      <DownloadPickerDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        downloading={downloading}
        sortedPlates={sortedPlates}
        downloadAllZip={downloadAllZip}
        downloadPlate={downloadPlate}
      />

      <AddToCollectionModal
        open={addToCollectionOpen}
        onClose={() => setAddToCollectionOpen(false)}
        printId={print.id}
        onUnauthorized={onUnauthorized}
        collectionId={collectionId}
        onRemovedFromCollection={onRemovedFromCollection}
      />

      {editOpen && (
        <EditModelModal
          print={print}
          onClose={closeEdit}
          onUnauthorized={onUnauthorized}
          onUpdated={(updated) => onUpdated?.(updated)}
          viewer={viewer}
        />
      )}

      {fillGapsOpen && (
        <FillGapsDialog
          open
          print={print}
          gaps={sourceGaps}
          onClose={() => setFillGapsOpen(false)}
          onUpdated={(updated) => onUpdated?.(updated)}
          onUnauthorized={onUnauthorized}
        />
      )}
    </>
  );
}
