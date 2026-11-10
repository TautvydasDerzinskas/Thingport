import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import FavoriteIcon from "@mui/icons-material/Favorite";
import { accent, ModelCount, sunken, Thumb, type SkeletonProps, type TileProps } from "../collectionTile";

const RADIUS = "8px";
const MOSAIC = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gridTemplateRows: "1fr 1fr",
  gap: "2px",
  aspectRatio: "2 / 1",
};

/** Fab365, in its bright green: a 2×2 of covers with a green rule above the name and the heart it marks favourites
 *  with. Its only list is the user's favourites. */
export function Tile({ provider, collection }: TileProps) {
  const green = accent(provider);
  const slot = { height: "100%", minHeight: 0 };
  return (
    <Box
      sx={{
        borderRadius: RADIUS,
        overflow: "hidden",
        bgcolor: sunken,
        border: 1,
        borderColor: (theme) => alpha(green, theme.palette.mode === "dark" ? 0.4 : 0.55),
      }}
    >
      <Box sx={MOSAIC}>
        {[0, 1, 2, 3].map((index) => (
          <Thumb key={index} src={collection.thumbnails[index]} sx={slot} />
        ))}
      </Box>
      <Box sx={{ height: "3px", bgcolor: green }} />
      <Box sx={{ px: 1.25, py: 1 }}>
        <Typography noWrap sx={{ fontWeight: 600, fontSize: "0.8125rem" }}>
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
          <FavoriteIcon sx={{ fontSize: 12, color: green }} />
          <ModelCount count={collection.model_count} provider={provider} />
        </Box>
      </Box>
    </Box>
  );
}

/** Its tile's shape while the lists load. */
export function TileSkeleton({ lines }: SkeletonProps): JSX.Element {
  return (
    <Box aria-hidden sx={{ borderRadius: RADIUS, overflow: "hidden", border: 1, borderColor: "divider" }}>
      <Box sx={MOSAIC}>
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} variant="rectangular" sx={{ width: "100%", height: "100%" }} />
        ))}
      </Box>
      <Box sx={{ height: "3px", bgcolor: "divider" }} />
      <Box sx={{ px: 1.25, py: 1 }}>{lines}</Box>
    </Box>
  );
}
