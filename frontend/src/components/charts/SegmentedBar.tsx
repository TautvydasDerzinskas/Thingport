import { useLayoutEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { alpha, getContrastRatio } from "@mui/material/styles";

export type BarSegment = {
  key: string;
  label: string;
  value: number;
  /** The value as the reader sees it, e.g. "7.5 GB". */
  valueLabel: string;
  color: string;
  /** Striped: the same thing as its neighbour in a state of its own, e.g. older versions of it. */
  hatched?: boolean;
};

type Props = {
  segments: BarSegment[];
  /** Names the whole bar for screen readers, which also hear every part. */
  label: string;
  /** 28 at most; thinner bars print no values. */
  height?: number;
};

// Narrower than this, a part prints no value inside: the legend and its tooltip still give it.
const MIN_LABELLED_WIDTH = 64;

export function segmentFill(segment: Pick<BarSegment, "color" | "hatched">): string {
  return segment.hatched
    ? `repeating-linear-gradient(135deg, ${segment.color} 0 3px, ${alpha(segment.color, 0.35)} 3px 7px)`
    : segment.color;
}

/** White or black, whichever contrasts more with `color`: one of them reaches 4.5:1 on any colour, as text needs. */
export function inkOn(color: string, common: { white: string; black: string }): string {
  return getContrastRatio(common.black, color) > getContrastRatio(common.white, color) ? common.black : common.white;
}

/**
 * One whole split into parts, widths in proportion, 2px apart. Each part names itself and its value on hover and
 * keyboard focus, and prints the value inside where it fits. A part of zero draws nothing.
 */
export default function SegmentedBar({ segments, label, height = 24 }: Props) {
  const ref = useRef<HTMLUListElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const shown = segments.filter((segment) => segment.value > 0);
  const total = shown.reduce((sum, segment) => sum + segment.value, 0);
  const gaps = Math.max(0, shown.length - 1) * 2;
  return (
    <Box
      ref={ref}
      component="ul"
      aria-label={label}
      sx={{
        m: 0,
        p: 0,
        listStyle: "none",
        display: "flex",
        gap: "2px",
        height,
        width: "100%",
        animation: "segmented-bar-in 250ms ease-out",
        "@keyframes segmented-bar-in": { from: { opacity: 0 }, to: { opacity: 1 } },
        "@media (prefers-reduced-motion: reduce)": { animation: "none" },
      }}
    >
      {shown.map((segment) => {
        const share = total ? segment.value / total : 0;
        const labelled = height >= 20 && share * (width - gaps) >= MIN_LABELLED_WIDTH;
        return (
          <Tooltip key={segment.key} title={`${segment.label}: ${segment.valueLabel}`} disableInteractive>
            <Box
              component="li"
              tabIndex={0}
              aria-label={`${segment.label}: ${segment.valueLabel}`}
              sx={{
                flex: `${share} 0 0`,
                minWidth: 3,
                borderRadius: "4px",
                background: segmentFill(segment),
                display: "flex",
                alignItems: "center",
                px: 0.75,
                overflow: "hidden",
                outlineOffset: 2,
                "&:focus-visible": { outline: (theme) => `2px solid ${theme.palette.text.primary}` },
              }}
            >
              {labelled && (
                <Typography
                  variant="caption"
                  aria-hidden
                  sx={{
                    color: (theme) => inkOn(segment.color, theme.palette.common),
                    fontWeight: 600,
                    lineHeight: 1,
                    whiteSpace: "nowrap",
                    // On stripes, the value sits on a patch of the solid colour so it stays readable.
                    ...(segment.hatched && { bgcolor: segment.color, px: 0.5, py: 0.25, borderRadius: "3px" }),
                  }}
                >
                  {segment.valueLabel}
                </Typography>
              )}
            </Box>
          </Tooltip>
        );
      })}
    </Box>
  );
}
