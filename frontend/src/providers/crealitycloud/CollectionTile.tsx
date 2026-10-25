import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
import Typography from "@mui/material/Typography";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import { accent, ModelCount, Thumb, type SkeletonProps, type TileProps } from "../collectionTile";

// Creality Cloud's collection card: one large cover beside two stacked ones, under its green.
export function Tile({ provider, collection }: TileProps) {
  return (
    <Box
      sx={{
        borderRadius: "12px",
        border: 1,
        borderColor: "divider",
        borderTop: `3px solid ${accent(provider)}`,
        bgcolor: "background.paper",
        overflow: "hidden",
      }}
    >
      <Box sx={{ display: "grid", gridTemplateColumns: "2fr 1fr", gridTemplateRows: "1fr 1fr", gap: "2px" }}>
        <Thumb src={collection.thumbnails[0]} sx={{ gridRow: "span 2", height: "100%", aspectRatio: "1 / 1" }} />
        <Thumb src={collection.thumbnails[1]} sx={{ height: "100%" }} />
        <Thumb src={collection.thumbnails[2]} sx={{ height: "100%" }} />
      </Box>
      <Box sx={{ px: 1.25, py: 1 }}>
        <Typography noWrap sx={{ fontWeight: 600, fontSize: "0.875rem" }}>
          {collection.name}
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", fontSize: "0.8rem", color: "text.secondary" }}>
          <ModelCount count={collection.model_count} provider={provider} />
          {collection.private && <LockOutlinedIcon sx={{ fontSize: 14, ml: "auto" }} />}
        </Box>
      </Box>
    </Box>
  );
}

/** Its tile's shape while the collections load. */
export function TileSkeleton({ lines }: SkeletonProps): JSX.Element {
  return (
    <Box aria-hidden sx={{ borderRadius: "12px", border: 1, borderColor: "divider", overflow: "hidden" }}>
      <Box sx={{ display: "grid", gridTemplateColumns: "2fr 1fr", gridTemplateRows: "1fr 1fr", gap: "2px" }}>
        <Skeleton
          variant="rectangular"
          sx={{ gridRow: "span 2", width: "100%", height: "100%", aspectRatio: "1 / 1" }}
        />
        <Skeleton variant="rectangular" sx={{ width: "100%", height: "100%" }} />
        <Skeleton variant="rectangular" sx={{ width: "100%", height: "100%" }} />
      </Box>
      <Box sx={{ px: 1.25, py: 1 }}>{lines}</Box>
    </Box>
  );
}
