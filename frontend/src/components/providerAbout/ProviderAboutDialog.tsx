import React from "react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router-dom";
import { keyframes } from "@emotion/react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import IconButton from "@mui/material/IconButton";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { alpha, useTheme } from "@mui/material/styles";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import ExtensionOutlinedIcon from "@mui/icons-material/ExtensionOutlined";
import MenuBookOutlinedIcon from "@mui/icons-material/MenuBookOutlined";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import RemoveIcon from "@mui/icons-material/Remove";
import { IMPORT_PROVIDER_INFO } from "../../constants/importProviders";
import {
  type Need,
  PROVIDER_FACTS,
  PROVIDER_ORDER,
  providerAccent,
  providerAccentText,
  providerDocsUrl,
} from "../../constants/providerFacts";
import { useDisabledProviders } from "../../hooks/useProviders";
import type { ImportProvider } from "../../api/settings";
import Segmented from "../controls/Segmented";
import HelpTip from "../HelpTip";
import { ProviderLogo, type ProviderId } from "../Layout/ConfigurationDialog/providerLogos";
import ProviderFlowAnimation from "./ProviderFlowAnimation";

type View = "about" | "compare";

const fadeUp = keyframes`
  from { transform: translateY(6px); opacity: 0; }
  to { transform: none; opacity: 1; }
`;
const enter = {
  animation: `${fadeUp} 220ms ease-out both`,
  "@media (prefers-reduced-motion: reduce)": { animation: "none" },
} as const;

const FEATURES = ["profiles", "collections", "likes", "paid"] as const;

type Props = {
  /** The provider shown, or null when closed. */
  provider: ProviderId | null;
  onClose: () => void;
};

/** A provider in short: what it is, what it leans on, what it imports and how to set it up, beside all the others. */
export default function ProviderAboutDialog({ provider, onClose }: Props) {
  const { t } = useTranslation(["app", "common"]);
  const theme = useTheme();
  const [id, setId] = React.useState<ProviderId>(provider ?? "makerworld");
  const [view, setView] = React.useState<View>("about");

  // Kept while closing, so the dialog doesn't change during the fade.
  React.useEffect(() => {
    if (provider) {
      setId(provider);
      setView("about");
    }
  }, [provider]);

  const name = IMPORT_PROVIDER_INFO[id].label;
  const accent = providerAccent(id, theme);
  const host = new URL(PROVIDER_FACTS[id].site).hostname.replace(/^www\./, "");

  return (
    <Dialog
      open={Boolean(provider)}
      onClose={onClose}
      fullWidth
      maxWidth={view === "compare" ? "md" : "sm"}
      aria-labelledby="provider-about-title"
      slotProps={{ paper: { sx: { overflow: "hidden" } } }}
    >
      <Box
        key={id}
        sx={{
          position: "relative",
          flexShrink: 0,
          px: 3,
          pt: 2.5,
          pb: 2,
          background: `linear-gradient(160deg, ${alpha(accent, 0.2)} 0%, ${alpha(accent, 0.03)} 70%)`,
          borderBottom: `1px solid ${alpha(accent, 0.25)}`,
        }}
      >
        <IconButton
          aria-label={t("common:close")}
          onClick={onClose}
          size="small"
          sx={{ position: "absolute", right: 12, top: 12 }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ pr: 5, mb: 2 }}>
          <Box
            sx={{
              width: 40,
              height: 40,
              flexShrink: 0,
              borderRadius: "11px",
              display: "grid",
              placeItems: "center",
              bgcolor: "#ffffff",
              boxShadow: `inset 0 0 0 1px rgba(0, 0, 0, 0.08), 0 2px 8px ${alpha(accent, 0.3)}`,
            }}
          >
            <ProviderLogo id={id} size={24} />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography
              id="provider-about-title"
              variant="h6"
              fontWeight={700}
              sx={{ lineHeight: 1.2, color: (muiTheme) => muiTheme.thingport.headingText }}
            >
              {name}
            </Typography>
            <Link
              href={PROVIDER_FACTS[id].site}
              target="_blank"
              rel="noopener"
              variant="caption"
              underline="hover"
              sx={{ color: "text.secondary", display: "inline-flex", alignItems: "center", gap: 0.5 }}
            >
              {host}
              <OpenInNewIcon sx={{ fontSize: 12 }} />
            </Link>
          </Box>
        </Stack>
        <ProviderFlowAnimation id={id} name={name} accent={accent} textAccent={providerAccentText(id, theme)} />
      </Box>

      <Box sx={{ px: 3, pt: 2, pb: 3, overflowY: "auto", flex: "1 1 auto", minHeight: 0 }}>
        <Box sx={{ mb: 2 }}>
          <Segmented<View>
            value={view}
            onChange={setView}
            label={t("providerAbout.tabsLabel")}
            options={[
              { value: "about", label: t("providerAbout.tabs.about") },
              { value: "compare", label: t("providerAbout.tabs.compare") },
            ]}
          />
        </Box>
        {view === "about" ? (
          <AboutView key={id} id={id} accent={providerAccentText(id, theme)} onClose={onClose} />
        ) : (
          <CompareView
            current={id}
            onPick={(next) => {
              setId(next);
              setView("about");
            }}
          />
        )}
      </Box>
    </Dialog>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Typography
      variant="overline"
      sx={{ display: "block", color: "text.secondary", fontWeight: 700, lineHeight: 2, mt: 2.5, mb: 0.5 }}
    >
      {children}
    </Typography>
  );
}

