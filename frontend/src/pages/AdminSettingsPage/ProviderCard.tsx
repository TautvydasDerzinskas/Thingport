import React from "react";
import { useTranslation } from "react-i18next";
import { keyframes } from "@emotion/react";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import ExtensionOutlinedIcon from "@mui/icons-material/ExtensionOutlined";
import FavoriteBorderIcon from "@mui/icons-material/FavoriteBorder";
import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import PersonOutlineIcon from "@mui/icons-material/PersonOutline";
import PrintOutlinedIcon from "@mui/icons-material/PrintOutlined";
import SellOutlinedIcon from "@mui/icons-material/SellOutlined";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import ShieldOutlinedIcon from "@mui/icons-material/ShieldOutlined";
import VpnKeyOutlinedIcon from "@mui/icons-material/VpnKeyOutlined";
import type { ImportProvider } from "../../api/settings";
import HelpTip from "../../components/HelpTip";
import { ProviderLogo } from "../../components/Layout/ConfigurationDialog/providerLogos";
import { useProviderAbout } from "../../components/providerAbout/ProviderAboutProvider";
import SelectionCheck from "../../components/selection/SelectionCheck";
import { MANIFESTS, type ProviderId } from "../../providers/index.generated";
import { FEATURES, type Feature, hasFeature, hasNeed, NEEDS, type NeedKind } from "./providerFilters";

const appear = keyframes`
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: none; }
`;

const FEATURE_CHIPS: Record<Feature, { icon: React.ReactElement; labelKey: string }> = {
  collections: { icon: <FolderOutlinedIcon />, labelKey: "providerAbout.features.collections" },
  likes: { icon: <FavoriteBorderIcon />, labelKey: "providerAbout.features.likes" },
  profiles: { icon: <PrintOutlinedIcon />, labelKey: "adminSettings.providers.chips.profiles" },
  paidModels: { icon: <SellOutlinedIcon />, labelKey: "adminSettings.providers.chips.paid" },
};

const NEED_CHIPS: Record<NeedKind, { icon: React.ReactElement; labelKey: string }> = {
  grabOnly: { icon: <ExtensionOutlinedIcon />, labelKey: "adminSettings.providers.filters.grabOnly" },
  flaresolverr: { icon: <ShieldOutlinedIcon />, labelKey: "providerAbout.rows.flaresolverr" },
};

const chipSx = {
  height: 22,
  borderRadius: "6px",
  fontSize: "0.72rem",
  color: "text.secondary",
  "& .MuiChip-label": { px: 0.75 },
  "& .MuiChip-icon": { fontSize: 14, ml: 0.75, mr: -0.25, color: "inherit" },
} as const;

type Props = {
  id: ImportProvider;
  /** Null until the providers have loaded. */
  enabled: boolean | null;
  busy: boolean;
  /** The provider has a key for the whole instance, which an admin sets here. */
  hasKey: boolean;
  /** Whether that key is set; undefined while it isn't known yet. */
  keySet?: boolean;
  onToggle: (enabled: boolean) => void;
  onOpenKey: () => void;
  selectMode: boolean;
  selected: boolean;
  /** `range` for a shift-click. */
  onToggleSelect: (range: boolean) => void;
};

/** A provider on the admin page: what it brings and needs, its instance key, and its switch. In select mode the card
 *  is a checkbox. */
