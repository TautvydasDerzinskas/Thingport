import { useState } from "react";
import { useTranslation } from "react-i18next";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import CloseIcon from "@mui/icons-material/Close";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useAiRun } from "./AiRunContext";

/** Shown while a library AI categorization runs; the outcome arrives as a notification once it's done. */
export default function AiRunProgressBar() {
  const { t } = useTranslation("app");
  const { run, running, cancelRun } = useAiRun();
  const [stopping, setStopping] = useState(false);
  if (!run || !running) return null;

  const { done, total } = run;
  return (
    <Box sx={{ bgcolor: "background.paper", borderTop: "1px solid", borderColor: "divider", px: 2, py: 0.75 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ maxWidth: 480, mx: "auto" }}>
        <Stack spacing={0.5} sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={0.75} justifyContent="center" alignItems="center">
            <AutoAwesomeIcon fontSize="small" sx={{ opacity: 0.7 }} />
            <Typography variant="caption" textAlign="center">
              {run.cancelled
                ? t("aiRunProgress.stopping")
                : total > 0
                  ? t("aiRunProgress.label", { done, total })
                  : t("aiRunProgress.starting")}
            </Typography>
          </Stack>
          <LinearProgress
            variant={total > 0 ? "determinate" : "indeterminate"}
            value={total > 0 ? Math.min(100, (done / total) * 100) : 0}
            sx={{ borderRadius: 1, height: 6 }}
          />
        </Stack>
        <Tooltip title={t("aiRunProgress.stop")}>
          <span>
            <IconButton
              size="small"
              aria-label={t("aiRunProgress.stop")}
              disabled={stopping || run.cancelled}
              onClick={() => {
                setStopping(true);
                void cancelRun()
                  .catch(() => undefined)
                  .finally(() => setStopping(false));
              }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
    </Box>
  );
}
