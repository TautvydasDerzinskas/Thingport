import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
import Typography from "@mui/material/Typography";
import { alpha, darken } from "@mui/material/styles";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import { MANIFESTS } from "../index.generated";
import { accent, ModelCount, sunken, Thumb, type SkeletonProps, type TileProps } from "../collectionTile";

const RADIUS = "12px";
// Its blue, a shade darker so white text on it is easy to read.
const BAND = darken(accent("voxelshare"), 0.22);
// Its covers: one alone, two side by side, a big one beside two, or four in a square. Tracks start at nothing, so the
// pictures fill the square rather than stretch it to their own size.
const LAYOUTS: Record<number, object> = {
  1: { gridTemplateColumns: "minmax(0, 1fr)" },
  2: { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" },
  3: {
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gridTemplateRows: "repeat(2, minmax(0, 1fr))",
    "& > :first-of-type": { gridRow: "span 2" },
  },
  4: { gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gridTemplateRows: "repeat(2, minmax(0, 1fr))" },
};
const cover = (count: number) => ({
  display: "grid",
  gap: "2px",
  aspectRatio: "1 / 1",
  bgcolor: sunken,
  ...LAYOUTS[Math.min(Math.max(count, 1), 4)],
});

/** Its two chevrons, in white on the band (the lower one fainter, as its ink is beside its blue), or faint on an empty
 *  cover. */
function Mark({ size, faint }: { size: number; faint?: boolean }) {
  const { viewBox, path, layers } = MANIFESTS.voxelshare.brand.logo;
  return (
    <Box
      component="svg"
      viewBox={viewBox}
      aria-hidden="true"
      sx={{ width: size, height: size, flex: "none", display: "block", opacity: faint ? 0.35 : 1 }}
    >
      <Box
        component="path"
        d={path}
        sx={{ fill: (theme) => (faint ? "currentColor" : alpha(theme.palette.common.white, 0.65)) }}
      />
      {layers.map((layer) => (
        <Box
          key={layer.d}
          component="path"
          d={layer.d}
          sx={{ fill: (theme) => (faint ? layer.color : theme.palette.common.white) }}
        />
      ))}
    </Box>
  );
}

/** VoxelShare: up to four of its pictures over a band in its blue carrying its mark beside the collection's name and
 *  count, and a lock on a private one. */
export function Tile({ provider, collection }: TileProps) {
  const thumbs = collection.thumbnails.slice(0, 4);
  return (
    <Box sx={{ borderRadius: RADIUS, overflow: "hidden", bgcolor: BAND }}>
      {thumbs.length ? (
        <Box sx={cover(thumbs.length)}>
          {thumbs.map((src) => (
            <Thumb key={src} src={src} sx={{ height: "100%", minHeight: 0 }} />
          ))}
        </Box>
      ) : (
        <Box sx={{ ...cover(1), placeItems: "center", color: "text.secondary" }}>
          <Mark size={44} faint />
        </Box>
      )}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.25, py: 1, color: "common.white" }}>
        <Mark size={20} />
        <Box sx={{ minWidth: 0 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, minWidth: 0 }}>
            <Typography noWrap sx={{ fontWeight: 600, fontSize: "0.8125rem", color: "inherit" }}>
              {collection.name}
            </Typography>
            {collection.private && <LockOutlinedIcon sx={{ fontSize: 13, flex: "none" }} />}
          </Box>
          <Typography
            sx={{ fontSize: "0.75rem", fontWeight: 600, color: (theme) => alpha(theme.palette.common.white, 0.85) }}
          >
            <ModelCount count={collection.model_count} provider={provider} />
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}

/** Its tile's shape while the collections load. */
export function TileSkeleton({ lines }: SkeletonProps): JSX.Element {
  return (
    <Box aria-hidden sx={{ borderRadius: RADIUS, overflow: "hidden", bgcolor: BAND }}>
      <Skeleton variant="rectangular" sx={{ width: "100%", height: "auto", aspectRatio: "1 / 1", bgcolor: sunken }} />
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 1.25,
          py: 1,
          // Its lines on the blue band, which the default shade would vanish into.
          "& .MuiSkeleton-root": { bgcolor: (theme) => alpha(theme.palette.common.white, 0.2) },
        }}
      >
        <Skeleton variant="rectangular" width={20} height={20} sx={{ flex: "none" }} />
        <Box sx={{ minWidth: 0, flex: 1 }}>{lines}</Box>
      </Box>
    </Box>
  );
}
