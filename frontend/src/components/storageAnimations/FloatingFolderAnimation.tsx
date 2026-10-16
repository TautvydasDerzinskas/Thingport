import { keyframes } from "@emotion/react";
import Box from "@mui/material/Box";
import { FolderBack, FolderFront, ModelShape, prefersReducedMotion, type Palette, type ShapeKind } from "./parts";

// A folder floating in the air, models peeking out of it, each bobbing a little on its own beat.
const FLOAT_S = 3.2;

const float = keyframes`
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-7%); }
`;
// The shadow below shrinks and fades as the folder rises.
const shadow = keyframes`
  0%, 100% { transform: scaleX(1); opacity: 0.32; }
  50% { transform: scaleX(0.78); opacity: 0.18; }
`;
const bob = keyframes`
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-14%); }
`;

const MODELS: { kind: ShapeKind; palette: Palette; left: number; top: number; size: number; delay: number }[] = [
  { kind: "cube", palette: "green", left: 0.24, top: 0.27, size: 0.24, delay: 0 },
  { kind: "sphere", palette: "blue", left: 0.43, top: 0.22, size: 0.2, delay: 0.5 },
  { kind: "pyramid", palette: "purple", left: 0.58, top: 0.27, size: 0.22, delay: 1.0 },
];

export default function FloatingFolderAnimation({ size }: { size: number }) {
  const still = prefersReducedMotion();
  const folder = { left: size * 0.17, top: size * 0.4, width: size * 0.66, height: size * 0.42 };
  return (
    <Box aria-hidden sx={{ position: "relative", width: size, height: size }}>
      <Box
        sx={{
          position: "absolute",
          left: size * 0.24,
          top: size * 0.9,
          width: size * 0.52,
          height: size * 0.07,
          borderRadius: "50%",
          bgcolor: "#0f172a",
          opacity: 0.25,
          filter: `blur(${Math.max(1, size / 40)}px)`,
          animation: still ? "none" : `${shadow} ${FLOAT_S}s ease-in-out infinite`,
        }}
      />
      <Box
        sx={{
          position: "absolute",
          inset: 0,
          animation: still ? "none" : `${float} ${FLOAT_S}s ease-in-out infinite`,
        }}
      >
        <FolderBack {...folder} />
        {MODELS.map((model) => (
          <Box
            key={model.kind}
            sx={{
              position: "absolute",
              left: size * model.left,
              top: size * model.top,
              zIndex: 1,
              animation: still ? "none" : `${bob} ${FLOAT_S / 1.6}s ease-in-out ${model.delay}s infinite`,
            }}
          >
            <ModelShape kind={model.kind} size={size * model.size} palette={model.palette} />
          </Box>
        ))}
        <FolderFront {...folder} />
      </Box>
    </Box>
  );
}
