import React from "react";
import { useTranslation } from "react-i18next";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import { UnauthorizedError } from "../../api/client";
import { settingsApi } from "../../api/settings";

type Props = {
  onUnauthorized?: () => void;
};

/** Leaving the URL blank turns FlareSolverr off. */
export default function FlaresolverrTab({ onUnauthorized }: Props) {
  const { t } = useTranslation("app");
  const [savedUrl, setSavedUrl] = React.useState<string | null>(null);
  const [url, setUrl] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    void settingsApi
      .getFlaresolverr()
      .then((settings) => {
        if (!active) return;
        setSavedUrl(settings.url);
        setUrl(settings.url ?? "");
      })
      .catch((err: unknown) => {
        if (err instanceof UnauthorizedError) onUnauthorized?.();
        else if (active) setError(t("adminSettings.flaresolverr.loadFailed"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [onUnauthorized, t]);

  const save = async () => {
    setSaving(true);
    setStatus(null);
    setError(null);
    try {
      const next = await settingsApi.updateFlaresolverr(url.trim() || null);
      setSavedUrl(next.url);
      setUrl(next.url ?? "");
      setStatus(next.url ? t("adminSettings.flaresolverr.saved") : t("adminSettings.flaresolverr.cleared"));
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else setError(err instanceof Error ? err.message : t("adminSettings.flaresolverr.failed"));
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setStatus(null);
    setError(null);
    try {
      const result = await settingsApi.testFlaresolverr(url.trim());
      if (result.ok)
        setStatus(
          t("adminSettings.flaresolverr.testSuccess", { version: result.version ?? "", latency: result.latency_ms }),
        );
      else setError(result.error || t("adminSettings.flaresolverr.testFailed"));
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else setError(err instanceof Error ? err.message : t("adminSettings.flaresolverr.testFailed"));
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <Stack alignItems="center" sx={{ py: 4 }}>
        <CircularProgress size={20} />
      </Stack>
    );
  }

  // Saving tests the URL too, so either request locks the whole form.
  const busy = saving || testing;

  return (
    <Stack spacing={3}>
      <Typography variant="caption" color="text.secondary">
        {t("adminSettings.flaresolverr.helpText")}
      </Typography>

      <Alert severity={savedUrl ? "success" : "warning"}>
        {savedUrl
          ? t("adminSettings.flaresolverr.statusConfigured")
          : t("adminSettings.flaresolverr.statusNotConfigured")}
      </Alert>

      <TextField
        label={t("adminSettings.flaresolverr.urlLabel")}
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder={t("adminSettings.flaresolverr.urlPlaceholder") ?? undefined}
        disabled={busy}
        fullWidth
      />

      <Alert severity="info">{t("adminSettings.flaresolverr.trustDisclosure")}</Alert>

      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
        <Button
          variant="contained"
          onClick={() => void save()}
          disabled={busy}
          startIcon={saving ? <CircularProgress size={14} color="inherit" /> : undefined}
        >
          {saving ? t("adminSettings.flaresolverr.saving") : t("adminSettings.flaresolverr.save")}
        </Button>
        <Button
          variant="outlined"
          onClick={() => void test()}
          disabled={busy || !url.trim()}
          startIcon={testing ? <CircularProgress size={14} color="inherit" /> : undefined}
        >
          {testing ? t("adminSettings.flaresolverr.testing") : t("adminSettings.flaresolverr.test")}
        </Button>
      </Stack>

      {status && <Alert severity="success">{status}</Alert>}
      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
    </Stack>
  );
}
