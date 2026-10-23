import React from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import FormControlLabel from "@mui/material/FormControlLabel";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import { UnauthorizedError } from "../../api/client";
import { settingsApi, type FileReuse } from "../../api/settings";
import HelpTip from "../../components/HelpTip";
import SectionHeader from "../../components/SectionHeader";
import { useToast } from "../../components/ToastProvider";
import { AnimatedTile } from "../../components/storageAnimations/parts";
import FileReuseAnimation from "../../components/storageAnimations/FileReuseAnimation";

type Props = {
  onUnauthorized?: () => void;
};

/** How a model file identical to one already stored, say the same model imported by two users, is saved. */
export default function FileReuseSection({ onUnauthorized }: Props) {
  const { t } = useTranslation("app");
  const toast = useToast();
  // Null until loaded, so a mode that never loaded isn't shown, or saved over, as the current one.
  const [mode, setMode] = React.useState<FileReuse | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [loadFailed, setLoadFailed] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const data = await settingsApi.getFileReuse();
        if (active) setMode(data.mode);
      } catch (err) {
        if (err instanceof UnauthorizedError) onUnauthorized?.();
        else if (active) setLoadFailed(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [onUnauthorized]);

  const select = async (next: FileReuse) => {
    if (mode === null || next === mode || saving) return;
    const previous = mode;
    setMode(next);
    setSaving(true);
    try {
      setMode((await settingsApi.updateFileReuse(next)).mode);
    } catch (err) {
      setMode(previous);
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else toast({ message: t("adminSettings.fileReuse.failed"), severity: "error" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack spacing={3}>
      <SectionHeader title={t("adminSettings.fileReuse.heading")} subtitle={t("adminSettings.fileReuse.subtitle")} />
      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Stack direction="row" spacing={2.5} alignItems="center">
          <AnimatedTile>
            <FileReuseAnimation size={76} mode={mode ?? "off"} />
          </AnimatedTile>
          <Stack spacing={1} alignItems="flex-start" sx={{ flex: 1, minWidth: 0 }}>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <FormControlLabel
                control={
                  <Switch
                    checked={mode === "reflink"}
                    disabled={mode === null || saving}
                    onChange={(e) => void select(e.target.checked ? "reflink" : "off")}
                  />
                }
                label={
                  <Box>
                    <Typography variant="body2" fontWeight={600}>
                      {t("adminSettings.fileReuse.modeLabel")}
                      <HelpTip text={t("adminSettings.fileReuse.help")} />
                    </Typography>
                    {mode !== null && (
                      <Typography variant="caption" color="text.secondary">
                        {t(`adminSettings.fileReuse.modeHelp.${mode}`)}
                      </Typography>
                    )}
                  </Box>
                }
                sx={{ alignItems: "flex-start", m: 0, "& .MuiSwitch-root": { mt: -0.5 } }}
              />
              {saving && <CircularProgress size={16} />}
            </Stack>
            {loadFailed && <Alert severity="error">{t("adminSettings.fileReuse.loadFailed")}</Alert>}
          </Stack>
        </Stack>
      </Paper>
    </Stack>
  );
}
