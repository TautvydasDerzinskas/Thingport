import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { alpha, useTheme, type Theme } from "@mui/material/styles";
import GroupsOutlinedIcon from "@mui/icons-material/GroupsOutlined";
import VerifiedOutlinedIcon from "@mui/icons-material/VerifiedOutlined";
import { printsApi, type Plate, type PrintProfile, type ProfileFilament } from "../../../api/prints";
import PlateThumbnail from "../../../components/media/PlateThumbnail";
import { neutralTint } from "../../../theme";
import { useProfileFormat, type ProfileFormat } from "./format";

/** The accent's soft tint, for what the designer made. */
function accentTint(theme: Theme): { background: string; text: string } {
  const dark = theme.palette.mode === "dark";
  return {
    background: alpha(theme.palette.primary.main, dark ? 0.2 : 0.1),
    text: dark ? theme.palette.primary.light : theme.palette.primary.dark,
  };
}

/** Whether the designer made the profile or someone else, where the provider says. `overlay` sits on a picture,
 *  solid so it reads over whatever is behind it; `compact` is the icon alone, its words in the tooltip. */
export function OriginChip({
  origin,
  compact,
  overlay,
}: {
  origin: PrintProfile["origin"] | undefined;
  compact?: boolean;
  overlay?: boolean;
}) {
  const theme = useTheme();
  const { t } = useTranslation("models");
  if (!origin) return null;
  const designer = origin === "designer";
  const label = t(designer ? "detail.profiles.designer" : "detail.profiles.community");
  const Icon = designer ? VerifiedOutlinedIcon : GroupsOutlinedIcon;
  const tint = accentTint(theme);
  const colors = overlay
    ? designer
      ? { bgcolor: "primary.main", color: "primary.contrastText" }
      : { bgcolor: alpha(theme.palette.background.paper, 0.92), color: "text.primary" }
    : designer
      ? { bgcolor: tint.background, color: tint.text }
      : { bgcolor: neutralTint(theme), color: "text.secondary" };
  const chip = (
    <Box
      component="span"
      aria-label={compact ? label : undefined}
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.4,
        flexShrink: 0,
        height: 20,
        px: compact ? 0.5 : 0.75,
        borderRadius: "6px",
        fontSize: "0.7rem",
        fontWeight: 600,
        lineHeight: 1,
        ...(overlay && { boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }),
        ...colors,
      }}
    >
      <Icon sx={{ fontSize: 13 }} />
      {!compact && label}
    </Box>
  );
  return compact ? <Tooltip title={label}>{chip}</Tooltip> : chip;
}

const dotBorder = (theme: Theme) =>
  theme.palette.mode === "dark" ? alpha(theme.palette.common.white, 0.35) : alpha(theme.palette.common.black, 0.2);

const dotSx = (size: number) => ({
  width: size,
  height: size,
  flexShrink: 0,
  // Round in dark mode too, like the colour swatches: the theme squares everything else there.
  borderRadius: "50% !important",
  border: "1px solid",
  borderColor: dotBorder,
});

function filamentText(format: ProfileFormat, filament: ProfileFilament): string {
  return [filament.type, filament.color, format.grams(filament.grams)].filter(Boolean).join(" · ");
}

/** The first few filaments' colours as overlapping dots, each named in its tooltip. */
export function FilamentDots({
  filaments,
  max = 6,
  size = 12,
}: {
  filaments: ProfileFilament[];
  max?: number;
  size?: number;
}) {
  const format = useProfileFormat();
  if (!filaments.length) return null;
  const shown = filaments.slice(0, max);
  const more = filaments.length - shown.length;
  return (
    <Stack direction="row" alignItems="center" sx={{ flexShrink: 0 }}>
      {shown.map((filament, i) => (
        <Tooltip key={i} title={filamentText(format, filament)}>
          <Box
            sx={{
              ...dotSx(size),
              bgcolor: filament.color ?? "transparent",
              ml: i ? `-${Math.round(size * 0.3)}px` : 0,
              boxShadow: (theme) => `0 0 0 1.5px ${theme.palette.background.paper}`,
            }}
          />
        </Tooltip>
      ))}
      {more > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5, fontSize: "0.7rem" }}>
          +{more}
        </Typography>
      )}
    </Stack>
  );
}

