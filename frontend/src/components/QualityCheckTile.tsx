import { useId, type ReactNode } from "react";
import { keyframes } from "@emotion/react";
import Box from "@mui/material/Box";
import { alpha, useTheme } from "@mui/material/styles";
import { QUALITY_CHECK_SEVERITY, type QualityCheckKey } from "../api/settings";
import { QUALITY_SEVERITY_COLOR, QUALITY_SEVERITY_ICON } from "./QualitySeverityChip";

// A small picture of each print problem, for its row in the checks dialog and the model's quality report: the model in the accent colour, the problem
// in its severity's colour. Without motion, each shows the problem at its plainest.

const SIZE = 52;

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
`;
const split = keyframes`
  0%, 30%, 100% { transform: translateX(0) rotate(0deg); }
  50%, 80% { transform: translateX(var(--shift)) rotate(var(--tilt)); }
`;
const growRay = keyframes`
  0%, 15% { transform: scale(0); opacity: 0; }
  40%, 85% { transform: scale(1); opacity: 1; }
  100% { transform: scale(0); opacity: 0; }
`;
const flip = keyframes`
  0%, 35% { transform: rotate(0deg); }
  50%, 85% { transform: rotate(180deg); }
  100% { transform: rotate(360deg); }
`;
const squeeze = keyframes`
  0%, 100% { transform: scale(1); }
  50% { transform: scale(0.82); }
`;
const bob = keyframes`
  0%, 100% { transform: translate(0, 0); }
  50% { transform: translate(2px, -3px); }
`;
const resize = keyframes`
  0%, 15% { transform: scale(1); }
  35%, 50% { transform: scale(0.15); }
  70%, 85% { transform: scale(2.2); }
  100% { transform: scale(1); }
