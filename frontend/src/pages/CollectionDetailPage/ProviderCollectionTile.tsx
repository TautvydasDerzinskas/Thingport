import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Skeleton from "@mui/material/Skeleton";
import Typography from "@mui/material/Typography";
import type { Theme } from "@mui/material/styles";
import CheckIcon from "@mui/icons-material/Check";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import ViewInArOutlinedIcon from "@mui/icons-material/ViewInArOutlined";
import type { BrowsableProvider, ProviderCollection } from "../../api/providerCollections";
import { MANIFESTS, parseListUrl } from "../../providers/_generated";

// Each provider's own accent, so a tile reads as theirs.
const accent = (provider: BrowsableProvider) => MANIFESTS[provider].brand.accent;

type Props = {
  provider: BrowsableProvider;
  collection: ProviderCollection;
  selected: boolean;
  onSelect: () => void;
};

const sunken = (theme: Theme) => (theme.palette.mode === "dark" ? "rgba(255, 255, 255, 0.06)" : "#f4f4f4");

/** A model image, or an empty slot when the collection has fewer. */
function Thumb({ src, sx }: { src: string | undefined; sx?: object }) {
  const base = { display: "block", width: "100%", bgcolor: sunken, ...sx };
  return src ? (
    <Box component="img" src={src} alt="" loading="lazy" sx={{ ...base, objectFit: "cover" }} />
  ) : (
    <Box sx={base} />
  );
}

function ModelCount({ count, provider }: { count: number; provider: BrowsableProvider }) {
  const { t } = useTranslation("models");
  return <>{t(`collections.sync.browse.${MANIFESTS[provider].modelNoun}`, { count })}</>;
}

/** MakerWorld: a 2x2 mosaic, "+N" over the last tile, the deck edges below. */
function MakerWorldTile({ collection }: { collection: ProviderCollection }) {
  const more = collection.model_count - 4;
  return (
    <Box
      sx={{
        borderRadius: "12px",
        border: 1,
        borderColor: "divider",
        bgcolor: "background.paper",
        overflow: "hidden",
        boxShadow: (theme) =>
          `0 6px 0 -2px ${theme.palette.mode === "dark" ? "#3a3a3a" : "#ebebeb"}, 0 11px 0 -5px ${theme.palette.mode === "dark" ? "#2e2e2e" : "#f2f2f2"}`,
        mb: "11px",
      }}
    >
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gridTemplateRows: "1fr 1fr",
          gap: "2px",
          aspectRatio: "4 / 3",
        }}
      >
        {[0, 1, 2, 3].map((i) => (
          <Box key={i} sx={{ position: "relative", minHeight: 0, overflow: "hidden" }}>
            <Thumb src={collection.thumbnails[i]} sx={{ width: "100%", height: "100%" }} />
            {i === 3 && more > 0 && (
              <Box
                sx={{
                  position: "absolute",
                  inset: 0,
                  display: "grid",
                  placeItems: "center",
                  bgcolor: "rgba(0, 0, 0, 0.45)",
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: "1.25rem",
                }}
              >
                +{more}
              </Box>
            )}
          </Box>
        ))}
      </Box>
      <Box sx={{ px: 1.5, py: 1.25 }}>
        <Typography noWrap sx={{ fontWeight: 700, fontSize: "0.875rem" }}>
          {collection.name}
        </Typography>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            mt: 0.25,
            color: "text.secondary",
            fontSize: "0.75rem",
          }}
        >
          <ViewInArOutlinedIcon sx={{ fontSize: 14 }} />
          <ModelCount count={collection.model_count} provider="makerworld" />
          {collection.private && <LockOutlinedIcon sx={{ fontSize: 14, ml: "auto" }} />}
        </Box>
      </Box>
    </Box>
  );
}

/** Printables: its list row, boxed, with the three square thumbnails along the top. */
function PrintablesTile({ collection }: { collection: ProviderCollection }) {
  return (
    <Box
      sx={{
        borderRadius: "4px",
        border: 1,
        borderColor: "divider",
        borderTop: `3px solid ${accent("printables")}`,
        bgcolor: "background.paper",
        p: 1.25,
      }}
    >
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "4px" }}>
        {[0, 1, 2].map((i) => (
          <Thumb key={i} src={collection.thumbnails[i]} sx={{ aspectRatio: "1 / 1" }} />
        ))}
      </Box>
      <Typography noWrap sx={{ fontWeight: 700, fontSize: "0.875rem", mt: 1 }}>
        {collection.name}
      </Typography>
      <Box sx={{ display: "flex", alignItems: "center", fontSize: "0.8rem", color: "text.secondary" }}>
        <ModelCount count={collection.model_count} provider="printables" />
        {collection.private && <LockOutlinedIcon sx={{ fontSize: 14, ml: "auto" }} />}
      </Box>
    </Box>
  );
}

