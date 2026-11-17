import { useTranslation } from "react-i18next";
import Divider from "@mui/material/Divider";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import LinkIcon from "@mui/icons-material/Link";
import DriveFileRenameOutlineIcon from "@mui/icons-material/DriveFileRenameOutline";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";

/** Where the menu opens: beside the ⋮ that opened it, or at the pointer for a right-click. */
export type FileMenuAnchor = { element: HTMLElement } | { top: number; left: number } | null;

export type FileMenuActions = {
  /** Left out where the file is already open, as in the viewer. */
  onOpen?: () => void;
  /** Left out where they're buttons of their own already, as in the viewer's header. */
  onOpenInTab?: () => void;
  onDownload?: () => void;
  /** Left out where there's no page to link to yet, as for a file still to be saved. */
  onCopyLink?: () => void;
  /** The owner's alone. */
  onRename?: () => void;
  onRemove?: () => void;
};

/** A supporting file's actions: everything that uses it, then what changes it, then removing it. */
export default function SupportingFileMenu({
  anchor,
  onClose,
  ...actions
}: { anchor: FileMenuAnchor; onClose: () => void } & FileMenuActions) {
  const { t } = useTranslation(["models", "common"]);
  const run = (action?: () => void) => () => {
    onClose();
    action?.();
  };
  const owned = Boolean(actions.onRename || actions.onRemove);
  return (
    <Menu
      open={Boolean(anchor)}
      onClose={onClose}
      anchorEl={anchor && "element" in anchor ? anchor.element : undefined}
      anchorReference={anchor && "top" in anchor ? "anchorPosition" : "anchorEl"}
      anchorPosition={anchor && "top" in anchor ? anchor : undefined}
      // A right-click on the menu itself is the browser's, not another of ours.
      onContextMenu={(event) => event.preventDefault()}
      slotProps={{ paper: { sx: { minWidth: 220 } } }}
    >
      {actions.onOpen && (
        <MenuItem onClick={run(actions.onOpen)}>
          <ListItemIcon>
            <VisibilityOutlinedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t("models:supporting.open")}</ListItemText>
        </MenuItem>
      )}
      {actions.onOpenInTab && (
        <MenuItem onClick={run(actions.onOpenInTab)}>
          <ListItemIcon>
            <OpenInNewIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t("models:supporting.openInTab")}</ListItemText>
        </MenuItem>
      )}
      {actions.onDownload && (
        <MenuItem onClick={run(actions.onDownload)}>
          <ListItemIcon>
            <DownloadOutlinedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t("common:download")}</ListItemText>
        </MenuItem>
      )}
      {actions.onCopyLink && (
        <MenuItem onClick={run(actions.onCopyLink)}>
          <ListItemIcon>
            <LinkIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t("models:supporting.copyLink")}</ListItemText>
        </MenuItem>
      )}
      {owned && (actions.onOpen || actions.onOpenInTab || actions.onDownload || actions.onCopyLink) && <Divider />}
      {actions.onRename && (
        <MenuItem onClick={run(actions.onRename)}>
          <ListItemIcon>
            <DriveFileRenameOutlineIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t("models:supporting.rename")}</ListItemText>
        </MenuItem>
      )}
      {actions.onRemove && actions.onRename && <Divider />}
      {actions.onRemove && (
        <MenuItem onClick={run(actions.onRemove)} sx={{ color: "error.main" }}>
          <ListItemIcon sx={{ color: "inherit" }}>
            <DeleteOutlineIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t("common:remove")}</ListItemText>
        </MenuItem>
      )}
    </Menu>
  );
}
