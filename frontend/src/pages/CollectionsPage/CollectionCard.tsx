import { useTranslation } from "react-i18next";
import { useState } from "react";
import type React from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import type { Theme } from "@mui/material/styles";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import LockIcon from "@mui/icons-material/Lock";
import { type Collection } from "../../api/collections";
import { type PreviewMode } from "../../api/settings";
import { type ResolvedTheme } from "../../constants/settingsOptions";
import { renderPreviewContent } from "../../components/media/renderPreviewContent";
import { collectionDisplayName } from "../../utils/collectionDisplay";
import CollectionActionsMenu from "../CollectionDetailPage/CollectionActionsMenu";
import CollectionSyncBadge from "../../components/CollectionSyncBadge";
import CollectionSyncDialog from "../CollectionDetailPage/CollectionSyncDialog";
import { useCardContextMenu } from "../../components/Layout/ConfigurationDialog/AppTiles";
import SelectionCheck from "../../components/selection/SelectionCheck";

type Props = {
  collection: Collection;
  theme: ResolvedTheme;
  previewMode: PreviewMode;
  onUpdated: (collection: Collection) => void;
  onDeleted: (id: string) => void;
  onUnauthorized?: () => void;
  onBookmarksChanged?: () => void;
  /** Select mode: a click selects the card instead of opening it. Built-in collections sit it out. */
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (range: boolean) => void;
};

const COVER_TILE_LIMIT = 4;

/** Opens that model directly, separate from the card's own click target. */
function CoverTile({
  print,
  theme,
  previewMode,
  overlayCount,
  interactive,
}: {
  print: Collection["cover_items"][number];
  theme: ResolvedTheme;
  previewMode: PreviewMode;
  overlayCount?: number;
  /** Off in select mode, where the click goes to the card. */
  interactive: boolean;
}) {
  const { t } = useTranslation(["models", "common"]);
  const navigate = useNavigate();
  return (
    <Box
      onClick={
        interactive
          ? (e) => {
              e.stopPropagation();
              navigate(`/models/${print.id}`);
            }
          : undefined
      }
      sx={{ position: "relative", width: "100%", height: "100%", cursor: "pointer", overflow: "hidden" }}
    >
      {renderPreviewContent(print, "card", theme, t, previewMode)}
      {Boolean(overlayCount && overlayCount > 0) && (
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            bgcolor: "rgba(0, 0, 0, 0.55)",
          }}
        >
          <Typography variant="subtitle1" fontWeight={700} sx={{ color: "#fff" }}>
            +{overlayCount}
          </Typography>
        </Box>
      )}
    </Box>
  );
}

// Two cards peeking out below so a collection reads as a stack. Back to front.
const STACK_LAYERS = [
  { insetPx: 20, dropPx: 12, opacity: 0.55 },
  { insetPx: 10, dropPx: 6, opacity: 0.8 },
];
const STACK_DEPTH_PX = Math.max(...STACK_LAYERS.map((layer) => layer.dropPx));

const cardBackground = (muiTheme: Theme) =>
  muiTheme.palette.mode === "dark" ? muiTheme.thingport.pageBackground : muiTheme.palette.grey[100];

