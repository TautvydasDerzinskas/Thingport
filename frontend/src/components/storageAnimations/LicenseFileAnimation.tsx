import { keyframes } from "@emotion/react";
import Box from "@mui/material/Box";
import { FolderBack, FolderFront, LINE, ModelShape, prefersReducedMotion } from "./parts";

// A model's folder. On: a LICENSE.txt sheet rises out of it beside the model, again and again. Off: only the model.
const CYCLE_S = 2.6;
const LINES = [
  { id: "title", width: 1 },
  { id: "by", width: 0.7 },
  { id: "licence", width: 0.85 },
];

const rise = keyframes`
  0%, 15% { transform: translateY(40%); opacity: 0; }
  40%, 85% { transform: translateY(0); opacity: 1; }
  100% { transform: translateY(0); opacity: 0; }
`;
const bob = keyframes`
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-10%); }
`;

export default function LicenseFileAnimation({ size, on }: { size: number; on: boolean }) {
  const still = prefersReducedMotion();
  const u = size / 76;
  const folder = { left: 14 * u, top: 44 * u, width: 48 * u, height: 22 * u };
  const animate = (frames: ReturnType<typeof keyframes>) =>
    still ? "none" : `${frames} ${CYCLE_S}s ease-in-out infinite`;

  return (
    <Box aria-hidden sx={{ position: "relative", width: size, height: size }}>
      <FolderBack {...folder} />
      <Box sx={{ position: "absolute", left: 20 * u, top: 28 * u, animation: animate(bob) }}>
        <ModelShape kind="cube" size={18 * u} palette="blue" />
      </Box>
      {/* The sheet: lines of text and a stamp, rising out of the folder when the switch is on. */}
      <Box
        sx={{
          position: "absolute",
          left: 40 * u,
          top: 18 * u,
          width: 16 * u,
          height: 22 * u,
          borderRadius: `${2 * u}px`,
          bgcolor: "#ffffff",
          boxShadow: `0 0 0 ${Math.max(1, u)}px ${LINE}`,
          opacity: on ? 1 : 0,
          transition: "opacity 220ms ease-out",
          animation: on ? animate(rise) : "none",
          px: `${2.5 * u}px`,
          pt: `${3 * u}px`,
          display: "flex",
          flexDirection: "column",
          gap: `${2 * u}px`,
        }}
      >
        {LINES.map((line) => (
          <Box key={line.id} sx={{ height: Math.max(1, 1.5 * u), width: `${line.width * 100}%`, bgcolor: LINE }} />
        ))}
        <Box
          sx={{
            mt: "auto",
            mb: `${2.5 * u}px`,
            alignSelf: "flex-end",
            width: 5 * u,
            height: 5 * u,
            borderRadius: "50%",
            bgcolor: "#22c55e",
          }}
        />
      </Box>
      <FolderFront {...folder} />
    </Box>
  );
}
