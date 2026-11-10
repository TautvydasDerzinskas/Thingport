import { useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonGroup from "@mui/material/ButtonGroup";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import ListSubheader from "@mui/material/ListSubheader";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Tooltip from "@mui/material/Tooltip";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import DesignServicesOutlinedIcon from "@mui/icons-material/DesignServicesOutlined";
import DownloadIcon from "@mui/icons-material/Download";
import FolderZipIcon from "@mui/icons-material/FolderZip";
import TuneIcon from "@mui/icons-material/Tune";
import type { SlicerOption } from "../../constants/settingsOptions";
import { switchSlicer, useSlicerSettings } from "../../hooks/useSlicerPreference";
import { SlicerLogo } from "../../components/Layout/ConfigurationDialog/slicerLogos";
import { slicerHref, type ModelFile, type SlicerTarget } from "./useOpenInSlicer";
import type { NormalizeState } from "./useNormalizedOpen";
import NormalizeInfoIcon from "./NormalizeInfoIcon";

type Props = {
  /** The file every action but the zip applies to. */
  file: ModelFile;
  /** False when the model has nothing a slicer opens; the button downloads instead. */
  canOpen: boolean;
  slicerOption: SlicerOption | null;
  slicerOptions: SlicerOption[];
  onOpened: (slicerId: string) => void;
  /** The normalized copy `slicerId` would open for `file`, if any. Listed for every installed slicer, so it is
   *  reachable without first switching to that slicer. */
  normalizedFor?: (slicerId: string) => SlicerTarget | undefined;
  normalizedStateOf?: (target: SlicerTarget) => NormalizeState;
  /** Prepares and launches a normalized copy; resolves true once the slicer was launched. */
  onOpenNormalized?: (target: SlicerTarget, slicerId: string) => Promise<boolean>;
  downloading: boolean;
  onDownload: () => void;
  /** Offered with more than one file. */
  zipCount: number;
  onDownloadZip: () => void;
  /** Set for a model that came with its generator script, which then takes the main action. */
  onCustomize?: () => void;
  /** Set when the file can open in Studio as a new design. */
  onOpenInStudio?: () => void;
  openingInStudio?: boolean;
};

/** A slicer's logo on the white tile it's drawn for, so the dark parts stay visible in dark mode. */
function LogoTile({ id, size }: { id: string; size: number }) {
  return (
    <Box
      sx={{
        width: size + 6,
        height: size + 6,
        borderRadius: "6px",
        bgcolor: "common.white",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <SlicerLogo id={id} size={size} />
    </Box>
  );
}

/**
 * The side panel's main action: open the file in the last slicer used, with the other installed slicers and the
 * downloads behind the arrow. Without a slicer to open it in, the main action is the download.
 *
 * A model that came with its generator script leads with Customize instead -- generating it again is the thing
 * to do with it, and what you'd slice or download is only one of the shapes it can make. Whatever Customize
 * displaces moves into the menu, so nothing becomes unreachable.
 */
export default function OpenInSlicerButton({
  file,
  canOpen,
  slicerOption,
  slicerOptions,
  onOpened,
  normalizedFor,
  normalizedStateOf,
  onOpenNormalized,
  downloading,
  onDownload,
  zipCount,
  onDownloadZip,
  onCustomize,
  onOpenInStudio,
  openingInStudio,
}: Props) {
  const { t } = useTranslation(["models"]);
  // Those the user sends through the Bridge, picked in the Slicer settings.
  const { bridged } = useSlicerSettings();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const group = anchor?.parentElement ?? null;
  const customizes = Boolean(onCustomize);
  const opensSlicer = canOpen && Boolean(slicerOption);
  // The list, when it appears, holds every installed slicer. It is skipped only where it would say nothing the
  // main button doesn't: one slicer, already on that button. With Customize there instead, even one is worth
  // listing, since the button no longer opens anything.
  const offersSlicers = canOpen && slicerOptions.length > (opensSlicer && !customizes ? 1 : 0);
  // Likewise the download: in the menu unless it is the main button.
  const offersDownload = customizes || opensSlicer;
  const normalizedOptions =
    canOpen && normalizedFor && onOpenNormalized
      ? slicerOptions.flatMap((option) => {
          const target = normalizedFor(option.id);
          return target ? [{ option, target }] : [];
        })
      : [];
  const hasMenu =
    offersSlicers || normalizedOptions.length > 0 || Boolean(onOpenInStudio) || offersDownload || zipCount > 1;
  const close = () => setAnchor(null);
  const downloadIcon = downloading ? <CircularProgress size={16} color="inherit" /> : <DownloadIcon fontSize="small" />;

  return (
    <>
      <ButtonGroup variant="contained" disableElevation fullWidth aria-label={t("models:detail.openActions")}>
        {customizes ? (
          <Button onClick={onCustomize} startIcon={<TuneIcon fontSize="small" />} sx={{ flex: 1, minWidth: 0 }}>
            <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {t("models:detail.customize")}
            </Box>
          </Button>
        ) : opensSlicer && slicerOption ? (
          <Button
            component="a"
            href={slicerHref(slicerOption.id, file, bridged)}
            onClick={() => onOpened(slicerOption.id)}
            startIcon={<LogoTile id={slicerOption.id} size={14} />}
            sx={{ flex: 1, minWidth: 0 }}
          >
            <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {t("models:detail.openInSlicer", { slicer: slicerOption.label })}
            </Box>
          </Button>
        ) : (
          <Button onClick={onDownload} disabled={downloading} startIcon={downloadIcon} sx={{ flex: 1, minWidth: 0 }}>
            {t("models:detail.downloadFile")}
          </Button>
        )}
        {hasMenu && (
          <Tooltip title={t("models:detail.moreOpenOptions")}>
            <Button
              onClick={(e) => setAnchor(e.currentTarget)}
              aria-label={t("models:detail.moreOpenOptions")}
              aria-haspopup="menu"
              aria-expanded={Boolean(anchor)}
              sx={{ flex: "0 0 auto", width: 40, minWidth: 40, px: 0 }}
            >
              <ArrowDropDownIcon
                sx={{
                  transition: "transform 150ms",
                  transform: anchor ? "rotate(180deg)" : "none",
                  "@media (prefers-reduced-motion: reduce)": { transition: "none" },
                }}
              />
            </Button>
          </Tooltip>
        )}
      </ButtonGroup>

      <Menu
        anchorEl={group}
        open={Boolean(anchor)}
        onClose={close}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        slotProps={{ paper: { sx: { width: group?.offsetWidth } } }}
      >
        {offersSlicers && <ListSubheader sx={{ lineHeight: "32px" }}>{t("models:detail.openInHeading")}</ListSubheader>}
        {offersSlicers &&
          slicerOptions.map((option) => (
            <MenuItem
              key={option.id}
              component="a"
              href={slicerHref(option.id, file, bridged)}
              selected={option.id === slicerOption?.id}
              onClick={() => {
                onOpened(option.id);
                close();
              }}
            >
              <ListItemIcon>
                <LogoTile id={option.id} size={16} />
              </ListItemIcon>
              <ListItemText primaryTypographyProps={{ variant: "body2" }}>{option.label}</ListItemText>
            </MenuItem>
          ))}
        {normalizedOptions.map(({ option, target }) => {
          const state = normalizedStateOf?.(target) ?? "idle";
          const preparing = state === "preparing";
          return (
            <MenuItem
              key={`normalized-${option.id}`}
              disabled={preparing}
              onClick={() => {
                // Opening it makes this slicer the main one, like opening the file plain does.
                void onOpenNormalized?.(target, option.id).then((launched) => {
                  if (launched) {
                    void switchSlicer(option.id);
                    close();
                  }
                });
              }}
            >
              <ListItemIcon>
                {preparing ? <CircularProgress size={16} color="inherit" /> : <LogoTile id={option.id} size={16} />}
              </ListItemIcon>
              <ListItemText primaryTypographyProps={{ variant: "body2" }}>
                {/* A slow copy is still launched by a second click, which this tells the user to make. */}
                {preparing
                  ? t("models:detail.normalizePreparing")
                  : state === "ready"
                    ? t("models:detail.normalizeReady", { slicer: option.label })
                    : t("models:detail.openNormalizedInSlicer", { slicer: option.label })}
              </ListItemText>
              {!preparing && (
                <Box component="span" sx={{ display: "inline-flex", ml: 1.5, color: "warning.main" }}>
                  <NormalizeInfoIcon slicerLabel={option.label} orca={target.normalizeTarget === "orca"} />
                </Box>
              )}
            </MenuItem>
          );
        })}
        {onOpenInStudio && (
          <MenuItem
            disabled={openingInStudio}
            onClick={() => {
              onOpenInStudio();
              close();
            }}
          >
            <ListItemIcon>
              {openingInStudio ? (
                <CircularProgress size={16} color="inherit" />
              ) : (
                <DesignServicesOutlinedIcon fontSize="small" />
              )}
            </ListItemIcon>
            <ListItemText primaryTypographyProps={{ variant: "body2" }}>{t("models:detail.openInStudio")}</ListItemText>
          </MenuItem>
        )}
        {(offersSlicers || normalizedOptions.length > 0 || onOpenInStudio) && (offersDownload || zipCount > 1) && (
          <Divider />
        )}
        {offersDownload && (
          <MenuItem
            disabled={downloading}
            onClick={() => {
              onDownload();
              close();
            }}
          >
            <ListItemIcon>{downloadIcon}</ListItemIcon>
            <ListItemText primaryTypographyProps={{ variant: "body2" }}>{t("models:detail.downloadFile")}</ListItemText>
          </MenuItem>
        )}
        {zipCount > 1 && (
          <MenuItem
            disabled={downloading}
            onClick={() => {
              onDownloadZip();
              close();
            }}
          >
            <ListItemIcon>
              <FolderZipIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primaryTypographyProps={{ variant: "body2" }}>
              {t("models:detail.downloadAllZip", { count: zipCount })}
            </ListItemText>
          </MenuItem>
        )}
      </Menu>
    </>
  );
}
