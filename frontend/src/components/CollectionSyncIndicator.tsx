import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Tooltip from "@mui/material/Tooltip";
import type { Theme } from "@mui/material/styles";
import type { CollectionSync } from "../api/collections";
import { hasProviderLogo, ProviderLogo } from "./Layout/ConfigurationDialog/providerLogos";
import { useDisabledProviders } from "../hooks/useProviders";
import { SourceRing, SyncBubble } from "./CollectionSyncBadge";
import { isSourceOff, MAX_SOURCE_LOGOS, syncHealth, syncsLabel } from "./syncSources";

const ICON_SIZE = 18;
const DISC_SIZE = 20;
const BUBBLE_SIZE = 10;
// A ring in the page's colour keeps the tick readable over the logos.
const pageRing = (theme: Theme) => theme.palette.background.default;

/** The collection's sources, slim enough for a toolbar row: one provider's logo, up to three overlapping, or past that
 *  a ring of their colours with how many. Opens the collection's sync configuration. */
export default function CollectionSyncIndicator({ syncs, onClick }: { syncs: CollectionSync[]; onClick: () => void }) {
  const { t } = useTranslation("models");
  const disabled = useDisabledProviders();
  const label = syncsLabel(syncs, disabled, t);
  const bubble = <SyncBubble health={syncHealth(syncs, disabled)} size={BUBBLE_SIZE} ring={pageRing} />;
  const dim = (sync: CollectionSync) =>
    isSourceOff(sync, disabled) ? { opacity: 0.45, filter: "grayscale(1)" } : { opacity: 1 };

  let glyph;
  if (syncs.length > MAX_SOURCE_LOGOS) {
    glyph = <SourceRing syncs={syncs} disabled={disabled} size={DISC_SIZE} countSize={9} hole={pageRing} />;
  } else if (syncs.length === 1) {
    glyph = hasProviderLogo(syncs[0].provider) && (
      <Box sx={{ lineHeight: 0, ...dim(syncs[0]) }}>
        <ProviderLogo id={syncs[0].provider} size={ICON_SIZE} />
      </Box>
    );
  } else {
    glyph = (
      <Box sx={{ display: "flex" }}>
        {syncs.map((sync, index) => (
          <Box
            key={sync.id}
            sx={{
              display: "grid",
              placeItems: "center",
              width: DISC_SIZE,
              height: DISC_SIZE,
              ml: index ? "-6px" : 0,
              zIndex: syncs.length - index,
              borderRadius: "50%",
              border: "1px solid",
              borderColor: "divider",
              bgcolor: "background.paper",
              boxShadow: (theme) => `0 0 0 1.5px ${pageRing(theme)}`,
            }}
          >
            {hasProviderLogo(sync.provider) && (
              <Box sx={{ lineHeight: 0, ...dim(sync) }}>
                <ProviderLogo id={sync.provider} size={12} />
              </Box>
            )}
          </Box>
        ))}
      </Box>
    );
  }

  return (
    <Tooltip title={label}>
      <ButtonBase
        aria-label={`${label}. ${t("collections.sync.title")}`}
        onClick={onClick}
        sx={{
          p: 0.5,
          // The padding is only for the hover background: cancelled out, the indicator takes no more
          // room than its icons, so the toolbar row it sits in doesn't grow.
          m: -0.5,
          borderRadius: "6px",
          transition: "background-color 150ms",
          "&:hover": { bgcolor: "action.hover" },
          "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 1 },
        }}
      >
        <Box sx={{ position: "relative", display: "flex", alignItems: "center", minHeight: ICON_SIZE }}>
          {glyph}
          {bubble}
        </Box>
      </ButtonBase>
    </Tooltip>
  );
}
