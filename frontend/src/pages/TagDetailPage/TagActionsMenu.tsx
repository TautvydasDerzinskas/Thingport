import { useState } from "react";
import { useTranslation } from "react-i18next";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import DownloadIcon from "@mui/icons-material/Download";
import DownloadZipConfirmDialog from "../../components/DownloadZipConfirmDialog";

type Props = {
  tag: string;
  onUnauthorized?: () => void;
};

/** The tag detail page's title-row "..." menu -- just "Download all Tag models as zip" for now
 *  (every print carrying this tag, across every category; see DownloadZipConfirmDialog), same
 *  shape as CollectionActionsMenu's own download item. A single-item menu still earns its own
 *  dropdown rather than a bare icon button: it reads as the same affordance as every other
 *  detail page's "..." menu, and leaves room to grow without another layout change later. */
export default function TagActionsMenu({ tag, onUnauthorized }: Props) {
  const { t } = useTranslation(["models", "common"]);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [downloadOpen, setDownloadOpen] = useState(false);

  const closeMenu = () => setAnchorEl(null);

  return (
    <>
      <IconButton size="small" onClick={e => setAnchorEl(e.currentTarget)} aria-label={t("common:more") ?? undefined}>
        <MoreVertIcon fontSize="small" />
      </IconButton>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={closeMenu}>
        <MenuItem onClick={() => { closeMenu(); setDownloadOpen(true); }}>
          <ListItemIcon><DownloadIcon fontSize="small" /></ListItemIcon>
          <ListItemText>{t("models:tags.downloadAllZip")}</ListItemText>
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
