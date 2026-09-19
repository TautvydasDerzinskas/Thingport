import { useState } from "react";
import { useTranslation } from "react-i18next";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import CircularProgress from "@mui/material/CircularProgress";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import BookmarkIcon from "@mui/icons-material/Bookmark";
import BookmarkBorderIcon from "@mui/icons-material/BookmarkBorder";
import type { SxProps, Theme } from "@mui/material/styles";
import { UnauthorizedError } from "../../api/client";
import { type Collection, type CollectionInput, collectionsApi } from "../../api/collections";
import { useConfirm } from "../../components/ConfirmProvider";
import CollectionFormModal from "../CollectionsPage/CollectionFormModal";

type Props = {
  collection: Collection;
  onUpdated: (collection: Collection) => void;
  onUnauthorized?: () => void;
  onDeleted: () => void;
  /** Called after a successful bookmark/unbookmark so the sidebar's own bookmarked list can
   *  refetch -- same callback TagBookmarkButton/TagsPage already use for tags. */
  onBookmarksChanged?: () => void;
  /** Lets callers restyle the trigger button -- e.g. the Collections grid's hover overlay,
   *  which needs to read over an arbitrary cover photo instead of the header's plain icon. */
  triggerSx?: SxProps<Theme>;
};

/** The "..." menu for a collection: Bookmark/Remove from bookmarks, Edit (opens the same
 *  create/edit modal used from the Collections grid, prefilled) and Delete (confirm, then
 *  delete). Shared by the collection detail page's header and the Collections grid's per-card
 *  hover overlay. */
export default function CollectionActionsMenu({
  collection,
  onUpdated,
  onUnauthorized,
  onDeleted,
  onBookmarksChanged,
  triggerSx,
}: Props) {
  const { t } = useTranslation(["models", "common"]);
  const confirmDialog = useConfirm();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [bookmarking, setBookmarking] = useState(false);

  const closeMenu = () => setAnchorEl(null);

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

  const handleEdit = async (input: CollectionInput) => {
    try {
      onUpdated(await collectionsApi.update(collection.id, input));
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
        onClick={e => setAnchorEl(e.currentTarget)}
        aria-label={t("common:more") ?? undefined}
        disabled={deleting || bookmarking}
        sx={triggerSx}
      >
        {deleting ? <CircularProgress size={18} /> : <MoreVertIcon fontSize="small" />}
      </IconButton>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={closeMenu}>
        <MenuItem onClick={handleToggleBookmark}>
          <ListItemIcon>
            {collection.bookmarked ? <BookmarkIcon fontSize="small" color="primary" /> : <BookmarkBorderIcon fontSize="small" />}
          </ListItemIcon>
          <ListItemText>
            {collection.bookmarked ? t("models:collections.unbookmarkCollection") : t("models:collections.bookmarkCollection")}
          </ListItemText>
        </MenuItem>
        <MenuItem onClick={() => { closeMenu(); setEditOpen(true); }}>
          <ListItemIcon><EditIcon fontSize="small" /></ListItemIcon>
          <ListItemText>{t("common:edit")}</ListItemText>
        </MenuItem>
        <MenuItem onClick={handleDelete}>
          <ListItemIcon><DeleteIcon fontSize="small" color="error" /></ListItemIcon>
          <ListItemText sx={{ color: "error.main" }}>{t("common:delete")}</ListItemText>
        </MenuItem>
      </Menu>

      {editOpen && (
        <CollectionFormModal collection={collection} onClose={() => setEditOpen(false)} onSubmit={handleEdit} />
      )}
    </>
  );
}
