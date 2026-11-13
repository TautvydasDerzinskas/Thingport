import React from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import { alpha, useTheme } from "@mui/material/styles";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CleaningServicesOutlinedIcon from "@mui/icons-material/CleaningServicesOutlined";
import CloseIcon from "@mui/icons-material/Close";
import CompressIcon from "@mui/icons-material/Compress";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import LayersOutlinedIcon from "@mui/icons-material/LayersOutlined";
import PhotoLibraryOutlinedIcon from "@mui/icons-material/PhotoLibraryOutlined";
import WarningAmberOutlinedIcon from "@mui/icons-material/WarningAmberOutlined";
import {
  CLEANUP_TASKS,
  PHOTO_KEEP_OPTIONS,
  type CleanupTaskKey,
  type PhotoKeep,
  type StorageCleanup,
  type StorageCleanupTask,
  type StorageUsage,
} from "../../api/admin";
import { UnauthorizedError } from "../../api/client";
import { useConfirm } from "../../components/ConfirmProvider";
import HelpTip from "../../components/HelpTip";
import Segmented from "../../components/controls/Segmented";
import { useToast } from "../../components/ToastProvider";
import { formatFileSize } from "../../utils/fileSize";

type Props = {
  /** null where storage couldn't be measured: then there's nothing to free from here, only a run's progress to show. */
  usage: StorageUsage | null;
  /** The clean-up running or last run, as the page follows it. */
  cleanup: StorageCleanup | null;
  /** The saved "Photos kept per model", which the photos clean-up starts from. */
  keepSetting: PhotoKeep | null;
  onStart: (tasks: CleanupTaskKey[], keepPhotos: PhotoKeep | null) => Promise<void>;
  onClose: () => void;
  onUnauthorized?: () => void;
};

const ICONS: Record<CleanupTaskKey, React.ReactNode> = {
  old: <HistoryOutlinedIcon />,
  compress: <CompressIcon />,
  slicer: <LayersOutlinedIcon />,
  photos: <PhotoLibraryOutlinedIcon />,
};

// Photos are gone for good, so they're never ticked for the admin.
const DEFAULT_ON: Record<CleanupTaskKey, boolean> = { old: true, compress: true, slicer: true, photos: false };

function TaskIcon({ children }: { children: React.ReactNode }) {
  return (
    <Box
      aria-hidden
      sx={{
        width: 36,
        height: 36,
        borderRadius: 2,
        display: "grid",
        placeItems: "center",
        flexShrink: 0,
        bgcolor: (theme) => alpha(theme.palette.primary.main, 0.1),
        color: "primary.main",
      }}
    >
      {children}
    </Box>
  );
}

/**
 * Administration → Storage → Free up space: the clean-ups to tick, with what each would free, and then their progress.
 * Closing it doesn't stop one that's running; opening it again shows how far it got.
 */
