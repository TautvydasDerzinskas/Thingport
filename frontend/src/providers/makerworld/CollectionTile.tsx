import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
import Typography from "@mui/material/Typography";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import ViewInArOutlinedIcon from "@mui/icons-material/ViewInArOutlined";
import { ModelCount, Thumb, type SkeletonProps, type TileProps } from "../collectionTile";

/** MakerWorld: a 2x2 mosaic, "+N" over the last tile, the deck edges below. */
export function Tile({ provider, collection }: TileProps) {
  const more = collection.model_count - 4;
  return (
    <Box
      sx={{
        borderRadius: "12px",
        border: 1,
        borderColor: "divider",
        bgcolor: "background.paper",
        overflow: "hidden",
        boxShadow: (theme) =>
          `0 6px 0 -2px ${theme.palette.mode === "dark" ? "#3a3a3a" : "#ebebeb"}, 0 11px 0 -5px ${theme.palette.mode === "dark" ? "#2e2e2e" : "#f2f2f2"}`,
        mb: "11px",
      }}
    >
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gridTemplateRows: "1fr 1fr",
          gap: "2px",
          aspectRatio: "4 / 3",
        }}
      >
        {[0, 1, 2, 3].map((i) => (
          <Box key={i} sx={{ position: "relative", minHeight: 0, overflow: "hidden" }}>
            <Thumb src={collection.thumbnails[i]} sx={{ width: "100%", height: "100%" }} />
            {i === 3 && more > 0 && (
              <Box
                sx={{
                  position: "absolute",
                  inset: 0,
                  display: "grid",
                  placeItems: "center",
                  bgcolor: "rgba(0, 0, 0, 0.45)",
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: "1.25rem",
                }}
              >
                +{more}
              </Box>
            )}
          </Box>
        ))}
      </Box>
      <Box sx={{ px: 1.5, py: 1.25 }}>
        <Typography noWrap sx={{ fontWeight: 700, fontSize: "0.875rem" }}>
          {collection.name}
        </Typography>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            mt: 0.25,
            color: "text.secondary",
            fontSize: "0.75rem",
          }}
        >
          <ViewInArOutlinedIcon sx={{ fontSize: 14 }} />
          <ModelCount count={collection.model_count} provider={provider} />
          {collection.private && <LockOutlinedIcon sx={{ fontSize: 14, ml: "auto" }} />}
        </Box>
      </Box>
    </Box>
  );
}

/** Its tile's shape while the collections load. */
export function TileSkeleton({ lines }: SkeletonProps): JSX.Element {
  return (
    <Box aria-hidden sx={{ borderRadius: "12px", border: 1, borderColor: "divider", overflow: "hidden", mb: "11px" }}>
      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px", aspectRatio: "4 / 3" }}>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} variant="rectangular" sx={{ width: "100%", height: "100%" }} />
        ))}
      </Box>
      <Box sx={{ px: 1.5, py: 1.25 }}>{lines}</Box>
    </Box>
  );
}
