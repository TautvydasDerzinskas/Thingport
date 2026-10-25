import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
import Typography from "@mui/material/Typography";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import { accent, ModelCount, Thumb, type SkeletonProps, type TileProps } from "../collectionTile";

/** Printables: its list row, boxed, with the three square thumbnails along the top. */
export function Tile({ provider, collection }: TileProps) {
  return (
    <Box
      sx={{
        borderRadius: "4px",
        border: 1,
        borderColor: "divider",
        borderTop: `3px solid ${accent(provider)}`,
        bgcolor: "background.paper",
        p: 1.25,
      }}
    >
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "4px" }}>
        {[0, 1, 2].map((i) => (
          <Thumb key={i} src={collection.thumbnails[i]} sx={{ aspectRatio: "1 / 1" }} />
        ))}
      </Box>
      <Typography noWrap sx={{ fontWeight: 700, fontSize: "0.875rem", mt: 1 }}>
        {collection.name}
      </Typography>
      <Box sx={{ display: "flex", alignItems: "center", fontSize: "0.8rem", color: "text.secondary" }}>
        <ModelCount count={collection.model_count} provider={provider} />
        {collection.private && <LockOutlinedIcon sx={{ fontSize: 14, ml: "auto" }} />}
      </Box>
    </Box>
  );
}

/** Its tile's shape while the collections load. */
export function TileSkeleton({ lines, provider }: SkeletonProps): JSX.Element {
  return (
    <Box
      aria-hidden
      sx={{
        borderRadius: "4px",
        border: 1,
        borderColor: "divider",
        borderTop: `3px solid ${accent(provider)}`,
        p: 1.25,
      }}
    >
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "4px", mb: 1 }}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} variant="rectangular" sx={{ width: "100%", height: "auto", aspectRatio: "1 / 1" }} />
        ))}
      </Box>
      {lines}
    </Box>
  );
}
