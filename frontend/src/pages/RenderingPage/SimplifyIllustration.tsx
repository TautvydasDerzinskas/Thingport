import { keyframes } from "@emotion/react";
import { useTranslation } from "react-i18next";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { alpha, useTheme } from "@mui/material/styles";

const TILE = 104;
const HEIGHT = 58;

/** The vase's radius at height t (0 bottom, 1 top): both models are sampled from it, so they're the same shape. */
const profile = (t: number) => 14 + 12.5 * Math.sin(Math.PI * (0.15 + 0.75 * t)) - 5 * t;

const turn = keyframes`
  from { transform: rotateX(-24deg) rotateY(0deg); }
  to { transform: rotateX(-24deg) rotateY(360deg); }
`;

const nudge = keyframes`
  0%, 100% { transform: translateX(-3px); opacity: 0.55; }
  50% { transform: translateX(3px); opacity: 1; }
`;

type Face = { key: string; transform: string; width: number; length: number; points: string; diagonal: string };

/** A lathed vase of `sides` around and `rings` up; each quad is drawn as two triangles, as a mesh would be. */
function faces(sides: number, rings: number): Face[] {
  const half = Math.PI / sides;
  const segment = HEIGHT / (rings - 1);
  const out: Face[] = [];
  for (let ring = 0; ring < rings - 1; ring++) {
    const below = profile(ring / (rings - 1));
    const above = profile((ring + 1) / (rings - 1));
    // Distance from the axis to each edge's middle, and each edge's length.
    const [nearBelow, nearAbove] = [below * Math.cos(half), above * Math.cos(half)];
    const [wideBelow, wideAbove] = [2 * below * Math.sin(half), 2 * above * Math.sin(half)];
    const length = Math.hypot(segment, nearBelow - nearAbove);
    const tilt = Math.atan2(nearBelow - nearAbove, segment);
    const width = Math.max(wideBelow, wideAbove);
    const middle = HEIGHT / 2 - (ring + 0.5) * segment;
    const [left, right] = [(width - wideBelow) / 2, (width + wideBelow) / 2];
    const [topLeft, topRight] = [(width - wideAbove) / 2, (width + wideAbove) / 2];
    for (let side = 0; side < sides; side++) {
      out.push({
        key: `${ring}-${side}`,
        transform: `rotateY(${(side * 360) / sides}deg) translate3d(0, ${middle}px, ${(nearBelow + nearAbove) / 2}px) rotateX(${tilt}rad)`,
        width,
        length,
        points: `${topLeft},0 ${topRight},0 ${right},${length} ${left},${length}`,
        diagonal: `M${left} ${length} L${topRight} 0`,
      });
    }
  }
  return out;
}

const DETAILED = faces(16, 6);
const SIMPLIFIED = faces(6, 3);

function Model({ mesh, caption }: { mesh: Face[]; caption: string }) {
  const edge = useTheme().palette.primary.main;
  return (
    <Stack alignItems="center" spacing={0.75}>
      <Box
        aria-hidden
        sx={{
          width: TILE,
          height: TILE,
          borderRadius: "18px",
          bgcolor: "#ffffff",
          boxShadow: "inset 0 0 0 1px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          perspective: "420px",
        }}
      >
        <Box
          sx={{
            position: "relative",
            width: 0,
            height: 0,
            transformStyle: "preserve-3d",
            transform: "rotateX(-24deg) rotateY(30deg)",
            animation: `${turn} 14s linear infinite`,
            "@media (prefers-reduced-motion: reduce)": { animation: "none" },
          }}
        >
          {mesh.map((face) => (
            <Box
              key={face.key}
              component="svg"
              width={face.width}
              height={face.length}
              viewBox={`0 0 ${face.width} ${face.length}`}
              sx={{
                position: "absolute",
                left: -face.width / 2,
                top: -face.length / 2,
                overflow: "visible",
                transform: face.transform,
              }}
            >
              <polygon points={face.points} fill={alpha(edge, 0.1)} stroke={edge} strokeWidth={0.8} />
              <path d={face.diagonal} stroke={edge} strokeWidth={0.5} strokeOpacity={0.6} />
            </Box>
          ))}
        </Box>
      </Box>
      <Typography variant="caption" color="text.secondary" fontWeight={600}>
        {caption}
      </Typography>
    </Stack>
  );
}

/** The same model before and after simplification, turning side by side: fewer corners and edges, same shape. */
export default function SimplifyIllustration() {
  const { t } = useTranslation("app");
  return (
    <Stack direction="row" spacing={1.5} alignItems="center" justifyContent="center" sx={{ flexShrink: 0 }}>
      <Model mesh={DETAILED} caption={t("adminSettings.rendering.simplify.illustrationBefore")} />
      <ArrowForwardIcon
        aria-hidden
        color="action"
        sx={{
          mb: 3,
          animation: `${nudge} 1.6s ease-in-out infinite`,
          "@media (prefers-reduced-motion: reduce)": { animation: "none" },
        }}
      />
      <Model mesh={SIMPLIFIED} caption={t("adminSettings.rendering.simplify.illustrationAfter")} />
    </Stack>
  );
}
