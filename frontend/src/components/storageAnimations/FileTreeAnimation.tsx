import { keyframes } from "@emotion/react";
import Box from "@mui/material/Box";
import { Folder, LINE, ModelShape, prefersReducedMotion, type Palette, type ShapeKind } from "./parts";

// A folder tree growing down: one folder, lines out to two, and from those to two and three model files. Each
// piece comes in at its moment in the cycle, the whole tree holds a while, fades, and grows again.
const CYCLE_S = 6;

/** Hidden until `at` (% of the cycle), then grows in; everything leaves together at the end. */
function growIn(at: number, axis: "both" | "x" | "y") {
  const from = axis === "x" ? "scaleX(0)" : axis === "y" ? "scaleY(0)" : "scale(0.3)";
  return keyframes`
    0%, ${at}% { opacity: 0; transform: ${from}; }
    ${at + 6}% { opacity: 1; transform: none; }
    86% { opacity: 1; transform: none; }
    95%, 100% { opacity: 0; transform: none; }
  `;
}

type Line = { x1: number; y1: number; x2: number; y2: number; at: number };
type Leaf = { x: number; kind: ShapeKind; palette: Palette; at: number };

// In parts of the size: x across, y down.
const ROOT = { x: 0.5, y: 0.13, at: 0 };
const BRANCHES = [
  { x: 0.27, y: 0.46, at: 22 },
  { x: 0.73, y: 0.46, at: 22 },
];
const LINES: Line[] = [
  { x1: 0.5, y1: 0.22, x2: 0.5, y2: 0.31, at: 8 },
  { x1: 0.27, y1: 0.31, x2: 0.73, y2: 0.31, at: 13 },
  { x1: 0.27, y1: 0.31, x2: 0.27, y2: 0.39, at: 18 },
  { x1: 0.73, y1: 0.31, x2: 0.73, y2: 0.39, at: 18 },
  { x1: 0.27, y1: 0.54, x2: 0.27, y2: 0.62, at: 32 },
  { x1: 0.73, y1: 0.54, x2: 0.73, y2: 0.62, at: 32 },
  { x1: 0.15, y1: 0.62, x2: 0.39, y2: 0.62, at: 36 },
  { x1: 0.59, y1: 0.62, x2: 0.87, y2: 0.62, at: 36 },
  { x1: 0.15, y1: 0.62, x2: 0.15, y2: 0.69, at: 40 },
  { x1: 0.39, y1: 0.62, x2: 0.39, y2: 0.69, at: 40 },
  { x1: 0.59, y1: 0.62, x2: 0.59, y2: 0.69, at: 40 },
  { x1: 0.73, y1: 0.62, x2: 0.73, y2: 0.69, at: 40 },
  { x1: 0.87, y1: 0.62, x2: 0.87, y2: 0.69, at: 40 },
];
const LEAF_Y = 0.79;
const LEAVES: Leaf[] = [
  { x: 0.15, kind: "cube", palette: "green", at: 46 },
  { x: 0.39, kind: "sphere", palette: "blue", at: 51 },
  { x: 0.59, kind: "pyramid", palette: "purple", at: 56 },
  { x: 0.73, kind: "cube", palette: "amber", at: 61 },
  { x: 0.87, kind: "sphere", palette: "green", at: 66 },
];

export default function FileTreeAnimation({ size }: { size: number }) {
  const still = prefersReducedMotion();
  const thickness = Math.max(1.5, size / 48);
  const animate = (at: number, axis: "both" | "x" | "y") =>
    still ? "none" : `${growIn(at, axis)} ${CYCLE_S}s ease-out infinite`;
  const folderAt = (x: number, y: number, width: number, at: number, key: string) => (
    <Box
      key={key}
      sx={{
        position: "absolute",
        left: size * (x - width / 2),
        top: size * (y - width * 0.35),
        width: size * width,
        height: size * width * 0.7,
        animation: animate(at, "both"),
      }}
    >
      <Folder left={0} top={0} width={size * width} height={size * width * 0.7} />
    </Box>
  );
  const leafSize = 0.12;

  return (
    <Box aria-hidden sx={{ position: "relative", width: size, height: size }}>
      {LINES.map((line) => {
        const vertical = line.x1 === line.x2;
        return (
          <Box
            key={`${line.x1},${line.y1},${line.x2},${line.y2}`}
            sx={{
              position: "absolute",
              left: size * line.x1 - (vertical ? thickness / 2 : 0),
              top: size * line.y1 - (vertical ? 0 : thickness / 2),
              width: vertical ? thickness : size * (line.x2 - line.x1),
              height: vertical ? size * (line.y2 - line.y1) : thickness,
              borderRadius: thickness,
              bgcolor: LINE,
              transformOrigin: vertical ? "top" : "center",
              animation: animate(line.at, vertical ? "y" : "x"),
            }}
          />
        );
      })}
      {folderAt(ROOT.x, ROOT.y, 0.24, ROOT.at, "root")}
      {BRANCHES.map((branch, index) => folderAt(branch.x, branch.y, 0.2, branch.at, `branch-${index}`))}
      {LEAVES.map((leaf) => (
        <Box
          key={leaf.x}
          sx={{
            position: "absolute",
            left: size * (leaf.x - leafSize / 2),
            top: size * (LEAF_Y - leafSize / 2),
            animation: animate(leaf.at, "both"),
          }}
        >
          <ModelShape kind={leaf.kind} size={size * leafSize} palette={leaf.palette} />
        </Box>
      ))}
    </Box>
  );
}
