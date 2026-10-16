import { useMemo } from "react";
import { keyframes } from "@emotion/react";
import Box from "@mui/material/Box";
import { FolderBack, FolderFront, ModelShape, prefersReducedMotion, type Palette, type ShapeKind } from "./parts";

// The watched folder: files drop into it one after another, and each comes back out as a model's thumbnail,
// settling into a column beside it. Once all three are in, they fade and it starts over.
const CYCLE_S = 5;
const STRIPES = ["#22c55e", "#3b82f6", "#a855f7"];
const MODELS: { kind: ShapeKind; palette: Palette }[] = [
  { kind: "cube", palette: "green" },
  { kind: "sphere", palette: "blue" },
  { kind: "pyramid", palette: "purple" },
];
// When each file starts to drop, in % of the cycle.
const STARTS = [4, 24, 44];
// The folder gives a little as each one lands.
const gulp = keyframes`
  0%, 13%, 19%, 33%, 39%, 53%, 59%, 100% { transform: scaleY(1); }
  16%, 36%, 56% { transform: scaleY(0.9); }
`;

/** Where everything sits at `size`, and each file's and card's moves from there. */
function layout(size: number) {
  const folder = { left: size * 0.05, top: size * 0.5, width: size * 0.44, height: size * 0.32 };
  const file = { width: size * 0.14, height: size * 0.18 };
  const fileAt = { left: folder.left + folder.width / 2 - file.width / 2, top: folder.top + size * 0.04 };
  const card = {
    left: size * 0.57,
    width: size * 0.36,
    height: size * 0.26,
    tops: [0.05, 0.37, 0.69].map((t) => size * t),
  };
  const folderMiddle = { x: folder.left + folder.width / 2, y: folder.top + folder.height / 2 };
  const frames = STARTS.map((at, index) => {
    const fromX = folderMiddle.x - (card.left + card.width / 2);
    const fromY = folderMiddle.y - (card.tops[index] + card.height / 2);
    return {
      drop: keyframes`
        0%, ${at}% { transform: translateY(${-size * 0.55}px); opacity: 0; }
        ${at + 1}% { opacity: 1; }
        ${at + 11}% { transform: translateY(0); opacity: 1; }
        ${at + 13}%, 100% { transform: translateY(0); opacity: 0; }
      `,
      rise: keyframes`
        0%, ${at + 12}% { transform: translate(${fromX}px, ${fromY}px) scale(0.3); opacity: 0; }
        ${at + 14}% { opacity: 1; }
        ${at + 24}% { transform: none; opacity: 1; }
        88% { transform: none; opacity: 1; }
        96%, 100% { transform: none; opacity: 0; }
      `,
    };
  });
  return { folder, file: { ...file, ...fileAt }, card, frames };
}

export default function ConsumeAnimation({ size }: { size: number }) {
  const still = prefersReducedMotion();
  const { folder, file, card, frames } = useMemo(() => layout(size), [size]);
  const radius = Math.max(2, size / 22);
  return (
    <Box aria-hidden sx={{ position: "relative", width: size, height: size }}>
      <FolderBack {...folder} />
      {STRIPES.map((stripe, index) => (
        <Box
          key={stripe}
          sx={{
            position: "absolute",
            left: file.left,
            top: file.top,
            width: file.width,
            height: file.height,
            zIndex: 1,
            borderRadius: `${radius / 1.5}px`,
            bgcolor: "#ffffff",
            boxShadow: "0 0 0 1px rgba(15, 23, 42, 0.18)",
            backgroundImage: `linear-gradient(${stripe}, ${stripe}), linear-gradient(225deg, #cbd5e1 50%, transparent 50%)`,
            backgroundSize: `100% ${file.height * 0.22}px, ${file.width * 0.32}px ${file.width * 0.32}px`,
            backgroundPosition: "top left, top right",
            backgroundRepeat: "no-repeat",
            opacity: still ? 0 : undefined,
            animation: still ? "none" : `${frames[index].drop} ${CYCLE_S}s ease-in infinite`,
          }}
        />
      ))}
      <FolderFront {...folder} animation={still ? "none" : `${gulp} ${CYCLE_S}s ease-out infinite`} />
      {MODELS.map((model, index) => (
        <Box
          key={model.kind}
          sx={{
            position: "absolute",
            left: card.left,
            top: card.tops[index],
            width: card.width,
            height: card.height,
            borderRadius: `${radius}px`,
            bgcolor: "#f1f5f9",
            boxShadow: "0 0 0 1px rgba(15, 23, 42, 0.1), 0 1px 2px rgba(15, 23, 42, 0.08)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 3,
            animation: still ? "none" : `${frames[index].rise} ${CYCLE_S}s cubic-bezier(0.3, 0.7, 0.4, 1) infinite`,
          }}
        >
          <ModelShape kind={model.kind} size={card.height * 0.66} palette={model.palette} />
        </Box>
      ))}
    </Box>
  );
}