// Thingiverse's card: rings of lighter blue around the bottom, where the models stack up.
const RINGS = [
  { size: 200, color: "#718BFE" },
  { size: 170, color: "#9DAFFF" },
  { size: 130, color: "#BDC9FF" },
  { size: 80, color: "#EAEEFF" },
];

function ThingiverseTile({ collection }: { collection: ProviderCollection }) {
  const stack = collection.thumbnails.slice(0, 3);
  return (
    <Box
      sx={{
        position: "relative",
        overflow: "hidden",
        borderRadius: "8px",
        bgcolor: accent("thingiverse"),
        aspectRatio: "4 / 3",
        color: "#fff",
        textAlign: "center",
      }}
    >
      {RINGS.map(({ size, color }) => (
        <Box
          key={size}
          sx={{
            position: "absolute",
            left: "50%",
            top: "62%",
            width: `${size}%`,
            aspectRatio: "1.4 / 1",
            transform: "translateX(-50%)",
            borderRadius: "100%",
            bgcolor: color,
          }}
        />
      ))}
      <Box sx={{ position: "relative", px: 1.5, pt: 1.5 }}>
        <Typography noWrap sx={{ fontWeight: 600, fontSize: "1rem", lineHeight: 1.3, color: "#fff" }}>
          {collection.name}
        </Typography>
        <Typography sx={{ fontSize: "0.8rem", color: "#fff" }}>
          <ModelCount count={collection.model_count} provider="thingiverse" />
        </Typography>
      </Box>
      {stack.map((src, i) => (
        // The first model in front, the others peeking out above it.
        <Box
          key={src}
          sx={{
            position: "absolute",
            left: "50%",
            bottom: `${-38 + (stack.length - 1 - i) * 7}%`,
            width: `${78 - (stack.length - 1 - i) * 8}%`,
            transform: "translateX(-50%)",
            zIndex: stack.length - i,
            borderRadius: "8px",
            overflow: "hidden",
            border: "1px solid rgba(255, 255, 255, 0.9)",
            aspectRatio: "4 / 3",
          }}
        >
          <Thumb src={src} sx={{ width: "100%", height: "100%" }} />
        </Box>
      ))}
    </Box>
  );
}

// MyMiniFactory's card: name and count, then the cover model large, then a row of three more.
function MyMiniFactoryTile({ collection }: { collection: ProviderCollection }) {
  const [cover, ...rest] = collection.thumbnails;
  return (
    <Box
      sx={{
        borderRadius: "4px",
        border: 1,
        borderColor: "divider",
        borderBottom: `3px solid ${accent("myminifactory")}`,
        bgcolor: "background.paper",
        p: 1.25,
      }}
    >
      <Typography noWrap sx={{ fontWeight: 700, fontSize: "0.875rem" }}>
        {collection.name}
      </Typography>
      <Box sx={{ display: "flex", alignItems: "center", fontSize: "0.8rem", color: "text.secondary" }}>
        <ModelCount count={collection.model_count} provider="myminifactory" />
        {collection.private && <LockOutlinedIcon sx={{ fontSize: 14, ml: "auto" }} />}
      </Box>
      <Thumb src={cover} sx={{ aspectRatio: "16 / 9", mt: 1, borderRadius: "2px" }} />
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "4px", mt: "4px" }}>
        {[0, 1, 2].map((i) => (
          <Thumb key={i} src={rest[i]} sx={{ aspectRatio: "1 / 1", borderRadius: "2px" }} />
        ))}
      </Box>
    </Box>
  );
}

// Snapmaker Space's model card: the newest model large, a row of three more, then name and count.
function SnapmakerTile({ collection }: { collection: ProviderCollection }) {
  const [cover, ...rest] = collection.thumbnails;
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
      <Thumb src={cover} sx={{ aspectRatio: "4 / 3" }} />
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "2px", mt: "2px" }}>
        {[0, 1, 2].map((i) => (
          <Thumb key={i} src={rest[i]} sx={{ aspectRatio: "1 / 1" }} />
        ))}
      </Box>
      <Box sx={{ px: 1.25, py: 1 }}>
        <Typography noWrap sx={{ fontWeight: 600, fontSize: "0.875rem" }}>
          {collection.name}
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", fontSize: "0.8rem", color: "text.secondary" }}>
          <ModelCount count={collection.model_count} provider="snapmaker" />
          {collection.private && <LockOutlinedIcon sx={{ fontSize: 14, ml: "auto" }} />}
        </Box>
      </Box>
    </Box>
  );
}

