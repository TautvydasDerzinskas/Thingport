import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
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
export const formatMm = (n: number, locale: string) =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(n);

/** Material Design has no nozzle, so this is a hot-end tip: block, taper, orifice. */
function NozzleIcon() {
  return (
    <SvgIcon>
      <path d="M7 3h10v5h-2v2l-3 6-3-6V8H7z M11 18h2v3h-2z" />
    </SvgIcon>
  );
}

/**
 * Flex per badge: the printer name gives way first, then the materials, and the numbers (which are short and
 * the point of the row) never shrink. The printer takes only the space left over, but not below `PRINTER_MIN`.
 * Past that the row wraps to a second line instead of cutting a value ("0.…").
 */
const FLEX: Record<string, string> = { printer: "1 1 0px", materials: "0 8 auto" };
const PRINTER_MIN = "10ch";

type Item = { key: string; icon: ReactNode; text: string; label: string };

/** Whole seconds as "1h 23m" in the user's language, without translation keys. */
export function formatDuration(seconds: number, locale: string): string {
  const total = Math.max(0, Math.round(seconds / 60));
  const unit = (value: number, u: "hour" | "minute") =>
    new Intl.NumberFormat(locale, { style: "unit", unit: u, unitDisplay: "narrow" }).format(value);
  // Under half a minute rounds to 0, which would read as "never sliced".
  if (!total) return `<${unit(1, "minute")}`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return unit(m, "minute");
  return m ? `${unit(h, "hour")} ${unit(m, "minute")}` : unit(h, "hour");
}

export function formatWeight(grams: number, locale: string): string {
  const gram = (value: number) =>
    new Intl.NumberFormat(locale, {
      style: "unit",
      unit: "gram",
      unitDisplay: "narrow",
      maximumFractionDigits: value < 10 ? 1 : 0,
    }).format(value);
  // Under 0.05 g rounds to 0.
  return grams < 0.05 ? `<${gram(0.1)}` : gram(grams);
}

/** The values a badge is shown for; a time or weight of 0 means the file was never sliced, so it counts as unknown. */
export function shownValues(p: PlateProfile) {
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
/**
 * One badge. When its value is cut off by an ellipsis it takes a tab stop, so a keyboard user can focus it and get
 * the tooltip with the full value (hover alone would leave them without it); a badge that fits stays out of the tab
 * order. Enter and Space stop here, so the row around it isn't picked by accident.
 */
function Badge({ item: i }: { item: Item }) {
  const textRef = useRef<HTMLSpanElement>(null);
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const measure = () => setCut(el.scrollWidth > el.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    // Without describeChild the tooltip text becomes the badge's aria-label, its name for screen readers.
    <Tooltip title={i.label}>
      <Box
        component="span"
        // An icon and its value read as one picture with a name; an <img> can't hold both.
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
        role="img"
        // The MUI tooltip is the hover text; without this an ancestor's title (the file name) shows too.
        title=""
        tabIndex={cut ? 0 : undefined}
        onKeyDown={cut ? (e) => e.stopPropagation() : undefined}
        data-item={i.key}
        sx={{
          display: "inline-flex",
          alignItems: "center",
          gap: 0.25,
          minWidth: i.key === "printer" ? PRINTER_MIN : 0,
          maxWidth: "100%",
          // The printer takes the rest of the line once its first few letters fit, then ellipsizes.
          flex: FLEX[i.key] ?? "0 1 auto",
          "& .MuiSvgIcon-root": { fontSize: "1.05em", flexShrink: 0 },
        }}
      >
        {i.icon}
        <Box component="span" ref={textRef} sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {i.text}
        </Box>
      </Box>
    </Tooltip>
  );
}

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
    // One line while it fits: the printer and materials shrink and end in an ellipsis (the tooltip has the full
    // value). When even that is too narrow, whole badges wrap to the next line; a number is never cut.
    <Box component="span" sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 1, minWidth: 0 }}>
      {shown.map((i) => (
        <Badge key={i.key} item={i} />
      ))}
    </Box>
  );
}
