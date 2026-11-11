import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Tooltip from "@mui/material/Tooltip";
import { useTheme, type Theme } from "@mui/material/styles";
import BlockIcon from "@mui/icons-material/Block";
import CheckIcon from "@mui/icons-material/Check";
import PriorityHighIcon from "@mui/icons-material/PriorityHigh";
import type { CollectionSync } from "../api/collections";
import type { ImportProvider } from "../api/settings";
import { hasProviderLogo, ProviderLogo } from "./Layout/ConfigurationDialog/providerLogos";
import { useDisabledProviders } from "../hooks/useProviders";
import { isSourceOff, MAX_SOURCE_LOGOS, sourceAccent, syncHealth, syncsLabel, type SyncHealth } from "./syncSources";

type Props = {
  /** The collection's sources, oldest first. */
  syncs: CollectionSync[];
  size?: number;
  /** Makes the badge a button, e.g. to open the collection's sync configuration. */
  onClick?: () => void;
};

type Ring = string | ((theme: Theme) => string);
const ringColor = (ring: Ring, theme: Theme) => (typeof ring === "function" ? ring(theme) : ring);

// The card's footer, for the gap between overlapping tiles.
const cardBackground = (theme: Theme) =>
  theme.palette.mode === "dark" ? theme.thingport.pageBackground : theme.palette.grey[100];

const paperRing = (theme: Theme) => theme.palette.background.paper;

/** The corner bubble: a tick while every source's site is on, "!" when an admin turned some off, a block when all. */
export function SyncBubble({ health, size, ring = paperRing }: { health: SyncHealth; size: number; ring?: Ring }) {
  return (
    <Box
      aria-hidden
      sx={{
        position: "absolute",
        right: -Math.round(size / 3),
        bottom: -Math.round(size / 3),
        zIndex: MAX_SOURCE_LOGOS + 1,
        display: "grid",
        placeItems: "center",
        width: size,
        height: size,
        borderRadius: "50%",
        bgcolor: health === "off" ? "error.main" : health === "partial" ? "warning.main" : "primary.main",
        color: "#fff",
        boxShadow: (theme) => `0 0 0 ${size < 12 ? 1.5 : 2}px ${ringColor(ring, theme)}`,
      }}
    >
      {health === "off" ? (
        <BlockIcon sx={{ fontSize: Math.round(size * 0.8) }} />
      ) : health === "partial" ? (
        <PriorityHighIcon sx={{ fontSize: Math.round(size * 0.8) }} />
      ) : (
        <CheckIcon sx={{ fontSize: Math.round(size * 0.75) }} />
      )}
    </Box>
  );
}

/** A ring with one segment per source in its provider's colour, grey where an admin turned the site off, and how many
 *  there are in the middle. Stands in for the logos past MAX_SOURCE_LOGOS. Its hole is a disc in `hole`, the colour of
 *  what it sits on, rather than a mask, so in dark mode, square everywhere, the hole turns square with the ring. */
export function SourceRing({
  syncs,
  disabled,
  size,
  countSize,
  hole,
}: {
  syncs: CollectionSync[];
  disabled: ReadonlySet<ImportProvider>;
  size: number;
  countSize: number;
  hole: Ring;
}) {
  const theme = useTheme();
  const step = 360 / syncs.length;
  // A small gap between segments, so neighbours in similar colours stay apart.
  const gap = syncs.length > 6 ? 5 : 8;
  const stops = syncs
    .map((sync, index) => {
      const colour = isSourceOff(sync, disabled)
        ? theme.palette.text.disabled
        : (sourceAccent(sync) ?? theme.palette.text.secondary);
      const from = index * step + gap / 2;
      const to = (index + 1) * step - gap / 2;
      return `transparent ${from - gap / 2}deg ${from}deg, ${colour} ${from}deg ${to}deg, transparent ${to}deg ${to + gap / 2}deg`;
    })
    .join(", ");
  return (
    <Box aria-hidden sx={{ position: "relative", width: size, height: size }}>
      <Box sx={{ position: "absolute", inset: 0, borderRadius: "50%", background: `conic-gradient(${stops})` }} />
      <Box
        sx={{
          position: "absolute",
          inset: Math.max(3, Math.round(size * 0.16)),
          display: "grid",
          placeItems: "center",
          borderRadius: "50%",
          bgcolor: (t) => ringColor(hole, t),
          fontSize: countSize,
          fontWeight: 800,
          lineHeight: 1,
          color: (t) => t.thingport.headingText,
        }}
      >
        {syncs.length}
      </Box>
    </Box>
  );
}

