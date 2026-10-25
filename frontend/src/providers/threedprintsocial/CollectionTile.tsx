import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
import Typography from "@mui/material/Typography";
import { accent, ModelCount, Thumb, type SkeletonProps, type TileProps } from "../collectionTile";

/** 3DPrint.social, as its Manyfold collection cards are: one picture across the top, the name under it and the count
 *  on a line of its own, its violet marking it. A creator's models are one of these too. */
export function Tile({ provider, collection }: TileProps) {
  return (
    <Box
      sx={{
        borderRadius: "6px",
        border: 1,
        borderColor: "divider",
        bgcolor: "background.paper",
        overflow: "hidden",
      }}
    >
      <Thumb src={collection.thumbnails[0]} sx={{ aspectRatio: "4 / 3" }} />
      <Box sx={{ px: 1.25, pt: 1, pb: 0.75 }}>
        <Typography noWrap sx={{ fontWeight: 600, fontSize: "0.875rem" }}>
          {collection.name}
        </Typography>
      </Box>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.75,
          px: 1.25,
          py: 0.75,
          borderTop: 1,
          borderColor: "divider",
          fontSize: "0.75rem",
          color: "text.secondary",
        }}
      >
        <Box aria-hidden sx={{ width: 8, height: 8, borderRadius: "2px", bgcolor: accent(provider) }} />
        <ModelCount count={collection.model_count} provider={provider} />
      </Box>
    </Box>
  );
}

/** Its tile's shape while the collections load. */
export function TileSkeleton(_props: SkeletonProps): JSX.Element {
  return (
    <Box aria-hidden sx={{ borderRadius: "6px", border: 1, borderColor: "divider", overflow: "hidden" }}>
      <Skeleton variant="rectangular" sx={{ width: "100%", height: "auto", aspectRatio: "4 / 3" }} />
      <Box sx={{ px: 1.25, pt: 1, pb: 0.75 }}>
        <Skeleton variant="text" sx={{ fontSize: "0.875rem", width: "60%" }} />
      </Box>
      <Box sx={{ px: 1.25, py: 0.75, borderTop: 1, borderColor: "divider" }}>
        <Skeleton variant="text" sx={{ fontSize: "0.75rem", width: "30%" }} />
      </Box>
    </Box>
  );
}
