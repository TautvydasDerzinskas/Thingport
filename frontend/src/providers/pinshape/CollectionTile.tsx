import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import FavoriteIcon from "@mui/icons-material/Favorite";
import { accent, ModelCount, Thumb, type SkeletonProps, type TileProps } from "../collectionTile";

const GRID = {
  display: "grid",
  gridTemplateColumns: "2fr 1fr",
  gridTemplateRows: "repeat(3, 1fr)",
  gap: "3px",
  aspectRatio: "3 / 2",
} as const;

/** Pinshape, as its own collection cards are: a big picture beside three small ones stacked, the count in a dark badge
 *  on the big one's corner, the name below. Likes have its blue heart in the badge. */
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
      <Box sx={{ ...GRID, position: "relative" }}>
        <Box sx={{ gridRow: "1 / 4", minHeight: 0, overflow: "hidden" }}>
          <Thumb src={collection.thumbnails[0]} sx={{ height: "100%" }} />
        </Box>
        {[1, 2, 3].map((i) => (
          <Box key={i} sx={{ minHeight: 0, overflow: "hidden" }}>
            <Thumb src={collection.thumbnails[i]} sx={{ height: "100%" }} />
          </Box>
        ))}
        <Box
          sx={{
            position: "absolute",
            bottom: 8,
            // The big picture's own corner, as the site has it.
            right: "calc(100% / 3 + 8px)",
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            px: 1,
            py: 0.25,
            borderRadius: "4px",
            bgcolor: (theme) => alpha(theme.palette.common.black, 0.7),
            color: "common.white",
            fontSize: "0.7rem",
            fontWeight: 700,
            whiteSpace: "nowrap",
          }}
        >
          {collection.likes && <FavoriteIcon sx={{ fontSize: 12, color: accent(provider) }} />}
          <ModelCount count={collection.model_count} provider={provider} />
        </Box>
      </Box>
      <Box sx={{ px: 1.25, py: 1 }}>
        <Typography noWrap sx={{ fontWeight: 700, fontSize: "0.875rem" }}>
          {collection.name}
        </Typography>
      </Box>
    </Box>
  );
}

/** Its tile's shape while the collections load. */
export function TileSkeleton(_props: SkeletonProps): JSX.Element {
  return (
    <Box aria-hidden sx={{ borderRadius: "6px", border: 1, borderColor: "divider", overflow: "hidden" }}>
      <Box sx={GRID}>
        <Skeleton variant="rectangular" sx={{ gridRow: "1 / 4", height: "100%" }} />
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} variant="rectangular" sx={{ height: "100%" }} />
        ))}
      </Box>
      <Box sx={{ px: 1.25, py: 1 }}>
        <Skeleton variant="text" sx={{ fontSize: "0.875rem", width: "65%" }} />
      </Box>
    </Box>
  );
}
