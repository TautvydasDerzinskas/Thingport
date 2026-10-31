import React from "react";
import { useTranslation } from "react-i18next";
import Stack from "@mui/material/Stack";
import Paper from "@mui/material/Paper";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Chip from "@mui/material/Chip";
import Collapse from "@mui/material/Collapse";
import CircularProgress from "@mui/material/CircularProgress";
import LinearProgress from "@mui/material/LinearProgress";
import Alert from "@mui/material/Alert";
import Link from "@mui/material/Link";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Switch from "@mui/material/Switch";
import FormControlLabel from "@mui/material/FormControlLabel";
import Typography from "@mui/material/Typography";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import ReplayIcon from "@mui/icons-material/Replay";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";
import CloseIcon from "@mui/icons-material/Close";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";
import { UnauthorizedError } from "../../api/client";
import { adminApi, type AdminImportJob, type ImportQueue } from "../../api/admin";
import type { ImportJobItem } from "../../api/imports";
import { useConfirm } from "../../components/ConfirmProvider";
import { useToast } from "../../components/ToastProvider";
import HelpTip from "../../components/HelpTip";

type Props = {
  onUnauthorized?: () => void;
};

type Filter = "all" | "paused" | "running" | "failed" | "done";

// Fast while something moves, so progress reads live; slow otherwise, to pick up links the
// extension sends.
const POLL_ACTIVE_MS = 1500;
const POLL_IDLE_MS = 8000;

type StatusColor = "default" | "success" | "warning" | "error" | "info";

/** A RUNNING job without a live runner was cut off by a restart. */
function isStalled(job: AdminImportJob): boolean {
  return job.status === "RUNNING" && !job.runner_live;
}

function jobStatus(job: AdminImportJob): { key: string; color: StatusColor } {
  if (isStalled(job)) return { key: "stalled", color: "error" };
  if (job.status === "PAUSED") return { key: job.runner_live ? "pausing" : "paused", color: "info" };
  if (job.status === "RUNNING") return { key: "running", color: "warning" };
  if (job.status === "ERROR") return { key: "error", color: "error" };
  return job.failed_count > 0 ? { key: "doneWithFailures", color: "warning" } : { key: "done", color: "success" };
}

function matchesFilter(job: AdminImportJob, filter: Filter): boolean {
  switch (filter) {
    case "paused":
      return job.status === "PAUSED";
    case "running":
      return job.status === "RUNNING";
    case "failed":
      return job.status === "ERROR" || job.failed_items_count > 0 || job.failed_count > 0;
    case "done":
      return job.status === "DONE";
    default:
      return true;
  }
}

const ITEM_COLOR: Record<ImportJobItem["status"], StatusColor> = {
  PENDING: "default",
  RUNNING: "warning",
  DONE: "success",
  FAILED: "error",
};

/** Every user's batch imports. Links sent from the extension's "Add to the queue" wait here, paused,
 *  until started; "Start all" and "Retry all failed" run the jobs one after another. */
