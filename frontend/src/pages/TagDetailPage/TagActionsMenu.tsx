import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { SxProps, Theme } from "@mui/material/styles";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Tooltip from "@mui/material/Tooltip";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import DownloadIcon from "@mui/icons-material/Download";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { UnauthorizedError } from "../../api/client";
import { tagsApi } from "../../api/tags";
import { useConfirm } from "../../components/ConfirmProvider";
import DownloadZipConfirmDialog from "../../components/DownloadZipConfirmDialog";
import { useToast } from "../../components/ToastProvider";
import { reopenContextMenuBelow } from "../../components/Layout/ConfigurationDialog/AppTiles";

type Props = {
  tag: string;
  onUnauthorized?: () => void;
  /** After the tag is taken off its models. */
  onDeleted?: () => void;
  /** For a trigger drawn over a picture, as on a tag's tile. */
  triggerSx?: SxProps<Theme>;
  iconFontSize?: number;
  /** Opens the menu at this point instead of at the trigger, as on a right-click. */
  contextMenuAt?: { top: number; left: number } | null;
  onContextMenuClose?: () => void;
};

export default function TagActionsMenu({
  tag,
  onUnauthorized,
  onDeleted,
  triggerSx,
  iconFontSize,
  contextMenuAt,
  onContextMenuClose,
}: Props) {
  const { t } = useTranslation(["models", "common"]);
  const confirm = useConfirm();
  const showToast = useToast();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const closeMenu = () => {
    setAnchorEl(null);
    onContextMenuClose?.();
  };

  const deleteTag = async () => {
    const ok = await confirm({
      title: t("models:tags.deleteTitle", { name: tag }),
      message: t("models:tags.deleteMessage"),
      confirmLabel: t("models:tags.deleteConfirm"),
      destructive: true,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      const { models } = await tagsApi.remove(tag);
      showToast({ message: t("models:tags.deleted", { name: tag, count: models }) });
      onDeleted?.();
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else showToast({ message: t("models:tags.deleteFailed"), severity: "error" });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <Tooltip title={t("common:moreActions")}>
        <span>
          <IconButton
            size="small"
            onClick={(e) => setAnchorEl(e.currentTarget)}
            aria-label={t("common:moreActions") ?? undefined}
            disabled={deleting}
            sx={triggerSx}
          >
            {deleting ? (
              <CircularProgress size={iconFontSize ?? 18} />
            ) : (
              <MoreVertIcon sx={iconFontSize ? { fontSize: iconFontSize } : undefined} fontSize="small" />
            )}
          </IconButton>
        </span>
      </Tooltip>
      <Menu
        open={Boolean(anchorEl || contextMenuAt)}
        onClose={closeMenu}
        onContextMenu={(event) => reopenContextMenuBelow(event, closeMenu)}
        {...(contextMenuAt
          ? { anchorReference: "anchorPosition" as const, anchorPosition: contextMenuAt }
          : { anchorEl })}
      >
        <MenuItem
          onClick={() => {
            closeMenu();
            setDownloadOpen(true);
          }}
        >
          <ListItemIcon>
            <DownloadIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t("models:tags.downloadAllZip")}</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            closeMenu();
            void deleteTag();
          }}
          sx={{ color: "error.main" }}
        >
          <ListItemIcon sx={{ color: "inherit" }}>
            <DeleteOutlineIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t("models:tags.deleteTag")}</ListItemText>
        </MenuItem>
      </Menu>

      <DownloadZipConfirmDialog
        open={downloadOpen}
        onClose={() => setDownloadOpen(false)}
        filter={{ tag }}
        filename={`${tag || "tag"}.zip`}
        title={t("models:tags.downloadZipTitle", { name: tag })}
        onUnauthorized={onUnauthorized}
      />
    </>
  );
}
