import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { keyframes } from "@mui/material/styles";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import FactCheckOutlinedIcon from "@mui/icons-material/FactCheckOutlined";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import ViewSidebarOutlinedIcon from "@mui/icons-material/ViewSidebarOutlined";
import Segmented from "../../components/controls/Segmented";
import type { Vec3 } from "../../studio/document";
import type { StudioPanel } from "./StudioToolbar";
import type { BodyStats } from "./StudioViewport";
import { STUDIO_UNITS, type StudioUnit, type UnitFormat } from "./units";

// Studio's status bar while editing, as CAD has one: how many bodies, how big and how much they hold, for the selection
// or else the whole design, the units it reads out in, and the page's own controls: the print check, which side panels
// show, and Studio's settings.

const rise = keyframes`from { opacity: 0; transform: translateY(6px); }`;

type Props = {
  stats: BodyStats[];
  selected: readonly string[];
  format: UnitFormat;
  onUnit: (unit: StudioUnit) => void;
  /** Which side panels show. */
  panels: Record<StudioPanel, boolean>;
  onTogglePanel: (panel: StudioPanel) => void;
  onCheck: () => void;
  onSettings: () => void;
};

export default function StatusBar({
  stats,
  selected,
  format,
  onUnit,
  panels,
  onTogglePanel,
  onCheck,
  onSettings,
}: Props) {
  const { t } = useTranslation("app");
  const [panelMenu, setPanelMenu] = useState<HTMLElement | null>(null);
  const button = (label: string, icon: React.ReactNode, onClick: (event: React.MouseEvent<HTMLElement>) => void) => (
    <Tooltip title={label}>
      <IconButton size="small" aria-label={label} onClick={onClick} sx={{ borderRadius: 1.5, flexShrink: 0 }}>
        {icon}
      </IconButton>
    </Tooltip>
  );
  const summary = useMemo(() => {
    const picked = stats.filter((body) => selected.includes(body.id));
    const bodies = picked.length ? picked : stats.filter((body) => body.visible);
    if (!bodies.length) return { selection: picked.length > 0, count: 0, size: null, volume: null, open: false };
    const min = [0, 1, 2].map((axis) => Math.min(...bodies.map((body) => body.bounds.min[axis])));
    const max = [0, 1, 2].map((axis) => Math.max(...bodies.map((body) => body.bounds.max[axis])));
    const closed = bodies.filter((body) => Number.isFinite(body.volume));
    return {
      selection: picked.length > 0,
      count: bodies.length,
      size: max.map((value, axis) => value - min[axis]) as Vec3,
      volume: closed.length ? closed.reduce((sum, body) => sum + body.volume, 0) : null,
      // An open mesh holds no volume, so the total leaves it out.
      open: closed.length < bodies.length,
    };
  }, [stats, selected]);

  const item = (label: string, value: string, hint?: string) => (
    <Tooltip title={hint ?? ""} disableHoverListener={!hint}>
      <Box sx={{ display: "flex", alignItems: "baseline", gap: 0.75, whiteSpace: "nowrap" }}>
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
        <Typography variant="caption" sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
          {value}
        </Typography>
      </Box>
    </Tooltip>
  );

  return (
    <Box
      component="section"
      aria-label={t("studio.status.label")}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        px: 1.5,
        minHeight: 40,
        borderTop: 1,
        borderColor: "divider",
        overflowX: "auto",
        animation: `${rise} 200ms ease-out`,
        "@media (prefers-reduced-motion: reduce)": { animation: "none" },
      }}
    >
      <Typography
        variant="caption"
        sx={{ fontWeight: 700, color: "text.secondary", textTransform: "uppercase", whiteSpace: "nowrap" }}
      >
        {summary.selection ? t("studio.status.selection") : t("studio.status.design")}
      </Typography>
      {item(t("studio.status.bodiesLabel"), String(summary.count))}
      {summary.size && (
        <>
          <Divider orientation="vertical" flexItem sx={{ my: 1.25 }} />
          {item(t("studio.status.size"), format.size(summary.size))}
        </>
      )}
      {summary.size && (
        <>
          <Divider orientation="vertical" flexItem sx={{ my: 1.25 }} />
          {item(
            t("studio.status.volume"),
            summary.volume === null ? "—" : format.volume(summary.volume),
            summary.open ? t("studio.status.openMeshes") : undefined,
          )}
        </>
      )}
      <Box sx={{ flex: 1 }} />
      <Segmented
        label={t("studio.status.units")}
        value={format.unit}
        // Unit symbols read the same in every language.
        options={STUDIO_UNITS.map((unit) => ({ value: unit, label: unit }))}
        onChange={onUnit}
      />
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.25, "& svg": { fontSize: 20 } }}>
        {button(t("studio.check.title"), <FactCheckOutlinedIcon />, onCheck)}
        {button(t("studio.panels.label"), <ViewSidebarOutlinedIcon />, (event) => setPanelMenu(event.currentTarget))}
        {button(t("studio.settings.title"), <SettingsOutlinedIcon />, onSettings)}
      </Box>
      {/* From the bottom of the page, it opens upwards. */}
      <Menu
        anchorEl={panelMenu}
        open={Boolean(panelMenu)}
        onClose={() => setPanelMenu(null)}
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
        transformOrigin={{ vertical: "bottom", horizontal: "right" }}
      >
        {(["features", "properties"] as const).map((panel) => (
          <MenuItem
            key={panel}
            role="menuitemcheckbox"
            aria-checked={panels[panel]}
            onClick={() => onTogglePanel(panel)}
          >
            <ListItemIcon>{panels[panel] && <CheckRoundedIcon fontSize="small" />}</ListItemIcon>
            <ListItemText>{t(`studio.panels.${panel}`)}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
}