export default function ProviderCard({
  id,
  enabled,
  busy,
  hasKey,
  keySet,
  onToggle,
  onOpenKey,
  selectMode,
  selected,
  onToggleSelect,
}: Props) {
  const { t } = useTranslation(["app", "providers"]);
  const name = MANIFESTS[id].name;
  const on = enabled ?? true;
  // What it needs is drawn dashed, apart from what it brings.
  const chips: { key: string; icon: React.ReactElement; labelKey: string; dashed: boolean }[] = [
    ...FEATURES.filter((feature) => hasFeature(id, feature)).map((feature) => ({
      key: feature,
      icon: FEATURE_CHIPS[feature].icon,
      labelKey: FEATURE_CHIPS[feature].labelKey,
      dashed: false,
    })),
    ...NEEDS.filter((need) => hasNeed(id, need)).map((need) => ({
      key: need,
      icon: NEED_CHIPS[need].icon,
      labelKey: NEED_CHIPS[need].labelKey,
      dashed: true,
    })),
  ];
  const toggleSelect = (event: React.MouseEvent | React.KeyboardEvent) => onToggleSelect(event.shiftKey);

  return (
    <Paper
      variant="outlined"
      sx={(theme) => ({
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: 1.25,
        p: 1.5,
        pr: 0.5,
        borderRadius: "12px",
        // Off, it steps back: no panel of its own, a dashed edge, the logo greyed.
        bgcolor: on ? "background.paper" : "transparent",
        borderStyle: on ? "solid" : "dashed",
        transition: "border-color 150ms, background-color 150ms, box-shadow 150ms",
        animation: `${appear} 200ms ease-out`,
        ...(selectMode && { userSelect: "none", "&:hover": { borderColor: "text.disabled" } }),
        ...(selected && {
          borderColor: "primary.main",
          boxShadow: `inset 0 0 0 1px ${theme.palette.primary.main}`,
          bgcolor: alpha(theme.palette.primary.main, 0.08),
          "&:hover": { borderColor: "primary.main" },
        }),
        "@media (prefers-reduced-motion: reduce)": { transition: "none", animation: "none" },
      })}
    >
      <Stack direction="row" alignItems="center" spacing={1.5}>
        <AboutButton id={id} name={name}>
          <LogoTile id={id} on={on} />
        </AboutButton>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" alignItems="center" sx={{ minWidth: 0 }}>
            <AboutButton id={id} name={name} tabIndex={-1}>
              <Typography
                variant="body1"
                fontWeight={600}
                noWrap
                sx={{ color: (theme) => (on ? theme.thingport.headingText : theme.palette.text.secondary) }}
              >
                {name}
              </Typography>
            </AboutButton>
            <HelpTip text={t(`providers:${id}.admin.description`)} />
          </Stack>
          <SignInLine id={id} hasKey={hasKey} keySet={keySet} />
        </Box>
        {hasKey && (
          <Tooltip title={t(`providers:${id}.admin.key.heading`)}>
            <IconButton size="small" aria-label={t(`providers:${id}.admin.key.heading`)} onClick={onOpenKey}>
              <SettingsOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        {enabled === null ? (
          <Skeleton variant="rounded" width={34} height={14} sx={{ mx: 1.5 }} />
        ) : (
          <Switch
            checked={enabled}
            disabled={busy}
            onChange={(event) => onToggle(event.target.checked)}
            // In select mode the tick takes its place; hidden rather than removed, so nothing beside it moves.
            sx={{ visibility: selectMode ? "hidden" : "visible" }}
            slotProps={{
              input: {
                "aria-label": t(enabled ? "adminSettings.providers.turnOff" : "adminSettings.providers.turnOn", {
                  name,
                }),
              },
            }}
          />
        )}
      </Stack>
      <Stack direction="row" flexWrap="wrap" gap={0.5} sx={{ pr: 1 }}>
        {chips.length ? (
          chips.map((chip) => (
            <Chip
              key={chip.key}
              size="small"
              variant="outlined"
              icon={chip.icon}
              label={t(chip.labelKey)}
              sx={{ ...chipSx, borderStyle: chip.dashed ? "dashed" : "solid" }}
            />
          ))
        ) : (
          <Typography variant="caption" color="text.secondary" sx={{ lineHeight: "22px" }}>
            {t("adminSettings.providers.chips.modelsOnly")}
          </Typography>
        )}
      </Stack>
      {selectMode && (
        <>
          <SelectionCheck selected={selected} sx={{ top: 18, right: 18 }} />
          <Box
            // The whole card is the checkbox, as the tag tiles are: a native input couldn't show the card's focus ring.
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
            role="checkbox"
            aria-checked={selected}
            aria-label={name}
            tabIndex={0}
            onClick={toggleSelect}
            onKeyDown={(event) => {
              if (event.key !== " " && event.key !== "Enter") return;
              event.preventDefault();
              toggleSelect(event);
            }}
            sx={{
              position: "absolute",
              inset: 0,
              borderRadius: "inherit",
              cursor: "pointer",
              "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2 },
            }}
          />
        </>
      )}
    </Paper>
  );
}

/** A provider that's on the way: shown, but nothing to switch yet. */
export function ComingSoonCard({ id, name }: { id: ProviderId; name: string }) {
  const { t } = useTranslation("app");
  return (
    <Paper
      variant="outlined"
      aria-disabled="true"
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        p: 1.5,
        borderRadius: "12px",
        borderStyle: "dashed",
        bgcolor: "transparent",
      }}
    >
      <LogoTile id={id} on={false} />
      <Typography variant="body1" fontWeight={600} color="text.disabled" noWrap sx={{ flex: 1, minWidth: 0 }}>
        {name}
      </Typography>
      <Chip size="small" variant="outlined" label={t("providers.comingSoon")} sx={{ color: "text.secondary" }} />
    </Paper>
  );
}

