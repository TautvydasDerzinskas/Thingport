import { keyframes } from "@emotion/react";
import Box from "@mui/material/Box";
import { prefersReducedMotion } from "../storageAnimations/parts";
import { Padlock } from "./SharingAnimation";

// Two instances, each a little window with a model in it, joined by a dotted line: a model goes over, and one comes
// back. Off, a padlock sits on the line and nothing moves. SVG, as dark mode squares every CSS corner.
const CYCLE_S = 3.4;

const over = keyframes`
  0%, 6% { transform: translateX(0) scale(0.6); opacity: 0; }
  14% { transform: translateX(0) scale(1); opacity: 1; }
  42% { transform: translateX(var(--run)) scale(1); opacity: 1; }
  50%, 100% { transform: translateX(var(--run)) scale(0.6); opacity: 0; }
`;
const back = keyframes`
  0%, 50% { transform: translateX(0) scale(0.6); opacity: 0; }
  58% { transform: translateX(0) scale(1); opacity: 1; }
  86% { transform: translateX(calc(var(--run) * -1)) scale(1); opacity: 1; }
  94%, 100% { transform: translateX(calc(var(--run) * -1)) scale(0.6); opacity: 0; }
`;

/** A small isometric cube: a model. */
function Cube({ color, size }: { color: string; size: number }) {
  return (
    <Box component="svg" viewBox="0 0 20 20" sx={{ width: size, height: size, display: "block" }}>
      <path d="M10 2 L18 6.5 L10 11 L2 6.5 Z" fill={color} />
      <path d="M2 6.5 L10 11 L10 19 L2 14.5 Z" fill={color} opacity="0.75" />
      <path d="M18 6.5 L10 11 L10 19 L18 14.5 Z" fill={color} opacity="0.55" />
    </Box>
  );
}

/** An instance: a window with a title bar and a model in it. */
function Instance({ left, top, width, cube }: { left: number; top: number; width: number; cube: string }) {
  return (
    <Box sx={{ position: "absolute", left, top, width, height: width * 0.9 }}>
      <Box component="svg" viewBox="0 0 40 36" sx={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        <rect x="1.5" y="1.5" width="37" height="33" rx="6" fill="#ffffff" stroke="#94a3b8" strokeWidth="2" />
        <path d="M1.5 9.5 H38.5" stroke="#94a3b8" strokeWidth="2" />
        {[7, 12, 17].map((cx) => (
          <circle key={cx} cx={cx} cy="5.6" r="1.4" fill="#94a3b8" />
        ))}
      </Box>
      <Box sx={{ position: "absolute", left: "30%", top: "38%", width: "40%" }}>
        <Cube color={cube} size={width * 0.4} />
      </Box>
    </Box>
  );
}

/** `on`: connected instances are on, so models travel between the two; otherwise a padlock keeps them apart. */
export default function ConnectedInstancesAnimation({ size, on }: { size: number; on: boolean }) {
  const still = prefersReducedMotion();
  const box = size * 0.34;
  const inset = size * 0.03;
  const top = (size - box * 0.9) / 2;
  const lineY = top + box * 0.55;
  const from = inset + box;
  const to = size - inset - box;
  const packet = size * 0.13;
  const run = to - from - packet;
  const lock = size * 0.18;
  const animate = (frames: ReturnType<typeof keyframes>) =>
    still || !on ? "none" : `${frames} ${CYCLE_S}s ease-in-out infinite`;

  return (
    <Box aria-hidden sx={{ position: "relative", width: size, height: size, "--run": `${run}px` }}>
      <Box
        component="svg"
        viewBox={`0 0 ${size} ${size}`}
        sx={{ position: "absolute", inset: 0, width: size, height: size, overflow: "visible" }}
      >
        <line
          x1={from}
          y1={lineY}
          x2={to}
          y2={lineY}
          stroke={on ? "#22c55e" : "#cbd5e1"}
          strokeWidth={size * 0.025}
          strokeDasharray={`${size * 0.03} ${size * 0.035}`}
          strokeLinecap="round"
        />
      </Box>
      <Instance left={inset} top={top} width={box} cube="#22c55e" />
      <Instance left={size - inset - box} top={top} width={box} cube="#3b82f6" />
      {on ? (
        <>
          <Box
            sx={{
              position: "absolute",
              left: from,
              top: lineY - packet / 2,
              opacity: still ? 1 : 0,
              animation: animate(over),
            }}
          >
            <Cube color="#22c55e" size={packet} />
          </Box>
          <Box
            sx={{
              position: "absolute",
              left: to - packet,
              top: lineY - packet / 2,
              // Still, only the first model shows, on its way.
              opacity: 0,
              animation: animate(back),
            }}
          >
            <Cube color="#3b82f6" size={packet} />
          </Box>
        </>
      ) : (
        <Padlock left={(size - lock) / 2} top={lineY - lock / 2} size={lock} />
      )}
    </Box>
  );
}
