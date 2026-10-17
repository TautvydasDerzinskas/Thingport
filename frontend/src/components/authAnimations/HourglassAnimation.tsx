import { keyframes } from "@emotion/react";
import Box from "@mui/material/Box";
import { prefersReducedMotion } from "../storageAnimations/parts";

// An hourglass: the top runs into the bottom, then it turns over and runs again. Turned over, the full bulb is
// on top, which is just how each cycle starts, so the jump back is invisible.
const CYCLE_S = 6;
const SAND = "#f5b83d";

const drain = keyframes`
  0% { transform: scaleY(1); }
  82%, 100% { transform: scaleY(0); }
`;
const fill = keyframes`
  0% { transform: scaleY(0); }
  82%, 100% { transform: scaleY(1); }
`;
const stream = keyframes`
  0%, 80% { opacity: 1; }
  83%, 100% { opacity: 0; }
`;
const flip = keyframes`
  0%, 86% { transform: rotate(0deg); }
  98%, 100% { transform: rotate(180deg); }
`;

/** One glass bulb, clipping its sand to the triangle; `up` is the bottom bulb, narrowing upwards. */
function Bulb({ size, top, up, animation }: { size: number; top: number; up: boolean; animation: string }) {
  const width = size * 0.5;
  const height = size * 0.32;
  // The sand's surface: flat, and a little below the rim.
  return (
    <Box
      sx={{
        position: "absolute",
        left: (size - width) / 2,
        top,
        width,
        height,
        bgcolor: "#e2e8f0",
        clipPath: up ? "polygon(46% 0, 54% 0, 100% 100%, 0 100%)" : "polygon(0 0, 100% 0, 54% 100%, 46% 100%)",
      }}
    >
      <Box
        sx={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: up ? "70%" : "80%",
          bgcolor: SAND,
          transformOrigin: "bottom",
          animation,
        }}
      />
    </Box>
  );
}

export default function HourglassAnimation({ size }: { size: number }) {
  const still = prefersReducedMotion();
  const run = (frames: ReturnType<typeof keyframes>, easing = "linear") =>
    still ? "none" : `${frames} ${CYCLE_S}s ${easing} infinite`;
  const cap = { left: size * 0.2, width: size * 0.6, height: Math.max(3, size * 0.07) };
  const neck = size * 0.5;
  return (
    <Box aria-hidden sx={{ position: "relative", width: size, height: size }}>
      <Box sx={{ position: "absolute", inset: 0, animation: run(flip, "cubic-bezier(0.5, 0, 0.3, 1)") }}>
        <Box sx={{ position: "absolute", ...cap, top: size * 0.1, borderRadius: 2, bgcolor: "#b45309" }} />
        <Bulb size={size} top={size * 0.17} up={false} animation={run(drain)} />
        <Box
          sx={{
            position: "absolute",
            left: size / 2 - Math.max(1, size / 70),
            top: neck - size * 0.01,
            width: Math.max(2, size / 35),
            height: size * 0.3,
            bgcolor: SAND,
            animation: run(stream),
          }}
        />
        <Bulb size={size} top={neck + size * 0.01} up animation={run(fill)} />
        <Box
          sx={{
            position: "absolute",
            ...cap,
            top: neck + size * 0.33,
            borderRadius: 2,
            bgcolor: "#b45309",
          }}
        />
      </Box>
    </Box>
  );
}
