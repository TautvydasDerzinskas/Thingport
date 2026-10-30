import { useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import CloseIcon from "@mui/icons-material/Close";
import { useRotatingPhrase } from "../../hooks/useRotatingPhrase";
import ImportPortalAnimation from "../ImportPortalAnimation";
import ModelDeleteAnimation from "../ModelDeleteAnimation";
import { useModelRepair } from "./ModelRepairContext";

const MINI_TILE = 40;

/** Shown while a repair of the models whose files are gone runs; how it went arrives as a notification. The
 *  fetching one borrows the import animation, since that is what it does; deleting has its own. */
export default function ModelRepairProgressBar() {
  const { t } = useTranslation("app");
  const { run, running, cancel } = useModelRepair();
  const [stopping, setStopping] = useState(false);
  const deleting = run?.action === "delete";
  const strings = deleting ? "modelRepairProgress.delete" : "modelRepairProgress.reimport";
  // A light touch on a long wait: the title changes every few seconds while the run goes.
  const phrase = useRotatingPhrase(`${strings}.phrases`, running);

  if (!run || !running) return null;
  const { done, total } = run;
  const Animation = deleting ? ModelDeleteAnimation : ImportPortalAnimation;
  const title = run.cancelled
    ? t("modelRepairProgress.stopping")
    : total > 0
      ? t(`${strings}.label`, { phrase, done, total })
      : t(`${strings}.starting`);

  return (
    <Box sx={{ bgcolor: "background.paper", borderTop: "1px solid", borderColor: "divider", px: 2, py: 0.75 }}>
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
          <Animation size={MINI_TILE - 4} paused={run.cancelled} />
        </Box>
        <Stack spacing={0.5} sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="caption" noWrap sx={{ display: "block" }}>
            {title}
          </Typography>
          <LinearProgress
            variant={total > 0 ? "determinate" : "indeterminate"}
            value={total > 0 ? Math.min(100, (done / total) * 100) : 0}
            color={deleting ? "error" : "primary"}
            sx={{ borderRadius: 1, height: 6 }}
          />
        </Stack>
        <Tooltip title={t("modelRepairProgress.stop")}>
          <span>
            <IconButton
              size="small"
              aria-label={t("modelRepairProgress.stop")}
              disabled={stopping || run.cancelled}
              onClick={() => {
                setStopping(true);
                void cancel()
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
