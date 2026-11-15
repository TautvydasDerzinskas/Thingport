import { forwardRef, useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Divider from "@mui/material/Divider";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import CircularProgress from "@mui/material/CircularProgress";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import DownloadIcon from "@mui/icons-material/Download";
import BookmarkIcon from "@mui/icons-material/Bookmark";
import BookmarkBorderIcon from "@mui/icons-material/BookmarkBorder";
import SyncIcon from "@mui/icons-material/Sync";
import GroupAddOutlinedIcon from "@mui/icons-material/GroupAddOutlined";
import type { SxProps, Theme } from "@mui/material/styles";
import { UnauthorizedError } from "../../api/client";
import {
  type Collection,
  type CollectionInput,
  type CollectionSharingPatch,
  collectionsApi,
  withSharing,
} from "../../api/collections";
import { useConfirm } from "../../components/ConfirmProvider";
import DownloadZipConfirmDialog from "../../components/DownloadZipConfirmDialog";
import CollectionFormModal from "../CollectionsPage/CollectionFormModal";
import CollectionSyncDialog from "./CollectionSyncDialog";
import { allProvidersOff, useDisabledProviders } from "../../hooks/useProviders";
import { reopenContextMenuBelow } from "../../components/Layout/ConfigurationDialog/AppTiles";
import { useSocialStatus } from "../../hooks/useSocialStatus";

export type CollectionActionsHandle = {
  /** Opens its form on who it's shared with, as Share… in the menu does. */
  openShare: () => void;
};

type Props = {
  collection: Collection;
  onUpdated: (collection: Collection) => void;
  onUnauthorized?: () => void;
  onDeleted: () => void;
  onBookmarksChanged?: () => void;
  triggerSx?: SxProps<Theme>;
  /** Opens the menu at this point instead of at the trigger, as on a right-click. */
  contextMenuAt?: { top: number; left: number } | null;
  onContextMenuClose?: () => void;
};

/** Shared by the collection detail header and the Collections grid cards. */
const CollectionActionsMenu = forwardRef<CollectionActionsHandle, Props>(function CollectionActionsMenu(
  {
    collection,
    onUpdated,
    onUnauthorized,
    onDeleted,
    onBookmarksChanged,
    triggerSx,
    contextMenuAt,
    onContextMenuClose,
  },
  ref,
) {
  const { t } = useTranslation(["models", "common"]);
  const confirmDialog = useConfirm();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  // The form, as Edit opens it, or as Share… does: on who sees it.
  const [editOpen, setEditOpen] = useState<false | "edit" | "share">(false);
  const social = useSocialStatus();
  useImperativeHandle(ref, () => ({ openShare: () => setEditOpen("share") }), []);
  const [deleting, setDeleting] = useState(false);
  const [bookmarking, setBookmarking] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const disabledProviders = useDisabledProviders();

  const closeMenu = () => {
    setAnchorEl(null);
    onContextMenuClose?.();
  };

  const handleToggleBookmark = async () => {
    closeMenu();
    if (bookmarking) return;
    setBookmarking(true);
    const next = !collection.bookmarked;
    try {
      await (next ? collectionsApi.bookmark(collection.id) : collectionsApi.unbookmark(collection.id));
      onUpdated({ ...collection, bookmarked: next });
      onBookmarksChanged?.();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onUnauthorized?.();
        return;
      }
      console.error(err);
      alert(t("models:collections.bookmarkFailed"));
    } finally {
      setBookmarking(false);
    }
  };

  const handleEdit = async (input: CollectionInput, sharing: CollectionSharingPatch | null) => {
    try {
      const updated = await collectionsApi.update(collection.id, input);
      // Saved, whatever becomes of who sees it.
      onUpdated(updated);
      if (sharing) onUpdated(withSharing(updated, await collectionsApi.updateSharing(collection.id, sharing)));
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onUnauthorized?.();
        return;
      }
      throw err;
    }
  };

  const handleDelete = async () => {
    closeMenu();
    const confirmed = await confirmDialog({
      message: t("models:collections.detail.confirmDelete", { name: collection.name }),
      destructive: true,
    });
    if (!confirmed) return;
    setDeleting(true);
    try {
      await collectionsApi.delete(collection.id);
      onDeleted();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onUnauthorized?.();
        return;
      }
      console.error(err);
      alert(t("models:collections.detail.deleteFailed"));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <IconButton
        size="small"
        onClick={(e) => setAnchorEl(e.currentTarget)}
        aria-label={t("common:more") ?? undefined}
        disabled={deleting || bookmarking}
        sx={triggerSx}
      >
        {deleting ? <CircularProgress size={18} /> : <MoreVertIcon fontSize="small" />}
      </IconButton>
      <Menu
        open={Boolean(anchorEl || contextMenuAt)}
        onClose={closeMenu}
        onContextMenu={(event) => reopenContextMenuBelow(event, closeMenu)}
        {...(contextMenuAt
          ? { anchorReference: "anchorPosition" as const, anchorPosition: contextMenuAt }
          : { anchorEl })}
      >
        <MenuItem onClick={handleToggleBookmark}>
          <ListItemIcon>
            {collection.bookmarked ? (
              <BookmarkIcon fontSize="small" color="primary" />
            ) : (
              <BookmarkBorderIcon fontSize="small" />
            )}
          </ListItemIcon>
          <ListItemText>
            {collection.bookmarked
              ? t("models:collections.unbookmarkCollection")
              : t("models:collections.bookmarkCollection")}
          </ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            closeMenu();
            setDownloadOpen(true);
          }}
        >
          <ListItemIcon>
            <DownloadIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t("models:collections.downloadAllZip")}</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            closeMenu();
            setEditOpen("edit");
          }}
        >
          <ListItemIcon>
            <EditIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t("common:edit")}</ListItemText>
        </MenuItem>
        {social?.enabled && (
          <MenuItem
            onClick={() => {
              closeMenu();
              setEditOpen("share");
            }}
          >
            <ListItemIcon>
              <GroupAddOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("models:collections.share")}</ListItemText>
          </MenuItem>
        )}
        <MenuItem onClick={handleDelete}>
          <ListItemIcon>
            <DeleteIcon fontSize="small" color="error" />
          </ListItemIcon>
          <ListItemText sx={{ color: "error.main" }}>{t("common:delete")}</ListItemText>
        </MenuItem>
        {/* Menu needs its items as direct children, not wrapped in a fragment. */}
        {/* Every collection can be synced; an unsynced one opens on Browse. With every provider turned off there's
            nothing to sync a new one with, but its sources can still be looked at or stopped. */}
        {(collection.syncs.length > 0 || !allProvidersOff(disabledProviders)) && [
          <Divider key="sync-divider" />,
          <MenuItem
            key="sync"
            onClick={() => {
              closeMenu();
              setSyncOpen(true);
            }}
          >
            <ListItemIcon>
              <SyncIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("models:collections.sync.menu")}</ListItemText>
          </MenuItem>,
        ]}
      </Menu>

      {editOpen && (
        <CollectionFormModal
          collection={collection}
          share={editOpen === "share"}
          onClose={() => setEditOpen(false)}
          onSubmit={handleEdit}
          onUnauthorized={onUnauthorized}
        />
      )}

      {syncOpen && (
        <CollectionSyncDialog
          collection={collection}
          onClose={() => setSyncOpen(false)}
          onUpdated={onUpdated}
          onUnauthorized={onUnauthorized}
        />
      )}

      <DownloadZipConfirmDialog
        open={downloadOpen}
        onClose={() => setDownloadOpen(false)}
        filter={{ collection_id: collection.id }}
        filename={`${collection.name || "collection"}.zip`}
        title={t("models:collections.downloadZipTitle", { name: collection.name })}
        onUnauthorized={onUnauthorized}
      />
    </>
  );
});

export default CollectionActionsMenu;
