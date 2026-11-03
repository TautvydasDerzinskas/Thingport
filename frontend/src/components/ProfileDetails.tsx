import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { PlateProfile, PlateStat } from "../api/prints";
import { extOf } from "../utils/fileExtensions";
import { formatDuration, formatMm, formatWeight, shownValues } from "./ProfileBadges";

/** "ca. 1h 23m · 12 g" for one plate of a sliced 3MF; null when the plate gives neither value. */
export function plateStatText(stat: PlateStat | undefined, locale: string): string | null {
  if (!stat) return null;
  const parts = [
    stat.estimated_seconds != null && stat.estimated_seconds > 0
      ? formatDuration(stat.estimated_seconds, locale)
      : null,
    stat.weight_g != null && stat.weight_g > 0 ? formatWeight(stat.weight_g, locale) : null,
  ].filter((p): p is string => !!p);
  return parts.length ? parts.join(" · ") : null;
}

/** The stats of the plate the file numbers `index` (1-based, as in slice_info.config); undefined when it has none. */
export function statForPlate(profile: PlateProfile | null | undefined, index: number): PlateStat | undefined {
  return profile?.plate_stats?.find((s) => s.index === index);
}

/**
 * The slicer profile of the file being previewed as compact key-value rows: printer, nozzle, layer, material,
 * time, weight, plates, file. Whatever the file doesn't say is left out; without a profile only the file name
 * and type remain.
 */
export default function ProfileDetails({ filename, profile }: { filename: string; profile?: PlateProfile | null }) {
  const { t, i18n } = useTranslation(["models"]);
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const v = profile ? shownValues(profile) : null;
  const rows: [string, string | null][] = [
    ["printer", v?.printer ?? null],
    ["nozzle", v?.nozzle != null ? `${formatMm(v.nozzle, locale)} mm` : null],
    ["layer", v?.layer != null ? `${formatMm(v.layer, locale)} mm` : null],
    ["material", v?.materials ? v.materials.join(" / ") : null],
    ["time", v?.seconds != null ? `${t("models:detail.details.approx")} ${formatDuration(v.seconds, locale)}` : null],
    ["weight", v?.grams != null ? `${t("models:detail.details.approx")} ${formatWeight(v.grams, locale)}` : null],
    ["plates", v?.plates != null ? String(v.plates) : null],
    ["file", filename],
    ["type", v ? null : extOf(filename).toUpperCase() || null],
  ];
  const shown = rows.filter((r): r is [string, string] => r[1] != null);

  return (
    <Box
      component="dl"
      aria-label={t("models:detail.details.title")}
      sx={{
        m: 0,
        display: "grid",
        gridTemplateColumns: "auto minmax(0, 1fr)",
        columnGap: 1.5,
        rowGap: 0.25,
        alignItems: "baseline",
      }}
    >
      {shown.map(([key, value]) => (
        <Box key={key} component="div" sx={{ display: "contents" }} data-row={key}>
          <Typography component="dt" variant="caption" color="text.secondary">
            {t(`models:detail.details.${key}`)}
          </Typography>
          <Typography
            component="dd"
            variant="caption"
            title={value}
            sx={{ m: 0, minWidth: 0, overflowWrap: "anywhere" }}
          >
            {value}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}
