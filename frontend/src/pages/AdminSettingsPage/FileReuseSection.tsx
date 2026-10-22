import React from "react";
import { useTranslation } from "react-i18next";
import CircularProgress from "@mui/material/CircularProgress";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { UnauthorizedError } from "../../api/client";
import { settingsApi, type PlateFileReuse } from "../../api/settings";
import Segmented from "../../components/controls/Segmented";
import HelpTip from "../../components/HelpTip";
import SectionHeader from "../../components/SectionHeader";
import { useToast } from "../../components/ToastProvider";
import { AnimatedTile } from "../../components/storageAnimations/parts";
import FileReuseAnimation from "../../components/storageAnimations/FileReuseAnimation";

type Props = {
  onUnauthorized?: () => void;
};

const MODES: PlateFileReuse[] = ["off", "reflink", "hardlink"];

/** How a model file identical to one already stored, say the same model imported by two users, is saved. */
export default function FileReuseSection({ onUnauthorized }: Props) {
  const { t } = useTranslation("app");
  const toast = useToast();
  const [mode, setMode] = React.useState<PlateFileReuse>("reflink");
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const data = await settingsApi.getFileReuse();
        if (active) setMode(data.mode);
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

  const select = async (next: PlateFileReuse) => {
    if (next === mode || saving) return;
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
            <FileReuseAnimation size={76} mode={mode} />
          </AnimatedTile>
          <Stack spacing={0.75} alignItems="flex-start" sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" fontWeight={600}>
              {t("adminSettings.fileReuse.modeLabel")}
              <HelpTip text={t("adminSettings.fileReuse.help")} />
            </Typography>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Segmented
                label={t("adminSettings.fileReuse.modeLabel")}
                value={mode}
                onChange={(next) => void select(next)}
                disabled={loading || saving}
                options={MODES.map((value) => ({ value, label: t(`adminSettings.fileReuse.modes.${value}`) }))}
              />
              {saving && <CircularProgress size={14} />}
            </Stack>
            <Typography variant="caption" color="text.secondary">
              {t(`adminSettings.fileReuse.modeHelp.${mode}`)}
            </Typography>
          </Stack>
        </Stack>
      </Paper>
    </Stack>
  );
}
