import React from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { UnauthorizedError } from "../../api/client";
import { settingsApi } from "../../api/settings";
import AddressBarAnimation from "../../components/authAnimations/AddressBarAnimation";
import SectionHeader from "../../components/SectionHeader";
import { AnimatedTile } from "../../components/storageAnimations/parts";

type Props = {
  /** After a save, with what's saved now (null when cleared). */
  onSaved?: (publicUrl: string | null) => void;
  onUnauthorized?: () => void;
};

const normalize = (value: string) => value.trim().replace(/\/+$/, "");

function looksValid(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.search && !url.hash;
  } catch {
    return false;
  }
}

/** Where people open Thingport. Seeded from PUBLIC_URL on the first run, then kept here. */
export default function PublicUrlSection({ onSaved, onUnauthorized }: Props) {
  const { t } = useTranslation("app");
  const [saved, setSaved] = React.useState<string | null | undefined>(undefined);
  const [draft, setDraft] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    settingsApi.getPublicUrl().then(
      (data) => {
        if (!active) return;
        setSaved(data.public_url);
        setDraft(data.public_url ?? "");
      },
      (err: unknown) => {
        if (err instanceof UnauthorizedError) onUnauthorized?.();
        else if (active) setSaved(null);
      },
    );
    return () => {
      active = false;
    };
  }, [onUnauthorized]);

  const next = normalize(draft);
  const valid = looksValid(next);
  const changed = saved !== undefined && next !== (saved ?? "");
  // Empty is "not set yet", not something to save: the hint says so, without calling it an error.
  const showInvalid = Boolean(next) && !valid;

  const save = async () => {
    setSaving(true);
    setStatus(null);
    setError(null);
    try {
      const result = await settingsApi.updatePublicUrl(next);
      setSaved(result.public_url);
      setDraft(result.public_url ?? "");
      setStatus(t("adminSettings.publicUrl.saved"));
      onSaved?.(result.public_url);
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else setError(err instanceof Error ? err.message : t("adminSettings.publicUrl.failed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack spacing={3}>
      <SectionHeader title={t("adminSettings.publicUrl.heading")} subtitle={t("adminSettings.publicUrl.subtitle")} />
      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Stack direction="row" spacing={2.5} alignItems="flex-start">
          <AnimatedTile>
            <AddressBarAnimation size={76} />
          </AnimatedTile>
          <Stack spacing={2} sx={{ flex: 1, minWidth: 0 }}>
            <TextField
              type="url"
              label={t("adminSettings.publicUrl.label")}
              placeholder="https://thingport.example.com"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              error={showInvalid}
              helperText={
                showInvalid
                  ? t("adminSettings.publicUrl.invalid")
                  : !next
                    ? t("adminSettings.publicUrl.notSet")
                    : t("adminSettings.publicUrl.help")
              }
              disabled={saved === undefined || saving}
              sx={{ maxWidth: 520 }}
            />
            <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
              <Button variant="contained" onClick={() => void save()} disabled={!changed || !valid || saving}>
                {saving ? t("adminSettings.publicUrl.saving") : t("adminSettings.publicUrl.save")}
              </Button>
              {saving && <CircularProgress size={14} />}
              {status && (
                <Typography variant="caption" color="text.secondary">
                  {status}
                </Typography>
              )}
            </Stack>
            {error && (
              <Alert severity="error" onClose={() => setError(null)}>
                {error}
              </Alert>
            )}
          </Stack>
        </Stack>
      </Paper>
    </Stack>
  );
}