export default function ImportQueuePage({ onUnauthorized }: Props) {
  const { t, i18n } = useTranslation(["app", "common"]);
  const confirm = useConfirm();
  const showToast = useToast();
  const [queue, setQueue] = React.useState<ImportQueue | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<Filter>("all");
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  // The expanded job's links, reloaded with the queue on every poll.
  const [items, setItems] = React.useState<{ jobId: string; items: ImportJobItem[] } | null>(null);
  const expandedRef = React.useRef<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const jobId = expandedRef.current;
      const [loaded, loadedItems] = await Promise.all([
        adminApi.getImportQueue(),
        jobId ? adminApi.getImportQueueItems(jobId).catch(() => null) : Promise.resolve(null),
      ]);
      setQueue(loaded);
      if (jobId && expandedRef.current === jobId) setItems(loadedItems ? { jobId, items: loadedItems } : null);
      setError(null);
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else setError(t("adminSettings.importQueue.loadFailed"));
    }
  }, [onUnauthorized, t]);

  // Opening a job loads its links right away instead of on the next poll.
  React.useEffect(() => {
    expandedRef.current = expanded;
    if (expanded) void load();
  }, [expanded, load]);

  const active = Boolean(
    queue && (queue.bulk.running || queue.jobs.some((job) => job.status === "RUNNING" || job.runner_live)),
  );

  React.useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), active ? POLL_ACTIVE_MS : POLL_IDLE_MS);
    return () => window.clearInterval(timer);
  }, [load, active]);

  /** Runs one action with its button disabled, then reloads; a refusal shows the server's reason. */
  const run = async (key: string, action: () => Promise<unknown>, success?: (result: unknown) => string | null) => {
    setBusy(key);
    try {
      const result = await action();
      const message = success?.(result);
      if (message) showToast({ message, severity: "success" });
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else showToast({ message: err instanceof Error ? err.message : String(err), severity: "error" });
    } finally {
      setBusy(null);
      await load();
    }
  };

  const jobs = queue?.jobs ?? [];
  const visible = jobs.filter((job) => matchesFilter(job, filter));
  const pausedCount = jobs.filter((job) => job.status === "PAUSED" && job.type === "LINKS").length;
  const failedCount = jobs.filter(
    (job) => job.type === "LINKS" && job.status !== "RUNNING" && job.status !== "PAUSED" && job.failed_items_count > 0,
  ).length;
  const runningCount = jobs.filter((job) => job.status === "RUNNING" && job.type === "LINKS").length;
  const finishedCount = jobs.filter((job) => job.status === "DONE" && job.failed_count === 0).length;

  const deleteJob = async (job: AdminImportJob) => {
    const ok = await confirm({
      title: t("adminSettings.importQueue.deleteTitle"),
      message: t("adminSettings.importQueue.deleteMessage", { count: job.total }),
      confirmLabel: t("adminSettings.importQueue.delete"),
      destructive: true,
    });
    if (ok) await run(`delete:${job.id}`, () => adminApi.deleteQueueJob(job.id));
  };

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Button
              variant="contained"
              size="small"
              startIcon={<PlayArrowIcon />}
              disabled={!pausedCount || busy !== null}
              onClick={() =>
                void run("startAll", adminApi.startAllQueued, (r) =>
                  t("adminSettings.importQueue.startedAll", { count: (r as { queued: number }).queued }),
                )
              }
            >
              {t("adminSettings.importQueue.startAll", { count: pausedCount })}
            </Button>
            <Button
              variant="outlined"
              size="small"
              startIcon={<ReplayIcon />}
              disabled={!failedCount || busy !== null}
              onClick={() =>
                void run("retryAll", adminApi.retryAllFailed, (r) =>
                  t("adminSettings.importQueue.retriedAll", { count: (r as { queued: number }).queued }),
                )
              }
            >
              {t("adminSettings.importQueue.retryAll", { count: failedCount })}
            </Button>
            <Button
              variant="outlined"
              size="small"
              startIcon={<PauseIcon />}
              disabled={(!runningCount && !queue?.bulk.running) || busy !== null}
              onClick={() => void run("pauseAll", adminApi.pauseAllQueued)}
            >
              {t("adminSettings.importQueue.pauseAll")}
            </Button>
            <Button
              variant="text"
              size="small"
              startIcon={<DeleteSweepIcon />}
              disabled={!finishedCount || busy !== null}
              onClick={() =>
                void run("clear", adminApi.clearFinishedQueued, (r) =>
                  t("adminSettings.importQueue.cleared", { count: (r as { deleted: number }).deleted }),
                )
              }
            >
              {t("adminSettings.importQueue.clearFinished")}
            </Button>
          </Stack>
          <FormControlLabel
            sx={{ mr: 0, alignSelf: "flex-start" }}
            disabled={!queue || busy !== null}
            control={
              <Switch
                size="small"
                checked={queue?.auto_start ?? false}
                onChange={(_e, checked) => void run("autoStart", () => adminApi.setImportQueueAutoStart(checked))}
              />
            }
            label={
              <Typography variant="body2" component="span">
                {t("adminSettings.importQueue.autoStart")}
                <HelpTip text={t("adminSettings.importQueue.autoStartHelp")} />
              </Typography>
            }
          />
          {queue?.bulk.running && (
            <Typography variant="body2" color="text.secondary">
              {t("adminSettings.importQueue.bulkRunning", { count: queue.bulk.remaining })}
            </Typography>
          )}
          <ToggleButtonGroup
            size="small"
            exclusive
            value={filter}
            onChange={(_e, value: Filter | null) => value && setFilter(value)}
            sx={{ flexWrap: "wrap" }}
          >
            {(["all", "paused", "running", "failed", "done"] as Filter[]).map((f) => (
              <ToggleButton key={f} value={f} sx={{ px: 1.5, py: 0.25, textTransform: "none" }}>
                {t(`adminSettings.importQueue.filter.${f}`)}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Stack>
      </Paper>

      {error && <Alert severity="error">{error}</Alert>}

      {!queue ? (
        <Stack alignItems="center" sx={{ py: 2 }}>
          <CircularProgress size={20} />
        </Stack>
      ) : visible.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="body2" color="text.secondary">
            {t(jobs.length ? "adminSettings.importQueue.emptyFilter" : "adminSettings.importQueue.empty")}
          </Typography>
        </Paper>
      ) : (
        <Paper variant="outlined">
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox" />
                  <TableCell>{t("adminSettings.importQueue.columnSource")}</TableCell>
                  <TableCell>{t("adminSettings.importQueue.columnUser")}</TableCell>
                  <TableCell>{t("adminSettings.importQueue.columnStatus")}</TableCell>
                  <TableCell sx={{ minWidth: 140 }}>{t("adminSettings.importQueue.columnProgress")}</TableCell>
                  <TableCell>{t("adminSettings.importQueue.columnCreated")}</TableCell>
                  <TableCell align="right">{t("adminSettings.importQueue.columnActions")}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visible.map((job) => (
                  <JobRow
                    key={job.id}
                    job={job}
                    expanded={expanded === job.id}
                    onToggle={() => setExpanded((id) => (id === job.id ? null : job.id))}
                    busy={busy}
                    items={items?.jobId === job.id ? items.items : null}
                    locale={i18n.language}
                    onStart={() => void run(`start:${job.id}`, () => adminApi.startQueueJob(job.id))}
                    onPause={() => void run(`pause:${job.id}`, () => adminApi.pauseQueueJob(job.id))}
                    onRetry={() => void run(`retry:${job.id}`, () => adminApi.retryQueueJob(job.id))}
                    onDelete={() => void deleteJob(job)}
                    onRemoveItem={(item) => void run(`item:${item.id}`, () => adminApi.removeQueueItem(item.id))}
                  />
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}
    </Stack>
  );
}

type JobRowProps = {
  job: AdminImportJob;
  expanded: boolean;
  onToggle: () => void;
  busy: string | null;
  items: ImportJobItem[] | null;
  locale: string;
  onStart: () => void;
  onPause: () => void;
  onRetry: () => void;
  onDelete: () => void;
  onRemoveItem: (item: ImportJobItem) => void;
};

function JobRow({
  job,
  expanded,
  onToggle,
  busy,
  items,
  locale,
  onStart,
  onPause,
  onRetry,
  onDelete,
  onRemoveItem,
}: JobRowProps) {
  const { t } = useTranslation("app");
  const isLinks = job.type === "LINKS";
  const status = jobStatus(job);
  const idle = job.status !== "RUNNING" && !job.runner_live;
  // An ERROR job was cut off with links still waiting (a restart, say), and starts like a paused one.
  const canStart =
    isLinks &&
    (job.status === "PAUSED" || job.status === "ERROR") &&
    !job.runner_live &&
    job.pending_count + job.running_count > 0;
  const canPause = isLinks && job.status === "RUNNING";
  const canRetry = isLinks && idle && job.failed_items_count > 0;
  const progress = job.total > 0 ? Math.min(100, (job.processed / job.total) * 100) : 0;
  const disabled = busy !== null;

  return (
    <>
      <TableRow hover sx={{ "& > td": { borderBottom: expanded ? "none" : undefined } }}>
        <TableCell padding="checkbox">
          {isLinks && (
            <IconButton
              size="small"
              onClick={onToggle}
              aria-expanded={expanded}
              aria-label={t(expanded ? "adminSettings.importQueue.hideLinks" : "adminSettings.importQueue.showLinks")}
            >
              {expanded ? <KeyboardArrowDownIcon fontSize="small" /> : <KeyboardArrowRightIcon fontSize="small" />}
            </IconButton>
          )}
        </TableCell>
        <TableCell sx={{ maxWidth: 320 }}>
          <Typography variant="body2" noWrap title={job.source_label ?? job.source_url}>
            {job.source_label ?? job.source_url}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t(`adminSettings.importQueue.type.${job.type}`)}
            {job.provider ? ` · ${job.provider}` : ""}
          </Typography>
        </TableCell>
        <TableCell>
          <Typography variant="body2">{job.owner.display_name}</Typography>
          <Typography variant="caption" color="text.secondary">
            {job.owner.email}
          </Typography>
        </TableCell>
        <TableCell>
          <Tooltip title={job.error_message ?? t(`adminSettings.importQueue.statusHint.${status.key}`)}>
            <Chip size="small" color={status.color} label={t(`adminSettings.importQueue.status.${status.key}`)} />
          </Tooltip>
        </TableCell>
        <TableCell>
          <Typography variant="caption" component="div">
            {t("adminSettings.importQueue.progress", {
              processed: job.processed,
              total: job.total,
              imported: job.imported,
              failed: job.failed_count,
            })}
          </Typography>
          <LinearProgress
            variant="determinate"
            value={progress}
            color={job.failed_count > 0 ? "warning" : "primary"}
            sx={{ borderRadius: 1, height: 4, mt: 0.5 }}
          />
        </TableCell>
        <TableCell>
          <Typography variant="body2" noWrap>
            {new Date(job.created_at).toLocaleString(locale)}
          </Typography>
        </TableCell>
        <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
          {canStart && (
            <Tooltip title={t("adminSettings.importQueue.start")}>
              <span>
                <IconButton
                  size="small"
                  color="primary"
                  onClick={onStart}
                  disabled={disabled}
                  aria-label={t("adminSettings.importQueue.start")}
                >
                  <PlayArrowIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          )}
          {canPause && (
            <Tooltip title={t("adminSettings.importQueue.pause")}>
              <span>
                <IconButton
                  size="small"
                  onClick={onPause}
                  disabled={disabled}
                  aria-label={t("adminSettings.importQueue.pause")}
                >
                  <PauseIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          )}
          {canRetry && (
            <Tooltip title={t("adminSettings.importQueue.retry", { count: job.failed_items_count })}>
              <span>
                <IconButton
                  size="small"
                  onClick={onRetry}
                  disabled={disabled}
                  aria-label={t("adminSettings.importQueue.retry", { count: job.failed_items_count })}
                >
                  <ReplayIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          )}
          {idle && (
            <Tooltip title={t("adminSettings.importQueue.delete")}>
              <span>
                <IconButton
                  size="small"
                  onClick={onDelete}
                  disabled={disabled}
                  aria-label={t("adminSettings.importQueue.delete")}
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          )}
        </TableCell>
      </TableRow>
      {isLinks && (
        <TableRow>
          <TableCell colSpan={7} sx={{ py: 0, borderBottom: expanded ? undefined : "none" }}>
            <Collapse in={expanded} timeout="auto" unmountOnExit>
              <JobItems items={items} canRemove={idle} disabled={disabled} onRemove={onRemoveItem} />
            </Collapse>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function JobItems({
  items,
  canRemove,
  disabled,
  onRemove,
}: {
  items: ImportJobItem[] | null;
  canRemove: boolean;
  disabled: boolean;
  onRemove: (item: ImportJobItem) => void;
}) {
  const { t } = useTranslation("app");
  if (!items) {
    return (
      <Box sx={{ py: 1.5 }}>
        <CircularProgress size={16} />
      </Box>
    );
  }
  return (
    <Stack spacing={1} sx={{ py: 1.5, pl: { xs: 0, sm: 5 } }}>
      {items.map((item) => (
        <Stack key={item.id} direction="row" spacing={1.5} alignItems="flex-start">
          <Chip
            size="small"
            color={ITEM_COLOR[item.status]}
            variant={item.status === "PENDING" ? "outlined" : "filled"}
            label={t(`adminSettings.importQueue.itemStatus.${item.status}`)}
            sx={{ minWidth: 84 }}
          />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            {item.title && (
              <Typography variant="body2" sx={{ wordBreak: "break-word" }}>
                {item.title}
              </Typography>
            )}
            <Link
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              variant={item.title ? "caption" : "body2"}
              sx={{ wordBreak: "break-all" }}
            >
              {item.url}
            </Link>
            {item.scope && item.scope !== "url" && (
              <Typography variant="caption" color="text.secondary" component="div">
                {t(`adminSettings.importQueue.scope.${item.scope}`)}
              </Typography>
            )}
            {item.error_message && (
              <Typography variant="caption" color="error" component="div" sx={{ wordBreak: "break-word" }}>
                {item.error_message}
              </Typography>
            )}
          </Box>
          {canRemove && item.status !== "DONE" && (
            <Tooltip title={t("adminSettings.importQueue.removeLink")}>
              <span>
                <IconButton
                  size="small"
                  onClick={() => onRemove(item)}
                  disabled={disabled}
                  aria-label={t("adminSettings.importQueue.removeLink")}
                >
                  <CloseIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          )}
        </Stack>
      ))}
      {!items.length && (
        <Typography variant="body2" color="text.secondary">
          {t("importProgress.queueEmpty")}
        </Typography>
      )}
    </Stack>
  );
}