// MakerOnline's collection card: four covers in a square grid, then name and count.
function MakeronlineTile({ collection }: { collection: ProviderCollection }) {
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
      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px" }}>
        {[0, 1, 2, 3].map((i) => (
          <Thumb key={i} src={collection.thumbnails[i]} sx={{ aspectRatio: "1 / 1" }} />
        ))}
      </Box>
      <Box sx={{ px: 1.25, py: 1 }}>
        <Typography noWrap sx={{ fontWeight: 600, fontSize: "0.875rem" }}>
          {collection.name}
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", fontSize: "0.8rem", color: "text.secondary" }}>
          <ModelCount count={collection.model_count} provider="makeronline" />
          {collection.private && <LockOutlinedIcon sx={{ fontSize: 14, ml: "auto" }} />}
        </Box>
      </Box>
    </Box>
  );
}

// Creality Cloud's collection card: one large cover beside two stacked ones, under its green.
function CrealitycloudTile({ collection }: { collection: ProviderCollection }) {
  return (
    <Box
      sx={{
        borderRadius: "12px",
        border: 1,
        borderColor: "divider",
        borderTop: `3px solid ${accent("crealitycloud")}`,
        bgcolor: "background.paper",
        overflow: "hidden",
      }}
    >
      <Box sx={{ display: "grid", gridTemplateColumns: "2fr 1fr", gridTemplateRows: "1fr 1fr", gap: "2px" }}>
        <Thumb src={collection.thumbnails[0]} sx={{ gridRow: "span 2", height: "100%", aspectRatio: "1 / 1" }} />
        <Thumb src={collection.thumbnails[1]} sx={{ height: "100%" }} />
        <Thumb src={collection.thumbnails[2]} sx={{ height: "100%" }} />
      </Box>
      <Box sx={{ px: 1.25, py: 1 }}>
        <Typography noWrap sx={{ fontWeight: 600, fontSize: "0.875rem" }}>
          {collection.name}
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", fontSize: "0.8rem", color: "text.secondary" }}>
          <ModelCount count={collection.model_count} provider="crealitycloud" />
          {collection.private && <LockOutlinedIcon sx={{ fontSize: 14, ml: "auto" }} />}
        </Box>
      </Box>
    </Box>
  );
}

// The gradient its title sits on: dark in both themes, so the white text reads over any cover.
const NEXPRINT_SCRIM = "linear-gradient(to top, rgba(0, 0, 0, 0.72), rgba(0, 0, 0, 0) 70%)";

/** NexPrint: one cover, its first model's, with the name over it, edged in its purple. */
function NexprintTile({ collection }: { collection: ProviderCollection }) {
  return (
    <Box
      sx={{
        position: "relative",
        borderRadius: "10px",
        overflow: "hidden",
        borderLeft: `3px solid ${accent("nexprint")}`,
        bgcolor: "background.paper",
      }}
    >
      <Thumb src={collection.thumbnails[0]} sx={{ aspectRatio: "4 / 3" }} />
      <Box
        sx={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          px: 1.25,
          py: 1,
          backgroundImage: NEXPRINT_SCRIM,
          color: "common.white",
        }}
      >
        <Typography noWrap sx={{ fontWeight: 700, fontSize: "0.875rem" }}>
          {collection.name}
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", fontSize: "0.75rem", opacity: 0.85 }}>
          <ModelCount count={collection.model_count} provider="nexprint" />
          {collection.private && <LockOutlinedIcon sx={{ fontSize: 14, ml: "auto" }} />}
        </Box>
      </Box>
    </Box>
  );
}

/** Thangs: its one cover, the count in a pill of its yellow over the corner, the name below. */
function ThangsTile({ collection }: { collection: ProviderCollection }) {
  return (
    <Box
      sx={{
        borderRadius: "8px",
        border: 1,
        borderColor: "divider",
        bgcolor: "background.paper",
        overflow: "hidden",
      }}
    >
      <Box sx={{ position: "relative" }}>
        <Thumb src={collection.thumbnails[0]} sx={{ aspectRatio: "4 / 3" }} />
        <Box
          sx={{
            position: "absolute",
            top: 8,
            left: 8,
            px: 1,
            py: 0.25,
            borderRadius: "999px",
            bgcolor: accent("thangs"),
            // Its yellow is light in both themes.
            color: "common.black",
            fontSize: "0.7rem",
            fontWeight: 700,
          }}
        >
          <ModelCount count={collection.model_count} provider="thangs" />
        </Box>
      </Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 1.25, py: 1 }}>
        <Typography noWrap sx={{ flex: 1, fontWeight: 700, fontSize: "0.875rem" }}>
          {collection.name}
        </Typography>
        {collection.private && <LockOutlinedIcon sx={{ fontSize: 14, color: "text.secondary" }} />}
      </Box>
    </Box>
  );
}

