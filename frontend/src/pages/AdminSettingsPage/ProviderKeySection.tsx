import React from "react";
import { useTranslation } from "react-i18next";
import Stack from "@mui/material/Stack";
import Alert from "@mui/material/Alert";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import { UnauthorizedError } from "../../api/client";
import { providersApi } from "../../api/providers";
import { refreshProviders } from "../../hooks/useProviders";
import type { AuthSlot, ProviderId } from "../../providers/_generated";

type Props = {
  provider: ProviderId;
  /** The instance's key: Thingiverse's App Token, MyMiniFactory's API key. */
  auth: AuthSlot;
  configured: boolean;
  onUnauthorized?: () => void;
};

/** A provider's instance key form, in the Providers page's dialog. Write-only: the server only reports whether a key
 *  is set. */
export default function ProviderKeySection({ provider, auth, configured, onUnauthorized }: Props) {
  const { t } = useTranslation("app");
  const k = (key: string) => t(`adminSettings.${provider}.${key}`);
  const [draft, setDraft] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const update = async (key: string | null) => {
    await providersApi.saveConnection(provider, auth.slot, { [auth.fields[0].name]: key });
    await refreshProviders();
  };

  const save = async () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setSaving(true);
    setStatus(null);
    setError(null);
    try {
      await update(trimmed);
      setDraft("");
      setStatus(k("saved"));
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onUnauthorized?.();
      } else {
        setError(err instanceof Error ? err.message : k("failed"));
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
      await update(null);
      setDraft("");
      setStatus(k("cleared"));
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onUnauthorized?.();
      } else {
        setError(err instanceof Error ? err.message : k("failed"));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack spacing={2}>
      <Typography variant="caption" color="text.secondary">
        {k("helpText")}
      </Typography>

      <Alert severity={configured ? "success" : "warning"}>
        {configured ? k("statusConfigured") : k("statusNotConfigured")}
      </Alert>

      <TextField
        label={k("tokenLabel")}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={k("tokenPlaceholder") ?? undefined}
        helperText={configured ? k("tokenHelperConfigured") : undefined}
        disabled={saving}
        fullWidth
        autoComplete="off"
      />

      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
        <Button variant="contained" onClick={save} disabled={saving || !draft.trim()}>
          {saving ? k("saving") : k("save")}
        </Button>
        {configured && (
          <Button variant="outlined" color="error" onClick={clear} disabled={saving}>
            {k("clear")}
          </Button>
        )}
        {saving && <CircularProgress size={14} />}
      </Stack>

      {status && <Alert severity="success">{status}</Alert>}
      {error && <Alert severity="error">{error}</Alert>}
    </Stack>
  );
}
