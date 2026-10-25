import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
import Typography from "@mui/material/Typography";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import { ModelCount, Thumb, type SkeletonProps, type TileProps } from "../collectionTile";

// Snapmaker Space's model card: the newest model large, a row of three more, then name and count.
export function Tile({ provider, collection }: TileProps) {
  const [cover, ...rest] = collection.thumbnails;
  return (
    <Box
      sx={{
        borderRadius: "12px",
        border: 1,
        borderColor: "divider",
        bgcolor: "background.paper",
        overflow: "hidden",
      }}
    >
      <Thumb src={cover} sx={{ aspectRatio: "4 / 3" }} />
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "2px", mt: "2px" }}>
        {[0, 1, 2].map((i) => (
          <Thumb key={i} src={rest[i]} sx={{ aspectRatio: "1 / 1" }} />
        ))}
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
      <Skeleton variant="rectangular" sx={{ width: "100%", height: "auto", aspectRatio: "4 / 3" }} />
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "2px", mt: "2px" }}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} variant="rectangular" sx={{ width: "100%", height: "auto", aspectRatio: "1 / 1" }} />
        ))}
      </Box>
      <Box sx={{ px: 1.25, py: 1 }}>{lines}</Box>
    </Box>
  );
}
