import React from "react";
import { useTranslation } from "react-i18next";
import Stack from "@mui/material/Stack";
import Alert from "@mui/material/Alert";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import { UnauthorizedError } from "../../api/client";
import { settingsApi } from "../../api/settings";

type Props = {
  onUnauthorized?: () => void;
  /** Whether a token is set, whenever that's learned or changes. */
  onConfiguredChange?: (configured: boolean) => void;
};

/** The Thingiverse token form, in the Providers page's dialog. Instance-wide and write-only: the server only reports
 *  whether a token is set. */
export default function ThingiverseSection({ onUnauthorized, onConfiguredChange }: Props) {
  const { t } = useTranslation("app");
  const [configured, setConfigured] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    setLoading(true);
    void (async () => {
      try {
        const data = await settingsApi.getThingiverse();
        if (active) setConfigured(data.configured);
      } catch (err) {
        if (err instanceof UnauthorizedError) onUnauthorized?.();
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [onUnauthorized]);

  React.useEffect(() => {
    if (!loading) onConfiguredChange?.(configured);
  }, [configured, loading, onConfiguredChange]);

  const save = async () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setSaving(true);
    setStatus(null);
    setError(null);
    try {
      const data = await settingsApi.updateThingiverse(trimmed);
      setConfigured(data.configured);
      setDraft("");
      setStatus(t("adminSettings.thingiverse.saved"));
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onUnauthorized?.();
      } else {
        setError(err instanceof Error ? err.message : t("adminSettings.thingiverse.failed"));
      }
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    setSaving(true);
    setStatus(null);
    setError(null);
    try {
      const data = await settingsApi.updateThingiverse(null);
      setConfigured(data.configured);
      setDraft("");
      setStatus(t("adminSettings.thingiverse.cleared"));
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onUnauthorized?.();
      } else {
        setError(err instanceof Error ? err.message : t("adminSettings.thingiverse.failed"));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack spacing={2}>
      <Typography variant="caption" color="text.secondary">
        {t("adminSettings.thingiverse.helpText")}
      </Typography>

      <Alert severity={configured ? "success" : "warning"}>
        {configured
          ? t("adminSettings.thingiverse.statusConfigured")
          : t("adminSettings.thingiverse.statusNotConfigured")}
      </Alert>

      <TextField
        label={t("adminSettings.thingiverse.tokenLabel")}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={t("adminSettings.thingiverse.tokenPlaceholder") ?? undefined}
        helperText={configured ? t("adminSettings.thingiverse.tokenHelperConfigured") : undefined}
        disabled={loading || saving}
        fullWidth
        autoComplete="off"
      />

      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
        <Button variant="contained" onClick={save} disabled={loading || saving || !draft.trim()}>
          {saving ? t("adminSettings.thingiverse.saving") : t("adminSettings.thingiverse.save")}
        </Button>
        {configured && (
          <Button variant="outlined" color="error" onClick={clear} disabled={loading || saving}>
            {t("adminSettings.thingiverse.clear")}
          </Button>
        )}
        {saving && <CircularProgress size={14} />}
      </Stack>

      {status && <Alert severity="success">{status}</Alert>}
      {error && <Alert severity="error">{error}</Alert>}
    </Stack>
  );
}