/** The logo on a white tile, as Configuration → Providers shows it, so dark logos read in the dark theme too. */
function LogoTile({ id, on }: { id: ProviderId; on: boolean }) {
  return (
    <Box
      sx={{
        width: 36,
        height: 36,
        flexShrink: 0,
        borderRadius: "10px",
        bgcolor: "#ffffff",
        boxShadow: "inset 0 0 0 1px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        filter: on ? "none" : "grayscale(1)",
        opacity: on ? 1 : 0.45,
        transition: "filter 200ms, opacity 200ms",
        "@media (prefers-reduced-motion: reduce)": { transition: "none" },
      }}
    >
      <ProviderLogo id={id} size={24} />
    </Box>
  );
}

/** Who signs in to it, or, where the admin sets a key for everyone, whether that key is there. */
function SignInLine({ id, hasKey, keySet }: { id: ImportProvider; hasKey: boolean; keySet?: boolean }) {
  const { t } = useTranslation(["app", "providers"]);
  if (hasKey && keySet === undefined) return <Skeleton variant="text" width={80} sx={{ fontSize: "0.75rem" }} />;
  const line = (icon: React.ReactNode, color: string, text: string) => (
    <Typography
      variant="caption"
      noWrap
      sx={{ display: "flex", alignItems: "center", gap: 0.5, color, "& svg": { fontSize: 13, flexShrink: 0 } }}
    >
      {icon}
      {text}
    </Typography>
  );
  if (!hasKey)
    return line(
      <PersonOutlineIcon />,
      "text.secondary",
      t(`adminSettings.providers.signInLine.${MANIFESTS[id].signIn}`),
    );
  if (keySet) return line(<VpnKeyOutlinedIcon />, "success.main", t(`providers:${id}.admin.keyStatus.set`));
  return (
    <Tooltip title={t(`providers:${id}.admin.keyStatus.missing`)}>
      {line(<VpnKeyOutlinedIcon />, "warning.main", t("adminSettings.providers.keyMissing"))}
    </Tooltip>
  );
}

/** The logo or name of a provider: opens its About dialog. The name repeats the logo's button, so it's skipped by Tab. */
function AboutButton({
  id,
  name,
  tabIndex,
  children,
}: {
  id: ImportProvider;
  name: string;
  tabIndex?: number;
  children: React.ReactNode;
}) {
  const { t } = useTranslation("app");
  const openAbout = useProviderAbout(id);
  if (!openAbout) return <>{children}</>;
  return (
    <Tooltip title={t("providerAbout.aboutName", { name })}>
      <ButtonBase
        onClick={openAbout}
        tabIndex={tabIndex}
        aria-label={t("providerAbout.aboutName", { name })}
        sx={{
          minWidth: 0,
          maxWidth: "100%",
          borderRadius: "8px",
          textAlign: "left",
          transition: "transform 150ms ease",
          "&:hover": { transform: "translateY(-1px)", "& .MuiTypography-root": { textDecoration: "underline" } },
          "&.Mui-focusVisible": { outline: 2, outlineColor: "primary.main", outlineOffset: 2 },
          "@media (prefers-reduced-motion: reduce)": { transition: "none", "&:hover": { transform: "none" } },
        }}
      >
        {children}
      </ButtonBase>
    </Tooltip>
  );
}
