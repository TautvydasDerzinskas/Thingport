import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import InputAdornment from "@mui/material/InputAdornment";
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
type Draft = Omit<AiCategorizationSettings, "has_api_key" | "base_url" | "model"> & {
  base_url: string;
  model: string;
  api_key: string;
};
const defaults: Draft = {
  mode: "off",
  base_url: "",
  model: "",
  api_key: "",
  threshold: 0.8,
  on_import: true,
  concurrency: 1,
  send_image: false,
  timeout_ms: 60000,
};

export default function AiCategorizationSection({ onUnauthorized }: Props) {
  const { t } = useTranslation("app");
  const [draft, setDraft] = useState<Draft>(defaults);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [clearKey, setClearKey] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void settingsApi
      .getAiCategorization()
      .then((settings) => {
        if (active) {
          setDraft({ ...settings, api_key: "", base_url: settings.base_url ?? "", model: settings.model ?? "" });
          setHasApiKey(settings.has_api_key);
        }
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
      const payload = {
        mode: draft.mode,
        base_url: draft.base_url.trim() || null,
        model: draft.model.trim() || null,
        threshold: Number(draft.threshold),
        on_import: draft.on_import,
        concurrency: Number(draft.concurrency),
        send_image: draft.send_image,
        timeout_ms: Number(draft.timeout_ms),
        ...(clearKey ? { api_key: null } : draft.api_key ? { api_key: draft.api_key } : {}),
      };
      const saved = await settingsApi.updateAiCategorization(payload);
      setDraft((current) => ({
        ...current,
        ...saved,
        base_url: saved.base_url ?? "",
        model: saved.model ?? "",
        api_key: "",
      }));
      setHasApiKey(saved.has_api_key);
      setClearKey(false);
      setStatus(t("adminSettings.aiCategorization.saved"));
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else setError(err instanceof Error ? err.message : t("adminSettings.aiCategorization.failed"));
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setStatus(null);
    setError(null);
    try {
      const result = await settingsApi.testAiCategorization();
      if (result.ok)
        setStatus(t("adminSettings.aiCategorization.testSuccess", { model: result.model, latency: result.latency_ms }));
      else setError(result.error || t("adminSettings.aiCategorization.testFailed"));
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else setError(err instanceof Error ? err.message : t("adminSettings.aiCategorization.testFailed"));
    } finally {
      setTesting(false);
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
            label={t("adminSettings.aiCategorization.baseUrl")}
            value={draft.base_url}
            onChange={(event) => update("base_url", event.target.value)}
            disabled={loading || saving}
            fullWidth
          />
          <TextField
            label={t("adminSettings.aiCategorization.model")}
            value={draft.model}
            onChange={(event) => update("model", event.target.value)}
            disabled={loading || saving}
            fullWidth
          />
          <TextField
            type="password"
            label={t("adminSettings.aiCategorization.apiKey")}
            value={draft.api_key}
            onChange={(event) => {
              update("api_key", event.target.value);
              setClearKey(false);
            }}
            helperText={
              clearKey
                ? t("adminSettings.aiCategorization.keyWillClear")
                : hasApiKey
                  ? t("adminSettings.aiCategorization.keySet")
                  : undefined
            }
            disabled={loading || saving}
            autoComplete="new-password"
            fullWidth
            slotProps={{
              input: {
                endAdornment:
                  hasApiKey && !clearKey ? (
                    <InputAdornment position="end">
                      <Button
                        size="small"
                        color="error"
                        onClick={() => {
                          setClearKey(true);
                          update("api_key", "");
                        }}
                        disabled={loading || saving}
                      >
                        {t("adminSettings.aiCategorization.clearKey")}
                      </Button>
                    </InputAdornment>
                  ) : undefined,
              },
            }}
          />
          <TextField
            type="number"
            label={t("adminSettings.aiCategorization.threshold")}
            value={draft.threshold}
            inputProps={{ min: 0, max: 1, step: 0.05 }}
            onChange={(event) => update("threshold", Number(event.target.value))}
            disabled={loading || saving}
          />
          <TextField
            type="number"
            label={t("adminSettings.aiCategorization.concurrency")}
            value={draft.concurrency}
            inputProps={{ min: 1, max: 4, step: 1 }}
            onChange={(event) => update("concurrency", Number(event.target.value))}
            disabled={loading || saving}
          />
          <TextField
            type="number"
            label={t("adminSettings.aiCategorization.timeout")}
            value={draft.timeout_ms}
            inputProps={{ min: 1000, step: 1000 }}
            onChange={(event) => update("timeout_ms", Number(event.target.value))}
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
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
            <Button variant="contained" onClick={() => void save()} disabled={loading || saving}>
              {t("adminSettings.aiCategorization.save")}
            </Button>
            <Button
              variant="outlined"
              onClick={() => void testConnection()}
              disabled={loading || saving || testing}
              startIcon={testing ? <CircularProgress size={14} /> : undefined}
            >
              {t("adminSettings.aiCategorization.test")}
            </Button>
            {(saving || loading) && <CircularProgress size={14} />}
          </Stack>
          {status && <Alert severity="success">{status}</Alert>}
          {error && <Alert severity="error">{error}</Alert>}
          <Typography variant="caption" color="text.secondary">
            {t("adminSettings.aiCategorization.writeOnly")}
          </Typography>
        </Stack>
      </Paper>
    </Stack>
  );
}
