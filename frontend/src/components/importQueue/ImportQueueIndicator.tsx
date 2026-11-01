import { keyframes } from "@emotion/react";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import { alpha, type Theme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import { statusTint } from "../../theme";
import { ImportQueueIcon, topBarButtonSx } from "../Layout/topBarIcons";
import { useImportQueue } from "./ImportQueueContext";
import { focusRingSx, REDUCED_MOTION, spinSx } from "./queueParts";
import { indicatorLabel, indicatorTip, type IndicatorState } from "./queueView";

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

function Ring({ arc }: { arc: number | null }) {
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

function Comet() {
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

function Badge({ count, tone }: NonNullable<IndicatorState["badge"]>) {
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
        tone === "error"
          ? { bgcolor: "error.main", color: "error.contrastText" }
          : { bgcolor: "text.secondary", color: "background.paper" },
        popSx(220),
      ]}
    >
      {count}
    </Box>
  );
}

/** What the button shows, for each of the indicator's states. */
export function IndicatorFace({ state }: { state: IndicatorState }) {
  return (
    <>
      {state.ring && <Ring arc={state.ring.arc} />}
      {state.comet && <Comet />}
      {state.number !== null && (
        <Box
          component="span"
          sx={(theme) => ({
            position: "relative",
            fontSize: 11,
            fontWeight: 700,
            lineHeight: 1,
            color:
              state.numberTone === "info"
                ? statusTint(theme, "info").text
                : theme.palette.mode === "dark"
                  ? theme.palette.primary.light
                  : theme.palette.primary.dark,
          })}
        >
          {state.number}
        </Box>
      )}
      {state.glyph === "tick" && <Tick />}
      {state.glyph === "tray" && (
        <ImportQueueIcon
          sx={
            state.arrowTone === "error" ? (theme) => ({ "& .detail": { fill: theme.palette.error.main } }) : undefined
          }
        />
      )}
      {state.badge && <Badge {...state.badge} />}
    </>
  );
}

/** The top bar's button for the viewer's own imports, which opens the queue on what it's showing. Not there when the
 *  backend is older than the queue. */
export default function ImportQueueIndicator() {
  const { t } = useTranslation("app");
  const { supported, indicator, open } = useImportQueue();
  if (!supported) return null;
  return (
    <Tooltip title={indicatorTip(indicator, t)}>
      <IconButton
        size="small"
        aria-label={indicatorLabel(indicator, t)}
        onClick={() => open()}
        sx={{ ...topBarButtonSx, ...focusRingSx }}
      >
        <IndicatorFace state={indicator} />
      </IconButton>
    </Tooltip>
  );
}