`;

const motion = (animation: string, origin = "center") => ({
  animation,
  transformBox: "fill-box",
  transformOrigin: origin,
  "@media (prefers-reduced-motion: reduce)": { animation: "none" },
});

function Drawing({
  check,
  line,
  fill,
  problem,
}: {
  check: QualityCheckKey;
  line: string;
  fill: string;
  problem: string;
}) {
  const clip = useId().replace(/:/g, "");
  const stroke = { stroke: line, strokeWidth: 1.2, strokeLinejoin: "round" as const };
  const problemFill = alpha(problem, 0.2);

  switch (check) {
    case "damaged": {
      // A file split down a jagged crack, its halves drifting apart.
      const page = "M14 8 H29 L36 15 V42 H14 Z";
      const crack = "L22 16 L27 22 L21 30 L26 36 L23 42";
      return (
        <>
          <defs>
            <clipPath id={`${clip}-l`}>
              <path d={`M0 0 H25 ${crack} V48 H0 Z`} />
            </clipPath>
            <clipPath id={`${clip}-r`}>
              <path d={`M48 0 H25 ${crack} V48 H48 Z`} />
            </clipPath>
          </defs>
          {(["l", "r"] as const).map((side) => (
            <Box
              key={side}
              component="g"
              clipPath={`url(#${clip}-${side})`}
              sx={{
                "--shift": side === "l" ? "-1.5px" : "1.5px",
                "--tilt": side === "l" ? "-4deg" : "4deg",
                ...motion(`${split} 2.6s ease-in-out infinite`, side === "l" ? "left bottom" : "right bottom"),
              }}
            >
              <path d={page} fill={fill} {...stroke} />
              <path d="M29 8 V15 H36" fill="none" {...stroke} />
            </Box>
          ))}
          <path d={`M25 8 ${crack}`} fill="none" stroke={problem} strokeWidth={1.6} strokeLinejoin="round" />
        </>
      );
    }
    case "missingParts": {
      // An assembly with one block's place empty.
      return (
        <>
          <rect x={10} y={24} width={14} height={14} fill={fill} {...stroke} />
          <rect x={24} y={24} width={14} height={14} fill={fill} {...stroke} />
          <rect x={10} y={10} width={14} height={14} fill={fill} {...stroke} />
          <Box
            component="rect"
            x={24}
            y={10}
            width={14}
            height={14}
            fill={problemFill}
            stroke={problem}
            strokeWidth={1.6}
            strokeDasharray="3 2"
            sx={motion(`${pulse} 1.8s ease-in-out infinite`)}
          />
        </>
      );
    }
    case "openEdges": {
      // A meshed surface with one triangle gone, its open edges lit.
      const cells: ReactNode[] = [];
      for (const [x, y] of [
        [10, 10],
        [24, 10],
        [10, 24],
        [24, 24],
      ]) {
        cells.push(
          <path key={`${x}-${y}-a`} d={`M${x} ${y} h14 L${x} ${y + 14} Z`} fill={fill} {...stroke} />,
          x === 24 && y === 10 ? null : (
            <path key={`${x}-${y}-b`} d={`M${x + 14} ${y} v14 h-14 Z`} fill={fill} {...stroke} />
          ),
        );
      }
      return (
        <>
          {cells}
          <Box
            component="path"
            d="M38 10 v14 h-14 Z"
            fill={problemFill}
            stroke={problem}
            strokeWidth={1.8}
            strokeLinejoin="round"
            sx={motion(`${pulse} 1.6s ease-in-out infinite`)}
          />
        </>
      );
    }
    case "nonManifoldEdges": {
      // An edge seen end on: two faces meet there as they should, then a third grows out of it.
      return (
        <>
          <path d="M24 24 L7 14" {...stroke} strokeWidth={3} strokeLinecap="round" />
          <path d="M24 24 L41 14" {...stroke} strokeWidth={3} strokeLinecap="round" />
          <Box
            component="path"
            d="M24 24 L24 43"
            stroke={problem}
            strokeWidth={3}
            strokeLinecap="round"
            sx={motion(`${growRay} 2.4s ease-in-out infinite`, "center top")}
          />
          <circle cx={24} cy={24} r={3.2} fill={problem} />
        </>
      );
    }
    case "flippedFaces": {
      // A strip of faces whose normals point out, but one turns over and points in.
      const arrow = (x: number, color: string) => (
        <>
          <path d={`M${x} 22 V10`} stroke={color} strokeWidth={1.6} strokeLinecap="round" />
          <path d={`M${x - 3} 13 L${x} 9.5 L${x + 3} 13`} fill="none" stroke={color} strokeWidth={1.6} />
        </>
      );
      return (
        <>
          <path d="M6 36 L15 24 L24 36 L33 24 L42 36 Z" fill={fill} {...stroke} />
          <path d="M15 24 H33" {...stroke} />
          {arrow(15, line)}
          {arrow(33, line)}
          <Box
            component="g"
            sx={{ transform: "rotate(180deg)", ...motion(`${flip} 2.8s ease-in-out infinite`, "center bottom") }}
          >
            {arrow(24, problem)}
          </Box>
        </>
      );
    }
    case "insideOut": {
      // A closed shape whose normals all point inwards.
      const inward = [
        [24, 7, 24, 15],
        [41, 24, 33, 24],
        [24, 41, 24, 33],
        [7, 24, 15, 24],
      ];
      return (
        <>
          <circle cx={24} cy={24} r={13} fill={fill} {...stroke} />
          <Box component="g" sx={motion(`${squeeze} 2s ease-in-out infinite`)}>
            {inward.map(([x1, y1, x2, y2]) => {
              const dx = Math.sign(x2 - x1) * 3;
              const dy = Math.sign(y2 - y1) * 3;
              return (
                <g key={`${x1}-${y1}`} stroke={problem} strokeWidth={1.6} strokeLinecap="round" fill="none">
                  <path d={`M${x1} ${y1} L${x2} ${y2}`} />
                  <path d={`M${x2 - dx - dy} ${y2 - dy - dx} L${x2} ${y2} L${x2 - dx + dy} ${y2 - dy + dx}`} />
                </g>
              );
            })}
          </Box>
        </>
      );
    }
    case "fragments": {
      // A part with crumbs of mesh floating loose beside it.
      return (
        <>
          <rect x={8} y={18} width={22} height={20} rx={3} fill={fill} {...stroke} />
          {[
            [36, 14, 0],
            [40, 27, 0.5],
            [34, 36, 1],
          ].map(([x, y, delay]) => (
            <Box
              key={`${x}-${y}`}
              component="rect"
              x={x}
              y={y}
              width={4}
              height={4}
              fill={problem}
              sx={{ ...motion(`${bob} 2s ease-in-out infinite`), animationDelay: `${delay}s` }}
            />
          ))}
        </>
      );
    }
    case "scale":
      // A model against a ruler, shrinking to a speck and swelling past the tile, as a wrong unit would.
      return (
        <>
          <path d="M6 42 H42" {...stroke} />
          {[6, 15, 24, 33, 42].map((x) => (
            <path key={x} d={`M${x} 42 V38`} {...stroke} />
          ))}
          <Box
            component="rect"
            x={17}
            y={22}
            width={14}
            height={14}
            fill={problemFill}
            stroke={problem}
            strokeWidth={1.4}
            sx={motion(`${resize} 3.2s ease-in-out infinite`, "center bottom")}
          />
        </>
      );
  }
}

/** The tile on the left of a problem's row. Decorative: the row's text says the same. `badge` pins the severity's icon
 * to its corner, where a row would otherwise show it beside the tile. */
export default function QualityCheckTile({ check, badge }: { check: QualityCheckKey; badge?: boolean }) {
  const theme = useTheme();
  const line = theme.palette.primary.main;
  const severity = QUALITY_CHECK_SEVERITY[check];
  const problem = theme.palette[QUALITY_SEVERITY_COLOR[severity]].main;
  const Icon = QUALITY_SEVERITY_ICON[severity];
  const tile = (
    <Box
      aria-hidden
      sx={{
        width: SIZE,
        height: SIZE,
        flexShrink: 0,
        borderRadius: "12px",
        bgcolor: "#ffffff",
        boxShadow: "inset 0 0 0 1px rgba(0, 0, 0, 0.08)",
        overflow: "hidden",
        display: "grid",
        placeItems: "center",
      }}
    >
      <svg width={44} height={44} viewBox="0 0 48 48" overflow="hidden">
        <Drawing check={check} line={line} fill={alpha(line, 0.14)} problem={problem} />
      </svg>
    </Box>
  );
  if (!badge) return tile;
  return (
    <Box aria-hidden sx={{ position: "relative", flexShrink: 0 }}>
      {tile}
      <Box
        sx={{
          position: "absolute",
          right: -6,
          bottom: -6,
          width: 22,
          height: 22,
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          bgcolor: "background.paper",
          boxShadow: `0 0 0 2px ${problem}`,
        }}
      >
        <Icon sx={{ fontSize: 15, color: problem }} />
      </Box>
    </Box>
  );
}
