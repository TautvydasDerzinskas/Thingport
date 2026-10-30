import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import BookmarkIcon from "@mui/icons-material/Bookmark";
import { accent, ModelCount, Thumb, sunken, type SkeletonProps, type TileProps } from "../collectionTile";

const RADIUS = "10px";

/** Makerables, light and squared off as its project cards are: one wide cover with its blue bookmark tab in the
 *  corner, the next three covers in a strip under it, then the name. Its only list is the projects the user saved,
 *  which is what the tab stands for. */
export function Tile({ provider, collection }: TileProps) {
  const blue = accent(provider);
  return (
    <Box
      sx={{
        borderRadius: RADIUS,
        overflow: "hidden",
        bgcolor: "background.paper",
        border: 1,
        borderColor: "divider",
      }}
    >
      <Box sx={{ position: "relative" }}>
        <Thumb src={collection.thumbnails[0]} sx={{ aspectRatio: "16 / 9", objectFit: "cover" }} />
        <Box
          sx={{
            position: "absolute",
            top: 0,
            right: 10,
            width: 20,
            height: 26,
            bgcolor: blue,
            color: "common.white",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            pt: "3px",
            // The dip a bookmark's tail has, as the site draws it on a saved card.
            clipPath: "polygon(0 0, 100% 0, 100% 100%, 50% 72%, 0 100%)",
          }}
        >
          <BookmarkIcon sx={{ fontSize: 12 }} />
        </Box>
      </Box>
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "2px", pt: "2px" }}>
        {[1, 2, 3].map((index) => (
          <Thumb key={index} src={collection.thumbnails[index]} sx={{ aspectRatio: "1 / 1", bgcolor: sunken }} />
        ))}
      </Box>
      <Box sx={{ px: 1.25, py: 1, borderTop: 1, borderColor: alpha(blue, 0.25) }}>
        <Typography noWrap sx={{ fontWeight: 600, fontSize: "0.875rem" }}>
          {collection.name}
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, fontSize: "0.75rem", color: blue }}>
          <BookmarkIcon sx={{ fontSize: 12 }} />
          <ModelCount count={collection.model_count} provider={provider} />
        </Box>
      </Box>
    </Box>
  );
}

/** Its tile's shape while the collections load. */
export function TileSkeleton(_props: SkeletonProps): JSX.Element {
  return (
    <Box aria-hidden sx={{ borderRadius: RADIUS, overflow: "hidden", border: 1, borderColor: "divider" }}>
      <Skeleton variant="rectangular" sx={{ width: "100%", height: "auto", aspectRatio: "16 / 9" }} />
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "2px", pt: "2px" }}>
        {[1, 2, 3].map((index) => (
          <Skeleton key={index} variant="rectangular" sx={{ width: "100%", height: "auto", aspectRatio: "1 / 1" }} />
        ))}
      </Box>
      <Box sx={{ px: 1.25, py: 1 }}>
        <Skeleton variant="text" sx={{ fontSize: "0.875rem", width: "60%" }} />
        <Skeleton variant="text" sx={{ fontSize: "0.75rem", width: "30%" }} />
      </Box>
    </Box>
  );
}