function NeedPill({ need, accent }: { need: Need; accent: string }) {
  const { t } = useTranslation("app");
  const strong = need === "required" || need === "recommended";
  return (
    <Box
      component="span"
      sx={{
        display: "inline-block",
        px: 1,
        py: 0.125,
        borderRadius: "999px",
        fontSize: "0.7rem",
        fontWeight: need === "required" ? 700 : 600,
        whiteSpace: "nowrap",
        color: strong ? accent : "text.secondary",
        bgcolor: strong ? alpha(accent, need === "required" ? 0.2 : 0.1) : "action.hover",
        border: 1,
        borderColor: strong ? alpha(accent, 0.4) : "divider",
      }}
    >
      {t(`providerAbout.need.${need}`)}
    </Box>
  );
}

function AboutView({ id, accent, onClose }: { id: ProviderId; accent: string; onClose: () => void }) {
  const { t } = useTranslation("app");
  const facts = PROVIDER_FACTS[id];
  const key = `providers:${id}.about`;
  const setup = t(`${key}.setup`, { returnObjects: true }) as string[];
  const flareNote = t(`${key}.flaresolverr`, { defaultValue: t(`providerAbout.flareNote.${facts.flaresolverr}`) });
  const rows: { label: string; help?: string; pill: React.ReactNode; note: string }[] = [
    {
      label: t("providerAbout.rows.signIn"),
      pill: (
        <Typography variant="body2" fontWeight={600} sx={{ fontSize: "0.8rem" }}>
          {t(`providerAbout.signIn.${facts.signIn}`)}
        </Typography>
      ),
      note: t(`${key}.signIn`),
    },
    {
      label: t("providerAbout.rows.grab"),
      help: t("providerAbout.rowHelp.grab"),
      pill: <NeedPill need={facts.grab} accent={accent} />,
      note: t(`${key}.grab`),
    },
    {
      label: t("providerAbout.rows.flaresolverr"),
      help: t("providerAbout.rowHelp.flaresolverr"),
      pill: <NeedPill need={facts.flaresolverr} accent={accent} />,
      note: flareNote,
    },
  ];
  const features = [
    { key: "models", on: true },
    ...FEATURES.map((feature) => ({ key: feature, on: facts[feature] })),
    { key: "sync", on: true },
  ];

  return (
    <Box sx={enter}>
      <Typography variant="body2" color="text.secondary">
        {t(`${key}.summary`)}
      </Typography>

      <SectionLabel>{t("providerAbout.sections.needs")}</SectionLabel>
      <Box sx={{ border: 1, borderColor: "divider", borderRadius: "12px", overflow: "hidden" }}>
        {rows.map((row) => (
          <Box
            key={row.label}
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "150px 1fr" },
              gap: { xs: 0.5, sm: 1.5 },
              px: 1.75,
              py: 1.25,
              "&:not(:last-of-type)": { borderBottom: 1, borderColor: "divider" },
            }}
          >
            <Typography variant="body2" sx={{ fontWeight: 600, display: "flex", alignItems: "center" }}>
              {row.label}
              {row.help && <HelpTip text={row.help} />}
            </Typography>
            <Box>
              {row.pill}
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                {row.note}
              </Typography>
            </Box>
          </Box>
        ))}
      </Box>

      <SectionLabel>{t("providerAbout.sections.imports")}</SectionLabel>
      <Stack direction="row" flexWrap="wrap" useFlexGap spacing={0.75}>
        {features.map(({ key: feature, on }, index) => (
          <Box
            key={feature}
            sx={{
              display: "inline-flex",
              alignItems: "center",
              gap: 0.5,
              px: 1.25,
              py: 0.375,
              borderRadius: "999px",
              fontSize: "0.75rem",
              fontWeight: 600,
              border: 1,
              borderColor: on ? alpha(accent, 0.4) : "divider",
              bgcolor: on ? alpha(accent, 0.1) : "transparent",
              color: on ? "text.primary" : "text.disabled",
              textDecoration: on ? "none" : "line-through",
              ...enter,
              animationDelay: `${index * 40}ms`,
            }}
          >
            {on ? (
              <CheckIcon sx={{ fontSize: 14, color: accent }} />
            ) : (
              <RemoveIcon sx={{ fontSize: 14 }} aria-label={t("providerAbout.no")} />
            )}
            {t(`providerAbout.features.${feature}`)}
          </Box>
        ))}
      </Stack>

      <SectionLabel>{t("providerAbout.sections.setup")}</SectionLabel>
      <Box component="ol" sx={{ m: 0, p: 0, listStyle: "none", counterReset: "step" }}>
        {setup.map((step) => (
          <Box
            component="li"
            key={step}
            sx={{
              position: "relative",
              pl: 4,
              mb: 1,
              fontSize: "0.8125rem",
              color: "text.secondary",
              counterIncrement: "step",
              "&::before": {
                content: "counter(step)",
                position: "absolute",
                left: 0,
                top: -1,
                width: 22,
                height: 22,
                borderRadius: "50%",
                display: "grid",
                placeItems: "center",
                fontSize: "0.7rem",
                fontWeight: 700,
                color: accent,
                bgcolor: alpha(accent, 0.12),
              },
            }}
          >
            {step}
          </Box>
        ))}
      </Box>

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 2 }}>
        <Button
          size="small"
          variant="outlined"
          startIcon={<MenuBookOutlinedIcon fontSize="small" />}
          href={providerDocsUrl(id)}
          target="_blank"
          rel="noopener"
        >
          {t("providerAbout.guide")}
        </Button>
        {facts.grab !== "none" && (
          <Button
            size="small"
            startIcon={<ExtensionOutlinedIcon fontSize="small" />}
            component={RouterLink}
            to="/downloads"
            onClick={onClose}
          >
            {t("providerAbout.getGrab")}
          </Button>
        )}
      </Stack>
    </Box>
  );
}

