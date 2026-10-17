import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router-dom";
import BookmarkIcon from "@mui/icons-material/Bookmark";
import BookmarkBorderIcon from "@mui/icons-material/BookmarkBorder";
import LocalOfferOutlinedIcon from "@mui/icons-material/LocalOfferOutlined";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Skeleton from "@mui/material/Skeleton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { printsApi } from "../../api/prints";
import type { TagSummary } from "../../api/tags";
import { colorForTag } from "../../utils/tagColors";
import TagActionsMenu from "../TagDetailPage/TagActionsMenu";
import { useCardContextMenu } from "../../components/Layout/ConfigurationDialog/AppTiles";

/** Grid areas for a mosaic's pictures, from its rows of letters. */
const areas = (rows: string[]) => rows.map((row) => `"${row.split("").join(" ")}"`).join(" ");

type Props = {
  tag: TagSummary;
  onToggleBookmark: (tag: TagSummary) => void;
  onDeleted: (tag: TagSummary) => void;
  onUnauthorized?: () => void;
};

const overlayButtonSx = {
  bgcolor: "rgba(255, 255, 255, 0.92)",
  color: "#5f6368",
  boxShadow: "0 1px 3px rgba(0, 0, 0, 0.2)",
  "&:hover, &.Mui-focusVisible": { bgcolor: "#ffffff", color: "primary.main" },
} as const;

/** A square for a tag: a mosaic of its models, its bookmark top left, its name and count along the bottom, and its menu
 * on hover or right-click. */
function TagTile({ tag, onToggleBookmark, onDeleted, onUnauthorized }: Props) {
  const { t } = useTranslation(["models", "common"]);
  const fallback = colorForTag(tag.name);
  const contextMenu = useCardContextMenu();
  const bookmarkLabel = tag.bookmarked ? t("models:tags.unbookmarkTag") : t("models:tags.bookmarkTag");

  return (
    <Box
      onContextMenu={contextMenu.onContextMenu}
      sx={{
        position: "relative",
        aspectRatio: "1 / 1",
        borderRadius: "14px",
        overflow: "hidden",
        border: "1px solid",
        borderColor: "divider",
        bgcolor: tag.mosaic_url ? "divider" : fallback.bg,
        transition: "transform 150ms, box-shadow 150ms",
        "&:hover": { transform: "translateY(-2px)", boxShadow: "0 6px 16px rgba(0, 0, 0, 0.16)" },
        "&:hover .tag-mosaic img": { transform: "scale(1.04)" },
        "&:hover .tag-tile-menu, &:focus-within .tag-tile-menu": { opacity: 1 },
      }}
    >
      {/* The menu and bookmark sit beside the link, not in it: a click in the menu's dialogs would otherwise open
          the tag. */}
      <Box
        component={RouterLink}
        to={`/models/tags/${encodeURIComponent(tag.name)}`}
        aria-label={tag.name}
        sx={{
          position: "absolute",
          inset: 0,
          borderRadius: "inherit",
          "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: -3 },
        }}
      >
        {tag.mosaic_url ? (
          // Built on the server from the tag's newest models: one picture per tile, however many models.
          <Box className="tag-mosaic" aria-hidden sx={{ position: "absolute", inset: 0, overflow: "hidden" }}>
            <Box
              component="img"
              src={printsApi.fileUrl(tag.mosaic_url)}
              alt=""
              loading="lazy"
              decoding="async"
              sx={{
                display: "block",
                width: "100%",
                height: "100%",
                objectFit: "cover",
                opacity: 0.4,
                transition: "transform 300ms",
              }}
            />
          </Box>
        ) : (
          <LocalOfferOutlinedIcon
            aria-hidden
            sx={{ position: "absolute", inset: 0, m: "auto", fontSize: 56, color: fallback.text, opacity: 0.35 }}
          />
        )}
        {/* Keeps the chip readable over any picture. */}
        <Box
          aria-hidden
          sx={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(to top, rgba(0, 0, 0, 0.4), transparent 40%)",
            pointerEvents: "none",
          }}
        />
        <Box sx={{ position: "absolute", bottom: 8, left: 8, right: 8, display: "flex" }}>
          <Tooltip title={tag.name}>
            <Box
              aria-hidden
              sx={{
                display: "inline-flex",
                alignItems: "center",
                gap: 0.75,
                maxWidth: "100%",
                pl: 1.25,
                pr: 0.5,
                py: 0.5,
                borderRadius: "999px",
                bgcolor: "rgba(255, 255, 255, 0.92)",
                backdropFilter: "blur(6px)",
                boxShadow: "0 1px 3px rgba(0, 0, 0, 0.2)",
              }}
            >
              <Typography variant="body2" fontWeight={600} noWrap sx={{ color: "#1f1f1f", minWidth: 0 }}>
                {tag.name}
              </Typography>
              <Box
                component="span"
                sx={{
                  flexShrink: 0,
                  px: 0.75,
                  borderRadius: "999px",
                  fontSize: "0.72rem",
                  fontWeight: 700,
                  lineHeight: "18px",
                  color: "#ffffff",
                  bgcolor: "primary.main",
                }}
              >
                {tag.count}
              </Box>
            </Box>
          </Tooltip>
        </Box>
      </Box>
      <Box
        className="tag-tile-menu"
        sx={{
          position: "absolute",
          top: 6,
          right: 6,
          opacity: 0,
          transition: "opacity 150ms",
          // No hover on a touch screen, so the menu stays in reach.
          "@media (hover: none)": { opacity: 1 },
        }}
      >
        <TagActionsMenu
          tag={tag.name}
          onUnauthorized={onUnauthorized}
          onDeleted={() => onDeleted(tag)}
          iconFontSize={18}
          contextMenuAt={contextMenu.at}
          onContextMenuClose={contextMenu.close}
          triggerSx={{ width: 30, height: 30, ...overlayButtonSx }}
        />
      </Box>
      <Tooltip title={bookmarkLabel}>
        <IconButton
          size="small"
          aria-label={bookmarkLabel}
          aria-pressed={tag.bookmarked}
          onClick={() => onToggleBookmark(tag)}
          sx={{
            position: "absolute",
            top: 6,
            left: 6,
            ...overlayButtonSx,
            color: tag.bookmarked ? "primary.main" : overlayButtonSx.color,
          }}
        >
          {tag.bookmarked ? <BookmarkIcon fontSize="small" /> : <BookmarkBorderIcon fontSize="small" />}
        </IconButton>
      </Tooltip>
    </Box>
  );
}

