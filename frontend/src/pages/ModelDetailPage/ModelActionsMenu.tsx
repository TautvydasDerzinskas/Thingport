import { useState } from "react";
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
import LaunchIcon from "@mui/icons-material/Launch";
import type { SxProps, Theme } from "@mui/material/styles";
import { UnauthorizedError } from "../../api/client";
import { type Print, printsApi } from "../../api/prints";
import type { AuthUser } from "../../api/auth";
import { collectionsApi } from "../../api/collections";
import { useConfirm } from "../../components/ConfirmProvider";
import { importProviderInfo } from "../../constants/importProviders";
import { useDownloadPrint } from "./useDownloadPrint";
import { useOpenInSlicer } from "./useOpenInSlicer";
import SlicerFileMenu from "./SlicerFileMenu";
import DownloadPickerDialog from "./DownloadPickerDialog";
import AddToCollectionModal from "./AddToCollectionModal";
import EditModelModal from "./EditModelModal";

type Props = {
  print: Print;
  onUnauthorized?: () => void;
  onDeleted: () => void;
  /** Called with the fresh print after a successful Edit-modal update, so the grid card / detail
   *  page it's rendered in can refresh without a full refetch -- same shape as onFavoriteChange. */
  onUpdated?: (print: Print) => void;
  /** Set only while browsing an actual (non-system) collection -- shows "Remove from collection"
   *  above Delete. Favourites/Browsing History have no real membership to drop (see
   *  collectionsApi.removeItem's doc comment), so callers there simply don't pass this. */
  collectionId?: string;
  onRemovedFromCollection?: () => void;
  /** Lets callers restyle the trigger button -- e.g. the Models grid's hover overlay, which
   *  needs to read over an arbitrary thumbnail instead of the detail page header's plain icon. */
  triggerSx?: SxProps<Theme>;
  /** Overrides the trigger icon's glyph size in px -- default (undefined) keeps the standard
   *  fontSize="small" (20px) used everywhere else. Only the Models grid hover overlay bumps
   *  this, to stay legible now that it no longer sits on a dark circular backdrop. */
  iconFontSize?: number;
  /** Passed straight through to EditModelModal's own `viewer` fallback -- see its doc comment. */
  viewer?: AuthUser | null;
};

/** The "..." menu for a model: "Add to collection" (opens the chip-toggle picker), "Remove from
 *  collection" (only while browsing one -- grouped right after Add, its counterpart), Download
 *  (single file, or a plate picker / zip-all for multi-plate models), Edit (opens EditModelModal,
 *  driven by a `?edit=<id>` URL param -- see openEdit/closeEdit below), Delete (confirm, then
 *  delete), then a divider followed by the two "leaves the app" actions grouped together: "Open
 *  in {Slicer}" (launches the user's preferred slicer via its own URL protocol -- disabled when
 *  no slicer is set, or it's set to "Other") and -- only for an imported print -- "Open in
 *  {Provider}" linking back to the original model page. Shared by the model detail page's header
 *  and the Models/Collection grids' per-card hover overlay. */
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
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [slicerMenuAnchor, setSlicerMenuAnchor] = useState<HTMLElement | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [removingFromCollection, setRemovingFromCollection] = useState(false);
  const [addToCollectionOpen, setAddToCollectionOpen] = useState(false);
  // Driven by the URL (?edit=<id>) rather than local state, per spec -- lets a direct link (or the
  // back button) open/close it too, and lets the grid-card trigger below just navigate there.
  const editOpen = searchParams.get("edit") === print.id;
  const { pickerOpen, setPickerOpen, downloading, handleDownload, downloadPlate, downloadAllZip, sortedPlates, recordUse } =
    useDownloadPrint(print, onUnauthorized, onUpdated);

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

  const providerInfo = importProviderInfo(print.source_provider);
  const { slicerOption, targets: slicerTargets } = useOpenInSlicer(print);
  const openInSlicerHref = slicerTargets.length === 1 ? slicerTargets[0].href : undefined;

  return (
    <>
      <Tooltip title={t("common:moreActions")}>
        <span>
          <IconButton
            size="small"
            onClick={e => setAnchorEl(e.currentTarget)}
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
        <MenuItem onClick={() => { closeMenu(); setAddToCollectionOpen(true); }}>
          <ListItemIcon><PlaylistAddIcon fontSize="small" /></ListItemIcon>
          <ListItemText>{t("models:detail.addToCollection")}</ListItemText>
        </MenuItem>
        {collectionId && (
          <MenuItem onClick={handleRemoveFromCollection}>
            <ListItemIcon><PlaylistRemoveIcon fontSize="small" /></ListItemIcon>
            <ListItemText>{t("models:detail.removeFromCollection")}</ListItemText>
          </MenuItem>
        )}
        <MenuItem onClick={onDownloadClick} disabled={downloading}>
          <ListItemIcon><DownloadIcon fontSize="small" /></ListItemIcon>
          <ListItemText>{t("common:download")}</ListItemText>
        </MenuItem>
        <MenuItem onClick={openEdit}>
          <ListItemIcon><EditIcon fontSize="small" /></ListItemIcon>
          <ListItemText>{t("common:edit")}</ListItemText>
        </MenuItem>
        <MenuItem onClick={handleDelete}>
          <ListItemIcon><DeleteIcon fontSize="small" color="error" /></ListItemIcon>
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
          <ListItemIcon><LaunchIcon fontSize="small" /></ListItemIcon>
          <ListItemText>
            {slicerOption
              ? t("models:detail.openInSlicer", { slicer: slicerOption.label })
              : t("models:detail.openInSlicerGeneric")}
          </ListItemText>
        </MenuItem>
        {providerInfo && print.source_url && (
          <MenuItem
            component="a"
            href={print.source_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={closeMenu}
          >
            <ListItemIcon><OpenInNewIcon fontSize="small" /></ListItemIcon>
            <ListItemText>{t("models:detail.openInProvider", { provider: providerInfo.label })}</ListItemText>
          </MenuItem>
        )}
      </Menu>

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
    </>
  );
}
