import Box from "@mui/material/Box";
import { keyframes } from "@mui/material/styles";

// Three blocks of a part drop into place one after another, each where a spark just landed, as the assistant builds
// a design step by step; the finished part fades and it starts again. Still and whole while off or motion is reduced.
const LOOP_MS = 4200;
// Where each block starts, as a share of the loop.
const STARTS = [6, 28, 50];
const U = 19;

/** A point of the isometric grid, in a 100 × 100 picture, the part centred in it. */
const at = (x: number, y: number, z: number): [number, number] => [
  50 + (x - y - 0.5) * U * 0.866,
  50 + (x + y) * U * 0.5 - (z - 0.25) * U,
];
const points = (corners: [number, number, number][]) => corners.map((corner) => at(...corner).join(",")).join(" ");

// Back to front, so nearer faces cover farther ones.
const BLOCKS: [number, number, number][] = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 0, 1],
];

const dropIn = (start: number) => keyframes`
  0%, ${start}% { opacity: 0; transform: translateY(-8px); }
  ${start + 9}% { opacity: 1; transform: none; }
  86% { opacity: 1; transform: none; }
  96%, 100% { opacity: 0; transform: none; }
`;

const spark = keyframes`
  ${STARTS.map((start, index) => {
    const [x, y] = at(BLOCKS[index][0] + 0.5, BLOCKS[index][1] + 0.5, BLOCKS[index][2] + 1.6);
    return `${Math.max(0, start - 5)}% { opacity: 0; transform: translate(${x}px, ${y}px) scale(0.4); }
      ${start}% { opacity: 1; transform: translate(${x}px, ${y}px) scale(1); }
      ${start + 8}% { opacity: 0; transform: translate(${x}px, ${y + 6}px) scale(0.6); }`;
  }).join("\n")}
  100% { opacity: 0; }
`;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

export default function StudioAssistantAnimation({ size, paused }: { size: number; paused?: boolean }) {
  const still = paused || prefersReducedMotion();
  return (
    <Box component="svg" viewBox="0 0 100 100" sx={{ width: size, height: size }} aria-hidden>
      {BLOCKS.map(([x, y, z], index) => (
        <Box
          component="g"
          key={`${x}${y}${z}`}
          sx={{ animation: still ? "none" : `${dropIn(STARTS[index])} ${LOOP_MS}ms ease-out infinite` }}
        >
          <polygon
            points={points([
              [x, y, z + 1],
              [x + 1, y, z + 1],
              [x + 1, y + 1, z + 1],
              [x, y + 1, z + 1],
            ])}
            fill="#93c5fd"
          />
          <polygon
            points={points([
              [x, y + 1, z + 1],
              [x + 1, y + 1, z + 1],
              [x + 1, y + 1, z],
              [x, y + 1, z],
            ])}
            fill="#3b82f6"
          />
          <polygon
            points={points([
              [x + 1, y, z + 1],
              [x + 1, y + 1, z + 1],
              [x + 1, y + 1, z],
              [x + 1, y, z],
            ])}
            fill="#2563eb"
          />
        </Box>
      ))}
      {!still && (
        <Box
          component="path"
          d="M0 -6 L1.6 -1.6 L6 0 L1.6 1.6 L0 6 L-1.6 1.6 L-6 0 L-1.6 -1.6 Z"
          fill="#a855f7"
          sx={{ animation: `${spark} ${LOOP_MS}ms ease-out infinite`, opacity: 0 }}
        />
      )}
    </Box>
  );
}
