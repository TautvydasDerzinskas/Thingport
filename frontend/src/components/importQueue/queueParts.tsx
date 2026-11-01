import { keyframes } from "@emotion/react";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import type { SxProps, Theme } from "@mui/material/styles";
import { neutralTint, statusTint } from "../../theme";
import { personInitials, type ChipTone } from "./queueView";

const rise = keyframes`from { opacity: 0; transform: translateY(4px); }`;
const popIn = keyframes`from { opacity: 0; transform: translateY(8px) scale(0.985); }`;
const pulse = keyframes`50% { opacity: 0.35; transform: scale(0.75); }`;
const spin = keyframes`to { transform: rotate(360deg); }`;

export const REDUCED_MOTION = "@media (prefers-reduced-motion: reduce)";

const still = { [REDUCED_MOTION]: { animation: "none" } };

/** Cards, rows and link lists as they appear. */
export const riseInSx = { animation: `${rise} 220ms ease-out both`, ...still };
/** The dialog as it opens. */
export const popInSx = { animation: `${popIn} 220ms ease-out both`, ...still };
export const spinSx = { animation: `${spin} 1100ms linear infinite`, ...still };
/** Skeletons hold still under reduced motion too. */
export const stillSkeletonsSx = { [REDUCED_MOTION]: { "& .MuiSkeleton-root": { animation: "none" } } };

export const focusRingSx = {
  "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 1 },
};

/** Read by screen readers, not shown. */
export const visuallyHiddenSx = {
  position: "absolute",
  width: "1px",
  height: "1px",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
} as const;

/** Big enough to tap on a phone, as `dialogIconButtonSx` is for icon buttons. */
export const tapTargetSx = { minHeight: { xs: 44, md: 0 } };

/** An outlined button that doesn't compete with the one primary action in view. */
export const quietButtonSx: SxProps<Theme> = {
  ...tapTargetSx,
  px: "12px",
  py: "5px",
  lineHeight: "19px",
  borderColor: "divider",
  color: (theme) => theme.thingport.headingText,
  "&:hover": { borderColor: "primary.main", bgcolor: "action.hover" },
};

/** A small dot, pulsing while something is happening. */
export function LiveDot({ live = false, color = "currentColor" }: { live?: boolean; color?: string }) {
  return (
    <Box
      component="span"
      sx={{
        display: "block",
        flexShrink: 0,
        width: 6,
        height: 6,
        borderRadius: "50%",
        bgcolor: color,
        ...(live && { animation: `${pulse} 1200ms ease-in-out infinite`, ...still }),
      }}
    />
  );
}

type StatusChipProps = {
  label: string;
  tone: ChipTone;
  /** Pulses, while something is happening. */
  live?: boolean;
  /** What the state means, on hover or focus. */
  hint?: string;
};

export function StatusChip({ label, tone, live, hint }: StatusChipProps) {
  const chip = (
    <Chip
      size="small"
      // Focusable, so the hint reaches keyboard users too.
      tabIndex={hint ? 0 : undefined}
      label={
        <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
          <LiveDot live={live} />
          {label}
        </Box>
      }
      sx={[
        (theme) => {
          const tint =
            tone === "neutral"
              ? { background: neutralTint(theme), text: theme.palette.text.primary }
              : statusTint(theme, tone);
          return { backgroundColor: tint.background, color: tint.text };
        },
        { height: 20, flexShrink: 0, fontSize: 11, fontWeight: 600, "& .MuiChip-label": { px: 1 } },
        focusRingSx,
      ]}
    />
  );
  return hint ? (
    <Tooltip title={hint} describeChild>
      {chip}
    </Tooltip>
  ) : (
    chip
  );
}

/** The round "#3" before a job in line. `quiet` for a row that isn't the viewer's. */
export function PlacePill({ text, title, quiet = false }: { text: string; title?: string; quiet?: boolean }) {
  const pill = (
    <Box
      component="span"
      sx={[
        {
          minWidth: 32,
          height: 32,
          px: 0.75,
          flexShrink: 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "16px",
          fontWeight: 700,
          whiteSpace: "nowrap",
        },
        quiet
          ? { fontSize: 11, bgcolor: "background.paper", color: "text.secondary", border: 1, borderColor: "divider" }
          : (theme) => {
              const { background, text: color } = statusTint(theme, "info");
              return { fontSize: 13, backgroundColor: background, color };
            },
      ]}
    >
      {text}
    </Box>
  );
  return title ? (
    <Tooltip title={title} describeChild>
      {pill}
    </Tooltip>
  ) : (
    pill
  );
}

/** Initials only: a Gravatar would send other people's email hashes out from an admin's browser. */
export function InitialsAvatar({ name, size }: { name: string; size: number }) {
  return (
    <Avatar
      aria-hidden
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        fontSize: size < 20 ? 9 : 10,
        fontWeight: 600,
        bgcolor: "primary.main",
        color: "primary.contrastText",
      }}
    >
      {personInitials(name)}
    </Avatar>
  );
}