/** Cults3D: a big cover beside two small ones, the name and a count in its purple below. */
function Cults3dTile({ collection }: { collection: ProviderCollection }) {
  return (
    <Box
      sx={{
        borderRadius: "10px",
        border: 1,
        borderColor: "divider",
        bgcolor: "background.paper",
        overflow: "hidden",
      }}
    >
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr",
          gridTemplateRows: "1fr 1fr",
          gap: "2px",
          aspectRatio: "4 / 3",
        }}
      >
        <Box sx={{ gridRow: "1 / 3", minHeight: 0, overflow: "hidden" }}>
          <Thumb src={collection.thumbnails[0]} sx={{ height: "100%" }} />
        </Box>
        {[1, 2].map((i) => (
          <Box key={i} sx={{ minHeight: 0, overflow: "hidden" }}>
            <Thumb src={collection.thumbnails[i]} sx={{ height: "100%" }} />
          </Box>
        ))}
      </Box>
      <Box sx={{ px: 1.25, py: 1 }}>
        <Typography noWrap sx={{ fontWeight: 700, fontSize: "0.875rem" }}>
          {collection.name}
        </Typography>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            mt: 0.25,
            fontSize: "0.75rem",
            fontWeight: 600,
            // Its purple is too dark to read on the dark theme's paper; a lighter shade of it there.
            color: (theme) => (theme.palette.mode === "dark" ? "#B48CFA" : accent("cults3d")),
          }}
        >
          <ModelCount count={collection.model_count} provider="cults3d" />
          {collection.private && <LockOutlinedIcon sx={{ fontSize: 14, ml: "auto", color: "text.secondary" }} />}
        </Box>
      </Box>
    </Box>
  );
}

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

