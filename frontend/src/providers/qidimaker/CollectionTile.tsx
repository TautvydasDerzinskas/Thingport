import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
import Typography from "@mui/material/Typography";
import { alpha, type Theme } from "@mui/material/styles";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import { MANIFESTS } from "../index.generated";
import { accent, ModelCount, sunken, Thumb, type SkeletonProps, type TileProps } from "../collectionTile";

const RADIUS = 12;
// The two cards stacked under it, each a little narrower and fainter, as the site draws a collection.
const STACK = 12;
const cardBehind = (width: string, bottom: number, opacity: number) => ({
  content: '""',
  position: "absolute",
  left: "50%",
  bottom,
  width,
  height: 6,
  transform: "translateX(-50%)",
  borderRadius: `0 0 ${RADIUS}px ${RADIUS}px`,
  bgcolor: "divider",
  opacity,
  pointerEvents: "none",
});
const card = {
  position: "relative",
  border: 1,
  borderColor: "divider",
  borderRadius: `${RADIUS}px`,
  bgcolor: "background.paper",
  "&::before": cardBehind("92%", -7, 0.9),
  "&::after": cardBehind("84%", -13, 0.5),
};
// Its covers in the site's layouts: one alone, two side by side, a big one beside two, or four in a square. Tracks
// start at nothing, so the pictures fill the square rather than stretch it to their own size.
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
  overflow: "hidden",
  borderRadius: `${RADIUS - 1}px ${RADIUS - 1}px 0 0`,
  bgcolor: sunken,
  ...LAYOUTS[Math.min(Math.max(count, 1), 4)],
});
// Its mark in its own indigo, or in its lighter blue where the dialog is dark.
const markColor = (theme: Theme) =>
  theme.palette.mode === "dark" ? accent("qidimaker") : MANIFESTS.qidimaker.brand.logo.color;

function Mark({ size }: { size: number }) {
  const { viewBox, path } = MANIFESTS.qidimaker.brand.logo;
  return (
    <Box sx={{ display: "flex", color: markColor }}>
      <svg width={size} height={size} viewBox={viewBox} aria-hidden="true">
        <path d={path} fill="currentColor" />
      </svg>
    </Box>
  );
}

/** QIDI Maker, as the site draws a collection: up to four of its pictures, the last saying how many more there are,
 *  with its name and count under them, on two cards stacked behind it. A private one has a lock. */
export function Tile({ provider, collection }: TileProps) {
  const thumbs = collection.thumbnails.slice(0, 4);
  const more = collection.model_count - thumbs.length;
  return (
    <Box sx={{ pb: `${STACK + 1}px` }}>
      <Box sx={card}>
        {thumbs.length ? (
          <Box sx={cover(thumbs.length)}>
            {thumbs.map((src, index) => (
              <Box key={src} sx={{ position: "relative", minHeight: 0 }}>
                <Thumb src={src} sx={{ height: "100%" }} />
                {index === 3 && more > 0 && (
                  <Box
                    sx={{
                      position: "absolute",
                      inset: 0,
                      display: "grid",
                      placeItems: "center",
                      bgcolor: (theme) => alpha(theme.palette.common.black, 0.36),
                      color: "common.white",
                      fontSize: "1.25rem",
                      fontWeight: 700,
                    }}
                  >
                    +{more}
                  </Box>
                )}
              </Box>
            ))}
          </Box>
        ) : (
          <Box sx={{ ...cover(1), placeItems: "center", "& svg": { opacity: 0.35 } }}>
            <Mark size={48} />
          </Box>
        )}
        <Box sx={{ px: 1.25, pt: 1, pb: 1.25 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0 }}>
            <Typography noWrap sx={{ fontWeight: 600, fontSize: "0.8125rem", color: "text.primary" }}>
              {collection.name}
            </Typography>
            {collection.private && <LockOutlinedIcon sx={{ fontSize: 14, color: "text.secondary", flex: "none" }} />}
          </Box>
          <Typography sx={{ fontSize: "0.75rem", fontWeight: 600, color: "text.secondary" }}>
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
    <Box aria-hidden sx={{ pb: `${STACK + 1}px` }}>
      <Box sx={card}>
        <Skeleton
          variant="rectangular"
          sx={{
            width: "100%",
            height: "auto",
            aspectRatio: "1 / 1",
            borderRadius: `${RADIUS - 1}px ${RADIUS - 1}px 0 0`,
          }}
        />
        <Box sx={{ px: 1.25, pt: 1, pb: 1.25 }}>{lines}</Box>
      </Box>
    </Box>
  );
}
