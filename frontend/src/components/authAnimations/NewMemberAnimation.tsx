import { keyframes } from "@emotion/react";
import Box from "@mui/material/Box";
import { prefersReducedMotion } from "../storageAnimations/parts";

// Two people, and a third walking up. With registrations open they're let in: a hop or two, the others nod, and
// a green "+" pops. Closed, a wall stands between them: the newcomer bumps into it, steps back, and a red "×"
// pops instead. It fades and they come again.
const CYCLE_S = 4.5;

const walkIn = keyframes`
  0%, 8% { transform: translateX(70%); opacity: 0; }
  12% { opacity: 1; }
  18% { transform: translateX(46%) translateY(-6%); }
  24% { transform: translateX(24%) translateY(0); }
  30% { transform: translateX(8%) translateY(-6%); }
  36%, 86% { transform: none; opacity: 1; }
  95%, 100% { transform: none; opacity: 0; }
`;
// Up to the wall, a bump, and a step back.
const walkIntoWall = keyframes`
  0%, 8% { transform: translateX(60%); opacity: 0; }
  12% { opacity: 1; }
  18% { transform: translateX(36%) translateY(-6%); }
  26% { transform: translateX(8%) translateY(0); }
  30% { transform: translateX(4%); }
  34% { transform: translateX(12%); }
  40%, 86% { transform: translateX(9%); opacity: 1; }
  95%, 100% { transform: translateX(9%); opacity: 0; }
`;
const badge = keyframes`
  0%, 38% { transform: scale(0); }
  44% { transform: scale(1.25); }
  48%, 86% { transform: scale(1); opacity: 1; }
  95%, 100% { transform: scale(1); opacity: 0; }
`;
// The two already there nod hello as the new one arrives.
const nod = keyframes`
  0%, 36%, 52%, 100% { transform: none; }
  42% { transform: translateY(-5%); }
`;
// The wall shakes as it's bumped.
const shake = keyframes`
  0%, 29%, 37%, 100% { transform: none; }
  31% { transform: translateX(6%); }
  34% { transform: translateX(-4%); }
`;

function Person({ size, left, color }: { size: number; left: number; color: string }) {
  const width = size * 0.26;
  return (
    <Box sx={{ position: "absolute", left, bottom: size * 0.18, width, height: width * 1.25 }}>
      <Box
        sx={{
          position: "absolute",
          left: width * 0.24,
          top: 0,
          width: width * 0.52,
          height: width * 0.52,
          borderRadius: "50%",
          bgcolor: color,
        }}
      />
      <Box
        sx={{
          position: "absolute",
          left: 0,
          bottom: 0,
          width,
          height: width * 0.62,
          borderRadius: `${width / 2}px ${width / 2}px ${width / 6}px ${width / 6}px`,
          bgcolor: color,
        }}
      />
    </Box>
  );
}

/** `open`: registrations are open, so the newcomer gets in; otherwise a wall keeps them out. */
export default function NewMemberAnimation({ size, open }: { size: number; open: boolean }) {
  const still = prefersReducedMotion();
  const run = (frames: ReturnType<typeof keyframes>, easing = "ease-out") =>
    still ? "none" : `${frames} ${CYCLE_S}s ${easing} infinite`;
  const badgeSize = size * 0.2;
  const line = Math.max(1.5, size / 48);
  // Closed, the two stand a little further left, to make room for the wall.
  const shift = open ? 0 : -size * 0.05;
  const newcomer = size * (open ? 0.67 : 0.62);
  return (
    <Box aria-hidden sx={{ position: "relative", width: size, height: size }}>
      {/* The ground they stand on. */}
      <Box
        sx={{
          position: "absolute",
          left: size * 0.06,
          right: size * 0.06,
          bottom: size * 0.15,
          height: line,
          borderRadius: 2,
          bgcolor: "#e2e8f0",
        }}
      />
      <Box sx={{ position: "absolute", inset: 0, animation: open ? run(nod) : "none" }}>
        <Person size={size} left={size * 0.07 + shift} color="#94a3b8" />
        <Person size={size} left={size * 0.37 + shift} color="#64748b" />
      </Box>
      {!open && (
        // A brick wall between them and the newcomer.
        <Box
          sx={{
            position: "absolute",
            left: size * 0.6,
            bottom: size * 0.15,
            width: size * 0.08,
            height: size * 0.5,
            borderRadius: `${size * 0.015}px ${size * 0.015}px 0 0`,
            bgcolor: "#b45309",
            backgroundImage: `repeating-linear-gradient(180deg, transparent 0, transparent ${size * 0.06}px, #fde68a ${size * 0.06}px, #fde68a ${size * 0.06 + line}px)`,
            boxShadow: "inset -2px 0 0 rgba(0, 0, 0, 0.15)",
            animation: run(shake),
          }}
        />
      )}
      <Box sx={{ position: "absolute", inset: 0, animation: run(open ? walkIn : walkIntoWall) }}>
        <Person size={size} left={newcomer} color={open ? "#22c55e" : "#94a3b8"} />
        <Box
          sx={{
            position: "absolute",
            left: newcomer + size * 0.13 - badgeSize / 2,
            top: size * 0.12,
            width: badgeSize,
            height: badgeSize,
            borderRadius: "50%",
            bgcolor: open ? "#16a34a" : "#dc2626",
            boxShadow: "0 0 0 2px #ffffff",
            animation: run(badge),
            // A plus, or turned a quarter, a cross.
            "&::before, &::after": {
              content: '""',
              position: "absolute",
              left: "50%",
              top: "50%",
              width: badgeSize * 0.5,
              height: Math.max(1.5, badgeSize * 0.14),
              borderRadius: 1,
              bgcolor: "#ffffff",
              transform: `translate(-50%, -50%) rotate(${open ? 0 : 45}deg)`,
            },
            "&::after": { transform: `translate(-50%, -50%) rotate(${open ? 90 : 135}deg)` },
          }}
        />
      </Box>
    </Box>
  );
}
