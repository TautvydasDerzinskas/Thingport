import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Fab from "@mui/material/Fab";
import Tooltip from "@mui/material/Tooltip";
import Zoom from "@mui/material/Zoom";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import { useImportJob } from "./ImportJobContext";
import { useAiRun } from "./AiRunContext";

const SCROLL_SHOW_THRESHOLD = 200;

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/** The app scrolls at the window level, so one listener covers every route. Shifts up while
 *  ImportProgressBar or AiRunProgressBar shows. */
export default function BackToTopButton() {
  const { t } = useTranslation("app");
  const [visible, setVisible] = useState(false);
  const { activeJob } = useImportJob();
  const { running: aiRunning } = useAiRun();

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
          bottom: 24 + (activeJob ? 64 : 0) + (aiRunning ? 64 : 0),
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