export default function FreeUpSpaceDialog({ usage, cleanup, keepSetting, onStart, onClose, onUnauthorized }: Props) {
  const { t } = useTranslation(["app", "common"]);
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const confirm = useConfirm();
  const toast = useToast();
  const [keep, setKeep] = React.useState<PhotoKeep>(keepSetting ?? 3);
  const [starting, setStarting] = React.useState(false);

  const frees = (key: CleanupTaskKey): number =>
    !usage ? 0 : key === "photos" ? usage.freeable.photos[keep] : usage.freeable[key];
  // Whether there's anything to free at all: for photos, keeping only one, so the switch stays usable to pick fewer.
  const available = (key: CleanupTaskKey): boolean =>
    !!usage && (key === "photos" ? usage.freeable.photos[PHOTO_KEEP_OPTIONS[0]] : usage.freeable[key]) > 0;
  const [selected, setSelected] = React.useState<Record<CleanupTaskKey, boolean>>(
    () => Object.fromEntries(CLEANUP_TASKS.map((key) => [key, DEFAULT_ON[key]])) as Record<CleanupTaskKey, boolean>,
  );
  const chosen = CLEANUP_TASKS.filter((key) => selected[key] && frees(key) > 0);
  const total = chosen.reduce((sum, key) => sum + frees(key), 0);
  // What the last or current run did, once one has started from here or was already going.
  const progress = cleanup && (cleanup.running || cleanup.finished_at) ? cleanup : null;
  const [showProgress, setShowProgress] = React.useState(!!cleanup?.running);
  // A run the page learns of only once this is open (its first read came back late) is followed too.
  if (cleanup?.running && !showProgress) setShowProgress(true);
  const run = showProgress ? progress : null;
  const freed = run?.tasks.reduce((sum, task) => sum + task.freed, 0) ?? 0;

  const start = async () => {
    if (selected.photos && frees("photos") > 0) {
      const ok = await confirm({
        title: t("adminSettings.freeSpace.confirmPhotosTitle"),
        message: t("adminSettings.freeSpace.confirmPhotosMessage", { count: keep }),
        confirmLabel: t("adminSettings.freeSpace.confirmPhotosAction"),
        destructive: true,
      });
      if (!ok) return;
    }
    setStarting(true);
    try {
      await onStart(chosen, chosen.includes("photos") ? keep : null);
      setShowProgress(true);
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else
        toast({
          message: err instanceof Error && err.message ? err.message : t("adminSettings.freeSpace.startFailed"),
          severity: "error",
        });
    } finally {
      setStarting(false);
    }
  };

  const rowKeys: CleanupTaskKey[] = run ? run.tasks.map((task) => task.key) : [...CLEANUP_TASKS];

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" fullScreen={fullScreen}>
      <DialogTitle sx={{ pr: 6 }}>
        {t("adminSettings.freeSpace.title")}
        <IconButton aria-label={t("common:close")} onClick={onClose} sx={{ position: "absolute", right: 8, top: 8 }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        {rowKeys.map((key, index) => {
          const task = run?.tasks.find((candidate) => candidate.key === key);
          const amount = frees(key);
          return (
            <Box key={key}>
              {index > 0 && <Divider />}
              <Stack direction="row" spacing={1.75} alignItems="center" sx={{ px: 3, py: 1.5 }}>
                <TaskIcon>{ICONS[key]}</TaskIcon>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography
                    fontWeight={600}
                    component="div"
                    sx={{ display: "flex", alignItems: "center", flexWrap: "wrap" }}
                  >
                    {t(`adminSettings.freeSpace.tasks.${key}.title`)}
                    <HelpTip text={t(`adminSettings.freeSpace.tasks.${key}.help`)} />
                    {key === "photos" && (
                      <Chip
                        size="small"
                        icon={<WarningAmberOutlinedIcon />}
                        label={t("adminSettings.freeSpace.cantUndo")}
                        color="warning"
                        variant="outlined"
                        sx={{ ml: 1, height: 22 }}
                      />
                    )}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {task ? taskSummary(task, t) : t(`adminSettings.freeSpace.tasks.${key}.detail`)}
                  </Typography>
                  {key === "photos" && !run && selected.photos && (
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
                      <Typography variant="body2" color="text.secondary">
                        {t("adminSettings.freeSpace.keep")}
                      </Typography>
                      <Segmented
                        label={t("adminSettings.freeSpace.keepLabel")}
                        value={String(keep)}
                        onChange={(value) => setKeep(Number(value) as PhotoKeep)}
                        options={PHOTO_KEEP_OPTIONS.map((option) => ({ value: String(option), label: String(option) }))}
                      />
                    </Stack>
                  )}
                  {task?.status === "running" && (
                    <LinearProgress
                      variant={task.total ? "determinate" : "indeterminate"}
                      value={task.total ? (task.done / task.total) * 100 : undefined}
                      sx={{ mt: 1, borderRadius: 2 }}
                    />
                  )}
                </Box>
                {run ? (
                  <TaskState task={task} />
                ) : (
                  <>
                    <Typography variant="body2" color="text.secondary" sx={{ minWidth: 72, textAlign: "right" }}>
                      {amount > 0
                        ? t("adminSettings.freeSpace.about", { size: formatFileSize(amount) })
                        : t("adminSettings.freeSpace.nothing")}
                    </Typography>
                    <Switch
                      checked={selected[key] && available(key)}
                      disabled={!available(key) || starting}
                      onChange={(event) => setSelected((previous) => ({ ...previous, [key]: event.target.checked }))}
                      slotProps={{ input: { "aria-label": t(`adminSettings.freeSpace.tasks.${key}.title`) } }}
                    />
                  </>
                )}
              </Stack>
            </Box>
          );
        })}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        {run ? (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }} aria-live="polite">
              {run.running
                ? t("adminSettings.freeSpace.runningFooter", { size: formatFileSize(freed) })
                : t("adminSettings.freeSpace.finishedFooter", { size: formatFileSize(freed) })}
            </Typography>
            <Button onClick={onClose}>{t(run.running ? "common:close" : "adminSettings.freeSpace.done")}</Button>
          </>
        ) : (
          <>
            <Typography variant="body2" sx={{ flex: 1 }}>
              {total > 0
                ? t("adminSettings.freeSpace.frees", { size: formatFileSize(total) })
                : t("adminSettings.freeSpace.nothing")}
            </Typography>
            <Button onClick={onClose}>{t("common:cancel")}</Button>
            <Button
              variant="contained"
              startIcon={<CleaningServicesOutlinedIcon />}
              disabled={!chosen.length || starting}
              onClick={() => void start()}
            >
              {total > 0
                ? t("adminSettings.freeSpace.start", { size: formatFileSize(total) })
                : t("adminSettings.freeSpace.open")}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}

function taskSummary(task: StorageCleanupTask, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (task.status === "queued") return t("adminSettings.freeSpace.queued");
  const parts = [t("adminSettings.freeSpace.freed", { size: formatFileSize(task.freed) })];
  if (task.status === "running" && task.total)
    parts.push(t("adminSettings.freeSpace.filesDone", { done: task.done, total: task.total }));
  if (task.failed) parts.push(t("adminSettings.freeSpace.someFailed", { count: task.failed }));
  if (task.status === "failed") parts.push(t("adminSettings.freeSpace.taskFailed"));
  return parts.join(" · ");
}

/** Done, failed, or how far it got; a tick that pops in once it's done. */
function TaskState({ task }: { task: StorageCleanupTask | undefined }) {
  const { t } = useTranslation("app");
  if (!task) return null;
  return (
    <Box sx={{ width: 64, display: "grid", placeItems: "center", flexShrink: 0 }}>
      {task.status === "done" ? (
        <CheckCircleIcon
          color="primary"
          aria-label={t("adminSettings.freeSpace.taskDone")}
          sx={{
            animation: "free-space-done 220ms ease-out",
            "@keyframes free-space-done": {
              from: { transform: "scale(0.5)", opacity: 0 },
              to: { transform: "scale(1)", opacity: 1 },
            },
            "@media (prefers-reduced-motion: reduce)": { animation: "none" },
          }}
        />
      ) : task.status === "failed" ? (
        <ErrorOutlineIcon color="error" aria-label={t("adminSettings.freeSpace.taskFailed")} />
      ) : task.status === "running" && task.total ? (
        <Typography variant="caption" color="text.secondary">
          {Math.round((task.done / task.total) * 100)}%
        </Typography>
      ) : null}
    </Box>
  );
}
