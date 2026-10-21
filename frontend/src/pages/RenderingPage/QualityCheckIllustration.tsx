import { keyframes } from "@emotion/react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import { alpha, useTheme } from "@mui/material/styles";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import WarningRoundedIcon from "@mui/icons-material/WarningRounded";

const TILE = 76;
const CUBE = 30;
// One pass over all three models, then they start again.
const CYCLE_S = 7.5;
// Each model's turn starts this long after the one before, and its scan takes SCAN_S of it.
const STEP_S = 2;
const SCAN_S = 1.4;

const pct = (seconds: number) => `${((seconds / CYCLE_S) * 100).toFixed(2)}%`;

// Per model, since each one's beat sits at a different point of the shared cycle.
const scanLine = (start: number) => keyframes`
  0%, ${pct(start)} { transform: translateY(0); opacity: 0; }
  ${pct(start + 0.1)} { opacity: 1; }
  ${pct(start + SCAN_S - 0.1)} { opacity: 1; }
  ${pct(start + SCAN_S)}, 100% { transform: translateY(${TILE - 4}px); opacity: 0; }
`;
const tileGlow = (start: number, color: string) => keyframes`
  0%, ${pct(start)}, ${pct(start + SCAN_S + 0.1)}, 100% { box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.08); }
  ${pct(start + 0.2)}, ${pct(start + SCAN_S - 0.1)} { box-shadow: inset 0 0 0 2px ${color}; }
`;
const badgeIn = (start: number) => keyframes`
  0%, ${pct(start + SCAN_S + 0.1)} { transform: scale(0.3); opacity: 0; }
  ${pct(start + SCAN_S + 0.35)} { transform: scale(1.18); opacity: 1; }
  ${pct(start + SCAN_S + 0.5)}, 92% { transform: scale(1); opacity: 1; }
  96%, 100% { transform: scale(1); opacity: 0; }
`;
// The hole's open edges, lit once the scan has found them and pulsing until the cycle ends.
const holeFound = (start: number) => {
  const found = start + SCAN_S + 0.1;
  const pulses = Array.from({ length: 4 }, (_, i) => found + 0.3 + i * 0.5);
  return keyframes`
    0%, ${pct(found)} { opacity: 0; }
    ${pulses.map((at, i) => `${pct(at)} { opacity: ${i % 2 ? 0.45 : 1}; }`).join("\n")}
    92% { opacity: 1; }
    96%, 100% { opacity: 0; }
  `;
};
const turn = keyframes`
  from { transform: rotateX(-34deg) rotateY(0deg); }
  to { transform: rotateX(-34deg) rotateY(360deg); }
`;
const still = { "@media (prefers-reduced-motion: reduce)": { animation: "none" } } as const;

// A cube's faces; the broken one is missing half its top, so the hole shows as it turns.
const FACES = [
  { key: "front", transform: `translateZ(${CUBE / 2}px)` },
  { key: "back", transform: `rotateY(180deg) translateZ(${CUBE / 2}px)` },
  { key: "right", transform: `rotateY(90deg) translateZ(${CUBE / 2}px)` },
  { key: "left", transform: `rotateY(-90deg) translateZ(${CUBE / 2}px)` },
  { key: "top", transform: `rotateX(90deg) translateZ(${CUBE / 2}px)` },
  { key: "bottom", transform: `rotateX(-90deg) translateZ(${CUBE / 2}px)` },
];

function Model({ index, broken }: { index: number; broken?: boolean }) {
  const theme = useTheme();
  const edge = theme.palette.primary.main;
  const warning = theme.palette.warning.main;
  const start = index * STEP_S;
  const Badge = broken ? WarningRoundedIcon : CheckCircleRoundedIcon;
  return (
    <Box
      sx={{
        position: "relative",
        width: TILE,
        height: TILE,
        borderRadius: "16px",
        bgcolor: "#ffffff",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        perspective: "300px",
        boxShadow: "inset 0 0 0 1px rgba(0, 0, 0, 0.08)",
        animation: `${tileGlow(start, alpha(edge, 0.55))} ${CYCLE_S}s linear infinite`,
        ...still,
      }}
    >
      <Box
        sx={{
          position: "relative",
          width: 0,
          height: 0,
          transformStyle: "preserve-3d",
          transform: "rotateX(-34deg) rotateY(35deg)",
          animation: `${turn} 12s linear infinite`,
          animationDelay: `${-index * 3}s`,
          ...still,
        }}
      >
        {FACES.map((face) => (
          <Box
            key={face.key}
            component="svg"
            width={CUBE}
            height={CUBE}
            viewBox={`0 0 ${CUBE} ${CUBE}`}
            sx={{
              position: "absolute",
              left: -CUBE / 2,
              top: -CUBE / 2,
              overflow: "visible",
              transform: face.transform,
            }}
          >
            {broken && face.key === "top" ? (
              <>
                {/* Only one of the top's two triangles: the other is the hole. */}
                <path
                  d={`M0 ${CUBE} L${CUBE} 0 L${CUBE} ${CUBE} Z`}
                  fill={alpha(edge, 0.16)}
                  stroke={edge}
                  strokeWidth={0.9}
                />
                <Box
                  component="path"
                  d={`M0 ${CUBE} L0 0 L${CUBE} 0 L0 ${CUBE}`}
                  fill={alpha(warning, 0.18)}
                  stroke={warning}
                  strokeWidth={2}
                  strokeDasharray="3 2"
                  strokeLinejoin="round"
                  sx={{ animation: `${holeFound(start)} ${CYCLE_S}s linear infinite`, ...still }}
                />
              </>
            ) : (
              <>
                <rect width={CUBE} height={CUBE} fill={alpha(edge, 0.16)} stroke={edge} strokeWidth={0.9} />
                <path d={`M0 ${CUBE} L${CUBE} 0`} stroke={edge} strokeWidth={0.5} strokeOpacity={0.6} />
              </>
            )}
          </Box>
        ))}
      </Box>
      <Box
        sx={{
          position: "absolute",
          left: 6,
          right: 6,
          top: 2,
          height: 2,
          borderRadius: 1,
          bgcolor: edge,
          boxShadow: `0 0 10px 2px ${alpha(edge, 0.6)}`,
          opacity: 0,
          animation: `${scanLine(start)} ${CYCLE_S}s linear infinite`,
          "@media (prefers-reduced-motion: reduce)": { display: "none" },
        }}
      />
      <Box
        sx={{
          position: "absolute",
          top: 5,
          right: 5,
          width: 20,
          height: 20,
          borderRadius: "50%",
          bgcolor: "#ffffff",
          display: "grid",
          placeItems: "center",
          animation: `${badgeIn(start)} ${CYCLE_S}s ease-out infinite`,
          ...still,
        }}
      >
        <Badge sx={{ fontSize: 20, color: broken ? "warning.main" : "success.main" }} />
      </Box>
    </Box>
  );
}

/** Three models scanned in turn: two pass with a tick; the third has a hole in its top, which the scan lights up. */
export default function QualityCheckIllustration() {
  return (
    <Stack direction="row" spacing={1.5} aria-hidden sx={{ flexShrink: 0 }}>
      <Model index={0} />
      <Model index={1} />
      <Model index={2} broken />
    </Stack>
  );
}
