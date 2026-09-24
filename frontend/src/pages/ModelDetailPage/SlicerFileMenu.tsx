import { useTranslation } from "react-i18next";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import ListSubheader from "@mui/material/ListSubheader";
import Box from "@mui/material/Box";
import PrintIcon from "@mui/icons-material/Print";
import PlateThumbnail from "../../components/media/PlateThumbnail";
import { fileRowText } from "./fileRowText";
import type { SlicerTarget } from "./useOpenInSlicer";

type Props = {
  anchorEl: HTMLElement | null;
  onClose: () => void;
  slicerLabel: string;
  targets: SlicerTarget[];
  /** Called as a target's link is followed (e.g. to bump the print count). */
  onOpen: () => void;
  /** Opens directly below the anchor at exactly its width -- for a full-width button, so the menu
   *  reads as that button's dropdown. Off for a small anchor like an icon button. */
  matchAnchorWidth?: boolean;
};

/** "Open in {Slicer}" for a model with more than one file: pick which one to hand the slicer,
 *  rather than always the first. Each row is a real link to the slicer's URL protocol. */
export default function SlicerFileMenu({ anchorEl, onClose, slicerLabel, targets, onOpen, matchAnchorWidth = false }: Props) {
  const { t } = useTranslation(["models"]);
  const paperSx = matchAnchorWidth && anchorEl ? { width: anchorEl.offsetWidth } : { maxWidth: 360 };
  return (
    <Menu
      anchorEl={anchorEl}
      open={Boolean(anchorEl)}
      onClose={onClose}
      {...(matchAnchorWidth && {
        anchorOrigin: { vertical: "bottom", horizontal: "left" },
        transformOrigin: { vertical: "top", horizontal: "left" },
      })}
      slotProps={{ paper: { sx: paperSx } }}
    >
      <ListSubheader sx={{ lineHeight: "32px" }}>{t("models:detail.openInSlicer", { slicer: slicerLabel })}</ListSubheader>
      {targets.map(target => {
        const text = target.plate
          ? fileRowText(t, target.filename, target.index)
          : { primary: t("models:detail.preparedPrintFile"), secondary: target.filename };
        return (
          <MenuItem
            key={target.key}
            component="a"
            href={target.href}
            title={target.filename}
            onClick={() => {
              onOpen();
              onClose();
            }}
          >
            <ListItemIcon sx={{ minWidth: 44 }}>
              {target.plate ? (
                <PlateThumbnail plate={target.plate} />
              ) : (
                <Box sx={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <PrintIcon fontSize="small" />
                </Box>
              )}
            </ListItemIcon>
            <ListItemText
              {...text}
              primaryTypographyProps={{ variant: "body2", noWrap: true }}
              secondaryTypographyProps={{ variant: "caption", noWrap: true }}
            />
          </MenuItem>
        );
      })}
    </Menu>
  );
}
