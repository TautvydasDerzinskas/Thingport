import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import LinkIcon from "@mui/icons-material/Link";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import { useTranslation } from "react-i18next";
import type { SendTargetSummary } from "../../api/sendTargets";
import { SendKindIcon, kindOf } from "../sendTo/sendKinds";

/** Where the menu opens: beside the ⋮ that opened it, or at the pointer for a right-click. */
export type FileMenuAnchor = { element: HTMLElement } | { top: number; left: number };

const NO_TARGETS: SendTargetSummary[] = [];

/** A supporting file's actions: opening, downloading and linking to it, then each of the user's Send to places that
 *  takes it. */
export default function SupportingFileMenu({
  anchor,
  onClose,
  onOpen,
  onDownload,
  onCopyLink,
  sendTargets = NO_TARGETS,
  sending,
  onSend,
}: {
  anchor: FileMenuAnchor | null;
  onClose: () => void;
  /** Left out where there's no viewer, as on a partner's model. */
  onOpen?: () => void;
  /** Left out where there's nothing to download, as for a partner's file it gave no address for. */
  onDownload?: () => void;
  /** Left out where there's no page of the file's to link to, as on a partner's model. */
  onCopyLink?: () => void;
  sendTargets?: SendTargetSummary[];
  sending?: ReadonlySet<string>;
  onSend?: (target: SendTargetSummary) => void;
}) {
  const { t } = useTranslation(["common", "models"]);
  const run = (action: () => void) => () => {
    onClose();
    action();
  };
  return (
    <Menu
      open={Boolean(anchor)}
      onClose={onClose}
      anchorEl={anchor && "element" in anchor ? anchor.element : undefined}
      anchorReference={anchor && "top" in anchor ? "anchorPosition" : "anchorEl"}
      anchorPosition={anchor && "top" in anchor ? anchor : undefined}
      // Under the ⋮, opening inwards from the row's edge; a right-click's opens from the pointer, as a context menu does.
      anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      transformOrigin={{ vertical: "top", horizontal: anchor && "top" in anchor ? "left" : "right" }}
      // A right-click on the menu itself is the browser's, not another of ours.
      onContextMenu={(event) => event.preventDefault()}
      slotProps={{ paper: { sx: { minWidth: 220 } } }}
    >
      {onOpen && (
        <MenuItem onClick={run(onOpen)}>
          <ListItemIcon>
            <VisibilityOutlinedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t("models:supporting.open")}</ListItemText>
        </MenuItem>
      )}
      {onDownload && (
        <MenuItem onClick={run(onDownload)}>
          <ListItemIcon>
            <DownloadOutlinedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t("common:download")}</ListItemText>
        </MenuItem>
      )}
      {onCopyLink && (
        <MenuItem onClick={run(onCopyLink)}>
          <ListItemIcon>
            <LinkIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t("models:supporting.copyLink")}</ListItemText>
        </MenuItem>
      )}
      {(onOpen || onDownload || onCopyLink) && sendTargets.length > 0 && <Divider />}
      {sendTargets.map((target) => (
        <MenuItem key={target.id} disabled={sending?.has(target.id)} onClick={run(() => onSend?.(target))}>
          <ListItemIcon>
            {sending?.has(target.id) ? (
              <CircularProgress size={16} color="inherit" />
            ) : (
              <SendKindIcon kind={kindOf(target)} size={22} />
            )}
          </ListItemIcon>
          <ListItemText primaryTypographyProps={{ variant: "body2" }}>{target.name}</ListItemText>
        </MenuItem>
      ))}
    </Menu>
  );
}
