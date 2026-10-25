import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
import Typography from "@mui/material/Typography";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import { accent, ModelCount, Thumb, type SkeletonProps, type TileProps } from "../collectionTile";

// The gradient its title sits on: dark in both themes, so the white text reads over any cover.
const NEXPRINT_SCRIM = "linear-gradient(to top, rgba(0, 0, 0, 0.72), rgba(0, 0, 0, 0) 70%)";

/** NexPrint: one cover, its first model's, with the name over it, edged in its purple. */
export function Tile({ provider, collection }: TileProps) {
  return (
    <Box
      sx={{
        position: "relative",
        borderRadius: "10px",
        overflow: "hidden",
        borderLeft: `3px solid ${accent(provider)}`,
        bgcolor: "background.paper",
      }}
    >
      <Thumb src={collection.thumbnails[0]} sx={{ aspectRatio: "4 / 3" }} />
      <Box
        sx={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          px: 1.25,
          py: 1,
          backgroundImage: NEXPRINT_SCRIM,
          color: "common.white",
        }}
      >
        <Typography noWrap sx={{ fontWeight: 700, fontSize: "0.875rem" }}>
          {collection.name}
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", fontSize: "0.75rem", opacity: 0.85 }}>
          <ModelCount count={collection.model_count} provider={provider} />
          {collection.private && <LockOutlinedIcon sx={{ fontSize: 14, ml: "auto" }} />}
        </Box>
      </Box>
    </Box>
  );
}

/** Its tile's shape while the collections load. */
export function TileSkeleton(_props: SkeletonProps): JSX.Element {
  return (
    <Box aria-hidden sx={{ borderRadius: "10px", overflow: "hidden" }}>
      <Skeleton variant="rectangular" sx={{ width: "100%", height: "auto", aspectRatio: "4 / 3" }} />
    </Box>
  );
}
