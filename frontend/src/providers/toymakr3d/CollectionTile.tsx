import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import ThumbUpIcon from "@mui/icons-material/ThumbUp";
import { accent, ModelCount, Thumb, type SkeletonProps, type TileProps } from "../collectionTile";

const RADIUS = "8px";

/** Toymakr3D, black and gold as its site is in both themes: a strip of four covers over a dark bar, with its gold
 *  rule above the name and the thumbs-up it counts likes by. Its only list is the user's liked products. */
export function Tile({ provider, collection }: TileProps) {
  const gold = accent(provider);
  return (
    <Box
      sx={{
        borderRadius: RADIUS,
        overflow: "hidden",
        bgcolor: "common.black",
        color: "common.white",
        border: 1,
        borderColor: (theme) => alpha(gold, theme.palette.mode === "dark" ? 0.35 : 0.6),
      }}
    >
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "2px" }}>
        {[0, 1, 2, 3].map((index) => (
          <Thumb
            key={index}
            src={collection.thumbnails[index]}
            sx={{ aspectRatio: "1 / 1", bgcolor: alpha(gold, 0.08) }}
          />
        ))}
      </Box>
      <Box sx={{ height: "2px", bgcolor: gold }} />
      <Box sx={{ px: 1.25, py: 1 }}>
        <Typography noWrap sx={{ fontWeight: 700, fontSize: "0.875rem", textTransform: "uppercase" }}>
          {collection.name}
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, fontSize: "0.75rem", color: gold }}>
          <ThumbUpIcon sx={{ fontSize: 12 }} />
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
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "2px" }}>
        {[0, 1, 2, 3].map((index) => (
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
