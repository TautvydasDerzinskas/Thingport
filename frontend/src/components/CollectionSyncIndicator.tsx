import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Tooltip from "@mui/material/Tooltip";
import BlockIcon from "@mui/icons-material/Block";
import CheckIcon from "@mui/icons-material/Check";
import type { CollectionSync } from "../api/collections";
import { importProviderInfo } from "../constants/importProviders";
import { ProviderLogo, type ProviderId } from "./Layout/ConfigurationDialog/providerLogos";
import { useDisabledProviders } from "../hooks/useDisabledProviders";
import type { ImportProvider } from "../api/settings";

const ICON_SIZE = 18;
const BUBBLE_SIZE = 10;
const LOGO_PROVIDERS = new Set<string>(["makerworld", "thingiverse", "printables"]);

/** The provider's logo with a small green tick, slim enough for a toolbar row. Opens the
 *  collection's sync configuration. */
export default function CollectionSyncIndicator({ sync, onClick }: { sync: CollectionSync; onClick: () => void }) {
  const { t } = useTranslation("models");
  const provider = importProviderInfo(sync.provider)?.label ?? sync.provider;
  // Still synced, but an admin turned the provider off: nothing comes from it until it's back on.
  const off = useDisabledProviders().has(sync.provider as ImportProvider);
  const synced = sync.likes_of
    ? t("collections.sync.badgeLikes", { user: sync.likes_of, provider })
    : t("collections.sync.badge", { provider });
  const label = off ? `${synced}. ${t("collections.sync.badgeOff", { provider })}` : synced;
  return (
    <Tooltip title={label}>
      <ButtonBase
        aria-label={off ? label : `${label}. ${t("collections.sync.title")}`}
        // With the provider turned off there's nothing to configure, so it only explains.
        onClick={off ? undefined : onClick}
        aria-disabled={off || undefined}
        sx={{
          p: 0.5,
          // The padding is only for the hover background: cancelled out, the indicator takes no more
          // room than its icon, so the toolbar row it sits in doesn't grow.
          m: -0.5,
          borderRadius: "6px",
          transition: "background-color 150ms",
          "&:hover": { bgcolor: off ? "transparent" : "action.hover" },
          cursor: off ? "default" : "pointer",
          "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 1 },
        }}
      >
        <Box sx={{ position: "relative", width: ICON_SIZE, height: ICON_SIZE }}>
          {LOGO_PROVIDERS.has(sync.provider) && (
            <Box sx={{ lineHeight: 0, opacity: off ? 0.45 : 1 }}>
              <ProviderLogo id={sync.provider as ProviderId} size={ICON_SIZE} />
            </Box>
          )}
          <Box
            aria-hidden
            sx={{
              position: "absolute",
              right: -BUBBLE_SIZE / 3,
              bottom: -BUBBLE_SIZE / 3,
              display: "grid",
              placeItems: "center",
              width: BUBBLE_SIZE,
              height: BUBBLE_SIZE,
              borderRadius: "50%",
              bgcolor: off ? "error.main" : "primary.main",
              color: "#fff",
              // A ring in the page's colour keeps the tick readable over the logo.
              boxShadow: (theme) => `0 0 0 1.5px ${theme.palette.background.default}`,
            }}
          >
            {off ? <BlockIcon sx={{ fontSize: 9 }} /> : <CheckIcon sx={{ fontSize: 8 }} />}
          </Box>
        </Box>
      </ButtonBase>
    </Tooltip>
  );
}
