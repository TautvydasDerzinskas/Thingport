import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import PowerSettingsNewIcon from "@mui/icons-material/PowerSettingsNew";
import TuneIcon from "@mui/icons-material/Tune";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import type { AiConnection } from "../../api/aiConnections";
import {
  menuPosition,
  reopenContextMenuBelow,
  TileMenuHeader,
} from "../../components/Layout/ConfigurationDialog/AppTiles";
import { AiLogo } from "./aiLogos";

/** Where a feature's dialog opens. */
export type FeatureSection = "settings" | "manage";

export const FEATURE_TILE = 112;
const tileShadow = "inset 0 0 0 1px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04)";

type Props = {
  label: string;
  /** A sentence on what the feature does, in its menu's header. */
  description: string;
  /** Drawn in the tile; paused while the feature is off. */
  Animation: React.ComponentType<{ size: number; paused?: boolean }>;
  /** Switched on and with a model to use. */
  enabled: boolean;
  /** Without one the switch is hidden: there's nothing to turn on. */
  hasModel: boolean;
  /** The model it uses, shown as a bubble on the corner. */
  model: AiConnection | undefined;
  /** False until its settings have loaded. */
  ready: boolean;
  switching: boolean;
  /** Its library run is going: it can't be switched off under it. */
  running: boolean;
  onToggle: (enabled: boolean) => void;
  onOpen: (section: FeatureSection) => void;
};

/** An AI feature as a tile: click it for its settings, switch it underneath, right-click for the rest. */
export default function FeatureTile({
  label,
  description,
  Animation,
  enabled,
  hasModel,
  model,
  ready,
  switching,
  running,
  onToggle,
  onOpen,
}: Props) {
  const { t } = useTranslation("app");
  const [menu, setMenu] = useState<{ top: number; left: number } | null>(null);
  const locked = running && enabled;
  const open = (section: FeatureSection) => {
    setMenu(null);
    onOpen(section);
  };

  return (
    <Stack alignItems="center" spacing={0.75}>
      <Tooltip title={t("adminSettings.aiFeatures.openSettings")} placement="top">
        <ButtonBase
          onClick={() => onOpen("settings")}
          onContextMenu={(event) => setMenu(menuPosition(event))}
          disabled={!ready}
          aria-label={t("adminSettings.aiFeatures.settingsAria", { feature: label })}
          sx={{
            position: "relative",
            width: FEATURE_TILE,
            height: FEATURE_TILE,
            borderRadius: "22px",
            bgcolor: "#ffffff",
            boxShadow: tileShadow,
            filter: enabled ? "none" : "grayscale(1)",
            opacity: enabled ? 1 : 0.55,
            transition: "filter 200ms, opacity 200ms, transform 150ms",
            "&:hover": { transform: "translateY(-1px)" },
            "&.Mui-focusVisible": { outline: 2, outlineColor: "primary.main", outlineOffset: 2 },
          }}
        >
          <Animation size={84} paused={!enabled} />
          {model && (
            // A bubble over the corner, so it reads as which model the feature uses rather than part of it.
            <Tooltip title={model.model} placement="bottom">
              <Box
                sx={{
                  position: "absolute",
                  right: -8,
                  bottom: -8,
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  bgcolor: "#ffffff",
                  boxShadow: "0 0 0 1px rgba(0, 0, 0, 0.08), 0 2px 6px rgba(0, 0, 0, 0.18)",
                }}
              >
                <AiLogo model={model.model} baseUrl={model.base_url} size={18} />
              </Box>
            </Tooltip>
          )}
        </ButtonBase>
      </Tooltip>
      {/* Centred under the tile, the label wrapping to a second line when it must. */}
      <Stack direction="row" alignItems="center" justifyContent="center" spacing={0.5} sx={{ pt: 0.5, width: "100%" }}>
        <Typography variant="body2" fontWeight={600} textAlign="center" sx={{ lineHeight: 1.3, minWidth: 0 }}>
          {label}
        </Typography>
        {hasModel && (
          <Tooltip title={locked ? t("adminSettings.aiFeatures.runningLock") : ""}>
            <span>
              <Switch
                size="small"
                checked={enabled}
                onChange={(event) => onToggle(event.target.checked)}
                disabled={!ready || switching || locked}
                slotProps={{ input: { "aria-label": t("adminSettings.aiFeatures.toggleAria", { feature: label }) } }}
              />
            </span>
          </Tooltip>
        )}
      </Stack>

      <Menu
        open={Boolean(menu)}
        onClose={() => setMenu(null)}
        onContextMenu={(event) => reopenContextMenuBelow(event, () => setMenu(null))}
        anchorReference="anchorPosition"
        anchorPosition={menu ?? undefined}
        slotProps={{ paper: { sx: { minWidth: 240, maxWidth: 300 } } }}
      >
        <TileMenuHeader
          logo={<AutoAwesomeOutlinedIcon fontSize="small" sx={{ color: "text.secondary" }} />}
          name={label}
          status={description}
        />
        <MenuItem
          disabled={!hasModel || !ready || switching || locked}
          onClick={() => {
            setMenu(null);
            onToggle(!enabled);
          }}
        >
          <ListItemIcon>
            <PowerSettingsNewIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>
            {enabled ? t("adminSettings.aiFeatures.turnOff") : t("adminSettings.aiFeatures.turnOn")}
          </ListItemText>
        </MenuItem>
        <MenuItem disabled={!ready} onClick={() => open("settings")}>
          <ListItemIcon>
            <TuneIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t("adminSettings.aiFeatures.settings")}</ListItemText>
        </MenuItem>
        <MenuItem disabled={!ready || !enabled} onClick={() => open("manage")}>
          <ListItemIcon>
            <AutoAwesomeOutlinedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t("adminSettings.aiFeatures.manage")}</ListItemText>
        </MenuItem>
      </Menu>
    </Stack>
  );
}
