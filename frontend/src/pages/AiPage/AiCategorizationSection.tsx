import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { UnauthorizedError } from "../../api/client";
import { settingsApi, type AiCategorizationSettings } from "../../api/settings";
import SectionHeader from "../../components/SectionHeader";

type Props = { onUnauthorized?: () => void };
type Draft = Pick<AiCategorizationSettings, "mode" | "threshold" | "on_import" | "send_image" | "thinking">;
const defaults: Draft = { mode: "off", threshold: 0.8, on_import: true, send_image: false, thinking: true };

const pick = (settings: AiCategorizationSettings): Draft => ({
  mode: settings.mode,
  threshold: settings.threshold,
  on_import: settings.on_import,
  send_image: settings.send_image,
  thinking: settings.thinking,
});

export default function AiCategorizationSection({ onUnauthorized }: Props) {
  const { t } = useTranslation("app");
  const [draft, setDraft] = useState<Draft>(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void settingsApi
      .getAiCategorization()
      .then((settings) => {
        if (active) setDraft(pick(settings));
      })
      .catch((err: unknown) => {
        if (err instanceof UnauthorizedError) onUnauthorized?.();
        else if (active) setError(err instanceof Error ? err.message : t("adminSettings.aiCategorization.failed"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [onUnauthorized, t]);

  const update = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const save = async () => {
    setSaving(true);
    setStatus(null);
    setError(null);
    try {
      const saved = await settingsApi.updateAiCategorization({ ...draft, threshold: Number(draft.threshold) });
      setDraft(pick(saved));
      setStatus(t("adminSettings.aiCategorization.saved"));
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else setError(err instanceof Error ? err.message : t("adminSettings.aiCategorization.failed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack spacing={3}>
      <SectionHeader
        title={t("adminSettings.aiCategorization.heading")}
        subtitle={t("adminSettings.aiCategorization.subtitle")}
      />
      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Stack spacing={2}>
          <Alert severity="info">{t("adminSettings.aiCategorization.privacy")}</Alert>
          <FormControl fullWidth>
            <InputLabel id="ai-mode-label">{t("adminSettings.aiCategorization.mode")}</InputLabel>
            <Select
              labelId="ai-mode-label"
              label={t("adminSettings.aiCategorization.mode")}
              value={draft.mode}
              onChange={(event) => update("mode", event.target.value as Draft["mode"])}
              disabled={loading || saving}
            >
              <MenuItem value="off">{t("adminSettings.aiCategorization.off")}</MenuItem>
              <MenuItem value="suggest">{t("adminSettings.aiCategorization.suggest")}</MenuItem>
              <MenuItem value="auto">{t("adminSettings.aiCategorization.auto")}</MenuItem>
            </Select>
          </FormControl>
          <TextField
            type="number"
            label={t("adminSettings.aiCategorization.threshold")}
            value={draft.threshold}
            inputProps={{ min: 0, max: 1, step: 0.05 }}
            onChange={(event) => update("threshold", Number(event.target.value))}
            disabled={loading || saving}
          />
          <FormControlLabel
            control={
              <Switch
                checked={draft.on_import}
                onChange={(event) => update("on_import", event.target.checked)}
                disabled={loading || saving}
              />
            }
            label={t("adminSettings.aiCategorization.onImport")}
          />
          <FormControlLabel
            control={
              <Switch
                checked={draft.send_image}
                onChange={(event) => update("send_image", event.target.checked)}
                disabled={loading || saving}
              />
            }
            label={t("adminSettings.aiCategorization.sendImage")}
          />
          <FormControlLabel
            control={
              <Switch
                checked={draft.thinking}
                onChange={(event) => update("thinking", event.target.checked)}
                disabled={loading || saving}
              />
            }
            label={
              <Box>
                <Typography variant="body2">{t("adminSettings.aiCategorization.thinking")}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {t("adminSettings.aiCategorization.thinkingHint")}
                </Typography>
              </Box>
            }
          />
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
            <Button variant="contained" onClick={() => void save()} disabled={loading || saving}>
              {t("adminSettings.aiCategorization.save")}
            </Button>
            {(saving || loading) && <CircularProgress size={14} />}
          </Stack>
          {status && <Alert severity="success">{status}</Alert>}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </Paper>
    </Stack>
  );
}
