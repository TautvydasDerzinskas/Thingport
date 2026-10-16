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

const LOGO_PROVIDERS = new Set<string>(["makerworld", "thingiverse", "printables"]);

type Props = {
  sync: CollectionSync;
  size?: number;
  /** Makes the badge a button, e.g. to open the collection's sync configuration. */
  onClick?: () => void;
};

/** The provider's logo with a green "connected" bubble. */
export default function CollectionSyncBadge({ sync, size = 30, onClick }: Props) {
  const { t } = useTranslation("models");
  const provider = importProviderInfo(sync.provider)?.label ?? sync.provider;
  // Still synced, but an admin turned the provider off: nothing comes from it until it's back on.
  const off = useDisabledProviders().has(sync.provider as ImportProvider);
  const synced = sync.likes_of
    ? t("collections.sync.badgeLikes", { user: sync.likes_of, provider })
    : t("collections.sync.badge", { provider });
  const label = off ? `${synced}. ${t("collections.sync.badgeOff", { provider })}` : synced;
  const bubble = Math.round(size * 0.5);
  const frame = {
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
  } as const;
  const content = (
    <>
      {LOGO_PROVIDERS.has(sync.provider) && (
        <Box sx={{ lineHeight: 0, opacity: off ? 0.45 : 1 }}>
          <ProviderLogo id={sync.provider as ProviderId} size={Math.round(size * 0.55)} />
        </Box>
      )}
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          right: -Math.round(bubble / 3),
          bottom: -Math.round(bubble / 3),
          display: "grid",
          placeItems: "center",
          width: bubble,
          height: bubble,
          borderRadius: "50%",
          bgcolor: off ? "error.main" : "primary.main",
          color: "#fff",
          boxShadow: (theme) => `0 0 0 2px ${theme.palette.background.paper}`,
        }}
      >
        {off ? (
          <BlockIcon sx={{ fontSize: Math.round(bubble * 0.8) }} />
        ) : (
          <CheckIcon sx={{ fontSize: Math.round(bubble * 0.75) }} />
        )}
      </Box>
    </>
  );

  // With the provider turned off there's nothing to configure, so it only explains.
  if (!onClick || off) {
    return (
      // Decorative here: whatever shows it also says what it's synced with.
      <Tooltip title={off ? label : ""}>
        <Box aria-hidden={!off} aria-label={off ? label : undefined} sx={frame}>
          {content}
        </Box>
      </Tooltip>
    );
  }
  return (
    <Tooltip title={label}>
      <ButtonBase
        aria-label={t("collections.sync.title")}
        onClick={(e) => {
          // The card around it opens the collection.
          e.stopPropagation();
          onClick();
        }}
        sx={{ ...frame, "&:hover": { borderColor: "primary.main" } }}
      >
        {content}
      </ButtonBase>
    </Tooltip>
  );
}
