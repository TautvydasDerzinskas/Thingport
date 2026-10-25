import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Skeleton from "@mui/material/Skeleton";
import Typography from "@mui/material/Typography";
import CheckIcon from "@mui/icons-material/Check";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import type { BrowsableProvider, ProviderCollection } from "../../api/providerCollections";
import { parseListUrl } from "../../providers/index.generated";
import { accent, ModelCount, Thumb } from "../../providers/collectionTile";
import { COLLECTION_TILES } from "../../providers/collectionTiles";

type Props = {
  provider: BrowsableProvider;
  collection: ProviderCollection;
  selected: boolean;
  onSelect: () => void;
};

/** Any other provider's: a cover with a strip in its accent, the name and a count below. */
function GenericTile({ provider, collection }: { provider: BrowsableProvider; collection: ProviderCollection }) {
  return (
    <Box
      sx={{
        borderRadius: "12px",
        border: 1,
        borderColor: "divider",
        bgcolor: "background.paper",
        overflow: "hidden",
      }}
    >
      <Thumb src={collection.thumbnails[0]} sx={{ aspectRatio: "4 / 3" }} />
      <Box sx={{ height: 3, bgcolor: accent(provider) }} />
      <Box sx={{ px: 1.25, py: 1 }}>
        <Typography noWrap sx={{ fontWeight: 700, fontSize: "0.875rem" }}>
          {collection.name}
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", fontSize: "0.75rem", color: "text.secondary" }}>
          <ModelCount count={collection.model_count} provider={provider} />
          {collection.private && <LockOutlinedIcon sx={{ fontSize: 14, ml: "auto" }} />}
        </Box>
      </Box>
    </Box>
  );
}

/** The name to show: likes and bookmarks come named in English by the instance. */
function displayName(collection: ProviderCollection, t: (key: string) => string): string {
  const kind = collection.likes ? "likes" : parseListUrl(collection.url)?.kind;
  if (kind === "likes") return t("collections.sync.browse.likes");
  if (kind === "bookmarks") return t("collections.sync.browse.bookmarks");
  return collection.name;
}

/** A provider's collection to pick, drawn in that provider's colours and manner. One already synced
 *  with another Thingport collection can't be picked, and says with which. */
export default function ProviderCollectionTile({ provider, collection: given, selected, onSelect }: Props) {
  const { t } = useTranslation("models");
  const Tile = COLLECTION_TILES[provider]?.Tile;
  const collection = { ...given, name: displayName(given, t) };
  const taken = collection.synced !== null;
  return (
    <Box>
      <ButtonBase
        onClick={onSelect}
        disabled={taken}
        aria-pressed={selected}
        sx={{
          position: "relative",
          display: "block",
          width: "100%",
          textAlign: "left",
          borderRadius: "12px",
          opacity: taken ? 0.5 : 1,
          outline: selected ? `2px solid ${accent(provider)}` : "2px solid transparent",
          outlineOffset: 3,
          transition: "outline-color 150ms, transform 150ms",
          "&:hover": taken ? undefined : { transform: "translateY(-2px)" },
          "&:focus-visible": { outline: `2px solid ${accent(provider)}` },
        }}
      >
        {Tile ? (
          <Tile provider={provider} collection={collection} />
        ) : (
          <GenericTile provider={provider} collection={collection} />
        )}
        {selected && (
          <Box
            sx={{
              position: "absolute",
              top: -6,
              right: -6,
              zIndex: 5,
              width: 22,
              height: 22,
              borderRadius: "50%",
              display: "grid",
              placeItems: "center",
              bgcolor: accent(provider),
              color: "#fff",
              boxShadow: 1,
            }}
          >
            <CheckIcon sx={{ fontSize: 15 }} />
          </Box>
        )}
      </ButtonBase>
      {taken && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
          {t("collections.sync.browse.takenBy", { name: collection.synced!.collection_name })}
        </Typography>
      )}
    </Box>
  );
}

/** A tile's shape while the provider's collections load, in that provider's manner. */
export function ProviderCollectionTileSkeleton({ provider }: { provider: BrowsableProvider }) {
  const lines = (
    <>
      <Skeleton variant="text" sx={{ fontSize: "0.875rem", width: "70%" }} />
      <Skeleton variant="text" sx={{ fontSize: "0.75rem", width: "40%" }} />
    </>
  );
  const Own = COLLECTION_TILES[provider]?.TileSkeleton;
  if (Own) return <Own lines={lines} provider={provider} />;
  return (
    <Box aria-hidden sx={{ borderRadius: "12px", border: 1, borderColor: "divider", overflow: "hidden" }}>
      <Skeleton variant="rectangular" sx={{ width: "100%", height: "auto", aspectRatio: "4 / 3" }} />
      <Box sx={{ px: 1.25, py: 1 }}>{lines}</Box>
    </Box>
  );
}