// The page passes the same callbacks every time, so only a tile whose tag changed draws again.
export default memo(TagTile);

// A few mosaics like the server draws, so a loading grid doesn't look stamped out.
const SKELETON_MOSAICS = [
  ["aabb", "aabb", "cdee", "cdee"],
  ["aabc", "aabd", "eeff", "eegg"],
  ["aabb", "aabb", "aacc", "aacc"],
  ["aabc", "aade", "fghh", "fijj"],
  ["aabc", "aabc", "ddee", "ffee"],
  ["abcc", "dbcc", "eeff", "ghff"],
];

/** Stand-ins shaped like tiles: a mosaic of blocks, a pill for the name, a circle for the bookmark. */
export function TagTileSkeletons({ count }: { count: number }) {
  return Array.from({ length: count }, (_, index) => {
    const layout = SKELETON_MOSAICS[index % SKELETON_MOSAICS.length];
    const blocks = new Set(layout.join("")).size;
    return (
      <Box
        key={index}
        aria-hidden
        sx={{
          position: "relative",
          aspectRatio: "1 / 1",
          borderRadius: "14px",
          overflow: "hidden",
          border: "1px solid",
          borderColor: "divider",
        }}
      >
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gridTemplateRows: "repeat(4, 1fr)",
            gridTemplateAreas: areas(layout),
            gap: "2px",
          }}
        >
          {Array.from({ length: blocks }, (_block, block) => (
            <Skeleton
              key={block}
              variant="rectangular"
              animation="wave"
              sx={{ gridArea: String.fromCharCode(97 + block), width: "100%", height: "100%" }}
            />
          ))}
        </Box>
        <Skeleton
          variant="rounded"
          sx={{ position: "absolute", bottom: 10, left: 10, width: "48%", height: 26, borderRadius: "999px" }}
        />
        <Skeleton variant="circular" sx={{ position: "absolute", top: 6, left: 6, width: 30, height: 30 }} />
      </Box>
    );
  });
}
