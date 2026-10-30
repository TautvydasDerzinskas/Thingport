import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
import Typography from "@mui/material/Typography";
import { alpha, useTheme } from "@mui/material/styles";
import FavoriteIcon from "@mui/icons-material/Favorite";
import ThumbUpIcon from "@mui/icons-material/ThumbUp";
import { providerAccentText } from "../../constants/providerFacts";
import { accent, ModelCount, Thumb, sunken, type SkeletonProps, type TileProps } from "../collectionTile";

const RADIUS = "8px";

/** CGTrader, white and teal as its model cards are: one big cover with the next two stacked beside it, the round
 *  button its cards carry in the corner -- a heart for the wishlist, a thumbs-up for the likes -- and the name under
 *  them. Its lists are the user's liked models and their wishlist. */
export function Tile({ provider, collection }: TileProps) {
  const theme = useTheme();
  const teal = accent(provider);
  const Icon = collection.likes ? ThumbUpIcon : FavoriteIcon;
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
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr",
            gridTemplateRows: "1fr 1fr",
            gap: "2px",
            aspectRatio: "3 / 2",
          }}
        >
          <Thumb src={collection.thumbnails[0]} sx={{ gridRow: "1 / 3", height: "100%", bgcolor: sunken }} />
          <Thumb src={collection.thumbnails[1]} sx={{ height: "100%", bgcolor: sunken }} />
          <Thumb src={collection.thumbnails[2]} sx={{ height: "100%", bgcolor: sunken }} />
        </Box>
        <Box
          sx={{
            position: "absolute",
            top: 6,
            right: 6,
            width: 22,
            height: 22,
            borderRadius: "50%",
            bgcolor: "background.paper",
            color: teal,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: `0 1px 3px ${alpha(theme.palette.common.black, 0.25)}`,
          }}
        >
          <Icon sx={{ fontSize: 13 }} />
        </Box>
      </Box>
      <Box sx={{ px: 1.25, py: 1, borderTop: 2, borderColor: teal }}>
        <Typography noWrap sx={{ fontWeight: 600, fontSize: "0.875rem" }}>
          {collection.name}
        </Typography>
        <Box sx={{ fontSize: "0.75rem", color: providerAccentText(provider, theme) }}>
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
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr",
          gridTemplateRows: "1fr 1fr",
          gap: "2px",
          aspectRatio: "3 / 2",
        }}
      >
        <Skeleton variant="rectangular" sx={{ gridRow: "1 / 3", width: "100%", height: "100%" }} />
        <Skeleton variant="rectangular" sx={{ width: "100%", height: "100%" }} />
        <Skeleton variant="rectangular" sx={{ width: "100%", height: "100%" }} />
      </Box>
      <Box sx={{ px: 1.25, py: 1 }}>
        <Skeleton variant="text" sx={{ fontSize: "0.875rem", width: "60%" }} />
        <Skeleton variant="text" sx={{ fontSize: "0.75rem", width: "30%" }} />
      </Box>
    </Box>
  );
}
