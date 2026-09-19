import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import LockIcon from "@mui/icons-material/Lock";
import { type Collection } from "../../api/collections";
import { type PreviewMode } from "../../api/settings";
import { type ResolvedTheme } from "../../constants/settingsOptions";
import { renderPreviewContent } from "../../components/media/renderPreviewContent";
import { collectionDisplayName } from "../../utils/collectionDisplay";
import CollectionActionsMenu from "../CollectionDetailPage/CollectionActionsMenu";

type Props = {
  collection: Collection;
  theme: ResolvedTheme;
  previewMode: PreviewMode;
  onUpdated: (collection: Collection) => void;
  onDeleted: (id: string) => void;
  onUnauthorized?: () => void;
  onBookmarksChanged?: () => void;
};

const COVER_TILE_LIMIT = 4;

/** One cell of the cover grid (or the single full-bleed cover when there's only one model) --
 *  clicking it goes straight to that model's detail page, independent of the card's own
 *  navigate-to-collection click target on the name bar below. */
function CoverTile({
  print,
  theme,
  previewMode,
  overlayCount,
}: {
  print: Collection["cover_items"][number];
  theme: ResolvedTheme;
  previewMode: PreviewMode;
  overlayCount?: number;
}) {
  const { t } = useTranslation(["models", "common"]);
  const navigate = useNavigate();
  return (
    <Box
      onClick={e => {
        e.stopPropagation();
        navigate(`/models/${print.id}`);
      }}
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

export default function CollectionCard({ collection, theme, previewMode, onUpdated, onDeleted, onUnauthorized, onBookmarksChanged }: Props) {
  const { t } = useTranslation(["models", "common"]);
  const navigate = useNavigate();
  const coverItems = collection.cover_items.slice(0, COVER_TILE_LIMIT);
  const extraCount = collection.item_count > COVER_TILE_LIMIT ? collection.item_count - COVER_TILE_LIMIT : 0;
  const displayName = collectionDisplayName(collection, t);
  // With a single model, opening the collection would just show that one card again -- go
  // straight to the model instead, same as clicking its cover tile above already does.
  const soleModelId = collection.item_count === 1 ? coverItems[0]?.id : undefined;
  const openTarget = soleModelId ? `/models/${soleModelId}` : `/models/collections/${collection.id}`;

  return (
    <Paper
      variant="outlined"
      sx={{
        position: "relative",
        overflow: "hidden",
        borderRadius: "12px",
        borderColor: "divider",
        bgcolor: (muiTheme) => (muiTheme.palette.mode === "dark" ? muiTheme.thingport.pageBackground : muiTheme.palette.grey[100]),
        "&:hover .collection-card-actions": { opacity: 1 },
      }}
    >
      <Box
        sx={{
          width: "100%",
          aspectRatio: "4 / 3",
          bgcolor: (muiTheme) => (muiTheme.palette.mode === "dark" ? muiTheme.thingport.pageBackground : muiTheme.palette.grey[200]),
        }}
      >
        {coverItems.length === 0 && (
          <Stack alignItems="center" justifyContent="center" sx={{ width: "100%", height: "100%", color: "text.disabled" }}>
            <Typography variant="caption">{t("models:collections.card.empty")}</Typography>
          </Stack>
        )}
        {coverItems.length === 1 && (
          <CoverTile print={coverItems[0]} theme={theme} previewMode={previewMode} />
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
              />
            ))}
          </Box>
        )}
      </Box>

      {!collection.system_key && (
        <Box
          className="collection-card-actions"
          onClick={e => e.stopPropagation()}
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
          />
        </Box>
      )}

      <Box
        onClick={() => navigate(openTarget)}
        sx={{
          p: 1.5,
          cursor: "pointer",
          transition: "background-color .15s ease",
          "&:hover": { bgcolor: "background.paper" },
        }}
      >
        <Stack direction="row" alignItems="center" spacing={0.5} minWidth={0}>
          {collection.system_key && (
            <LockIcon sx={{ fontSize: 14, color: "text.disabled", flexShrink: 0 }} />
          )}
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
    </Paper>
  );
}
