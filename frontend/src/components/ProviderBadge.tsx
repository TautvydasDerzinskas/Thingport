import type { KeyboardEvent, MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import { useTheme, type SxProps, type Theme } from "@mui/material/styles";
import { useBrandMark } from "../hooks/useBrandLogo";
import { printProviderInfo, providerChipSx } from "../constants/importProviders";
import { hasProviderLogo, ProviderLogo } from "./Layout/ConfigurationDialog/providerLogos";
import { useProviderAbout } from "./providerAbout/ProviderAboutProvider";

// Read by screen readers, not shown.
const visuallyHidden = {
  position: "absolute",
  width: "1px",
  height: "1px",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
} as const;

type Props = {
  /** The model's source provider; null for a direct upload, shown with Thingport's own mark. */
  provider: string | null | undefined;
  /** The badge's width and height, in px. */
  size?: number;
  /** Off while the card it sits on is a selectable checkbox: no tab stop, and clicks reach the card. */
  interactive?: boolean;
  sx?: SxProps<Theme>;
};

/** Where a model came from, as the provider's logo on a round badge; its chip shows on hover or focus. A click opens
 *  the provider's About dialog; a direct upload's Thingport badge has none. */
export default function ProviderBadge({ provider, size = 28, interactive = true, sx }: Props) {
  const { t } = useTranslation(["models", "app"]);
  const theme = useTheme();
  const markSrc = useBrandMark();
  const about = useProviderAbout(provider);
  const openAbout = interactive ? about : undefined;
  const info = printProviderInfo(provider);
  const label = provider ? t("card.importedFrom", { provider: info.label }) : t("card.uploadedDirectly");
  const logoSize = Math.round(size * 0.6);
  return (
    <Tooltip
      title={
        <Box
          sx={{
            px: 1,
            py: 0.375,
            borderRadius: 1,
            fontSize: 11,
            fontWeight: 600,
            lineHeight: 1.4,
            ...providerChipSx(info),
          }}
        >
          {info.label}
        </Box>
      }
      // The chip is the whole tooltip, so the tooltip's own box stays out of sight.
      slotProps={{ tooltip: { sx: { bgcolor: "transparent", p: 0, boxShadow: 3, borderRadius: 1 } } }}
    >
      <Box
        tabIndex={interactive ? 0 : undefined}
        {...(openAbout && {
          role: "button",
          "aria-label": `${label}. ${t("app:providerAbout.aboutName", { name: info.label })}`,
          onClick: (event: MouseEvent) => {
            // The badge sits on a card that opens the model.
            event.stopPropagation();
            openAbout();
          },
          onKeyDown: (event: KeyboardEvent) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            event.stopPropagation();
            openAbout();
          },
        })}
        sx={[
          {
            width: size,
            height: size,
            display: "grid",
            placeItems: "center",
            borderRadius: "50%",
            bgcolor: "background.paper",
            color: "text.primary",
            border: 1,
            borderColor: "divider",
            boxShadow: 2,
            cursor: openAbout ? "pointer" : "default",
            ...(!interactive && { pointerEvents: "none" }),
            transition: "transform 150ms ease",
            "&:hover, &:focus-visible": { transform: "scale(1.08)" },
            "&:focus-visible": { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 2 },
            "@media (prefers-reduced-motion: reduce)": {
              transition: "none",
              "&:hover, &:focus-visible": { transform: "none" },
            },
          },
          ...(Array.isArray(sx) ? sx : [sx]),
        ]}
      >
        {!openAbout && (
          <Box component="span" sx={visuallyHidden}>
            {label}
          </Box>
        )}
        {hasProviderLogo(provider) ? (
          <ProviderLogo id={provider} size={logoSize} />
        ) : (
          <Box
            component="img"
            src={markSrc}
            alt=""
            aria-hidden="true"
            sx={{ width: logoSize, height: logoSize, objectFit: "contain", display: "block" }}
          />
        )}
      </Box>
    </Tooltip>
  );
}
