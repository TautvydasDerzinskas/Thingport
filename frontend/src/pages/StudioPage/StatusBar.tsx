import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { keyframes } from "@mui/material/styles";
import Segmented from "../../components/controls/Segmented";
import type { Vec3 } from "../../studio/document";
import type { BodyStats } from "./StudioViewport";
import { STUDIO_UNITS, type StudioUnit, type UnitFormat } from "./units";

// Studio's status bar while editing, as CAD has one: how many bodies, how big and how much they hold, for the selection
// or else the whole design, and the units it reads out in.

const rise = keyframes`from { opacity: 0; transform: translateY(6px); }`;

type Props = {
  stats: BodyStats[];
  selected: readonly string[];
  format: UnitFormat;
  onUnit: (unit: StudioUnit) => void;
};

export default function StatusBar({ stats, selected, format, onUnit }: Props) {
  const { t } = useTranslation("app");
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
    </Box>
  );
}
