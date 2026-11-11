import { useMemo } from "react";
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
import { folderLabel, shortNames } from "../../utils/fileFolders";
import type { SlicerTarget } from "./useOpenInSlicer";
import type { AdaptState } from "./useAdaptedOpen";

/** An element, or a bare point for a menu opened by right-click. */
export type MenuAnchor = HTMLElement | { nodeType: 1; getBoundingClientRect: () => DOMRect } | null;

type Props<T extends SlicerTarget> = {
  anchorEl: MenuAnchor;
  onClose: () => void;
  slicerLabel: string;
  targets: T[];
  onOpen: () => void;
  /** Heading; defaults to "Open in <slicer>". */
  title?: string;
  /** Adapted picks go through the prepare step instead of being plain links. */
  adapted?: {
    stateOf: (target: T) => AdaptState;
    open: (target: T) => Promise<boolean>;
  };
  /** Opens below the anchor at its exact width, for a full-width button. */
  matchAnchorWidth?: boolean;
};

export default function SlicerFileMenu<T extends SlicerTarget>({
  anchorEl,
  onClose,
  slicerLabel,
  targets,
  onOpen,
  title,
  adapted,
  matchAnchorWidth = false,
}: Props<T>) {
  const { t } = useTranslation(["models"]);
  const names = useMemo(
    () =>
      shortNames(
        targets,
        (target) => target.key,
        (target) => target.filename,
        (target) => target.folder,
      ),
    [targets],
  );
  const paperSx =
    matchAnchorWidth && anchorEl instanceof HTMLElement ? { width: anchorEl.offsetWidth } : { maxWidth: 360 };
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
      <ListSubheader sx={{ lineHeight: "32px" }}>
        {title ?? t("models:detail.openInSlicer", { slicer: slicerLabel })}
      </ListSubheader>
      {targets.map((target) => {
        const text = target.plate
          ? fileRowText(t, target.filename, target.index, target.folder, names.get(target.key))
          : { primary: t("models:detail.preparedPrintFile"), secondary: target.filename };
        const state = adapted?.stateOf(target) ?? "idle";
        // The folder stays beside the state: two files of one name are told apart by theirs.
        const withFolder = (status: string) => (target.folder ? `${folderLabel(target.folder)} · ${status}` : status);
        if (state === "preparing") text.secondary = withFolder(t("models:detail.adaptPreparingShort"));
        if (state === "ready") text.secondary = withFolder(t("models:detail.adaptReadyShort"));
        const action = adapted
          ? {
              disabled: state === "preparing",
              onClick: () => {
                // Stays open while preparing, so the row can show progress and then "ready".
                void adapted.open(target).then((launched) => launched && onClose());
              },
            }
          : {
              component: "a" as const,
              href: target.href,
              onClick: () => {
                onOpen();
                onClose();
              },
            };
        return (
          <MenuItem key={target.key} title={target.filename} {...action}>
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
