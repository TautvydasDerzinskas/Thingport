import React from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
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
import { ProviderLogo } from "../../components/Layout/ConfigurationDialog/providerLogos";
import SectionHeader from "../../components/SectionHeader";
import { publishProviders } from "../../hooks/useDisabledProviders";
import ThingiverseSection from "./ThingiverseSection";

type Props = {
  onUnauthorized?: () => void;
};

const NAMES: Record<ImportProvider, string> = {
  makerworld: "MakerWorld",
  printables: "Printables",
  thingiverse: "Thingiverse",
};

/** The sites Thingport imports from and syncs with: each can be turned off for everyone, and Thingiverse's token set. */
export default function ProvidersPage({ onUnauthorized }: Props) {
  const { t } = useTranslation(["app", "common"]);
  const confirm = useConfirm();
  const [providers, setProviders] = React.useState<ProviderSetting[] | null>(null);
  const [saving, setSaving] = React.useState<ImportProvider | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [tokenOpen, setTokenOpen] = React.useState(false);
  const [tokenSet, setTokenSet] = React.useState<boolean | null>(null);

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
      (data) => active && setTokenSet(data.configured),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [fail]);

  const toggle = async (provider: ImportProvider, enabled: boolean) => {
    if (!enabled) {
      const ok = await confirm({
        title: t("adminSettings.providers.disableTitle", { name: NAMES[provider] }),
        message: t("adminSettings.providers.disableMessage", { name: NAMES[provider] }),
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
        {(providers ?? (["makerworld", "printables", "thingiverse"] as const).map((id) => ({ id, enabled: true }))).map(
          ({ id, enabled }) => (
            <Stack
              key={id}
              direction="row"
              spacing={2}
              alignItems="center"
              sx={{ px: 2, py: 1.5, "&:not(:last-of-type)": { borderBottom: 1, borderColor: "divider" } }}
            >
              <Box sx={{ flexShrink: 0, lineHeight: 0, opacity: enabled ? 1 : 0.45 }}>
                <ProviderLogo id={id} size={32} />
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body1" fontWeight={600}>
                  {NAMES[id]}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {t(`adminSettings.providers.descriptions.${id}`)}
                </Typography>
                {id === "thingiverse" && tokenSet !== null && (
                  <Typography variant="caption" color={tokenSet ? "success.main" : "warning.main"}>
                    {t(tokenSet ? "adminSettings.providers.tokenSet" : "adminSettings.providers.tokenMissing")}
                  </Typography>
                )}
              </Box>
              {id === "thingiverse" && (
                <Tooltip title={t("adminSettings.providers.tokenSettings")}>
                  <IconButton
                    aria-label={t("adminSettings.providers.tokenSettings")}
                    onClick={() => setTokenOpen(true)}
                  >
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
                        name: NAMES[id],
                      }),
                    },
                  }}
                />
              ) : (
                <Skeleton variant="rounded" width={34} height={14} sx={{ mx: 1.5 }} />
              )}
            </Stack>
          ),
        )}
      </Paper>

      <Dialog open={tokenOpen} onClose={() => setTokenOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle sx={{ pr: 6 }}>
          {t("adminSettings.thingiverse.heading")}
          <IconButton
            aria-label={t("common:close")}
            onClick={() => setTokenOpen(false)}
            sx={{ position: "absolute", right: 8, top: 8 }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          <ThingiverseSection onUnauthorized={onUnauthorized} onConfiguredChange={setTokenSet} />
        </DialogContent>
      </Dialog>
    </Stack>
  );
}
