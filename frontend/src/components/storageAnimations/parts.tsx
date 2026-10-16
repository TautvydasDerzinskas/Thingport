import type React from "react";
import Box from "@mui/material/Box";

// The pieces the storage page's tiles are drawn from: a folder, whose back and front are separate so things can
// sit inside it, and small "3D models", shaded so they read as solids. All plain boxes; sized in pixels by the
// caller, so one drawing works at any tile size.

export const FOLDER_BACK = "#f5b83d";
export const FOLDER_FRONT = "#fcd36b";
export const LINE = "#cbd5e1";

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

type Place = { left: number; top: number; width: number; height: number; animation?: string };

/** The folder's back and tab; what goes "inside" it is drawn after this and before FolderFront. */
export function FolderBack({ left, top, width, height }: Place) {
  const radius = Math.max(2, width / 14);
  return (
    <Box
      sx={{
        position: "absolute",
        left,
        top,
        width,
        height,
        borderRadius: `${radius}px`,
        bgcolor: FOLDER_BACK,
        "&::before": {
          content: '""',
          position: "absolute",
          left: 0,
          top: -height * 0.2,
          width: width * 0.42,
          height: height * 0.3,
          borderRadius: `${radius}px ${radius}px 0 0`,
          bgcolor: FOLDER_BACK,
        },
      }}
    />
  );
}

/** The folder's front flap, over whatever is inside. */
export function FolderFront({ left, top, width, height, animation }: Place) {
  return (
    <Box
      sx={{
        position: "absolute",
        left,
        top: top + height * 0.28,
        width,
        height: height * 0.72,
        borderRadius: `${Math.max(2, width / 14)}px`,
        bgcolor: FOLDER_FRONT,
        transformOrigin: "bottom",
        zIndex: 2,
        animation,
      }}
    />
  );
}

/** A whole folder, for where nothing goes inside it. */
export function Folder(place: Place) {
  return (
    <>
      <FolderBack {...place} />
      <FolderFront {...place} />
    </>
  );
}

// Light, side and shadow of each colour.
const PALETTES = {
  green: ["#86efac", "#22c55e", "#15803d"],
  blue: ["#93c5fd", "#3b82f6", "#1d4ed8"],
  amber: ["#fde68a", "#f59e0b", "#b45309"],
  purple: ["#d8b4fe", "#a855f7", "#7e22ce"],
} as const;
export type Palette = keyof typeof PALETTES;
export type ShapeKind = "cube" | "sphere" | "pyramid";

const face = (clipPath: string, color: string): React.ReactNode => (
  <Box sx={{ position: "absolute", inset: 0, clipPath, bgcolor: color }} />
);

/** A small solid: an isometric cube, a shaded ball, or a pyramid. */
export function ModelShape({ kind, size, palette }: { kind: ShapeKind; size: number; palette: Palette }) {
  const [light, mid, dark] = PALETTES[palette];
  if (kind === "sphere") {
    return (
      <Box
        sx={{
          width: size,
          height: size,
          borderRadius: "50%",
          background: `radial-gradient(circle at 35% 30%, ${light}, ${mid} 55%, ${dark})`,
        }}
      />
    );
  }
  return (
    <Box sx={{ position: "relative", width: size, height: size }}>
      {kind === "cube" ? (
        <>
          {face("polygon(50% 0, 100% 25%, 50% 50%, 0 25%)", light)}
          {face("polygon(0 25%, 50% 50%, 50% 100%, 0 75%)", mid)}
          {face("polygon(50% 50%, 100% 25%, 100% 75%, 50% 100%)", dark)}
        </>
      ) : (
        <>
          {face("polygon(50% 0, 50% 100%, 2% 80%)", mid)}
          {face("polygon(50% 0, 98% 80%, 50% 100%)", dark)}
        </>
      )}
    </Box>
  );
}

/** The white rounded tile the storage page's animations sit in, at the left of each section; not on a phone. */
export function AnimatedTile({ children, size = 88 }: { children: React.ReactNode; size?: number }) {
  return (
    <Box
      aria-hidden
      sx={{
        display: { xs: "none", sm: "flex" },
        flexShrink: 0,
        width: size,
        height: size,
        borderRadius: "18px",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: "#ffffff",
        boxShadow: "inset 0 0 0 1px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04)",
        overflow: "hidden",
      }}
    >
      {children}
    </Box>
  );
}
