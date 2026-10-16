import { useMemo } from "react";
import { keyframes } from "@emotion/react";
import Box from "@mui/material/Box";

// Model files hopping, one after another, out of one folder and over into another: the storage structure
// changing. Pure CSS; sized from `size`, so the same picture works on the progress bar and larger.
const FILES = 3;
const CYCLE_S = 2.4;
// Each file's top stripe: one model's 3MF, STL and STEP, say.
const STRIPES = ["#22c55e", "#3b82f6", "#f59e0b"];
const FOLDER_BACK = "#f5b83d";
const FOLDER_FRONT = "#fcd36b";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

export default function FileMoveAnimation({ size, paused }: { size: number; paused?: boolean }) {
  const still = paused || prefersReducedMotion();
  const folderW = size * 0.4;
  const folderH = size * 0.3;
  const folderTop = size * 0.62;
  const fileW = size * 0.17;
  const fileH = size * 0.22;
  // The file's left edge over each folder's middle, and its top tucked inside the folder.
  const fromX = size * 0.06 + folderW / 2 - fileW / 2;
  const toX = size * 0.54 + folderW / 2 - fileW / 2;
  const inY = folderTop + folderH * 0.15;
  const outY = folderTop - fileH * 0.9;
  const peakY = size * 0.08;

  const { hop, land } = useMemo(() => {
    const midX = (fromX + toX) / 2;
    return {
      // An arc from stops along it: out of the first folder, over, and down into the second.
      hop: keyframes`
        0% { transform: translate(${fromX}px, ${inY}px) rotate(0deg); opacity: 0; }
        8% { opacity: 1; }
        18% { transform: translate(${fromX}px, ${outY}px) rotate(-4deg); }
        34% { transform: translate(${fromX + (midX - fromX) * 0.6}px, ${peakY + size * 0.06}px) rotate(-10deg); }
        50% { transform: translate(${midX}px, ${peakY}px) rotate(0deg); }
        66% { transform: translate(${midX + (toX - midX) * 0.4}px, ${peakY + size * 0.06}px) rotate(10deg); }
        82% { transform: translate(${toX}px, ${outY}px) rotate(4deg); }
        92% { opacity: 1; }
        100% { transform: translate(${toX}px, ${inY}px) rotate(0deg); opacity: 0; }
      `,
      // The second folder's front gives a little as each file drops in.
      land: keyframes`
        0%, 80%, 100% { transform: scaleY(1); }
        90% { transform: scaleY(0.88); }
      `,
    };
  }, [fromX, toX, inY, outY, peakY, size]);

  const radius = Math.max(2, size / 22);
  const folder = (left: number, landing: boolean) => ({
    back: (
      <Box
        sx={{
          position: "absolute",
          left,
          top: folderTop,
          width: folderW,
          height: folderH,
          borderRadius: `${radius}px`,
          bgcolor: FOLDER_BACK,
          // The tab.
          "&::before": {
            content: '""',
            position: "absolute",
            left: 0,
            top: -folderH * 0.22,
            width: folderW * 0.42,
            height: folderH * 0.3,
            borderRadius: `${radius}px ${radius}px 0 0`,
            bgcolor: FOLDER_BACK,
          },
        }}
      />
    ),
    front: (
      <Box
        sx={{
          position: "absolute",
          left,
          top: folderTop + folderH * 0.28,
          width: folderW,
          height: folderH * 0.72,
          borderRadius: `${radius}px`,
          bgcolor: FOLDER_FRONT,
          transformOrigin: "bottom",
          zIndex: 2,
          animation: landing && !still ? `${land} ${CYCLE_S / FILES}s ease-out infinite` : "none",
        }}
      />
    ),
  });
  const source = folder(size * 0.06, false);
  const destination = folder(size * 0.54, true);

  return (
    <Box aria-hidden sx={{ position: "relative", width: size, height: size, overflow: "hidden" }}>
      {source.back}
      {destination.back}
      {Array.from({ length: FILES }, (_file, index) => (
        <Box
          key={index}
          sx={{
            position: "absolute",
            left: 0,
            top: 0,
            width: fileW,
            height: fileH,
            zIndex: 1,
            borderRadius: `${radius / 1.5}px`,
            bgcolor: "#ffffff",
            boxShadow: "0 0 0 1px rgba(15, 23, 42, 0.18)",
            // A coloured stripe across the top, and a folded corner.
            backgroundImage: `linear-gradient(${STRIPES[index]}, ${STRIPES[index]}), linear-gradient(225deg, #cbd5e1 50%, transparent 50%)`,
            backgroundSize: `100% ${fileH * 0.22}px, ${fileW * 0.32}px ${fileW * 0.32}px`,
            backgroundPosition: "top left, top right",
            backgroundRepeat: "no-repeat",
            transform: still ? `translate(${(fromX + toX) / 2}px, ${peakY}px)` : undefined,
            opacity: still && index > 0 ? 0 : undefined,
            animation: still ? "none" : `${hop} ${CYCLE_S}s ease-in-out ${(index * CYCLE_S) / FILES}s infinite both`,
          }}
        />
      ))}
      {source.front}
      {destination.front}
    </Box>
  );
}
