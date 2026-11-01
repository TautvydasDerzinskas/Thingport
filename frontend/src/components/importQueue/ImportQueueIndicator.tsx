import { keyframes } from "@emotion/react";
import Box from "@mui/material/Box";
import { alpha, type Theme } from "@mui/material/styles";
import { AddModelIcon, ModelCubeIcon } from "../Layout/topBarIcons";
import { REDUCED_MOTION, spinSx } from "./queueParts";
import type { IndicatorState } from "./queueView";

const pop = keyframes`from { opacity: 0; transform: scale(0.6); }`;
const popSx = (ms: number) => ({ animation: `${pop} ${ms}ms ease-out both`, [REDUCED_MOTION]: { animation: "none" } });

const layerSx = { position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" };

// The ring and the comet are drawn and masked rather than rounded: the dark theme squares off any border radius.
const ringSx = (theme: Theme) => {
  const dark = theme.palette.mode === "dark";
  return {
    ...layerSx,
    display: "block",
    transform: "rotate(-90deg)",
    "& circle": { fill: "none", strokeWidth: 2.5 },
    "& .track": { stroke: alpha(dark ? theme.palette.common.white : theme.palette.common.black, dark ? 0.12 : 0.09) },
    "& .arc": {
      stroke: theme.palette.primary.main,
      strokeLinecap: "round",
      transition: "stroke-dasharray 300ms ease-out",
      [REDUCED_MOTION]: { transition: "none" },
    },
    "& .arc.none": { stroke: "transparent" },
  };
};

export function Ring({ arc }: { arc: number | null }) {
  return (
    <Box component="svg" viewBox="0 0 30 30" aria-hidden sx={ringSx}>
      <circle className="track" cx="15" cy="15" r="10.5" />
      <circle
        // Nothing at 0 too: a round cap on an empty arc draws a dot on the track.
        className={arc ? "arc" : "arc none"}
        cx="15"
        cy="15"
        r="10.5"
        pathLength={100}
        style={{ strokeDasharray: `${arc ?? 0} 100` }}
      />
    </Box>
  );
}

// The mask's colour only says what shows. Without the last stop, what's outside the circle shows too: a square.
const COMET_MASK =
  "radial-gradient(circle farthest-side, transparent calc(100% - 2.5px), black calc(100% - 2px), black calc(100% - 0.5px), transparent 100%)";

export function Comet() {
  return (
    <Box
      component="span"
      aria-hidden
      sx={{
        ...layerSx,
        background: (theme) => `conic-gradient(from 0deg, transparent 0 50%, ${theme.palette.primary.main} 100%)`,
        WebkitMask: COMET_MASK,
        mask: COMET_MASK,
        ...spinSx,
        [REDUCED_MOTION]: { display: "none" },
      }}
    />
  );
}

function Tick() {
  return (
    <Box
      component="svg"
      viewBox="0 0 24 24"
      aria-hidden
      sx={[
        (theme) => ({
          position: "relative",
          display: "block",
          width: 15,
          height: 15,
          fill: theme.palette.mode === "dark" ? theme.palette.primary.light : theme.palette.primary.dark,
        }),
        popSx(300),
      ]}
    >
      <path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
    </Box>
  );
}

const BADGE_TONES = {
  error: { bgcolor: "error.main", color: "error.contrastText" },
  neutral: { bgcolor: "text.secondary", color: "background.paper" },
  accent: { bgcolor: "primary.main", color: "primary.contrastText" },
  info: { bgcolor: "info.dark", color: "info.contrastText" },
};

function Badge({ text, tone }: NonNullable<IndicatorState["badge"]>) {
  return (
    <Box
      component="span"
      sx={[
        {
          position: "absolute",
          top: -4,
          right: -4,
          minWidth: 16,
          height: 16,
          px: "4px",
          borderRadius: "8px",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 10,
          fontWeight: 500,
          lineHeight: 1,
          boxShadow: (theme) => `0 0 0 2px ${theme.thingport.pageBackground}`,
        },
        BADGE_TONES[tone],
        popSx(220),
      ]}
    >
      {text}
    </Box>
  );
}

/** What the top bar's Add button shows, for each of the indicator's states: Add itself, with the viewer's imports on it. */
export function IndicatorFace({ state }: { state: IndicatorState }) {
  return (
    <>
      {state.ring && <Ring arc={state.ring.arc} />}
      {state.comet && <Comet />}
      {state.glyph === "add" && <AddModelIcon />}
      {/* Smaller inside the ring, so the two don't touch. */}
      {state.glyph === "cube" && <ModelCubeIcon sx={state.ring ? { fontSize: 15 } : undefined} />}
      {state.glyph === "tick" && <Tick />}
      {state.badge && <Badge {...state.badge} />}
    </>
  );
}
