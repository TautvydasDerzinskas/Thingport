import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
import Typography from "@mui/material/Typography";
import FavoriteBorderIcon from "@mui/icons-material/FavoriteBorder";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import { ModelCount, sunken, Thumb, type SkeletonProps, type TileProps } from "../collectionTile";

const RADIUS = "6px";
// Tracks that start at nothing, so the pictures fill the panel's 2:1 rather than stretch it to their own size.
const MOSAIC = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)",
  gridTemplateRows: "minmax(0, 1fr) minmax(0, 1fr)",
  gap: "2px",
  aspectRatio: "2 / 1",
};

/** PIXUP, as a creator's collections show on their Series tab: a sunken panel with one large picture beside two
 *  stacked ones, the name and the count under them. A wishlist has a heart before its count, as the site marks the
 *  models saved to one. */
export function Tile({ provider, collection }: TileProps) {
  // An empty slot is drawn darker than the panel it sits in, or it would vanish into it.
  const slot = { height: "100%", minHeight: 0, bgcolor: "divider" };
  return (
    <Box sx={{ borderRadius: RADIUS, bgcolor: sunken, overflow: "hidden" }}>
      <Box sx={MOSAIC}>
        <Thumb src={collection.thumbnails[0]} sx={{ ...slot, gridRow: "span 2" }} />
        <Thumb src={collection.thumbnails[1]} sx={slot} />
        <Thumb src={collection.thumbnails[2]} sx={slot} />
      </Box>
      <Box sx={{ px: 1, pt: 1, pb: 1.125 }}>
        <Typography noWrap sx={{ fontWeight: 500, fontSize: "0.8125rem" }}>
          {collection.name}
        </Typography>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            mt: 0.25,
            fontSize: "0.75rem",
            color: "text.secondary",
          }}
        >
          {collection.likes && <FavoriteBorderIcon sx={{ fontSize: 13 }} />}
          <ModelCount count={collection.model_count} provider={provider} />
          {collection.private && <LockOutlinedIcon sx={{ fontSize: 13 }} />}
        </Box>
      </Box>
    </Box>
  );
}

/** Its tile's shape while the lists load. */
export function TileSkeleton({ lines }: SkeletonProps): JSX.Element {
  return (
    <Box aria-hidden sx={{ borderRadius: RADIUS, bgcolor: sunken, overflow: "hidden" }}>
      <Box sx={MOSAIC}>
        <Skeleton variant="rectangular" sx={{ gridRow: "span 2", width: "100%", height: "100%" }} />
        <Skeleton variant="rectangular" sx={{ width: "100%", height: "100%" }} />
        <Skeleton variant="rectangular" sx={{ width: "100%", height: "100%" }} />
      </Box>
      <Box sx={{ px: 1, pt: 1, pb: 1.125 }}>{lines}</Box>
    </Box>
  );
}
