import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import SvgIcon from "@mui/material/SvgIcon";
import Tooltip from "@mui/material/Tooltip";
import GridViewOutlined from "@mui/icons-material/GridViewOutlined";
import Inventory2Outlined from "@mui/icons-material/Inventory2Outlined";
import LayersOutlined from "@mui/icons-material/LayersOutlined";
import PrintOutlined from "@mui/icons-material/PrintOutlined";
import ScaleOutlined from "@mui/icons-material/ScaleOutlined";
import ScheduleOutlined from "@mui/icons-material/ScheduleOutlined";
import type { PlateProfile } from "../api/prints";

/** 0.40 -> "0.4" (or "0,4"): no trailing zeros, decimal mark of the user's language. */
const formatMm = (n: number, locale: string) => new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(n);

/** Material Design has no nozzle, so this is a hot-end tip: block, taper, orifice. */
function NozzleIcon() {
  return (
    <SvgIcon>
      <path d="M7 3h10v5h-2v2l-3 6-3-6V8H7z M11 18h2v3h-2z" />
    </SvgIcon>
  );
}

type Item = { key: string; icon: ReactNode; text: string; label: string };

/** Whole seconds as "1h 23m" in the user's language, without translation keys. */
function formatDuration(seconds: number, locale: string): string {
  const total = Math.max(0, Math.round(seconds / 60));
  const unit = (value: number, u: "hour" | "minute") =>
    new Intl.NumberFormat(locale, { style: "unit", unit: u, unitDisplay: "narrow" }).format(value);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return unit(m, "minute");
  return m ? `${unit(h, "hour")} ${unit(m, "minute")}` : unit(h, "hour");
}

function formatWeight(grams: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "gram",
    unitDisplay: "narrow",
    maximumFractionDigits: grams < 10 ? 1 : 0,
  }).format(grams);
}

/** The values a badge is shown for; a time or weight of 0 means the file was never sliced, so it counts as unknown. */
function shownValues(p: PlateProfile) {
  return {
    nozzle: p.nozzle_mm ?? null,
    layer: p.layer_height_mm ?? null,
    materials: p.materials?.length ? p.materials : null,
    plates: p.plates,
    seconds: p.estimated_seconds != null && p.estimated_seconds > 0 ? p.estimated_seconds : null,
    grams: p.weight_g != null && p.weight_g > 0 ? p.weight_g : null,
    printer: p.printer || null,
  };
}

/** Whether `ProfileBadges` renders anything for this profile. */
export function hasProfileBadges(profile: PlateProfile): boolean {
  return Object.values(shownValues(profile)).some((v) => v != null);
}

/**
 * A 3MF's slicer profile as small icon + value pairs: printer, nozzle, layer height, material, plates,
 * print time, weight. Whatever the file doesn't say is left out; renders nothing when there's nothing to show.
 */
export default function ProfileBadges({ profile }: { profile: PlateProfile }) {
  const { t, i18n } = useTranslation(["models"]);
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const { nozzle, layer, materials, plates, seconds, grams, printer } = shownValues(profile);
  const nozzleText = nozzle != null ? formatMm(nozzle, locale) : null;
  const layerText = layer != null ? formatMm(layer, locale) : null;
  const time = seconds != null ? formatDuration(seconds, locale) : null;
  const weight = grams != null ? formatWeight(grams, locale) : null;

  const items: (Item | null)[] = [
    nozzleText
      ? {
          key: "nozzle",
          icon: <NozzleIcon />,
          text: nozzleText,
          label: t("models:detail.profileNozzle", { value: nozzleText }),
        }
      : null,
    layerText
      ? {
          key: "layer",
          icon: <LayersOutlined />,
          text: layerText,
          label: t("models:detail.profileLayer", { value: layerText }),
        }
      : null,
    materials
      ? {
          key: "materials",
          icon: <Inventory2Outlined />,
          text: materials.join("/"),
          label: materials.join(", "),
        }
      : null,
    plates != null
      ? {
          key: "plates",
          icon: <GridViewOutlined />,
          text: String(plates),
          label: t("models:detail.profilePlates", { count: plates }),
        }
      : null,
    time
      ? { key: "time", icon: <ScheduleOutlined />, text: time, label: t("models:detail.profileTime", { value: time }) }
      : null,
    weight
      ? {
          key: "weight",
          icon: <ScaleOutlined />,
          text: weight,
          label: t("models:detail.profileWeight", { value: weight }),
        }
      : null,
    // Last, so a narrow row clips the long name before the numbers.
    printer ? { key: "printer", icon: <PrintOutlined />, text: printer, label: printer } : null,
  ];
  const shown = items.filter((i): i is Item => !!i);
  if (!shown.length) return null;

  return (
    // Badges that don't fit wrap onto a second line, which is cut off: a badge shows whole or not at all, so a
    // clipped "0.2" never reads as "0.". Screen readers still get every badge.
    <Box
      component="span"
      sx={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        columnGap: 1,
        rowGap: 0,
        minWidth: 0,
        height: "1lh",
        overflow: "hidden",
      }}
    >
      {shown.map((i) => (
        // Without describeChild the tooltip text becomes the badge's aria-label, its name for screen readers.
        <Tooltip key={i.key} title={i.label}>
          <Box
            component="span"
            // An icon and its value read as one picture with a name; an <img> can't hold both.
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
            role="img"
            // The MUI tooltip is the hover text; without this an ancestor's title (the file name) shows too.
            title=""
            data-item={i.key}
            sx={{
              display: "inline-flex",
              alignItems: "center",
              gap: 0.25,
              minWidth: 0,
              // The printer takes the rest of the line once its first few letters fit, then ellipsizes.
              flex: i.key === "printer" ? "1 1 7ch" : "0 0 auto",
              "& .MuiSvgIcon-root": { fontSize: "1.05em", flexShrink: 0 },
            }}
          >
            {i.icon}
            <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {i.text}
            </Box>
          </Box>
        </Tooltip>
      ))}
    </Box>
  );
}