// Drawn in each site's own manner, where one is worth it.
const TILES: Partial<Record<BrowsableProvider, (props: { collection: ProviderCollection }) => JSX.Element>> = {
  makerworld: MakerWorldTile,
  printables: PrintablesTile,
  thingiverse: ThingiverseTile,
  myminifactory: MyMiniFactoryTile,
  snapmaker: SnapmakerTile,
  makeronline: MakeronlineTile,
  crealitycloud: CrealitycloudTile,
  nexprint: NexprintTile,
  thangs: ThangsTile,
  cults3d: Cults3dTile,
};

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
  const Tile = TILES[provider];
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
        {Tile ? <Tile collection={collection} /> : <GenericTile provider={provider} collection={collection} />}
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
  if (provider === "cults3d") {
    return (
      <Box aria-hidden sx={{ borderRadius: "10px", border: 1, borderColor: "divider", overflow: "hidden" }}>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr",
            gridTemplateRows: "1fr 1fr",
            gap: "2px",
            aspectRatio: "4 / 3",
          }}
        >
          <Skeleton variant="rectangular" sx={{ gridRow: "1 / 3", width: "100%", height: "100%" }} />
          <Skeleton variant="rectangular" sx={{ width: "100%", height: "100%" }} />
          <Skeleton variant="rectangular" sx={{ width: "100%", height: "100%" }} />
        </Box>
        <Box sx={{ px: 1.25, py: 1 }}>{lines}</Box>
      </Box>
    );
  }
  if (provider === "makerworld") {
    return (
      <Box aria-hidden sx={{ borderRadius: "12px", border: 1, borderColor: "divider", overflow: "hidden", mb: "11px" }}>
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px", aspectRatio: "4 / 3" }}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} variant="rectangular" sx={{ width: "100%", height: "100%" }} />
          ))}
        </Box>
        <Box sx={{ px: 1.5, py: 1.25 }}>{lines}</Box>
      </Box>
    );
  }
  if (provider === "printables") {
    return (
      <Box
        aria-hidden
        sx={{
          borderRadius: "4px",
          border: 1,
          borderColor: "divider",
          borderTop: `3px solid ${accent("printables")}`,
          p: 1.25,
        }}
      >
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "4px", mb: 1 }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} variant="rectangular" sx={{ width: "100%", height: "auto", aspectRatio: "1 / 1" }} />
          ))}
        </Box>
        {lines}
      </Box>
    );
  }
  if (provider === "makeronline") {
    return (
      <Box aria-hidden sx={{ borderRadius: "12px", border: 1, borderColor: "divider", overflow: "hidden" }}>
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px" }}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} variant="rectangular" sx={{ width: "100%", height: "auto", aspectRatio: "1 / 1" }} />
          ))}
        </Box>
        <Box sx={{ px: 1.25, py: 1 }}>{lines}</Box>
      </Box>
    );
  }
  if (provider === "thangs") {
    return (
      <Box aria-hidden sx={{ borderRadius: "8px", border: 1, borderColor: "divider", overflow: "hidden" }}>
        <Skeleton variant="rectangular" sx={{ width: "100%", height: "auto", aspectRatio: "4 / 3" }} />
        <Box sx={{ px: 1.25, py: 1 }}>
          <Skeleton variant="text" sx={{ fontSize: "0.875rem", width: "70%" }} />
        </Box>
      </Box>
    );
  }
  if (provider === "nexprint") {
    return (
      <Box aria-hidden sx={{ borderRadius: "10px", overflow: "hidden" }}>
        <Skeleton variant="rectangular" sx={{ width: "100%", height: "auto", aspectRatio: "4 / 3" }} />
      </Box>
    );
  }
  if (provider === "crealitycloud") {
    return (
      <Box aria-hidden sx={{ borderRadius: "12px", border: 1, borderColor: "divider", overflow: "hidden" }}>
        <Box sx={{ display: "grid", gridTemplateColumns: "2fr 1fr", gridTemplateRows: "1fr 1fr", gap: "2px" }}>
          <Skeleton
            variant="rectangular"
            sx={{ gridRow: "span 2", width: "100%", height: "100%", aspectRatio: "1 / 1" }}
          />
          <Skeleton variant="rectangular" sx={{ width: "100%", height: "100%" }} />
          <Skeleton variant="rectangular" sx={{ width: "100%", height: "100%" }} />
        </Box>
        <Box sx={{ px: 1.25, py: 1 }}>{lines}</Box>
      </Box>
    );
  }
  if (provider === "snapmaker") {
    return (
      <Box aria-hidden sx={{ borderRadius: "12px", border: 1, borderColor: "divider", overflow: "hidden" }}>
        <Skeleton variant="rectangular" sx={{ width: "100%", height: "auto", aspectRatio: "4 / 3" }} />
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "2px", mt: "2px" }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} variant="rectangular" sx={{ width: "100%", height: "auto", aspectRatio: "1 / 1" }} />
          ))}
        </Box>
        <Box sx={{ px: 1.25, py: 1 }}>{lines}</Box>
      </Box>
    );
  }
  if (provider === "myminifactory") {
    return (
      <Box
        aria-hidden
        sx={{
          borderRadius: "4px",
          border: 1,
          borderColor: "divider",
          borderBottom: `3px solid ${accent("myminifactory")}`,
          p: 1.25,
        }}
      >
        {lines}
        <Skeleton variant="rectangular" sx={{ width: "100%", height: "auto", aspectRatio: "16 / 9", mt: 1 }} />
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "4px", mt: "4px" }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} variant="rectangular" sx={{ width: "100%", height: "auto", aspectRatio: "1 / 1" }} />
          ))}
        </Box>
      </Box>
    );
  }
  if (provider === "thingiverse") {
    return (
      <Box
        aria-hidden
        sx={{
          borderRadius: "8px",
          aspectRatio: "4 / 3",
          bgcolor: accent("thingiverse"),
          opacity: 0.35,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          pt: 1.5,
        }}
      >
        <Skeleton variant="text" sx={{ fontSize: "1rem", width: "60%", bgcolor: "rgba(255, 255, 255, 0.5)" }} />
        <Skeleton variant="text" sx={{ fontSize: "0.8rem", width: "30%", bgcolor: "rgba(255, 255, 255, 0.5)" }} />
      </Box>
    );
  }
  return (
    <Box aria-hidden sx={{ borderRadius: "12px", border: 1, borderColor: "divider", overflow: "hidden" }}>
      <Skeleton variant="rectangular" sx={{ width: "100%", height: "auto", aspectRatio: "4 / 3" }} />
      <Box sx={{ px: 1.25, py: 1 }}>{lines}</Box>
    </Box>
  );
}
