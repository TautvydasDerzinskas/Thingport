import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
import Typography from "@mui/material/Typography";
import { alpha, type Theme } from "@mui/material/styles";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import { ProviderLogo } from "../../components/Layout/ConfigurationDialog/providerLogos";
import { ModelCount, sunken, Thumb, type SkeletonProps, type TileProps } from "../collectionTile";

const RADIUS = "6px";
// One big picture beside two stacked ones, in tracks that start at nothing, so the pictures fill the 3:2 rather than
// stretch it to their own size.
const MOSAIC = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)",
  gridTemplateRows: "minmax(0, 1fr) minmax(0, 1fr)",
  gap: "2px",
  aspectRatio: "3 / 2",
};
// Its header's black, a shade under the dialog's own panel in the dark theme.
const band = (theme: Theme) =>
  theme.palette.mode === "dark" ? alpha(theme.palette.common.black, 0.45) : theme.palette.grey[900];

/** 3DExport, in its header's black: a cover and the next two pictures over a black band, which carries its red
 *  hexagon mark beside the collection's name and count, and a lock on a private one. */
export function Tile({ provider, collection }: TileProps) {
  const slot = { height: "100%", minHeight: 0 };
  return (
    <Box sx={{ borderRadius: RADIUS, overflow: "hidden", bgcolor: band }}>
      <Box sx={MOSAIC}>
        <Thumb src={collection.thumbnails[0]} sx={{ ...slot, gridRow: "span 2" }} />
        <Thumb src={collection.thumbnails[1]} sx={slot} />
        <Thumb src={collection.thumbnails[2]} sx={slot} />
      </Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.25, py: 1, color: "common.white" }}>
        <Box sx={{ flex: "none" }}>
          <ProviderLogo id={provider} size={22} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography noWrap sx={{ fontWeight: 600, fontSize: "0.8125rem", color: "inherit" }}>
            {collection.name}
          </Typography>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.5,
              fontSize: "0.75rem",
              color: (theme) => alpha(theme.palette.common.white, 0.72),
            }}
          >
            <ModelCount count={collection.model_count} provider={provider} />
            {collection.private && <LockOutlinedIcon sx={{ fontSize: 13 }} />}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

/** Its tile's shape while the collections load. */
export function TileSkeleton({ lines }: SkeletonProps): JSX.Element {
  return (
    <Box aria-hidden sx={{ borderRadius: RADIUS, overflow: "hidden", bgcolor: band }}>
      <Box sx={MOSAIC}>
        <Skeleton variant="rectangular" sx={{ gridRow: "span 2", width: "100%", height: "100%", bgcolor: sunken }} />
        <Skeleton variant="rectangular" sx={{ width: "100%", height: "100%", bgcolor: sunken }} />
        <Skeleton variant="rectangular" sx={{ width: "100%", height: "100%", bgcolor: sunken }} />
      </Box>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 1.25,
          py: 1,
          // Its lines on the black band, which the default shade would vanish into.
          "& .MuiSkeleton-root": { bgcolor: (theme) => alpha(theme.palette.common.white, 0.14) },
        }}
      >
        <Skeleton variant="circular" width={22} height={22} sx={{ flex: "none" }} />
        <Box sx={{ minWidth: 0, flex: 1 }}>{lines}</Box>
      </Box>
    </Box>
  );
}
