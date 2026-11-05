import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { keyframes } from "@mui/material/styles";
import HelpTip from "../../components/HelpTip";
import Segmented from "../../components/controls/Segmented";
import { MEASURE_FILTERS, type MeasureFilter, type Reading } from "./measureTool";
import type { Picked } from "./StudioViewport";
import type { UnitFormat } from "./units";

// The measure tool's panel, over the view where a tool's panel goes: what to pick, what's been picked, and what it
// measures, in the status bar's units.

const rise = keyframes`from { opacity: 0; transform: translateY(-6px); }`;
const appear = keyframes`from { opacity: 0; }`;

type Props = {
  filter: MeasureFilter;
  onFilter: (filter: MeasureFilter) => void;
  picks: Picked[];
  readings: Reading[];
  format: UnitFormat;
  label: (id: string) => string;
  onClear: () => void;
  onClose: () => void;
};

export default function MeasurePanel({ filter, onFilter, picks, readings, format, label, onClear, onClose }: Props) {
  const { t } = useTranslation("app");
  const value = (reading: Reading) => {
    switch (reading.kind) {
      case "length":
        return format.length(reading.value);
      case "area":
        return format.area(reading.value);
      case "volume":
        return format.volume(reading.value);
      case "angle":
        return format.angle(reading.value);
      case "size":
        return format.size(reading.value);
      default:
        return null;
    }
  };
  // A note says something in words (touching, too far); the rest are figures, in a list of their own.
  const notes = readings.filter((reading) => reading.kind === "note" || reading.kind === "failure");
  const values = readings.filter((reading) => reading.kind !== "note" && reading.kind !== "failure");
  const hint =
    picks.length === 0
      ? t(`studio.measure.pickFirst.${filter}`)
      : picks.length === 1
        ? t(`studio.measure.pickSecond.${filter}`)
        : t("studio.measure.again");

  return (
    <Paper
      elevation={4}
      component="section"
      aria-label={t("studio.measure.title")}
      sx={{
        position: "absolute",
        top: 12,
        left: 12,
        zIndex: 2,
        width: 300,
        maxWidth: "calc(100% - 24px)",
        maxHeight: "calc(100% - 24px)",
        overflow: "auto",
        p: 1.5,
        borderRadius: 2,
        border: 1,
        borderColor: "divider",
        animation: `${rise} 180ms ease-out`,
        "@media (prefers-reduced-motion: reduce)": { animation: "none" },
      }}
    >
      <Typography variant="subtitle2" sx={{ mb: 1.25 }}>
        {t("studio.measure.title")}
        <HelpTip text={t("studio.measure.help")} />
      </Typography>
      <Segmented
        fullWidth
        label={t("studio.measure.filter")}
        value={filter}
        options={MEASURE_FILTERS.map((each) => ({ value: each, label: t(`studio.measure.kinds.${each}`) }))}
        onChange={onFilter}
      />
      {picks.length > 0 && (
        <Stack direction="row" flexWrap="wrap" gap={0.75} sx={{ mt: 1.25 }}>
          {picks.map((picked, index) => (
            <Chip
              // Picks have no ids: the first and the second.
              // oxlint-disable-next-line react/no-array-index-key
              key={index}
              size="small"
              variant="outlined"
              color="primary"
              label={`${index + 1} · ${t(`studio.measure.kinds.${picked.kind}`)} · ${label(picked.body)}`}
            />
          ))}
        </Stack>
      )}
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
        {hint}
      </Typography>
      {notes.map((reading) => (
        <Typography
          key={reading.key}
          variant="body2"
          aria-live="polite"
          color={reading.kind === "failure" ? "error" : undefined}
          sx={{ mt: 1.25, pt: 1.25, borderTop: 1, borderColor: "divider", fontWeight: 600 }}
        >
          {reading.kind === "failure" ? reading.message : t(`studio.measure.readings.${reading.key}`)}
        </Typography>
      ))}
      {values.length > 0 && (
        <Box
          component="dl"
          aria-live="polite"
          sx={{
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            columnGap: 2,
            rowGap: 0.5,
            m: 0,
            mt: 1.25,
            pt: 1.25,
            borderTop: 1,
            borderColor: "divider",
            animation: `${appear} 150ms ease-out`,
            "@media (prefers-reduced-motion: reduce)": { animation: "none" },
          }}
        >
          {values.map((reading) => {
            const shown = value(reading);
            return [
              <Typography key={`${reading.key}-label`} component="dt" variant="body2" color="text.secondary">
                {t(`studio.measure.readings.${reading.key}`)}
              </Typography>,
              <Typography
                key={`${reading.key}-value`}
                component="dd"
                variant="body2"
                sx={{
                  m: 0,
                  textAlign: "right",
                  fontVariantNumeric: "tabular-nums",
                  fontWeight: reading.key === "distance" || reading.key === "gap" ? 700 : 500,
                }}
              >
                {shown}
              </Typography>,
            ];
          })}
        </Box>
      )}
      <Stack direction="row" justifyContent="flex-end" spacing={1} sx={{ mt: 1.5 }}>
        <Button size="small" disabled={!picks.length} onClick={onClear}>
          {t("studio.measure.clear")}
        </Button>
        <Button size="small" variant="contained" disableElevation onClick={onClose}>
          {t("studio.measure.done")}
        </Button>
      </Stack>
    </Paper>
  );
}
