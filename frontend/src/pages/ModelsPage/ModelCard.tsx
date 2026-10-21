import { useState } from "react";
import type React from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Paper from "@mui/material/Paper";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Avatar from "@mui/material/Avatar";
import Typography from "@mui/material/Typography";
import Tooltip from "@mui/material/Tooltip";
import { useTheme } from "@mui/material/styles";
import SelectionCheck from "../../components/selection/SelectionCheck";
import VisibilityIcon from "@mui/icons-material/Visibility";
import PrintIcon from "@mui/icons-material/Print";
import { type Print, printsApi } from "../../api/prints";
import { type PreviewMode } from "../../api/settings";
import { type ResolvedTheme } from "../../constants/settingsOptions";
import { renderPreviewContent } from "../../components/media/renderPreviewContent";
import ProviderBadge from "../../components/ProviderBadge";
import { SELF_AUTHOR_ID } from "../../constants/selfAuthor";
import { useGravatarUrl } from "../../hooks/useGravatarUrl";
import StarToggle from "../../components/StarToggle";
import HoverSlideshow from "../../components/media/HoverSlideshow";
import { useHoverSlideshowEnabled } from "../../hooks/useHoverSlideshowEnabled";
import AuthorHoverCard from "../../components/AuthorHoverCard";
import RollingNumber from "../../components/RollingNumber";
import { useFavoriteToggle } from "../../hooks/useFavoriteToggle";
import ModelActionsMenu from "../ModelDetailPage/ModelActionsMenu";
import type { AuthUser } from "../../api/auth";
import { useCardContextMenu } from "../../components/Layout/ConfigurationDialog/AppTiles";

type Props = {
  item: Print;
  theme: ResolvedTheme;
  previewMode: PreviewMode;
  onDeleted?: (id: string) => void;
  onFavoriteChange?: (print: Print) => void;
  onUpdated?: (print: Print) => void;
  onUnauthorized?: () => void;
  /** Only for a real collection; shows "Remove from collection". */
  collectionId?: string;
  onRemovedFromCollection?: (id: string) => void;
  /** Shown as the author of a direct upload, which has none. */
  viewer?: AuthUser | null;
  /** Select mode: a click selects the card instead of opening it, and the hover actions are gone. */
  selectMode?: boolean;
  selected?: boolean;
  /** `range` is a shift-click. */
  onToggleSelect?: (range: boolean) => void;
};

const OVERLAY_BUTTON_SIZE = 30;
const HOVER_ICON_SIZE = 18;
const overlayButtonSx = {
  width: OVERLAY_BUTTON_SIZE,
  height: OVERLAY_BUTTON_SIZE,
  padding: 0,
  borderRadius: "50%",
  bgcolor: "background.paper",
  // Keep the background flat in every interaction state.
  "&:hover, &.Mui-focusVisible, &:active": { bgcolor: "background.paper" },
} as const;