export default function CollectionCard({
  collection,
  theme,
  previewMode,
  onUpdated,
  onDeleted,
  onUnauthorized,
  onBookmarksChanged,
  selectMode = false,
  selected = false,
  onToggleSelect,
}: Props) {
  const { t } = useTranslation(["models", "common"]);
  const navigate = useNavigate();
  const coverItems = collection.cover_items.slice(0, COVER_TILE_LIMIT);
  const extraCount = collection.item_count > COVER_TILE_LIMIT ? collection.item_count - COVER_TILE_LIMIT : 0;
  const displayName = collectionDisplayName(collection, t);
  // With a single model, go straight to it.
  const soleModelId = collection.item_count === 1 ? coverItems[0]?.id : undefined;
  const openTarget = soleModelId ? `/models/${soleModelId}` : `/models/collections/${collection.id}`;
  const [syncOpen, setSyncOpen] = useState(false);
  const contextMenu = useCardContextMenu();
  const system = Boolean(collection.system_key);
  // Built-in ones can't be merged or deleted, so in select mode they step back and do nothing.
  const sittingOut = selectMode && system;
  const toggleSelect = (event: React.MouseEvent | React.KeyboardEvent) => onToggleSelect?.(event.shiftKey);

  return (
    <Tooltip title={sittingOut ? t("models:collections.selection.builtIn") : ""} followCursor>
      <Box
        sx={{
          position: "relative",
          pb: `${STACK_DEPTH_PX}px`,
          opacity: sittingOut ? 0.45 : 1,
          filter: sittingOut ? "grayscale(1)" : "none",
          transition: "opacity 200ms, filter 200ms",
          "@media (prefers-reduced-motion: reduce)": { transition: "none" },
        }}
      >
        {STACK_LAYERS.map(({ insetPx, dropPx, opacity }) => (
          <Box
            key={dropPx}
            aria-hidden
            sx={{
              position: "absolute",
              top: 0,
              left: insetPx,
              right: insetPx,
              bottom: STACK_DEPTH_PX - dropPx,
              borderRadius: "12px",
              border: "1px solid",
              borderColor: "divider",
              bgcolor: cardBackground,
              opacity,
            }}
          />
        ))}
        <Paper
          variant="outlined"
          // System collections have no menu, so they keep the browser's.
          onContextMenu={system || selectMode ? undefined : contextMenu.onContextMenu}
          {...(selectMode &&
            !system && {
              onClick: toggleSelect,
              role: "checkbox",
              "aria-checked": selected,
              "aria-label": displayName,
              tabIndex: 0,
              onKeyDown: (event: React.KeyboardEvent) => {
                if (event.key !== " " && event.key !== "Enter") return;
                event.preventDefault();
                toggleSelect(event);
              },
            })}
          sx={{
            position: "relative",
            overflow: "hidden",
            borderRadius: "12px",
            borderColor: "divider",
            bgcolor: cardBackground,
            // An outline, so selecting doesn't shift the card's contents the way a thicker border would.
            outline: "2px solid",
            outlineColor: selected ? "primary.main" : "transparent",
            outlineOffset: -2,
            transition: "outline-color .15s ease",
            ...(selectMode && { cursor: "pointer", userSelect: "none" }),
            "&:focus-visible": { outlineColor: "primary.main" },
            ...(!selectMode && { "&:hover .collection-card-actions": { opacity: 1 } }),
            "@media (prefers-reduced-motion: reduce)": { transition: "none" },
          }}
        >
          <Box
            sx={{
              width: "100%",
              aspectRatio: "4 / 3",
              bgcolor: (muiTheme) =>
                muiTheme.palette.mode === "dark" ? muiTheme.thingport.pageBackground : muiTheme.palette.grey[200],
              // Selected, the cover shrinks inside the outline, as a selected model card's does.
              transform: selected ? "scale(0.92)" : "none",
              borderRadius: selected ? "8px" : 0,
              overflow: "hidden",
              transition: "transform .2s ease, border-radius .2s ease",
              "@media (prefers-reduced-motion: reduce)": { transition: "none" },
            }}
          >
            {coverItems.length === 0 && (
              <Stack
                alignItems="center"
                justifyContent="center"
                sx={{ width: "100%", height: "100%", color: "text.disabled" }}
              >
                <Typography variant="caption">{t("models:collections.card.empty")}</Typography>
              </Stack>
            )}
            {coverItems.length === 1 && (
              <CoverTile print={coverItems[0]} theme={theme} previewMode={previewMode} interactive={!selectMode} />
            )}
            {coverItems.length > 1 && (
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, 1fr)",
                  gridTemplateRows: "repeat(2, 1fr)",
                  gap: "2px",
                  width: "100%",
                  height: "100%",
                }}
              >
                {coverItems.map((item, idx) => (
                  <CoverTile
                    key={item.id}
                    print={item}
                    theme={theme}
                    previewMode={previewMode}
                    overlayCount={idx === coverItems.length - 1 ? extraCount : undefined}
                    interactive={!selectMode}
                  />
                ))}
              </Box>
            )}
          </Box>

          {selectMode && !system && <SelectionCheck selected={selected} />}

          {!system && !selectMode && (
            <Box
              className="collection-card-actions"
              onClick={(e) => e.stopPropagation()}
              sx={{
                position: "absolute",
                top: 8,
                right: 8,
                opacity: 0,
                transition: "opacity .15s ease",
                bgcolor: "rgba(0, 0, 0, 0.55)",
                borderRadius: "50%",
              }}
            >
              <CollectionActionsMenu
                collection={collection}
                onUpdated={onUpdated}
                onDeleted={() => onDeleted(collection.id)}
                onUnauthorized={onUnauthorized}
                onBookmarksChanged={onBookmarksChanged}
                triggerSx={{ color: "#fff" }}
                contextMenuAt={contextMenu.at}
                onContextMenuClose={contextMenu.close}
              />
            </Box>
          )}

          <Box
            onClick={selectMode ? undefined : () => navigate(openTarget)}
            sx={{
              p: 1.5,
              cursor: "pointer",
              transition: "background-color .15s ease",
              ...(!selectMode && { "&:hover": { bgcolor: "background.paper" } }),
            }}
          >
            <Stack direction="row" alignItems="center" spacing={1}>
              <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                <Stack direction="row" alignItems="center" spacing={0.5} minWidth={0}>
                  {collection.system_key && <LockIcon sx={{ fontSize: 14, color: "text.disabled", flexShrink: 0 }} />}
                  <Typography
                    variant="body2"
                    fontWeight={600}
                    noWrap
                    title={displayName}
                    sx={{ color: (muiTheme) => muiTheme.thingport.headingText }}
                  >
                    {displayName}
                  </Typography>
                </Stack>
                <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mt: 0.5, color: "#858585" }}>
                  <Inventory2OutlinedIcon sx={{ fontSize: 14 }} />
                  <Typography variant="caption">
                    {t("models:collections.card.itemCount", { count: collection.item_count })}
                  </Typography>
                </Stack>
              </Box>
              {collection.sync && (
                <CollectionSyncBadge
                  sync={collection.sync}
                  onClick={selectMode ? undefined : () => setSyncOpen(true)}
                />
              )}
            </Stack>
          </Box>
        </Paper>
        {syncOpen && collection.sync && (
          <CollectionSyncDialog
            collection={{ ...collection, sync: collection.sync }}
            onClose={() => setSyncOpen(false)}
            onUpdated={onUpdated}
            onUnauthorized={onUnauthorized}
          />
        )}
      </Box>
    </Tooltip>
  );
}
