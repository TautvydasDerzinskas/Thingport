import React from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Paper from "@mui/material/Paper";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import { UnauthorizedError } from "../../api/client";
import { settingsApi, type ConsumeMode, type ConsumeSettings } from "../../api/settings";
import { adminApi, type AdminUser } from "../../api/admin";
import Segmented from "../../components/controls/Segmented";
import { AnimatedTile } from "../../components/storageAnimations/parts";
import ConsumeAnimation from "../../components/storageAnimations/ConsumeAnimation";
import SectionHeader from "../../components/SectionHeader";

type Props = {
  onUnauthorized?: () => void;
};

const MODES: ConsumeMode[] = ["separate", "folder"];
const MODE_TEXT: Record<ConsumeMode, "Separate" | "Folder"> = { separate: "Separate", folder: "Folder" };

/** The folder itself comes from the Docker setup; only how it's imported is chosen here. */
export default function ConsumeSection({ onUnauthorized }: Props) {
  const { t } = useTranslation("app");
  const [settings, setSettings] = React.useState<ConsumeSettings | null>(null);
  const [users, setUsers] = React.useState<AdminUser[]>([]);
  const [mode, setMode] = React.useState<ConsumeMode>("separate");
  const [userId, setUserId] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const apply = React.useCallback((data: ConsumeSettings) => {
    setSettings(data);
    setMode(data.mode);
    setUserId(data.user_id ?? "");
  }, []);

  React.useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [data, list] = await Promise.all([settingsApi.getConsume(), adminApi.listUsers()]);
        if (!active) return;
        apply(data);
        setUsers(list);
      } catch (err) {
        if (err instanceof UnauthorizedError) onUnauthorized?.();
        else if (active) setError(err instanceof Error ? err.message : t("adminSettings.consume.failed"));
      }
    })();
    return () => {
      active = false;
    };
  }, [apply, onUnauthorized, t]);

  const loading = settings === null;
  const isDirty = !loading && (mode !== settings.mode || userId !== (settings.user_id ?? ""));

  const save = async () => {
    if (!isDirty || saving) return;
    setSaving(true);
    setStatus(null);
    setError(null);
    try {
      apply(await settingsApi.updateConsume({ mode, user_id: userId || undefined }));
      setStatus(t("adminSettings.consume.saved"));
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else setError(err instanceof Error ? err.message : t("adminSettings.consume.failed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack spacing={3}>
      <SectionHeader title={t("adminSettings.consume.heading")} subtitle={t("adminSettings.consume.subtitle")} />
      {settings &&
        (settings.available ? (
          <Alert severity="info">
            {t("adminSettings.consume.activeBody", {
              path: settings.path,
              notImported: settings.not_imported_dir,
            })}
          </Alert>
        ) : (
          <Alert severity="warning">
            <AlertTitle>{t("adminSettings.consume.notSetUpTitle")}</AlertTitle>
            {t("adminSettings.consume.notSetUpBody", { path: settings.path })}
          </Alert>
        ))}
      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Stack direction="row" spacing={2.5} alignItems="flex-start">
          <AnimatedTile>
            <ConsumeAnimation size={76} />
          </AnimatedTile>
          <Stack spacing={2} sx={{ flex: 1, minWidth: 0 }}>
            <Box>
              <Stack
                direction="row"
                flexWrap="wrap"
                useFlexGap
                alignItems="flex-start"
                sx={{ columnGap: 3, rowGap: 2 }}
              >
                <Box sx={{ flex: "1 1 260px", maxWidth: 420, minWidth: 0 }}>
                  <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.5 }}>
                    {t("adminSettings.consume.userLabel")}
                  </Typography>
                  <TextField
                    select
                    size="small"
                    slotProps={{ htmlInput: { "aria-label": t("adminSettings.consume.userLabel") } }}
                    value={users.some((u) => u.id === userId) ? userId : ""}
                    onChange={(e) => setUserId(e.target.value)}
                    disabled={loading || saving}
                    fullWidth
                  >
                    {users.map((user) => (
                      <MenuItem key={user.id} value={user.id}>
                        {user.display_name} ({user.email})
                      </MenuItem>
                    ))}
                  </TextField>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.5 }}>
                    {t("adminSettings.consume.modeLabel")}
                  </Typography>
                  <Segmented
                    label={t("adminSettings.consume.modeLabel")}
                    value={mode}
                    onChange={setMode}
                    disabled={loading || saving}
                    options={MODES.map((option) => ({
                      value: option,
                      label: t(`adminSettings.consume.mode${MODE_TEXT[option]}Short`),
                    }))}
                  />
                  {/* What the chosen mode does. */}
                  <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1, maxWidth: 380 }}>
                    {t(`adminSettings.consume.mode${MODE_TEXT[mode]}Desc`)}
                  </Typography>
                </Box>
              </Stack>
            </Box>

            <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
              <Button variant="contained" onClick={save} disabled={!isDirty || saving}>
                {saving ? t("adminSettings.consume.saving") : t("adminSettings.consume.save")}
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
