import { keyframes } from "@emotion/react";
import Box from "@mui/material/Box";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import PriorityHighRoundedIcon from "@mui/icons-material/PriorityHighRounded";
import QuestionMarkRoundedIcon from "@mui/icons-material/QuestionMarkRounded";
import { useBrandMark } from "../../hooks/useBrandLogo";
import { ModelShape, prefersReducedMotion, type Palette, type ShapeKind } from "../storageAnimations/parts";

export type UpdateCheckState = "checking" | "unknown" | "outdated" | "current";

// While checking, models orbit the logo like electrons; once done, the logo floats with a status bubble.
const FLOAT_S = 3.2;

const float = keyframes`
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-8%); }
`;
const shadow = keyframes`
  0%, 100% { transform: scaleX(1); opacity: 0.32; }
  50% { transform: scaleX(0.75); opacity: 0.16; }
`;
const pulse = keyframes`
  0%, 100% { transform: scale(1); }
  50% { transform: scale(0.92); }
`;
// Two ease-in-out sweeps a quarter-period apart trace an ellipse; the vertical one also scales for depth.
const orbitX = keyframes`
  from { transform: translateX(var(--rx)); }
  to { transform: translateX(calc(var(--rx) * -1)); }
`;
const orbitY = keyframes`
  from { transform: translateY(calc(var(--ry) * -1)) scale(0.6); opacity: 0.55; }
  to { transform: translateY(var(--ry)) scale(1.1); opacity: 1; }
`;
const popIn = keyframes`
  0% { transform: scale(0); }
  70% { transform: scale(1.15); }
  100% { transform: scale(1); }
`;

// The cartoon atom: three orbits 60° apart trace a star, each carrying two models half a lap apart.
type Electron = { kind: ShapeKind; palette: Palette };
const ORBITS: { tilt: number; period: number; electrons: [Electron, Electron] }[] = [
  {
    tilt: -60,
    period: 2.4,
    electrons: [
      { kind: "cube", palette: "blue" },
      { kind: "sphere", palette: "amber" },
    ],
  },
  {
    tilt: 0,
    period: 2.8,
    electrons: [
      { kind: "sphere", palette: "purple" },
      { kind: "pyramid", palette: "green" },
    ],
  },
  {
    tilt: 60,
    period: 2.2,
    electrons: [
      { kind: "pyramid", palette: "amber" },
      { kind: "cube", palette: "purple" },
    ],
  },
];

const BUBBLES = {
  unknown: { color: "#94a3b8", Icon: QuestionMarkRoundedIcon },
  outdated: { color: "#f59e0b", Icon: PriorityHighRoundedIcon },
  current: { color: "#22c55e", Icon: CheckRoundedIcon },
} as const;

export default function UpdateCheckAnimation({ size, state }: { size: number; state: UpdateCheckState }) {
  const still = prefersReducedMotion();
  // The light-background mark in either theme.
  const markSrc = useBrandMark(false);
  const checking = state === "checking";
  const logo = size * (checking ? 0.36 : 0.5);
  const shape = size * 0.12;
  const rx = size * 0.4;
  const ry = size * 0.14;
  return (
    <Box aria-hidden sx={{ position: "relative", width: size, height: size }}>
      {!checking && (
        <Box
          sx={{
            position: "absolute",
            left: size * 0.3,
            top: size * 0.84,
            width: size * 0.4,
            height: size * 0.06,
            borderRadius: "50%",
            bgcolor: "#0f172a",
            opacity: 0.25,
            filter: `blur(${Math.max(1, size / 40)}px)`,
            animation: still ? "none" : `${shadow} ${FLOAT_S}s ease-in-out infinite`,
          }}
        />
      )}
      <Box
        sx={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          animation: still
            ? "none"
            : checking
              ? `${pulse} 1.6s ease-in-out infinite`
              : `${float} ${FLOAT_S}s ease-in-out infinite`,
        }}
      >
        <Box
          component="img"
          src={markSrc}
          alt=""
          sx={{ width: logo, height: logo, display: "block", transition: "width 300ms ease, height 300ms ease" }}
        />
      </Box>
      {checking &&
        ORBITS.flatMap((orbit) =>
          orbit.electrons.map((electron, i) => {
            const phase = (i * orbit.period) / 2;
            return (
              <Box
                key={`${orbit.tilt}-${electron.kind}`}
                sx={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transform: `rotate(${orbit.tilt}deg)`,
                  "--rx": `${rx}px`,
                  "--ry": `${ry}px`,
                }}
              >
                <Box
                  sx={{
                    transform: still ? `translateX(calc(var(--rx) * ${i ? -1 : 1}))` : undefined,
                    animation: still
                      ? "none"
                      : `${orbitX} ${orbit.period / 2}s ease-in-out ${-phase}s infinite alternate`,
                  }}
                >
                  <Box
                    sx={{
                      animation: still
                        ? "none"
                        : `${orbitY} ${orbit.period / 2}s ease-in-out ${-phase - orbit.period / 4}s infinite alternate`,
                    }}
                  >
                    <Box sx={{ transform: `rotate(${-orbit.tilt}deg)` }}>
                      <ModelShape kind={electron.kind} size={shape} palette={electron.palette} />
                    </Box>
                  </Box>
                </Box>
              </Box>
            );
          }),
        )}
      {!checking && <StatusBubble size={size * 0.3} state={state} still={still} />}
    </Box>
  );
}

function StatusBubble({
  size,
  state,
  still,
}: {
  size: number;
  state: Exclude<UpdateCheckState, "checking">;
  still: boolean;
}) {
  const { color, Icon } = BUBBLES[state];
  return (
    <Box
      sx={{
        position: "absolute",
        left: 0,
        bottom: 0,
        width: size,
        height: size,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: color,
        color: "#ffffff",
        boxShadow: "0 0 0 2px #ffffff, 0 2px 4px rgba(15, 23, 42, 0.2)",
        transformOrigin: "center",
        animation: still ? "none" : `${popIn} 400ms ease-out both`,
      }}
    >
      <Icon sx={{ fontSize: size * 0.68 }} />
    </Box>
  );
}
