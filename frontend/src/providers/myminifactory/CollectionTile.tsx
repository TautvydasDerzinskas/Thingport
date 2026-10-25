import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
import Typography from "@mui/material/Typography";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import { accent, ModelCount, Thumb, type SkeletonProps, type TileProps } from "../collectionTile";

// MyMiniFactory's card: name and count, then the cover model large, then a row of three more.
export function Tile({ provider, collection }: TileProps) {
  const [cover, ...rest] = collection.thumbnails;
  return (
    <Box
      sx={{
        borderRadius: "4px",
        border: 1,
        borderColor: "divider",
        borderBottom: `3px solid ${accent(provider)}`,
        bgcolor: "background.paper",
        p: 1.25,
      }}
    >
      <Typography noWrap sx={{ fontWeight: 700, fontSize: "0.875rem" }}>
        {collection.name}
      </Typography>
      <Box sx={{ display: "flex", alignItems: "center", fontSize: "0.8rem", color: "text.secondary" }}>
        <ModelCount count={collection.model_count} provider={provider} />
        {collection.private && <LockOutlinedIcon sx={{ fontSize: 14, ml: "auto" }} />}
      </Box>
      <Thumb src={cover} sx={{ aspectRatio: "16 / 9", mt: 1, borderRadius: "2px" }} />
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "4px", mt: "4px" }}>
        {[0, 1, 2].map((i) => (
          <Thumb key={i} src={rest[i]} sx={{ aspectRatio: "1 / 1", borderRadius: "2px" }} />
        ))}
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
        borderBottom: `3px solid ${accent(provider)}`,
        p: 1.25,
      }}
    >
      {lines}
      <Skeleton variant="rectangular" sx={{ width: "100%", height: "auto", aspectRatio: "16 / 9", mt: 1 }} />
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "4px", mt: "4px" }}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} variant="rectangular" sx={{ width: "100%", height: "auto", aspectRatio: "1 / 1" }} />
        ))}
      </Box>
    </Box>
  );
}
