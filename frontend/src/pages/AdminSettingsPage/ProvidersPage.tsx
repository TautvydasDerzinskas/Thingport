import React from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import CloseIcon from "@mui/icons-material/Close";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import { UnauthorizedError } from "../../api/client";
import { type ImportProvider, type ProviderSetting, settingsApi } from "../../api/settings";
import { useConfirm } from "../../components/ConfirmProvider";
import { COMING_SOON_PROVIDERS, ProviderLogo } from "../../components/Layout/ConfigurationDialog/providerLogos";
import SectionHeader from "../../components/SectionHeader";
import { publishProviders } from "../../hooks/useProviders";
import { useProviderAbout } from "../../components/providerAbout/ProviderAboutProvider";
import ProviderKeySection, { type KeyedProvider } from "./ProviderKeySection";
import { MANIFESTS, PROVIDER_IDS } from "../../providers/_generated";

type Props = {
  onUnauthorized?: () => void;
};

const KEYED = new Set<ImportProvider>(["thingiverse", "myminifactory"]);
const isKeyed = (provider: ImportProvider): provider is KeyedProvider => KEYED.has(provider);

/** The sites Thingport imports from and syncs with: each can be turned off for everyone, and the instance keys of
 *  the ones that need one set. */
export default function ProvidersPage({ onUnauthorized }: Props) {
  const { t } = useTranslation(["app", "common"]);
  const confirm = useConfirm();
  const [providers, setProviders] = React.useState<ProviderSetting[] | null>(null);
  const [saving, setSaving] = React.useState<ImportProvider | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [keyOpen, setKeyOpen] = React.useState<KeyedProvider | null>(null);
  const [keySet, setKeySet] = React.useState<Partial<Record<KeyedProvider, boolean>>>({});
  const onKeyConfigured = React.useCallback(
    (configured: boolean) => keyOpen && setKeySet((current) => ({ ...current, [keyOpen]: configured })),
    [keyOpen],
  );

  const fail = React.useCallback(
    (err: unknown) => {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else setError(err instanceof Error ? err.message : String(err));
    },
    [onUnauthorized],
  );

  React.useEffect(() => {
    let active = true;
    settingsApi.getProviders().then(
      (loaded) => active && setProviders(loaded),
      (err: unknown) => active && fail(err),
    );
    settingsApi.getThingiverse().then(
      (data) => active && setKeySet((current) => ({ ...current, thingiverse: data.configured })),
      () => undefined,
    );
    settingsApi.getMyminifactory().then(
      (data) => active && setKeySet((current) => ({ ...current, myminifactory: data.configured })),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [fail]);

  const toggle = async (provider: ImportProvider, enabled: boolean) => {
    if (!enabled) {
      const ok = await confirm({
        title: t("adminSettings.providers.disableTitle", { name: MANIFESTS[provider].name }),
        message: t("adminSettings.providers.disableMessage", { name: MANIFESTS[provider].name }),
        confirmLabel: t("adminSettings.providers.disableConfirm"),
        destructive: true,
      });
      if (!ok) return;
    }
    setSaving(provider);
    setError(null);
    try {
      const updated = await settingsApi.setProviderEnabled(provider, enabled);
      setProviders(updated);
      // Menus open elsewhere in the app hide or show it at once.
      publishProviders(updated);
    } catch (err) {
      fail(err);
    } finally {
      setSaving(null);
    }
  };

  return (
    <Stack spacing={3}>
      <SectionHeader title={t("adminSettings.providers.heading")} subtitle={t("adminSettings.providers.subtitle")} />
      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      <Paper variant="outlined" sx={{ borderRadius: "12px", overflow: "hidden" }}>
        {(providers ?? PROVIDER_IDS.map((id) => ({ id, enabled: true }))).map(({ id, enabled }) => {
          const keySetHere = isKeyed(id) ? keySet[id] : undefined;
          return (
            <Stack
              key={id}
              direction="row"
              spacing={2}
              alignItems="center"
              sx={{ px: 2, py: 1.5, "&:not(:last-of-type)": { borderBottom: 1, borderColor: "divider" } }}
            >
              <AboutButton id={id} name={MANIFESTS[id].name}>
                <Box sx={{ flexShrink: 0, lineHeight: 0, opacity: enabled ? 1 : 0.45 }}>
                  <ProviderLogo id={id} size={32} />
                </Box>
              </AboutButton>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <AboutButton id={id} name={MANIFESTS[id].name} tabIndex={-1}>
                  <Typography variant="body1" fontWeight={600}>
                    {MANIFESTS[id].name}
                  </Typography>
                </AboutButton>
                <Typography variant="body2" color="text.secondary">
                  {t(`adminSettings.providers.descriptions.${id}`)}
                </Typography>
                {isKeyed(id) && keySetHere !== undefined && (
                  <Typography variant="caption" color={keySetHere ? "success.main" : "warning.main"}>
                    {t(`adminSettings.providers.keyStatus.${id}.${keySetHere ? "set" : "missing"}`)}
                  </Typography>
                )}
              </Box>
              {isKeyed(id) && (
                <Tooltip title={t(`adminSettings.${id}.heading`)}>
                  <IconButton aria-label={t(`adminSettings.${id}.heading`)} onClick={() => setKeyOpen(id)}>
                    <SettingsOutlinedIcon />
                  </IconButton>
                </Tooltip>
              )}
              {providers ? (
                <Switch
                  checked={enabled}
                  disabled={saving !== null}
                  onChange={(event) => void toggle(id, event.target.checked)}
                  slotProps={{
                    input: {
                      "aria-label": t(enabled ? "adminSettings.providers.turnOff" : "adminSettings.providers.turnOn", {
                        name: MANIFESTS[id].name,
                      }),
                    },
                  }}
                />
              ) : (
                <Skeleton variant="rounded" width={34} height={14} sx={{ mx: 1.5 }} />
              )}
            </Stack>
          );
        })}
        {COMING_SOON_PROVIDERS.map(({ id, name }) => (
          <Stack
            key={id}
            direction="row"
            spacing={2}
            alignItems="center"
            aria-disabled="true"
            sx={{ px: 2, py: 1.5, "&:not(:last-of-type)": { borderBottom: 1, borderColor: "divider" } }}
          >
            <Box sx={{ flexShrink: 0, lineHeight: 0, opacity: 0.45, filter: "grayscale(1)" }}>
              <ProviderLogo id={id} size={32} />
            </Box>
            <Typography variant="body1" fontWeight={600} color="text.disabled" sx={{ flex: 1, minWidth: 0 }}>
              {name}
            </Typography>
            <Chip size="small" variant="outlined" label={t("providers.comingSoon")} sx={{ color: "text.secondary" }} />
          </Stack>
        ))}
      </Paper>

      <Dialog open={Boolean(keyOpen)} onClose={() => setKeyOpen(null)} fullWidth maxWidth="sm">
        <DialogTitle sx={{ pr: 6 }}>
          {keyOpen && t(`adminSettings.${keyOpen}.heading`)}
          <IconButton
            aria-label={t("common:close")}
            onClick={() => setKeyOpen(null)}
            sx={{ position: "absolute", right: 8, top: 8 }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          {keyOpen && (
            <ProviderKeySection
              key={keyOpen}
              provider={keyOpen}
              onUnauthorized={onUnauthorized}
              onConfiguredChange={onKeyConfigured}
            />
          )}
        </DialogContent>
      </Dialog>
    </Stack>
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
