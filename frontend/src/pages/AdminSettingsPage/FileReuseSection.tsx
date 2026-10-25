import React from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import LinearProgress from "@mui/material/LinearProgress";
import Tooltip from "@mui/material/Tooltip";
import RefreshIcon from "@mui/icons-material/Refresh";
import FormControlLabel from "@mui/material/FormControlLabel";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import { UnauthorizedError } from "../../api/client";
import { settingsApi, type FileReuse, type FileReuseBackfill } from "../../api/settings";
import HelpTip from "../../components/HelpTip";
import SectionHeader from "../../components/SectionHeader";
import { useConfirm } from "../../components/ConfirmProvider";
import { useToast } from "../../components/ToastProvider";
import { formatFileSize } from "../../utils/fileSize";
import { AnimatedTile } from "../../components/storageAnimations/parts";
import FileReuseAnimation from "../../components/storageAnimations/FileReuseAnimation";

const POLL_INTERVAL_MS = 2000;

/** What the Existing files row says about the run, if any. */
const backfillStatus = (run: FileReuseBackfill | null, t: TFunction): string => {
  const key = "adminSettings.fileReuse.backfill";
  if (!run) return t(`${key}.idle`);
  if (run.running || run.restart_queued) {
    if (run.restart_queued) return t(`${key}.restarting`);
    if (!run.total) return t(`${key}.starting`);
    return run.phase === "hashing"
      ? t(`${key}.hashing`, { done: run.done, total: run.total })
      : t(`${key}.cloning`, { done: run.done, total: run.total, cloned: run.cloned });
  }
  if (run.failed) return t(`${key}.failedRun`);
  if (run.stopped) return t(`${key}.stopped`);
  if (run.unsupported) return t(`${key}.unsupported`);
  if (!run.cloned) return t(`${key}.nothing`);
  return t(`${key}.result`, { count: run.cloned, size: formatFileSize(run.reclaimed_bytes) });
};

type Props = {
  onUnauthorized?: () => void;
};

/** How a model file identical to one already stored, say the same model imported by two users, is saved. */
export default function FileReuseSection({ onUnauthorized }: Props) {
  const { t } = useTranslation("app");
  const toast = useToast();
  const confirm = useConfirm();
  const [backfill, setBackfill] = React.useState<FileReuseBackfill | null>(null);
  // Null until loaded, so a mode that never loaded isn't shown, or saved over, as the current one.
  const [mode, setMode] = React.useState<FileReuse | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [loadFailed, setLoadFailed] = React.useState(false);
  // Bumped by starting a run or saving the mode: a poll sent before that can come back after it with the old run's
  // "finished", which would stop following the new one, so its answer is dropped. Polls don't bump it, and only one is
  // in flight at a time, so a slow server still gets its answer through.
  const requestSeq = React.useRef(0);
  const polling = React.useRef(false);

  React.useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const data = await settingsApi.getFileReuse();
        if (active) {
          setMode(data.mode);
          setBackfill(data.backfill);
        }
      } catch (err) {
        if (err instanceof UnauthorizedError) onUnauthorized?.();
        else if (active) setLoadFailed(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [onUnauthorized]);

  // A queued restart briefly exposes the ended run while the server checks whether sharing is still enabled.
  const running = !!(backfill?.running || backfill?.restart_queued);
  // Followed while it runs, like the move of files, so a run turned on by the switch or one a restart carried on with
  // shows up too.
  React.useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      if (polling.current) return;
      polling.current = true;
      const seq = requestSeq.current;
      settingsApi
        .getFileReuse()
        .then((data) => {
          if (seq === requestSeq.current) setBackfill(data.backfill);
        })
        .catch((err) => {
          if (err instanceof UnauthorizedError) onUnauthorized?.();
        })
        .finally(() => {
          polling.current = false;
        });
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [running, onUnauthorized]);

  const checkAgain = async () => {
    const ok = await confirm({
      title: t("adminSettings.fileReuse.backfill.confirmTitle"),
      message: t("adminSettings.fileReuse.backfill.confirmMessage"),
      confirmLabel: t("adminSettings.fileReuse.backfill.confirmAction"),
    });
    if (!ok) return;
    const seq = ++requestSeq.current;
    try {
      const started = await settingsApi.startFileReuseBackfill();
      if (seq === requestSeq.current) setBackfill(started);
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else
        toast({
          message: err instanceof Error && err.message ? err.message : t("adminSettings.fileReuse.backfill.failed"),
          severity: "error",
        });
    }
  };

  const select = async (next: FileReuse) => {
    if (mode === null || next === mode || saving) return;
    const previous = mode;
    setMode(next);
    setSaving(true);
    const seq = ++requestSeq.current;
    try {
      const saved = await settingsApi.updateFileReuse(next);
      setMode(saved.mode);
      // Turning it on starts going over the files already stored.
      if (seq === requestSeq.current) setBackfill(saved.backfill);
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
            <Box sx={{ width: "100%" }}>
              <Stack direction="row" spacing={0.5} alignItems="center">
                <Typography variant="body2" fontWeight={600} sx={{ flexShrink: 0 }}>
                  {t("adminSettings.fileReuse.backfill.label")}
                  <HelpTip text={t("adminSettings.fileReuse.backfill.help")} />
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap sx={{ flex: 1, minWidth: 0, pl: 1 }}>
                  {backfillStatus(backfill, t)}
                  {backfill && !backfill.running && backfill.skipped > 0
                    ? ` · ${t("adminSettings.fileReuse.backfill.skippedNote", { count: backfill.skipped })}`
                    : ""}
                </Typography>
                <Tooltip title={t("adminSettings.fileReuse.backfill.checkAgain")}>
                  <span>
                    <IconButton
                      size="small"
                      aria-label={t("adminSettings.fileReuse.backfill.checkAgain")}
                      disabled={mode !== "reflink" || running}
                      onClick={() => void checkAgain()}
                    >
                      <RefreshIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </Stack>
              {running && (
                <LinearProgress
                  variant={backfill && backfill.total > 0 ? "determinate" : "indeterminate"}
                  value={backfill && backfill.total > 0 ? Math.min(100, (backfill.done / backfill.total) * 100) : 0}
                  sx={{ borderRadius: 1, height: 6, mt: 0.5 }}
                />
              )}
            </Box>
            {loadFailed && <Alert severity="error">{t("adminSettings.fileReuse.loadFailed")}</Alert>}
          </Stack>
        </Stack>
      </Paper>
    </Stack>
  );
}
