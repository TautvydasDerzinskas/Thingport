import type { ImportJob } from "../../api/imports";
import { useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import LinearProgress from "@mui/material/LinearProgress";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import CloseIcon from "@mui/icons-material/Close";
import ReplayIcon from "@mui/icons-material/Replay";
import { useRotatingPhrase } from "../../hooks/useRotatingPhrase";
import ImportPortalAnimation from "../ImportPortalAnimation";
import { useImportJob } from "./ImportJobContext";
import ImportJobItemsDialog from "./ImportJobItemsDialog";

const MINI_TILE = 40;

/** Shown while a batch import runs; clicking shows the per-link queue. A link queue that finished
 *  with failures stays up, in warning colors, with a retry button until it's dismissed. */
export default function ImportProgressBar() {
  const { jobs } = useImportJob();
  const { t } = useTranslation("app");
  return (
    <Box sx={{ maxHeight: 192, overflowY: "auto", flexShrink: 0 }}>
      {jobs.length > 0 && (
        <Button component={RouterLink} to="/import-queue" size="small">
          {t("importQueue.title")}
        </Button>
      )}
      {jobs.map((job) => (
        <ImportProgressRow key={job.id} activeJob={job} />
      ))}
    </Box>
  );
}

function ImportProgressRow({ activeJob }: { activeJob: ImportJob }) {
  const { t } = useTranslation("app");
  const { retryJob, dismissJob } = useImportJob();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const running = activeJob?.status === "RUNNING";
  const queued = activeJob?.status === "QUEUED";
  const phrase = useRotatingPhrase("importProgress.phrases", running);

  if (!activeJob) return null;

  const { total, processed, imported, already_in_library: alreadyInLibrary, failed_count: failedCount } = activeJob;
  const progressValue = total > 0 ? Math.min(100, (processed / total) * 100) : 0;
  const hasFailures = !running && !queued && (failedCount > 0 || activeJob.status === "ERROR");
  const singleError = activeJob.type === "SINGLE" && activeJob.status === "ERROR";
  const label = singleError
    ? (activeJob.error_message ?? t("importProgress.singleFailed"))
    : queued
      ? t("importProgress.queued")
      : running
        ? total > 0
          ? t("importProgress.label", { phrase, processed, total })
          : t("importProgress.starting")
        : hasFailures
          ? t("importProgress.doneWithFailures", { imported, alreadyInLibrary, failedCount })
          : t("importProgress.done", { imported, alreadyInLibrary });
  const tooltip = singleError
    ? (activeJob.error_message ?? t("importProgress.singleFailed"))
    : queued
      ? t("importProgress.queued")
      : hasFailures
        ? t("importProgress.tooltipFailed", { failedCount })
        : t("importProgress.tooltip", { imported, alreadyInLibrary, failedCount });

  return (
    <>
      <Tooltip title={tooltip} placement="top">
        <Box
          onClick={activeJob.type === "LINKS" ? () => setDetailsOpen(true) : undefined}
          sx={{
            bgcolor: hasFailures ? "warning.main" : "background.paper",
            color: hasFailures ? "warning.contrastText" : "inherit",
            borderTop: "1px solid",
            borderColor: hasFailures ? "warning.dark" : "divider",
            px: 2,
            py: 0.75,
            cursor: activeJob.type === "LINKS" ? "pointer" : "default",
          }}
        >
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ maxWidth: 520, mx: "auto" }}>
            <Box
              aria-hidden
              sx={{
                flexShrink: 0,
                width: MINI_TILE,
                height: MINI_TILE,
                borderRadius: "11px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                bgcolor: "#ffffff",
                boxShadow: "inset 0 0 0 1px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04)",
                overflow: "hidden",
              }}
            >
              <ImportPortalAnimation size={MINI_TILE - 4} paused={!running} />
            </Box>
            <Stack spacing={0.5} sx={{ flex: 1, minWidth: 0 }}>
              <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
                <Typography variant="caption" noWrap={running} sx={{ display: "block", minWidth: 0 }}>
                  {activeJob.source_label ?? activeJob.provider ?? activeJob.source_url}
                  {" · "}
                  {label}
                </Typography>
              </Stack>
              {running || queued ? (
                <LinearProgress
                  variant={running && total > 0 && activeJob.type !== "SINGLE" ? "determinate" : "indeterminate"}
                  value={progressValue}
                  sx={{ borderRadius: 1, height: 6 }}
                />
              ) : (
                <Stack direction="row" spacing={1} alignItems="center">
                  {activeJob.type === "LINKS" && hasFailures && (
                    <Button
                      size="small"
                      startIcon={<ReplayIcon fontSize="small" />}
                      onClick={(e) => {
                        e.stopPropagation();
                        void retryJob(activeJob.id);
                      }}
                      sx={{ color: "warning.contrastText" }}
                    >
                      {t("importProgress.retryFailed")}
                    </Button>
                  )}
                  <IconButton
                    size="small"
                    aria-label={t("importProgress.dismiss")}
                    onClick={(e) => {
                      e.stopPropagation();
                      dismissJob(activeJob.id);
                    }}
                    sx={hasFailures ? { color: "warning.contrastText" } : undefined}
                  >
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </Stack>
              )}
            </Stack>
          </Stack>
        </Box>
      </Tooltip>
      {activeJob.type === "LINKS" && (
        <ImportJobItemsDialog jobId={activeJob.id} open={detailsOpen} onClose={() => setDetailsOpen(false)} />
      )}
    </>
  );
}
