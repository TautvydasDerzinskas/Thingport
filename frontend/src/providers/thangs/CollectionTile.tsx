import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
import Typography from "@mui/material/Typography";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import { accent, ModelCount, Thumb, type SkeletonProps, type TileProps } from "../collectionTile";

/** Thangs: its one cover, the count in a pill of its yellow over the corner, the name below. */
export function Tile({ provider, collection }: TileProps) {
  return (
    <Box
      sx={{
        borderRadius: "8px",
        border: 1,
        borderColor: "divider",
        bgcolor: "background.paper",
        overflow: "hidden",
      }}
    >
      <Box sx={{ position: "relative" }}>
        <Thumb src={collection.thumbnails[0]} sx={{ aspectRatio: "4 / 3" }} />
        <Box
          sx={{
            position: "absolute",
            top: 8,
            left: 8,
            px: 1,
            py: 0.25,
            borderRadius: "999px",
            bgcolor: accent(provider),
            // Its yellow is light in both themes.
            color: "common.black",
            fontSize: "0.7rem",
            fontWeight: 700,
          }}
        >
          <ModelCount count={collection.model_count} provider={provider} />
        </Box>
      </Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 1.25, py: 1 }}>
        <Typography noWrap sx={{ flex: 1, fontWeight: 700, fontSize: "0.875rem" }}>
          {collection.name}
        </Typography>
        {collection.private && <LockOutlinedIcon sx={{ fontSize: 14, color: "text.secondary" }} />}
      </Box>
    </Box>
  );
}

/** Its tile's shape while the collections load. */
export function TileSkeleton(_props: SkeletonProps): JSX.Element {
  return (
    <Box aria-hidden sx={{ borderRadius: "8px", border: 1, borderColor: "divider", overflow: "hidden" }}>
      <Skeleton variant="rectangular" sx={{ width: "100%", height: "auto", aspectRatio: "4 / 3" }} />
      <Box sx={{ px: 1.25, py: 1 }}>
        <Skeleton variant="text" sx={{ fontSize: "0.875rem", width: "70%" }} />
      </Box>
    </Box>
  );
}
