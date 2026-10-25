import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
import Typography from "@mui/material/Typography";
import FavoriteIcon from "@mui/icons-material/Favorite";
import { accent, ModelCount, Thumb, type SkeletonProps, type TileProps } from "../collectionTile";

/** eufyMake, dark as its site is in both themes: four covers in a grid, the name under them and the count in its
 *  green. Its only list is the user's likes. */
export function Tile({ provider, collection }: TileProps) {
  return (
    <Box sx={{ borderRadius: "12px", overflow: "hidden", bgcolor: "grey.900", color: "common.white" }}>
      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px" }}>
        {[0, 1, 2, 3].map((index) => (
          <Thumb key={index} src={collection.thumbnails[index]} sx={{ aspectRatio: "1 / 1", bgcolor: "grey.800" }} />
        ))}
      </Box>
      <Box sx={{ px: 1.25, py: 1 }}>
        <Typography noWrap sx={{ fontWeight: 700, fontSize: "0.875rem" }}>
          {collection.name}
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, fontSize: "0.75rem", color: accent(provider) }}>
          <FavoriteIcon sx={{ fontSize: 12 }} />
          <ModelCount count={collection.model_count} provider={provider} />
        </Box>
      </Box>
    </Box>
  );
}

/** Its tile's shape while the collections load. */
export function TileSkeleton(_props: SkeletonProps): JSX.Element {
  return (
    <Box aria-hidden sx={{ borderRadius: "12px", overflow: "hidden" }}>
      <Skeleton variant="rectangular" sx={{ width: "100%", height: "auto", aspectRatio: "1 / 1" }} />
      <Box sx={{ px: 1.25, py: 1 }}>
        <Skeleton variant="text" sx={{ fontSize: "0.875rem", width: "60%" }} />
        <Skeleton variant="text" sx={{ fontSize: "0.75rem", width: "30%" }} />
      </Box>
    </Box>
  );
}
