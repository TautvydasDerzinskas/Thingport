import { keyframes } from "@emotion/react";
import Box from "@mui/material/Box";
import type { FileReuse } from "../../api/settings";
import { Folder, ModelShape, prefersReducedMotion } from "./parts";

// Two users' folders with the same model in each. Off: two copies, one in each. Copy-on-write: the second
// is a faded clone of the first, filling in as it's read.
const CYCLE_S = 2.4;

const bob = keyframes`
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-10%); }
`;
const clone = keyframes`
  0%, 100% { opacity: 0.35; }
  50% { opacity: 0.9; }
`;

export default function FileReuseAnimation({ size, mode }: { size: number; mode: FileReuse }) {
  const still = prefersReducedMotion();
  const u = size / 76;
  const folder = { top: 46 * u, width: 26 * u, height: 18 * u };
  const left = 9 * u;
  const right = 41 * u;
  const model = 16 * u;
  const fade = { transition: "opacity 220ms ease-out, transform 220ms ease-out" };
  const animate = (frames: ReturnType<typeof keyframes>, delay = 0) =>
    still ? "none" : `${frames} ${CYCLE_S}s ease-in-out ${delay}s infinite`;

  const modelAt = (x: number, y: number, extra: object) => (
    <Box sx={{ position: "absolute", left: x, top: y, ...fade, ...extra }}>
      <ModelShape kind="cube" size={model} palette="green" />
    </Box>
  );

  return (
    <Box aria-hidden sx={{ position: "relative", width: size, height: size }}>
      <Folder left={left} {...folder} />
      <Folder left={right} {...folder} />
      {/* A copy in each folder; the right one is the clone, faded when it shares the left one's blocks. */}
      {modelAt(left + 5 * u, 30 * u, { animation: animate(bob) })}
      {modelAt(right + 5 * u, 30 * u, {
        // Under the animation's own opacity; what's left with reduced motion, so the two states still differ.
        opacity: mode === "reflink" ? 0.5 : 1,
        animation: mode === "reflink" ? animate(clone) : animate(bob, CYCLE_S / 3),
      })}
    </Box>
  );
}
