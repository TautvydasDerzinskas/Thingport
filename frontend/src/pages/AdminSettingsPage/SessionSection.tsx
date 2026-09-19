import React from "react";
import { useTranslation } from "react-i18next";
import Stack from "@mui/material/Stack";
import Paper from "@mui/material/Paper";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import { UnauthorizedError } from "../../api/client";
import { settingsApi } from "../../api/settings";
import SectionHeader from "../../components/SectionHeader";

type Props = {
  onUnauthorized?: () => void;
};

// Mirrors the backend's own bounds (routes/settings.ts's MIN/MAX_AUTH_TOKEN_TTL_SECONDS) so a
// bad value is rejected client-side before it ever reaches the server.
const MIN_SECONDS = 5 * 60;
const MAX_SECONDS = 365 * 24 * 60 * 60;

type DurationUnit = "minutes" | "hours" | "days" | "weeks" | "months";
const UNIT_SECONDS: Record<DurationUnit, number> = {
  minutes: 60,
  hours: 3600,
  days: 86400,
  weeks: 604800,
  months: 2629800, // 30.44 days, i.e. a year / 12 -- close enough for a rough conversion hint
};

/** Picks the largest unit `totalSeconds` amounts to at least one of, e.g. 90000 -> "1 day", not
 *  "1500 minutes" -- so a large TTL always reads as a plain "X hours/days/weeks/months" instead
 *  of forcing the admin to do that arithmetic themselves. Returns null under a minute, where the
 *  raw seconds the admin already typed are conversion enough. */
function bestFitDuration(totalSeconds: number): { unit: DurationUnit; value: number } | null {
  const units: DurationUnit[] = ["months", "weeks", "days", "hours", "minutes"];
  for (const unit of units) {
    const size = UNIT_SECONDS[unit];
    if (totalSeconds >= size) {
      return { unit, value: Math.round((totalSeconds / size) * 10) / 10 };
    }
  }
  return null;
}

/** Instance-wide: how long a freshly issued sign-in token stays valid before that user has to
 *  log in again (see backend's auth.ts issueToken and getAuthTokenTtl) -- admin-configured like
 *  Storage Structure and Model Previews above it. Seeded from the AUTH_TOKEN_TTL env var the
 *  first time this is ever read on a fresh instance; once saved here, the DB value takes over
 *  for good. Only affects tokens issued after saving -- anyone already signed in keeps whatever
 *  length was active at their own login. */
export default function SessionSection({ onUnauthorized }: Props) {
  const { t } = useTranslation("app");
  const [seconds, setSeconds] = React.useState(43200);
  const [draft, setDraft] = React.useState("43200");
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    setLoading(true);
    void (async () => {
      try {
        const data = await settingsApi.getAuth();
        if (active) {
          setSeconds(data.token_ttl_seconds);
          setDraft(String(data.token_ttl_seconds));
        }
      } catch (err) {
        if (err instanceof UnauthorizedError) onUnauthorized?.();
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [onUnauthorized]);

  const parsed = Number.parseInt(draft, 10);
  const isValid = Number.isFinite(parsed) && parsed >= MIN_SECONDS && parsed <= MAX_SECONDS;
  const preview = isValid ? bestFitDuration(parsed) : null;

  const save = async () => {
    if (!isValid || saving) return;
    setSaving(true);
    setStatus(null);
    setError(null);
    try {
      const data = await settingsApi.updateAuth(parsed);
      setSeconds(data.token_ttl_seconds);
      setDraft(String(data.token_ttl_seconds));
      setStatus(t("adminSettings.session.saved"));
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onUnauthorized?.();
      } else {
        setError(err instanceof Error ? err.message : t("adminSettings.session.failed"));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack spacing={3}>
      <SectionHeader
        title={t("adminSettings.session.heading")}
        subtitle={t("adminSettings.session.subtitle")}
      />
      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Stack spacing={2}>
          <Alert severity="info">
            <AlertTitle>{t("adminSettings.session.infoTitle")}</AlertTitle>
            {t("adminSettings.session.infoBody")}
          </Alert>

          <TextField
            type="number"
            label={t("adminSettings.session.tokenTtlLabel")}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            error={draft !== "" && !isValid}
            helperText={
              draft !== "" && !isValid
                ? t("adminSettings.session.invalid")
                : preview
                  ? t("adminSettings.session.approx", { value: t(`adminSettings.session.units.${preview.unit}`, { count: preview.value }) })
                  : t("adminSettings.session.tokenTtlHelp")
            }
            disabled={loading || saving}
            slotProps={{ htmlInput: { min: MIN_SECONDS, max: MAX_SECONDS } }}
            sx={{ maxWidth: 320 }}
          />

          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
            <Button variant="contained" onClick={save} disabled={loading || saving || !isValid || parsed === seconds}>
              {saving ? t("adminSettings.session.saving") : t("adminSettings.session.save")}
            </Button>
            {saving && <CircularProgress size={14} />}
            {status && <Typography variant="caption" color="text.secondary">{status}</Typography>}
          </Stack>

          {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
        </Stack>
      </Paper>
    </Stack>
  );
}
