import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
import Typography from "@mui/material/Typography";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import { accent, ModelCount, Thumb, sunken, type SkeletonProps, type TileProps } from "../collectionTile";

const RADIUS = "16px";
const INNER = "10px";

/** Meshy, rounded and soft as its community cards are: four covers in an inset grid, the name, and the count on a
 *  pill in its lime with its near-black text, which reads on a light page and a dark one alike. */
export function Tile({ provider, collection }: TileProps) {
  const lime = accent(provider);
  return (
    <Box
      sx={{ borderRadius: RADIUS, overflow: "hidden", bgcolor: "background.paper", border: 1, borderColor: "divider" }}
    >
      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px", p: "6px" }}>
        {[0, 1, 2, 3].map((index) => (
          <Thumb
            key={index}
            src={collection.thumbnails[index]}
            sx={{ aspectRatio: "1 / 1", borderRadius: INNER, bgcolor: sunken }}
          />
        ))}
      </Box>
      <Box sx={{ px: 1.25, pb: 1.25, pt: 0.25 }}>
        <Typography noWrap sx={{ fontWeight: 600, fontSize: "0.875rem" }}>
          {collection.name}
        </Typography>
        <Box
          sx={{
            mt: 0.5,
            display: "inline-flex",
            alignItems: "center",
            gap: 0.5,
            px: 1,
            py: "1px",
            borderRadius: 999,
            bgcolor: lime,
            color: "common.black",
            fontSize: "0.75rem",
            fontWeight: 600,
          }}
        >
          <AutoAwesomeIcon sx={{ fontSize: 12 }} />
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
      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px", p: "6px" }}>
        {[0, 1, 2, 3].map((index) => (
          <Skeleton
            key={index}
            variant="rectangular"
            sx={{ width: "100%", height: "auto", aspectRatio: "1 / 1", borderRadius: INNER }}
          />
        ))}
      </Box>
      <Box sx={{ px: 1.25, pb: 1.25, pt: 0.25 }}>
        <Skeleton variant="text" sx={{ fontSize: "0.875rem", width: "60%" }} />
        <Skeleton variant="rounded" sx={{ mt: 0.5, width: 72, height: 18, borderRadius: 999 }} />
      </Box>
    </Box>
  );
}