/** Each filament with its type and weight. */
export function FilamentList({ filaments }: { filaments: ProfileFilament[] }) {
  const format = useProfileFormat();
  return (
    <Stack direction="row" flexWrap="wrap" useFlexGap sx={{ columnGap: 1.25, rowGap: 0.5 }}>
      {filaments.map((filament, i) => (
        <Stack key={i} direction="row" alignItems="center" spacing={0.5} title={filament.color ?? undefined}>
          <Box sx={{ ...dotSx(12), bgcolor: filament.color ?? "transparent" }} />
          {filament.type && (
            <Typography variant="caption" sx={{ color: "text.primary", fontWeight: 600 }}>
              {filament.type}
            </Typography>
          )}
          {filament.grams != null && (
            <Typography variant="caption" color="text.secondary">
              {format.grams(filament.grams)}
            </Typography>
          )}
        </Stack>
      ))}
    </Stack>
  );
}

/** An icon and a value, as the profiles' meta lines show them. */
export function Fact({ icon, children, label }: { icon: ReactNode; children: ReactNode; label?: string }) {
  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={0.5}
      title={label}
      sx={{ minWidth: 0, color: "text.secondary", "& svg": { fontSize: 15, flexShrink: 0 } }}
    >
      {icon}
      <Typography variant="caption" noWrap sx={{ color: "text.secondary" }}>
        {children}
      </Typography>
    </Stack>
  );
}

/** The profile's picture: its plate's thumbnail, which an import takes from the profile's own cover. */
export function ProfileCover({
  plate,
  size,
  width,
  height,
}: {
  plate: Plate;
  size?: number;
  width?: number;
  height?: number;
}) {
  const w = width ?? size ?? 40;
  const h = height ?? size ?? 40;
  if (plate.thumb_url) {
    return (
      <Box
        component="img"
        src={printsApi.fileUrl(plate.thumb_url)}
        alt=""
        sx={{ width: w, height: h, flexShrink: 0, objectFit: "cover", borderRadius: 1.5, display: "block" }}
      />
    );
  }
  return (
    <Box
      sx={{
        width: w,
        height: h,
        flexShrink: 0,
        borderRadius: 1.5,
        bgcolor: (theme) => neutralTint(theme),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      <PlateThumbnail plate={plate} size={Math.min(w, h)} />
    </Box>
  );
}

/** A build plate's own picture from the 3MF, transparent, on a tint. */
export function ProfilePlateThumb({
  src,
  size = 40,
  selected,
  index,
}: {
  src: string | null;
  size?: number;
  selected?: boolean;
  /** Its number, in the corner. */
  index?: number;
}) {
  return (
    <Box
      sx={{
        position: "relative",
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: 1.25,
        bgcolor: (theme) => neutralTint(theme),
        border: "1.5px solid",
        borderColor: selected ? "primary.main" : "transparent",
        overflow: "hidden",
        transition: "border-color 150ms",
      }}
    >
      {src && (
        <Box
          component="img"
          src={src.startsWith("data:") ? src : printsApi.fileUrl(src)}
          alt=""
          loading="lazy"
          sx={{ width: "100%", height: "100%", objectFit: "contain" }}
        />
      )}
      {index != null && (
        <Box
          component="span"
          sx={{
            position: "absolute",
            left: 3,
            bottom: 3,
            px: 0.5,
            borderRadius: 1,
            fontSize: "0.65rem",
            fontWeight: 700,
            lineHeight: "14px",
            bgcolor: "background.paper",
            color: "text.secondary",
          }}
        >
          {index}
        </Box>
      )}
    </Box>
  );
}

export function LineSkeleton({ width }: { width: number | string }) {
  return (
    <Skeleton
      variant="text"
      width={width}
      sx={{ fontSize: "0.75rem", "@media (prefers-reduced-motion: reduce)": { animation: "none" } }}
    />
  );
}

/** A caption-sized label over the section, as the side panel's others are. */
export function SectionCaption({ children, end }: { children: ReactNode; end?: ReactNode }) {
  return (
    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.75 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: "flex", alignItems: "center" }}>
        {children}
      </Typography>
      {end}
    </Stack>
  );
}

/** A small heading inside a list: "From the designer", "Community", "Other files". */
export function GroupLabel({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={0.5}
      sx={{ px: 1, pt: 1, pb: 0.5, color: "text.secondary", "& svg": { fontSize: 14 } }}
    >
      {icon}
      <Typography
        variant="caption"
        sx={{ fontSize: "0.7rem", fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase" }}
      >
        {children}
      </Typography>
    </Stack>
  );
}