function CompareView({ current, onPick }: { current: ProviderId; onPick: (id: ProviderId) => void }) {
  const { t } = useTranslation("app");
  const theme = useTheme();
  const disabled = useDisabledProviders();
  const columns = [
    t("providerAbout.rows.signIn"),
    t("providerAbout.rows.grab"),
    t("providerAbout.rows.flaresolverr"),
    ...FEATURES.map((feature) => t(`providerAbout.features.${feature}`)),
  ];
  const cell = { px: 1, py: 0.75, fontSize: "0.75rem", whiteSpace: "nowrap", textAlign: "center" } as const;
  const tick = (on: boolean, accent: string) =>
    on ? (
      <CheckIcon sx={{ fontSize: 16, color: accent, verticalAlign: "middle" }} aria-label={t("providerAbout.yes")} />
    ) : (
      <RemoveIcon
        sx={{ fontSize: 16, color: "text.disabled", verticalAlign: "middle" }}
        aria-label={t("providerAbout.no")}
      />
    );

  return (
    <Box sx={{ ...enter, overflowX: "auto", border: 1, borderColor: "divider", borderRadius: "12px" }}>
      <Box
        component="table"
        aria-label={t("providerAbout.compareLabel")}
        sx={{ width: "100%", borderCollapse: "collapse", "& th, & td": { borderBottom: 1, borderColor: "divider" } }}
      >
        <thead>
          <tr>
            <Box component="th" sx={cell} />
            {columns.map((column) => (
              <Box
                component="th"
                key={column}
                scope="col"
                sx={{ ...cell, whiteSpace: "normal", fontWeight: 700, color: "text.secondary", lineHeight: 1.25 }}
              >
                {column}
              </Box>
            ))}
          </tr>
        </thead>
        <tbody>
          {PROVIDER_ORDER.map((id, index) => {
            const facts = PROVIDER_FACTS[id];
            const accent = providerAccentText(id, theme);
            const chosen = id === current;
            const off = disabled.has(id as ImportProvider);
            return (
              <Box
                component="tr"
                key={id}
                tabIndex={0}
                onClick={() => onPick(id)}
                onKeyDown={(event: React.KeyboardEvent) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onPick(id);
                  }
                }}
                aria-current={chosen || undefined}
                sx={{
                  cursor: "pointer",
                  opacity: off ? 0.5 : 1,
                  bgcolor: chosen ? alpha(accent, 0.1) : "transparent",
                  transition: "background-color 150ms",
                  "&:hover": { bgcolor: alpha(accent, 0.08) },
                  "&:focus-visible": { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: -2 },
                  "&:last-of-type td, &:last-of-type th": { borderBottom: 0 },
                  ...enter,
                  animationDelay: `${index * 25}ms`,
                }}
              >
                <Box
                  component="th"
                  scope="row"
                  sx={{
                    ...cell,
                    textAlign: "left",
                    boxShadow: chosen ? `inset 3px 0 0 ${accent}` : "none",
                  }}
                >
                  <Stack direction="row" spacing={1} alignItems="center">
                    <ProviderLogo id={id} size={16} />
                    <Typography variant="body2" sx={{ fontSize: "0.78rem", fontWeight: chosen ? 700 : 600 }}>
                      {IMPORT_PROVIDER_INFO[id].label}
                    </Typography>
                    {off && (
                      <Typography variant="caption" color="text.secondary">
                        ({t("providerAbout.off")})
                      </Typography>
                    )}
                  </Stack>
                </Box>
                <Box component="td" sx={cell}>
                  {t(`providerAbout.signIn.${facts.signIn}`)}
                </Box>
                <Box component="td" sx={cell}>
                  <NeedPill need={facts.grab} accent={accent} />
                </Box>
                <Box component="td" sx={cell}>
                  <NeedPill need={facts.flaresolverr} accent={accent} />
                </Box>
                {FEATURES.map((feature) => (
                  <Box component="td" key={feature} sx={cell}>
                    {tick(facts[feature], accent)}
                  </Box>
                ))}
              </Box>
            );
          })}
        </tbody>
      </Box>
    </Box>
  );
}
