import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
import Typography from "@mui/material/Typography";
import { accent, ModelCount, Thumb, type SkeletonProps, type TileProps } from "../collectionTile";

// Thingiverse's card: rings of lighter blue around the bottom, where the models stack up.
const RINGS = [
  { size: 200, color: "#718BFE" },
  { size: 170, color: "#9DAFFF" },
  { size: 130, color: "#BDC9FF" },
  { size: 80, color: "#EAEEFF" },
];

export function Tile({ provider, collection }: TileProps) {
  const stack = collection.thumbnails.slice(0, 3);
  return (
    <Box
      sx={{
        position: "relative",
        overflow: "hidden",
        borderRadius: "8px",
        bgcolor: accent(provider),
        aspectRatio: "4 / 3",
        color: "#fff",
        textAlign: "center",
      }}
    >
      {RINGS.map(({ size, color }) => (
        <Box
          key={size}
          sx={{
            position: "absolute",
            left: "50%",
            top: "62%",
            width: `${size}%`,
            aspectRatio: "1.4 / 1",
            transform: "translateX(-50%)",
            borderRadius: "100%",
            bgcolor: color,
          }}
        />
      ))}
      <Box sx={{ position: "relative", px: 1.5, pt: 1.5 }}>
        <Typography noWrap sx={{ fontWeight: 600, fontSize: "1rem", lineHeight: 1.3, color: "#fff" }}>
          {collection.name}
        </Typography>
        <Typography sx={{ fontSize: "0.8rem", color: "#fff" }}>
          <ModelCount count={collection.model_count} provider={provider} />
        </Typography>
      </Box>
      {stack.map((src, i) => (
        // The first model in front, the others peeking out above it.
        <Box
          key={src}
          sx={{
            position: "absolute",
            left: "50%",
            bottom: `${-38 + (stack.length - 1 - i) * 7}%`,
            width: `${78 - (stack.length - 1 - i) * 8}%`,
            transform: "translateX(-50%)",
            zIndex: stack.length - i,
            borderRadius: "8px",
            overflow: "hidden",
            border: "1px solid rgba(255, 255, 255, 0.9)",
            aspectRatio: "4 / 3",
          }}
        >
          <Thumb src={src} sx={{ width: "100%", height: "100%" }} />
        </Box>
      ))}
    </Box>
  );
}

/** Its tile's shape while the collections load. */
export function TileSkeleton({ provider }: SkeletonProps): JSX.Element {
  return (
    <Box
      aria-hidden
      sx={{
        borderRadius: "8px",
        aspectRatio: "4 / 3",
        bgcolor: accent(provider),
        opacity: 0.35,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        pt: 1.5,
      }}
    >
      <Skeleton variant="text" sx={{ fontSize: "1rem", width: "60%", bgcolor: "rgba(255, 255, 255, 0.5)" }} />
      <Skeleton variant="text" sx={{ fontSize: "0.8rem", width: "30%", bgcolor: "rgba(255, 255, 255, 0.5)" }} />
    </Box>
  );
}
