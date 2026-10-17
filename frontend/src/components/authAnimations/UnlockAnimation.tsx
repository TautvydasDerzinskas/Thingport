import { keyframes } from "@emotion/react";
import Box from "@mui/material/Box";
import { prefersReducedMotion } from "../storageAnimations/parts";

// A padlock opened in turn by two keys: an amber one (a password) from the left, and a purple one (single
// sign-on) from the right. Each slides its blade into the keyhole, turns, the shackle springs up, and it slides
// out again for the other.
const CYCLE_S = 5;

/** A key's half of the cycle, starting at `from` (% of it). The key is drawn pointing right. */
function keyTurn(from: number) {
  return keyframes`
    0%, ${from}% { transform: translateX(-60%) scaleY(1); opacity: 0; }
    ${from + 4}% { opacity: 1; }
    ${from + 12}% { transform: translateX(0) scaleY(1); opacity: 1; }
    ${from + 18}% { transform: translateX(0) scaleY(0.3); opacity: 1; }
    ${from + 36}% { transform: translateX(0) scaleY(0.3); opacity: 1; }
    ${from + 44}%, 100% { transform: translateX(-60%) scaleY(1); opacity: 0; }
  `;
}
const amberTurn = keyTurn(2);
const purpleTurn = keyTurn(52);
// Opens as each key finishes turning.
const shackle = keyframes`
  0%, 19%, 41%, 69%, 91%, 100% { transform: translateY(0); }
  23%, 37%, 73%, 87% { transform: translateY(-24%); }
`;
const glow = keyframes`
  0%, 19%, 41%, 69%, 91%, 100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); }
  25%, 35%, 75%, 85% { box-shadow: 0 0 0 4px rgba(34, 197, 94, 0.35); }
`;

/** A key lying across the front of the lock, its tip in the keyhole at (`tipX`, `tipY`); `fromRight` mirrors it. */
function Key({
  size,
  color,
  animation,
  tipX,
  tipY,
  fromRight,
}: {
  size: number;
  color: string;
  animation: string;
  tipX: number;
  tipY: number;
  fromRight: boolean;
}) {
  const length = size * 0.38;
  const bow = size * 0.15;
  const blade = Math.max(2.5, size * 0.05);
  return (
    <Box
      sx={{
        position: "absolute",
        left: fromRight ? tipX : tipX - length,
        top: tipY - bow / 2,
        width: length,
        height: bow,
        zIndex: 2,
        transform: fromRight ? "scaleX(-1)" : undefined,
      }}
    >
      <Box sx={{ position: "absolute", inset: 0, transformOrigin: "100% 50%", animation }}>
        {/* The bow, to hold it by. */}
        <Box
          sx={{
            position: "absolute",
            left: 0,
            top: 0,
            width: bow,
            height: bow,
            borderRadius: "50%",
            border: `${Math.max(2, size / 26)}px solid ${color}`,
            bgcolor: "#ffffff",
            boxSizing: "border-box",
          }}
        />
        {/* The blade, its tip in the keyhole, with its teeth. */}
        <Box
          sx={{
            position: "absolute",
            left: bow - 1,
            right: 0,
            top: bow / 2 - blade / 2,
            height: blade,
            borderRadius: `0 ${blade / 2}px ${blade / 2}px 0`,
            bgcolor: color,
            "&::after": {
              content: '""',
              position: "absolute",
              left: "30%",
              top: blade - 1,
              width: "22%",
              height: blade * 0.9,
              borderRadius: "0 0 2px 2px",
              bgcolor: color,
            },
          }}
        />
      </Box>
    </Box>
  );
}

export default function UnlockAnimation({ size }: { size: number }) {
  const still = prefersReducedMotion();
  const run = (frames: ReturnType<typeof keyframes>, easing = "ease-in-out") =>
    still ? "none" : `${frames} ${CYCLE_S}s ${easing} infinite`;
  const body = { left: size * 0.26, top: size * 0.36, width: size * 0.48, height: size * 0.38 };
  const stroke = Math.max(3, size / 14);
  const hole = { x: size / 2, y: body.top + body.height * 0.42, size: size * 0.09 };
  return (
    <Box aria-hidden sx={{ position: "relative", width: size, height: size }}>
      {/* The shackle, behind the body. */}
      <Box
        sx={{
          position: "absolute",
          left: size * 0.34,
          top: size * 0.12,
          width: size * 0.32,
          height: size * 0.36,
          border: `${stroke}px solid #94a3b8`,
          borderBottom: "none",
          borderRadius: `${size * 0.16}px ${size * 0.16}px 0 0`,
          animation: run(shackle),
        }}
      />
      <Box
        sx={{
          position: "absolute",
          ...body,
          borderRadius: `${size * 0.07}px`,
          background: "linear-gradient(180deg, #fcd36b, #f5b83d)",
          zIndex: 1,
          animation: run(glow),
        }}
      />
      {/* The keyhole. */}
      <Box
        sx={{
          position: "absolute",
          left: hole.x - hole.size / 2,
          top: hole.y - hole.size / 2,
          width: hole.size,
          height: hole.size,
          borderRadius: "50%",
          bgcolor: "#92400e",
          zIndex: 1,
          "&::after": {
            content: '""',
            position: "absolute",
            left: "50%",
            top: "60%",
            width: hole.size * 0.45,
            height: hole.size * 1.1,
            borderRadius: 1,
            bgcolor: "#92400e",
            transform: "translateX(-50%)",
          },
        }}
      />
      <Key size={size} color="#f59e0b" animation={run(amberTurn)} tipX={hole.x} tipY={hole.y} fromRight={false} />
      <Key size={size} color="#a855f7" animation={run(purpleTurn)} tipX={hole.x} tipY={hole.y} fromRight />
    </Box>
  );
}
