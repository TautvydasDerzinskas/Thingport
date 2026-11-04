import { keyframes } from "@emotion/react";
import Box from "@mui/material/Box";
import { prefersReducedMotion } from "../storageAnimations/parts";
import { Bust, COLLECTOR, Padlock, SHARER } from "./SharingAnimation";

// The two people from the sharing tile, talking: a bubble rises from one, then an answer from the other. Off, a padlock
// stands between them and neither says anything. The bubbles are SVG, as dark mode squares every CSS corner.
const CYCLE_S = 3.2;

const first = keyframes`
  0%, 4% { transform: translateY(6px) scale(0.6); opacity: 0; }
  12%, 70% { transform: none; opacity: 1; }
  80%, 100% { transform: translateY(-4px); opacity: 0; }
`;
const second = keyframes`
  0%, 36% { transform: translateY(6px) scale(0.6); opacity: 0; }
  46%, 84% { transform: none; opacity: 1; }
  94%, 100% { transform: translateY(-4px); opacity: 0; }
`;

/** A speech bubble with three dots, its tail towards whoever said it. */
function Bubble({
  left,
  top,
  width,
  color,
  tail,
  animation,
}: {
  left: number;
  top: number;
  width: number;
  color: string;
  tail: "left" | "right";
  animation?: string;
}) {
  return (
    <Box
      component="svg"
      viewBox="0 0 40 30"
      sx={{ position: "absolute", left, top, width, height: width * 0.75, overflow: "visible", animation }}
    >
      <rect x="0" y="0" width="40" height="22" rx="9" fill={color} />
      <path d={tail === "left" ? "M7 20 L5 29 L15 21 Z" : "M33 20 L35 29 L25 21 Z"} fill={color} />
      {[12, 20, 28].map((cx) => (
        <circle key={cx} cx={cx} cy="11" r="2.4" fill="#ffffff" />
      ))}
    </Box>
  );
}

/** `on`: chats are on, so the two talk; otherwise a padlock keeps them quiet. */
export default function ChatAnimation({ size, on }: { size: number; on: boolean }) {
  const still = prefersReducedMotion();
  const person = size * 0.42;
  const ground = size * 0.06;
  const leftPerson = size * 0.04;
  const rightPerson = size - leftPerson - person;
  const bubble = size * 0.34;
  const bubbleTop = size * 0.08;
  const lock = size * 0.18;
  const run = (frames: ReturnType<typeof keyframes>) => (still ? "none" : `${frames} ${CYCLE_S}s ease-out infinite`);

  return (
    <Box aria-hidden sx={{ position: "relative", width: size, height: size }}>
      <Bust left={leftPerson} bottom={ground} width={person} look={SHARER} />
      <Bust left={rightPerson} bottom={ground} width={person} look={COLLECTOR} />
      {on ? (
        <>
          <Bubble
            left={leftPerson + person * 0.35}
            top={bubbleTop}
            width={bubble}
            color="#22c55e"
            tail="left"
            animation={run(first)}
          />
          <Bubble
            left={rightPerson + person * 0.65 - bubble}
            top={bubbleTop + size * 0.06}
            width={bubble}
            color="#3b82f6"
            tail="right"
            animation={run(second)}
          />
        </>
      ) : (
        <Padlock left={(size - lock) / 2} top={size * 0.14} size={lock} />
      )}
    </Box>
  );
}
