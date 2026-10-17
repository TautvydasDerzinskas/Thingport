import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Paper from "@mui/material/Paper";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Avatar from "@mui/material/Avatar";
import Typography from "@mui/material/Typography";
import Tooltip from "@mui/material/Tooltip";
import { useTheme } from "@mui/material/styles";
import VisibilityIcon from "@mui/icons-material/Visibility";
import PrintIcon from "@mui/icons-material/Print";
import { type Print, printsApi } from "../../api/prints";
import { type PreviewMode } from "../../api/settings";
import { type ResolvedTheme } from "../../constants/settingsOptions";
import { renderPreviewContent } from "../../components/media/renderPreviewContent";
import { printProviderInfo } from "../../constants/importProviders";
import { SELF_AUTHOR_ID } from "../../constants/selfAuthor";
import { useGravatarUrl } from "../../hooks/useGravatarUrl";
import StarToggle from "../../components/StarToggle";
import HoverSlideshow from "../../components/media/HoverSlideshow";
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
  const providerInfo = printProviderInfo(item.source_provider);
  // Only mounted while hovered, so idle cards don't load images or tick.
  const [hovered, setHovered] = useState(false);
  const contextMenu = useCardContextMenu();
  const slideshowImages =
    item.preview_images.length > 1 ? item.preview_images.map((img) => printsApi.fileUrl(img.url)) : [];

  return (
    <Paper
      variant="outlined"
      onClick={() => navigate(`/models/${item.id}`)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onContextMenu={contextMenu.onContextMenu}
      sx={{
        position: "relative",
        cursor: "pointer",
        overflow: "hidden",
        borderRadius: "12px",
        borderColor: "transparent",
        bgcolor: muiTheme.palette.mode === "dark" ? muiTheme.thingport.pageBackground : muiTheme.palette.grey[100],
        transition: "background-color .15s ease, box-shadow .15s ease, transform .15s ease",
        "&:hover": {
          bgcolor: "background.paper",
          boxShadow: 6,
          borderColor: "divider",
          transform: "translateY(-2px)",
        },
        "&:hover .model-card-actions": { opacity: 1 },
      }}
    >
      {/* zIndex 0 makes this its own stacking context, so the slideshow's layered slides stay
          under the provider badge and hover actions rendered after it. */}
      <Box sx={{ position: "relative", zIndex: 0, width: "100%", aspectRatio: "4 / 3" }}>
        {renderPreviewContent(item, "card", theme, t, previewMode)}
        {hovered && slideshowImages.length > 0 && (
          <HoverSlideshow images={slideshowImages} alt={item.title || item.name} />
        )}
      </Box>

      <Tooltip
        title={
          item.source_provider
            ? t("models:card.importedFrom", { provider: providerInfo.label })
            : t("models:card.uploadedDirectly")
        }
      >
        <Box
          sx={{
            position: "absolute",
            top: 8,
            left: 8,
            px: 1,
            py: 0.375,
            borderRadius: 1,
            fontSize: 11,
            fontWeight: 600,
            lineHeight: 1.4,
            color: providerInfo.textColor ?? "#fff",
            bgcolor: providerInfo.color,
          }}
        >
          {providerInfo.label}
        </Box>
      </Tooltip>

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
            disabled={!author && !showViewerAsAuthor}
          >
            <Stack
              direction="row"
              alignItems="center"
              spacing={0.75}
              sx={{
                minWidth: 0,
                color: "#858585",
                ...(author || showViewerAsAuthor ? { cursor: "pointer", "&:hover": { color: "#00b800" } } : undefined),
              }}
              onClick={(e) => {
                if (!author && !showViewerAsAuthor) return;
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
