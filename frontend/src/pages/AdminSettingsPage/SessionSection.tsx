import React from "react";
import { useTranslation } from "react-i18next";
import Stack from "@mui/material/Stack";
import Paper from "@mui/material/Paper";
import Alert from "@mui/material/Alert";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import { UnauthorizedError } from "../../api/client";
import { settingsApi } from "../../api/settings";
import HelpTip from "../../components/HelpTip";
import Segmented from "../../components/controls/Segmented";
import { useToast } from "../../components/ToastProvider";
import SectionHeader from "../../components/SectionHeader";
import { AnimatedTile } from "../../components/storageAnimations/parts";
import HourglassAnimation from "../../components/authAnimations/HourglassAnimation";

type Props = {
  onUnauthorized?: () => void;
};

// Mirrors the backend's bounds.
const MIN_SECONDS = 5 * 60;
const MAX_SECONDS = 365 * 24 * 60 * 60;

type DurationUnit = "minutes" | "hours" | "days" | "weeks" | "months";
const UNIT_SECONDS: Record<DurationUnit, number> = {
  minutes: 60,
  hours: 3600,
  days: 86400,
  weeks: 604800,
  months: 2629800, // a year / 12
};

// How long a browser stays signed in without being used. 0 is off.
const REMEMBER_CHOICES = [0, 7 * 86400, 30 * 86400, 90 * 86400, 365 * 86400];

/** e.g. 90000 -> "1 day". Null under a minute. */
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

/** Only affects tokens issued after saving. */
export default function SessionSection({ onUnauthorized }: Props) {
  const { t } = useTranslation("app");
  const [seconds, setSeconds] = React.useState(43200);
  const [draft, setDraft] = React.useState("43200");
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [remember, setRemember] = React.useState(30 * 86400);
  const [savingRemember, setSavingRemember] = React.useState(false);
  const toast = useToast();

  React.useEffect(() => {
    let active = true;
    setLoading(true);
    void (async () => {
      try {
        const data = await settingsApi.getAuth();
        if (active) {
          setSeconds(data.token_ttl_seconds);
          setDraft(String(data.token_ttl_seconds));
          setRemember(data.remember_session_ttl_seconds);
        }
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

  const parsed = Number.parseInt(draft, 10);
  const isValid = Number.isFinite(parsed) && parsed >= MIN_SECONDS && parsed <= MAX_SECONDS;
  const preview = isValid ? bestFitDuration(parsed) : null;

  const save = async () => {
    if (!isValid || saving) return;
    setSaving(true);
    setStatus(null);
    setError(null);
    try {
      const data = await settingsApi.updateAuth({ token_ttl_seconds: parsed });
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

  const selectRemember = async (next: number) => {
    if (next === remember || savingRemember) return;
    const previous = remember;
    setRemember(next);
    setSavingRemember(true);
    try {
      setRemember((await settingsApi.updateAuth({ remember_session_ttl_seconds: next })).remember_session_ttl_seconds);
    } catch (err) {
      setRemember(previous);
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else toast({ message: t("adminSettings.session.failed"), severity: "error" });
    } finally {
      setSavingRemember(false);
    }
  };

  // A length set through REMEMBER_SESSION_TTL that isn't one of the choices is shown as one.
  const rememberChoices = REMEMBER_CHOICES.includes(remember) ? REMEMBER_CHOICES : [...REMEMBER_CHOICES, remember];
  const rememberLabel = (value: number) => {
    const fit = value > 0 ? bestFitDuration(value) : null;
    return fit
      ? t(`adminSettings.session.units.${fit.unit}`, { count: fit.value })
      : t("adminSettings.session.rememberOff");
  };

  return (
    <Stack spacing={3}>
      <SectionHeader title={t("adminSettings.session.heading")} subtitle={t("adminSettings.session.subtitle")} />
      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Stack direction="row" spacing={2.5} alignItems="flex-start">
          <AnimatedTile>
            <HourglassAnimation size={76} />
          </AnimatedTile>
          <Stack spacing={2} sx={{ flex: 1, minWidth: 0 }}>
            <TextField
              type="number"
              label={
                <>
                  {t("adminSettings.session.tokenTtlLabel")}
                  <HelpTip
                    text={t("adminSettings.session.infoBody")}
                    content={
                      <>
                        <Typography variant="subtitle2" component="div" sx={{ mb: 0.5 }}>
                          {t("adminSettings.session.infoTitle")}
                        </Typography>
                        {t("adminSettings.session.infoBody")}
                      </>
                    }
                  />
                </>
              }
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              error={draft !== "" && !isValid}
              helperText={
                draft !== "" && !isValid
                  ? t("adminSettings.session.invalid")
                  : preview
                    ? t("adminSettings.session.approx", {
                        value: t(`adminSettings.session.units.${preview.unit}`, { count: preview.value }),
                      })
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

            <Stack spacing={0.75} alignItems="flex-start">
              <Typography variant="body2" fontWeight={600}>
                {t("adminSettings.session.rememberLabel")}
                <HelpTip text={t("adminSettings.session.rememberHelp")} />
              </Typography>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <Segmented
                  label={t("adminSettings.session.rememberLabel")}
                  value={String(remember)}
                  onChange={(next) => void selectRemember(Number(next))}
                  disabled={loading || savingRemember}
                  options={rememberChoices.map((value) => ({ value: String(value), label: rememberLabel(value) }))}
                />
                {savingRemember && <CircularProgress size={14} />}
              </Stack>
            </Stack>
          </Stack>
        </Stack>
      </Paper>
    </Stack>
  );
}
