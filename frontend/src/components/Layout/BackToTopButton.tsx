import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Fab from "@mui/material/Fab";
import Tooltip from "@mui/material/Tooltip";
import Zoom from "@mui/material/Zoom";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import { useAiDescriptionRun, useAiRun } from "./AiRunContext";
import { useStorageMove } from "./StorageMoveContext";
import { useModelRepair } from "./ModelRepairContext";

const SCROLL_SHOW_THRESHOLD = 200;

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/** The app scrolls at the window level, so one listener covers every route. Shifts up while
 *  AiRunProgressBar, StorageMoveProgressBar or ModelRepairProgressBar shows. */
export default function BackToTopButton() {
  const { t } = useTranslation("app");
  const [visible, setVisible] = useState(false);
  const { running: aiRunning } = useAiRun();
  const { running: descriptionsRunning } = useAiDescriptionRun();
  const { running: filesMoving } = useStorageMove();
  const { running: repairing } = useModelRepair();

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > SCROLL_SHOW_THRESHOLD);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const label = t("shell.backToTop");

  return (
    <Zoom in={visible}>
      <Box
        onClick={scrollToTop}
        sx={{
          position: "fixed",
          right: 24,
          bottom:
            24 + (aiRunning ? 64 : 0) + (descriptionsRunning ? 64 : 0) + (filesMoving ? 64 : 0) + (repairing ? 64 : 0),
          zIndex: (theme) => theme.zIndex.fab,
          transition: (theme) => theme.transitions.create("bottom"),
        }}
      >
        <Tooltip title={label}>
          <Fab color="primary" aria-label={label ?? undefined} size="medium">
            <KeyboardArrowUpIcon />
          </Fab>
        </Tooltip>
      </Box>
    </Zoom>
  );
}
