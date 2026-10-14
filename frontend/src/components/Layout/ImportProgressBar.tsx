import { useState } from "react";
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
import ListIcon from "@mui/icons-material/List";
import { useImportJob } from "./ImportJobContext";
import ImportJobItemsDialog from "./ImportJobItemsDialog";

/** Shown while a batch import runs; clicking shows the per-link queue. A link queue that finished
 *  with failures stays up, in warning colors, with a retry button until it's dismissed. */
export default function ImportProgressBar() {
  const { t } = useTranslation("app");
  const { activeJob, retryJob, dismissJob } = useImportJob();
  const [detailsOpen, setDetailsOpen] = useState(false);
  if (!activeJob) return null;

  const { total, processed, imported, already_in_library: alreadyInLibrary, failed_count: failedCount } = activeJob;
  const progressValue = total > 0 ? Math.min(100, (processed / total) * 100) : 0;
  const running = activeJob.status === "RUNNING";
  const hasFailures = !running && (failedCount > 0 || activeJob.status === "ERROR");
  const label = running
    ? total > 0
      ? t("importProgress.label", { processed, total })
      : t("importProgress.starting")
    : hasFailures
      ? t("importProgress.doneWithFailures", { imported, alreadyInLibrary, failedCount })
      : t("importProgress.done", { imported, alreadyInLibrary });
  const tooltip = hasFailures
    ? t("importProgress.tooltipFailed", { failedCount })
    : t("importProgress.tooltip", { imported, alreadyInLibrary, failedCount });

  return (
    <>
      <Tooltip title={tooltip} placement="top">
        <Box
          onClick={() => setDetailsOpen(true)}
          sx={{
            bgcolor: hasFailures ? "warning.main" : "background.paper",
            color: hasFailures ? "warning.contrastText" : "inherit",
            borderTop: "1px solid",
            borderColor: hasFailures ? "warning.dark" : "divider",
            px: 2,
            py: 0.75,
            cursor: "pointer",
          }}
        >
          <Stack spacing={0.5} sx={{ maxWidth: 480, mx: "auto" }}>
            <Stack direction="row" spacing={0.75} justifyContent="center" alignItems="center">
              <ListIcon fontSize="small" sx={{ opacity: 0.7 }} />
              <Typography variant="caption" textAlign="center">
                {label}
              </Typography>
            </Stack>
            {running ? (
              <LinearProgress
                variant={total > 0 ? "determinate" : "indeterminate"}
                value={progressValue}
                sx={{ borderRadius: 1, height: 6 }}
              />
            ) : (
              <Stack direction="row" spacing={1} justifyContent="center" alignItems="center">
                <Button
                  size="small"
                  startIcon={<ReplayIcon fontSize="small" />}
                  onClick={(e) => {
                    e.stopPropagation();
                    void retryJob();
                  }}
                  sx={hasFailures ? { color: "warning.contrastText" } : undefined}
                >
                  {t("importProgress.retryFailed")}
                </Button>
                <IconButton
                  size="small"
                  aria-label={t("importProgress.dismiss")}
                  onClick={(e) => {
                    e.stopPropagation();
                    dismissJob();
                  }}
                  sx={hasFailures ? { color: "warning.contrastText" } : undefined}
                >
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Stack>
            )}
          </Stack>
        </Box>
      </Tooltip>
      {activeJob.type === "LINKS" && (
        <ImportJobItemsDialog jobId={activeJob.id} open={detailsOpen} onClose={() => setDetailsOpen(false)} />
      )}
    </>
  );
}
