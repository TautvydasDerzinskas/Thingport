import { useEffect, useState } from "react";
import { keyframes } from "@emotion/react";
import Box from "@mui/material/Box";
import { useBrandLockup, useTintedSvg } from "../hooks/useBrandLogo";
import { seasonFor } from "../utils/season";

type Props = {
  size?: "lg" | "md" | "sm";
  /** Dresses the logo up for the season it is, if any. */
  seasonal?: boolean;
};

const HEIGHTS: Record<NonNullable<Props["size"]>, string> = {
  lg: "2.25rem",
  md: "1.5rem",
  sm: "1.125rem",
};

// Each season's overlay is named after it, in lower case; only today's is loaded. As text, so its Thingport green
// can take the accent too; the colours it dresses the mark in, like Šaltibarščių diena's pink, stay its own.
export const SEASONAL_OVERLAYS = import.meta.glob<string>("../assets/logos/seasonal/*.svg", {
  query: "?raw",
  import: "default",
});

// Upside down all day, with a wobble now and then as if it noticed.
const upsideDown = keyframes`
  0%, 70%, 100% { transform: rotate(180deg); }
  76% { transform: rotate(168deg); }
  82% { transform: rotate(191deg); }
  88% { transform: rotate(176deg); }
  94% { transform: rotate(183deg); }
`;

export default function Wordmark({ size = "md", seasonal = false }: Props) {
  const [season] = useState(() => (seasonal ? seasonFor(new Date()) : null));
  const [overlaySvg, setOverlaySvg] = useState<string | null>(null);
  const overlay = useTintedSvg(overlaySvg);
  const src = useBrandLockup();
  const height = HEIGHTS[size];

  useEffect(() => {
    const load = season && SEASONAL_OVERLAYS[`../assets/logos/seasonal/${season.toLowerCase()}.svg`];
    if (!load) return;
    let active = true;
    void load().then((svg) => active && setOverlaySvg(svg));
    return () => {
      active = false;
    };
  }, [season]);

  const logo = (
    <Box
      component="img"
      src={src}
      alt="Thingport"
      sx={{
        height,
        width: "auto",
        display: "block",
        ...(season === "aprilFools" && {
          transform: "rotate(180deg)",
          animation: `${upsideDown} 5s ease-in-out infinite`,
          "@media (prefers-reduced-motion: reduce)": { animation: "none" },
        }),
      }}
    />
  );
  if (!overlay) return logo;
  return (
    <Box sx={{ position: "relative", lineHeight: 0 }}>
      {logo}
      {/* The overlay's viewBox (-30 -45 530 175) is the logo's (0 0 411 100) with room around it, so it lines up
          at any size and may spill a little past the logo. */}
      <Box
        component="img"
        src={overlay}
        alt=""
        aria-hidden
        sx={{
          position: "absolute",
          left: `calc(${height} * -0.3)`,
          top: `calc(${height} * -0.45)`,
          height: `calc(${height} * 1.75)`,
          width: "auto",
          pointerEvents: "none",
        }}
      />
    </Box>
  );
}
