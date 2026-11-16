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
import HandymanOutlinedIcon from "@mui/icons-material/HandymanOutlined";
import TuneIcon from "@mui/icons-material/Tune";
import type { SlicerOption } from "../../constants/settingsOptions";
import { SlicerLogo } from "../../components/Layout/ConfigurationDialog/slicerLogos";
import ToolIcon from "../../components/tools/ToolIcon";
import type { OfferedCommand } from "../../components/tools/toolCommands";
import type { SendTargetSummary } from "../../api/sendTargets";
import { SendKindIcon, kindOf } from "../../components/sendTo/sendKinds";
import { useSlicerSettings } from "../../hooks/useSlicerPreference";
import { slicerHref, type ModelFile } from "./useOpenInSlicer";

type Props = {
  /** The file every action but the zip applies to. */
  file: ModelFile;
  /** False when the model has nothing a slicer opens; the button downloads instead. */
  canOpen: boolean;
  slicerOption: SlicerOption | null;
  slicerOptions: SlicerOption[];
  onOpened: (slicerId: string) => void;
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
  /** What the installed tools offer to do with the model, last in the menu; none leaves the menu as it was. */
  toolCommands?: OfferedCommand[];
  onToolCommand?: (offered: OfferedCommand) => void;
  /** The user's Send to destinations shown in the menu, after the slicers; none leaves the menu as it was. */
  sendTargets?: SendTargetSummary[];
  onSend?: (target: SendTargetSummary) => void;
  /** Those being sent to, while they are. */
  sending?: ReadonlySet<string>;
};

const NO_COMMANDS: OfferedCommand[] = [];
const NO_TARGETS: SendTargetSummary[] = [];
const NONE_SENDING: ReadonlySet<string> = new Set();

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
  downloading,
  onDownload,
  zipCount,
  onDownloadZip,
  onCustomize,
  onOpenInStudio,
  openingInStudio,
  toolCommands = NO_COMMANDS,
  onToolCommand,
  sendTargets = NO_TARGETS,
  onSend,
  sending = NONE_SENDING,
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
  const offersTools = Boolean(onToolCommand) && toolCommands.length > 0;
  const offersSending = Boolean(onSend) && sendTargets.length > 0;
  const offersAbove = offersSlicers || offersSending || Boolean(onOpenInStudio) || offersDownload || zipCount > 1;
  const hasMenu = offersAbove || offersTools;
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
        {offersSending && (
          <ListSubheader sx={{ lineHeight: "32px" }}>{t("models:detail.sendTo.heading")}</ListSubheader>
        )}
        {offersSending &&
          sendTargets.map((target) => (
            <MenuItem
              key={target.id}
              disabled={sending.has(target.id)}
              onClick={() => {
                onSend?.(target);
                close();
              }}
            >
              <ListItemIcon>
                {sending.has(target.id) ? (
                  <CircularProgress size={16} color="inherit" />
                ) : (
                  <SendKindIcon kind={kindOf(target)} size={22} />
                )}
              </ListItemIcon>
              <ListItemText primaryTypographyProps={{ variant: "body2" }}>{target.name}</ListItemText>
            </MenuItem>
          ))}
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
        {(offersSlicers || offersSending || onOpenInStudio) && (offersDownload || zipCount > 1) && <Divider />}
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
        {offersTools && offersAbove && <Divider />}
        {offersTools && <ListSubheader sx={{ lineHeight: "32px" }}>{t("models:detail.toolsHeading")}</ListSubheader>}
        {offersTools && onToolCommand && toolCommandItems(toolCommands, onToolCommand, close)}
      </Menu>
    </>
  );
}

/** The menu's Tools group: each command with its tool's icon and name. An array, as a Menu takes no fragment. */
function toolCommandItems(commands: OfferedCommand[], onRun: (offered: OfferedCommand) => void, close: () => void) {
  return commands.map((offered) => (
    <MenuItem
      key={offered.key}
      onClick={() => {
        onRun(offered);
        close();
      }}
    >
      <ListItemIcon sx={{ color: "primary.main" }}>
        <ToolIcon iconUrl={offered.tool.manifest.iconUrl} size={18} />
      </ListItemIcon>
      <ListItemText
        primary={offered.label}
        secondary={offered.tool.manifest.name}
        primaryTypographyProps={{ variant: "body2" }}
        secondaryTypographyProps={{ variant: "caption" }}
        sx={{ my: 0 }}
      />
    </MenuItem>
  ));
}

/** In the main button's place on a model with no file: the tools' model commands alone, behind one button. */
export function ToolCommandsButton({
  commands,
  onRun,
}: {
  commands: OfferedCommand[];
  onRun: (offered: OfferedCommand) => void;
}) {
  const { t } = useTranslation(["models"]);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = () => setAnchor(null);
  return (
    <>
      <Button
        variant="outlined"
        fullWidth
        onClick={(e) => setAnchor(e.currentTarget)}
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        startIcon={<HandymanOutlinedIcon fontSize="small" />}
        endIcon={
          <ArrowDropDownIcon
            sx={{
              transition: "transform 150ms",
              transform: anchor ? "rotate(180deg)" : "none",
              "@media (prefers-reduced-motion: reduce)": { transition: "none" },
            }}
          />
        }
        sx={{ "& .MuiButton-endIcon": { ml: "auto" } }}
      >
        {t("models:detail.toolsHeading")}
      </Button>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={close}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        slotProps={{ paper: { sx: { width: anchor?.offsetWidth } } }}
      >
        <ListSubheader sx={{ lineHeight: "32px" }}>{t("models:detail.toolsHeading")}</ListSubheader>
        {toolCommandItems(commands, onRun, close)}
      </Menu>
    </>
  );
}