export default function ModelCard({
  item,
  theme,
  previewMode,
  onDeleted,
  onFavoriteChange,
  onUpdated,
  onUnauthorized,
  collectionId,
  onRemovedFromCollection,
  viewer,
  selectMode = false,
  selected = false,
  onToggleSelect,
}: Props) {
  const { t } = useTranslation(["models", "common"]);
  const navigate = useNavigate();
  const muiTheme = useTheme();
  const overlayIconColor = muiTheme.thingport.headingText;
  const {
    isFavorite,
    toggle: toggleFavorite,
    label: favoriteLabel,
  } = useFavoriteToggle(item, {
    onUpdated: onFavoriteChange,
    onUnauthorized,
  });
  const author = item.author;
  const viewerAvatarUrl = useGravatarUrl(viewer?.email, 40);
  // Not clickable: there's no Author id behind this fallback.
  const showViewerAsAuthor =
    !author?.name && !author?.handle && !item.creator && !item.source_provider && Boolean(viewer);
  const authorName =
    author?.name || author?.handle || item.creator || (showViewerAsAuthor ? viewer!.display_name : null);
  const authorAvatarUrl = author?.avatar_url || (showViewerAsAuthor ? viewerAvatarUrl : undefined);
  // Only mounted while hovered, so idle cards don't load images or tick.
  const [hovered, setHovered] = useState(false);
  const [slideshowEnabled] = useHoverSlideshowEnabled();
  const contextMenu = useCardContextMenu();
  const toggleSelect = (event: React.MouseEvent | React.KeyboardEvent) => onToggleSelect?.(event.shiftKey);
  const slideshowImages =
    item.preview_images.length > 1 ? item.preview_images.map((img) => printsApi.fileUrl(img.url)) : [];

  return (
    <Paper
      variant="outlined"
      onClick={selectMode ? toggleSelect : () => navigate(`/models/${item.id}`)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onContextMenu={selectMode ? undefined : contextMenu.onContextMenu}
      {...(selectMode && {
        role: "checkbox",
        "aria-checked": selected,
        "aria-label": item.title || item.name,
        tabIndex: 0,
        onKeyDown: (event: React.KeyboardEvent) => {
          if (event.key !== " " && event.key !== "Enter") return;
          event.preventDefault();
          toggleSelect(event);
        },
      })}
      sx={{
        position: "relative",
        cursor: "pointer",
        overflow: "hidden",
        borderRadius: "12px",
        borderColor: "transparent",
        bgcolor: muiTheme.palette.mode === "dark" ? muiTheme.thingport.pageBackground : muiTheme.palette.grey[100],
        // An outline, so selecting doesn't shift the card's contents the way a thicker border would.
        outline: "2px solid",
        outlineColor: selected ? muiTheme.palette.primary.main : "transparent",
        outlineOffset: -2,
        transition: "background-color .15s ease, box-shadow .15s ease, transform .15s ease, outline-color .15s ease",
        // Shift-clicking a range would otherwise also select the text between.
        ...(selectMode && { userSelect: "none" }),
        "&:focus-visible": { outlineColor: muiTheme.palette.primary.main },
        ...(!selectMode && {
          "&:hover": {
            bgcolor: "background.paper",
            boxShadow: 6,
            borderColor: "divider",
            transform: "translateY(-2px)",
          },
          "&:hover .model-card-actions": { opacity: 1 },
        }),
        "@media (prefers-reduced-motion: reduce)": { transition: "none" },
      }}
    >
      {/* zIndex 0 makes this its own stacking context, so the slideshow's layered slides stay
          under the provider badge and hover actions rendered after it. Selected, it shrinks
          inside the outline, so the selection reads at a glance across the grid. */}
      <Box
        sx={{
          position: "relative",
          zIndex: 0,
          width: "100%",
          aspectRatio: "4 / 3",
          overflow: "hidden",
          transformOrigin: "center",
          transform: selected ? "scale(0.92)" : "none",
          borderRadius: selected ? "8px" : 0,
          transition: "transform .2s ease, border-radius .2s ease",
          "@media (prefers-reduced-motion: reduce)": { transition: "none" },
        }}
      >
        {renderPreviewContent(item, "card", theme, t, previewMode)}
        {hovered && slideshowEnabled && !selectMode && slideshowImages.length > 0 && (
          <HoverSlideshow images={slideshowImages} alt={item.title || item.name} />
        )}
      </Box>

      <ProviderBadge
        provider={item.source_provider}
        interactive={!selectMode}
        sx={{ position: "absolute", top: 8, left: 8 }}
      />

      {selectMode && <SelectionCheck selected={selected} />}

      {!selectMode && (
        <Stack
          className="model-card-actions"
          direction="row"
          spacing={0.5}
          onClick={(e) => e.stopPropagation()}
          sx={{
            position: "absolute",
            top: 8,
            right: 8,
            opacity: 0,
            transition: "opacity .15s ease",
          }}
        >
          <Tooltip title={favoriteLabel}>
            <Box>
              <StarToggle
                active={isFavorite}
                onClick={toggleFavorite}
                ariaLabel={favoriteLabel}
                inactiveColor={overlayIconColor}
                size={HOVER_ICON_SIZE}
                sx={overlayButtonSx}
              />
            </Box>
          </Tooltip>
          <ModelActionsMenu
            print={item}
            onUnauthorized={onUnauthorized}
            onDeleted={() => onDeleted?.(item.id)}
            onUpdated={onUpdated}
            collectionId={collectionId}
            onRemovedFromCollection={() => onRemovedFromCollection?.(item.id)}
            triggerSx={{ color: overlayIconColor, ...overlayButtonSx }}
            iconFontSize={HOVER_ICON_SIZE}
            viewer={viewer}
            contextMenuAt={contextMenu.at}
            onContextMenuClose={contextMenu.close}
          />
        </Stack>
      )}
      <Box sx={{ px: 1.5, pt: 0.75, pb: 1.5 }}>
        <Typography
          variant="body2"
          fontWeight={600}
          noWrap
          title={item.title || item.name}
          sx={{ color: muiTheme.thingport.headingText }}
        >
          {item.title || item.name}
        </Typography>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 0.75 }}>
          <AuthorHoverCard
            authorId={author ? author.id : SELF_AUTHOR_ID}
            viewer={viewer}
            disabled={selectMode || (!author && !showViewerAsAuthor)}
          >
            <Stack
              direction="row"
              alignItems="center"
              spacing={0.75}
              sx={{
                minWidth: 0,
                color: "#858585",
                ...((author || showViewerAsAuthor) && !selectMode
                  ? { cursor: "pointer", "&:hover": { color: "primary.main" } }
                  : undefined),
              }}
              onClick={(e) => {
                if (selectMode || (!author && !showViewerAsAuthor)) return;
                e.stopPropagation();
                navigate(`/authors/${author ? author.id : SELF_AUTHOR_ID}`);
              }}
            >
              <Avatar
                src={authorAvatarUrl || undefined}
                sx={{ width: 20, height: 20, fontSize: 11, color: "inherit !important" }}
              >
                {(authorName || "?").slice(0, 1).toUpperCase()}
              </Avatar>
              <Typography variant="caption" noWrap sx={{ color: "inherit" }}>
                {authorName || t("models:card.unknownAuthor")}
              </Typography>
            </Stack>
          </AuthorHoverCard>
          <Stack direction="row" spacing={1.5} sx={{ color: "#858585", flexShrink: 0 }}>
            <Stack direction="row" alignItems="center" spacing={0.4}>
              <VisibilityIcon sx={{ fontSize: 14 }} />
              <Typography variant="caption">{item.view_count}</Typography>
            </Stack>
            <Stack direction="row" alignItems="center" spacing={0.4}>
              <PrintIcon sx={{ fontSize: 14 }} />
              <Typography variant="caption">
                <RollingNumber value={item.print_count} />
              </Typography>
            </Stack>
          </Stack>
        </Stack>
      </Box>
    </Paper>
  );
}
