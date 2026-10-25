import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
import Typography from "@mui/material/Typography";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import { accent, ModelCount, Thumb, type SkeletonProps, type TileProps } from "../collectionTile";

/** Cults3D: a big cover beside two small ones, the name and a count in its purple below. */
export function Tile({ provider, collection }: TileProps) {
  return (
    <Box
      sx={{
        borderRadius: "10px",
        border: 1,
        borderColor: "divider",
        bgcolor: "background.paper",
        overflow: "hidden",
      }}
    >
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr",
          gridTemplateRows: "1fr 1fr",
          gap: "2px",
          aspectRatio: "4 / 3",
        }}
      >
        <Box sx={{ gridRow: "1 / 3", minHeight: 0, overflow: "hidden" }}>
          <Thumb src={collection.thumbnails[0]} sx={{ height: "100%" }} />
        </Box>
        {[1, 2].map((i) => (
          <Box key={i} sx={{ minHeight: 0, overflow: "hidden" }}>
            <Thumb src={collection.thumbnails[i]} sx={{ height: "100%" }} />
          </Box>
        ))}
      </Box>
      <Box sx={{ px: 1.25, py: 1 }}>
        <Typography noWrap sx={{ fontWeight: 700, fontSize: "0.875rem" }}>
          {collection.name}
        </Typography>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            mt: 0.25,
            fontSize: "0.75rem",
            fontWeight: 600,
            // Its purple is too dark to read on the dark theme's paper; a lighter shade of it there.
            color: (theme) => (theme.palette.mode === "dark" ? "#B48CFA" : accent(provider)),
          }}
        >
          <ModelCount count={collection.model_count} provider={provider} />
          {collection.private && <LockOutlinedIcon sx={{ fontSize: 14, ml: "auto", color: "text.secondary" }} />}
        </Box>
      </Box>
    </Box>
  );
}

/** Its tile's shape while the collections load. */
export function TileSkeleton({ lines }: SkeletonProps): JSX.Element {
  return (
    <Box aria-hidden sx={{ borderRadius: "10px", border: 1, borderColor: "divider", overflow: "hidden" }}>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr",
          gridTemplateRows: "1fr 1fr",
          gap: "2px",
          aspectRatio: "4 / 3",
        }}
      >
        <Skeleton variant="rectangular" sx={{ gridRow: "1 / 3", width: "100%", height: "100%" }} />
        <Skeleton variant="rectangular" sx={{ width: "100%", height: "100%" }} />
        <Skeleton variant="rectangular" sx={{ width: "100%", height: "100%" }} />
      </Box>
      <Box sx={{ px: 1.25, py: 1 }}>{lines}</Box>
    </Box>
  );
}
