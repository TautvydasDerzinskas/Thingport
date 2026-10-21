import { useMemo } from "react";
import { useTheme } from "@mui/material/styles";
import lockupColor from "../assets/logos/thingport-lockup-compact-color.svg?raw";
import lockupOnDark from "../assets/logos/thingport-lockup-compact-on-dark.svg?raw";
import markColor from "../assets/logos/thingport-mark-color.svg?raw";
import markOnDark from "../assets/logos/thingport-mark-on-dark.svg?raw";

// The logo files are drawn in Thingport green, which stands for the accent, so it's swapped for the one picked.
// Every other colour, such as a seasonal overlay's own, is left alone.
const BRAND_GREEN = /#00b800/gi;

function tint(svg: string, accent: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace(BRAND_GREEN, accent))}`;
}

/** An SVG's text as an <img> src, its Thingport green in the theme's accent; null while there's no SVG. */
export function useTintedSvg(svg: string | null): string | null {
  const accent = useTheme().palette.primary.main;
  return useMemo(() => svg && tint(svg, accent), [svg, accent]);
}

/** The icon-only mark; `onDark` defaults to the theme's mode. */
export function useBrandMark(onDark?: boolean): string {
  const { palette } = useTheme();
  const svg = (onDark ?? palette.mode === "dark") ? markOnDark : markColor;
  return useMemo(() => tint(svg, palette.primary.main), [svg, palette.primary.main]);
}

/** The mark beside the name. */
export function useBrandLockup(): string {
  const { palette } = useTheme();
  const svg = palette.mode === "dark" ? lockupOnDark : lockupColor;
  return useMemo(() => tint(svg, palette.primary.main), [svg, palette.primary.main]);
}