/** What the collection syncs with: its provider's logo, up to three overlapping, or past that a ring of their colours
 *  with how many; and a bubble saying whether all of them are on. */
export default function CollectionSyncBadge({ syncs, size = 30, onClick }: Props) {
  const { t } = useTranslation("models");
  // Still synced, but an admin turned a provider off: nothing comes from that source until it's back on.
  const disabled = useDisabledProviders();
  const health = syncHealth(syncs, disabled);
  const label = syncsLabel(syncs, disabled, t);
  const bubble = <SyncBubble health={health} size={Math.round(size * 0.5)} />;
  const overlap = Math.round(size * 0.3);
  const tile = {
    position: "relative",
    flexShrink: 0,
    display: "grid",
    placeItems: "center",
    width: size,
    height: size,
    borderRadius: "8px",
    border: "1px solid",
    borderColor: "divider",
    bgcolor: "background.paper",
    transition: "border-color 150ms",
  } as const;

  const content =
    syncs.length > MAX_SOURCE_LOGOS ? (
      <Box className="sync-tile" sx={tile}>
        <SourceRing
          syncs={syncs}
          disabled={disabled}
          size={Math.round(size * 0.8)}
          countSize={Math.round(size * 0.37)}
          hole={paperRing}
        />
        {bubble}
      </Box>
    ) : (
      <Box sx={{ position: "relative", display: "flex", flexShrink: 0 }}>
        {syncs.map((sync, index) => {
          const off = isSourceOff(sync, disabled);
          return (
            <Box
              key={sync.id}
              className="sync-tile"
              sx={{
                ...tile,
                ml: index ? `-${overlap}px` : 0,
                // The first in front, as the avatars of the people a collection is shared with are.
                zIndex: syncs.length - index,
                ...(syncs.length > 1 && { boxShadow: (theme: Theme) => `0 0 0 2px ${cardBackground(theme)}` }),
              }}
            >
              {hasProviderLogo(sync.provider) && (
                <Box sx={{ lineHeight: 0, opacity: off ? 0.45 : 1, filter: off ? "grayscale(1)" : "none" }}>
                  <ProviderLogo id={sync.provider} size={Math.round(size * 0.55)} />
                </Box>
              )}
            </Box>
          );
        })}
        {bubble}
      </Box>
    );

  if (!onClick) {
    return (
      // Decorative while all is well: whatever shows it also says what it's synced with.
      <Tooltip title={health === "ok" ? "" : label}>
        <Box aria-hidden={health === "ok"} aria-label={health === "ok" ? undefined : label} sx={{ display: "flex" }}>
          {content}
        </Box>
      </Tooltip>
    );
  }
  return (
    <Tooltip title={label}>
      <ButtonBase
        aria-label={`${label}. ${t("collections.sync.title")}`}
        onClick={(e) => {
          // The card around it opens the collection.
          e.stopPropagation();
          onClick();
        }}
        sx={{
          flexShrink: 0,
          borderRadius: "8px",
          "&:hover .sync-tile": { borderColor: "primary.main" },
          "&.Mui-focusVisible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2 },
        }}
      >
        {content}
      </ButtonBase>
    </Tooltip>
  );
}
