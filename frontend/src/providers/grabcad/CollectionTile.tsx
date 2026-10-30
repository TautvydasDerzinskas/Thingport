import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
import Typography from "@mui/material/Typography";
import ThumbUpIcon from "@mui/icons-material/ThumbUp";
import { ModelCount, Thumb, type SkeletonProps, type TileProps } from "../collectionTile";

const RADIUS = "2px";

/** GrabCAD, as its library cards are: square-cornered and white, the model's picture across the top, its name in bold
 *  under it, and a grey row of counts with a thumbs-up, as a model's likes are counted there. Its only lists are
 *  members' likes. */
export function Tile({ provider, collection }: TileProps) {
  return (
    <Box sx={{ borderRadius: RADIUS, border: 1, borderColor: "divider", bgcolor: "background.paper", p: "3px" }}>
      <Thumb src={collection.thumbnails[0]} sx={{ aspectRatio: "4 / 3" }} />
      <Box sx={{ px: 1, pt: 1, pb: 0.75 }}>
        <Typography noWrap sx={{ fontWeight: 700, fontSize: "0.8125rem" }}>
          {collection.name}
        </Typography>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            mt: 0.5,
            fontSize: "0.75rem",
            color: "text.secondary",
          }}
        >
          <ThumbUpIcon sx={{ fontSize: 13 }} />
          <ModelCount count={collection.model_count} provider={provider} />
        </Box>
      </Box>
    </Box>
  );
}

/** Its tile's shape while the lists load. */
export function TileSkeleton(_props: SkeletonProps): JSX.Element {
  return (
    <Box aria-hidden sx={{ borderRadius: RADIUS, border: 1, borderColor: "divider", p: "3px" }}>
      <Skeleton variant="rectangular" sx={{ width: "100%", height: "auto", aspectRatio: "4 / 3" }} />
      <Box sx={{ px: 1, pt: 1, pb: 0.75 }}>
        <Skeleton variant="text" sx={{ fontSize: "0.8125rem", width: "65%" }} />
        <Skeleton variant="text" sx={{ fontSize: "0.75rem", width: "30%" }} />
      </Box>
    </Box>
  );
}
