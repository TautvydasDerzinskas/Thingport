import { useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonGroup from "@mui/material/ButtonGroup";
import CircularProgress from "@mui/material/CircularProgress";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Tooltip from "@mui/material/Tooltip";
import { alpha, type Theme } from "@mui/material/styles";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import DownloadIcon from "@mui/icons-material/Download";
import AdaptedInfoIcon from "./AdaptedInfoIcon";
import type { AdaptedTarget } from "./useOpenInSlicer";
import type { AdaptState } from "./useAdaptedOpen";

type Props = {
  target: AdaptedTarget;
  slicerLabel: string;
  state: AdaptState;
  /** The user's printer the copy is made for ("Bambu Lab P1S"), null for a copy made for no printer. */
  printerName: string | null;
  onOpen: () => void;
  downloading: boolean;
  onDownload: () => void;
};

const ellipsis = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;

/** The side panel's "Open in <slicer>, adapted for <printer>" button, in the bulb's warning color, as Thingport Grab's
 *  button on a site's page names its copy. Its arrow downloads the copy instead. */
export default function AdaptedOpenButton({
  target,
  slicerLabel,
  state,
  printerName,
  onOpen,
  downloading,
  onDownload,
}: Props) {
  const { t } = useTranslation(["models"]);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const group = anchor?.parentElement ?? null;
  const label =
    state === "preparing"
      ? t("models:detail.adaptPreparing")
      : state === "ready"
        ? t("models:detail.adaptReady", { slicer: slicerLabel })
        : t("models:detail.openInSlicer", { slicer: slicerLabel });
  // Asked on the click, where the user has several printers and none set for this slicer.
  const forWhat =
    target.ask && !printerName
      ? t("models:detail.adaptedForYourPrinter")
      : t("models:detail.adaptedFor", { target: printerName ?? slicerLabel });
  const outlined = {
    bgcolor: "background.paper",
    color: "warning.main",
    borderColor: "warning.main",
    borderWidth: "1.5px",
    "&:hover": {
      bgcolor: (theme: Theme) => alpha(theme.palette.warning.main, 0.08),
      borderColor: "warning.dark",
      borderWidth: "1.5px",
    },
    "&.Mui-disabled": { color: "warning.main", borderColor: "warning.main", opacity: 0.7 },
  };

  return (
    <>
      <ButtonGroup variant="outlined" fullWidth aria-label={t("models:detail.adaptedActions")}>
        <Button
          onClick={onOpen}
          disabled={state === "preparing"}
          startIcon={
            state === "preparing" ? (
              <CircularProgress size={16} color="inherit" />
            ) : (
              <AdaptedInfoIcon slicerLabel={slicerLabel} plan={target.plan} />
            )
          }
          sx={{ ...outlined, flex: 1, minWidth: 0, py: 0.5, justifyContent: "center" }}
        >
          <Box component="span" sx={{ display: "flex", flexDirection: "column", minWidth: 0, lineHeight: 1.25 }}>
            <Box component="span" sx={ellipsis}>
              {label}
            </Box>
            <Box
              component="span"
              sx={{ ...ellipsis, fontSize: "0.75rem", fontWeight: 400, textTransform: "none", opacity: 0.85 }}
            >
              {forWhat}
            </Box>
          </Box>
        </Button>
        <Tooltip title={t("models:detail.downloadAdapted")}>
          <Button
            onClick={(e) => setAnchor(e.currentTarget)}
            aria-label={t("models:detail.downloadAdapted")}
            aria-haspopup="menu"
            aria-expanded={Boolean(anchor)}
            sx={{ ...outlined, flex: "0 0 auto", width: 40, minWidth: 40, px: 0 }}
          >
            {/* The download's progress shows here too, once its menu has closed. */}
            {downloading ? (
              <CircularProgress size={16} color="inherit" />
            ) : (
              <ArrowDropDownIcon
                sx={{
                  transition: "transform 150ms",
                  transform: anchor ? "rotate(180deg)" : "none",
                  "@media (prefers-reduced-motion: reduce)": { transition: "none" },
                }}
              />
            )}
          </Button>
        </Tooltip>
      </ButtonGroup>

      <Menu
        anchorEl={group}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        slotProps={{ paper: { sx: { width: group?.offsetWidth } } }}
      >
        <MenuItem
          disabled={downloading}
          onClick={() => {
            onDownload();
            setAnchor(null);
          }}
        >
          <ListItemIcon>
            {downloading ? <CircularProgress size={16} color="inherit" /> : <DownloadIcon fontSize="small" />}
          </ListItemIcon>
          <ListItemText primary={t("models:detail.downloadAdapted")} secondary={forWhat} />
        </MenuItem>
      </Menu>
    </>
  );
}
