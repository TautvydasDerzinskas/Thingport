import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { keyframes } from "@mui/material/styles";
import Box from "@mui/material/Box";
import Dialog from "@mui/material/Dialog";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import CloseIcon from "@mui/icons-material/Close";
import CloseFullscreenIcon from "@mui/icons-material/CloseFullscreen";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import OpenInFullIcon from "@mui/icons-material/OpenInFull";
import ToolIcon from "./ToolIcon";
import ToolRunner from "./ToolRunner";
import type { RunnableTool, ToolContext } from "./toolSdk";

// Opens out of the page a little, as a window does.
const open = keyframes`from { opacity: 0; transform: translateY(8px) scale(0.98); } to { opacity: 1; transform: none; }`;

type Props = {
  tool: RunnableTool | null;
  /** What it was opened on: a model, where the window was opened from one. */
  context?: ToolContext;
  onClose: () => void;
  onAbout?: () => void;
  onUnauthorized?: () => void;
};

/** A tool running in a window of its own: the size its metadata asks for, or the whole screen. */
export default function ToolWindow({ tool, context, onClose, onAbout, onUnauthorized }: Props) {
  const { t } = useTranslation("app");
  const [full, setFull] = useState(false);
  // Each tool opens at its own size, whatever the last one was left at.
  useEffect(() => {
    if (!tool) setFull(false);
  }, [tool]);
  const size = tool?.manifest.window ?? { width: 960, height: 640 };

  return (
    <Dialog
      open={Boolean(tool)}
      onClose={onClose}
      maxWidth={false}
      fullScreen={full}
      aria-labelledby="tool-window-title"
      slotProps={{
        paper: {
          sx: {
            width: full ? "100%" : size.width,
            height: full ? "100%" : size.height,
            maxWidth: full ? "100%" : "calc(100% - 32px)",
            maxHeight: full ? "100%" : "calc(100% - 32px)",
            m: full ? 0 : 2,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            animation: `${open} 220ms ease-out`,
            "@media (prefers-reduced-motion: reduce)": { animation: "none" },
          },
        },
      }}
    >
      {tool && (
        <>
          <Box
            sx={{
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              gap: 1,
              pl: 2,
              pr: 1,
              py: 0.75,
              borderBottom: 1,
              borderColor: "divider",
            }}
          >
            <Box sx={{ display: "flex", color: "primary.main" }}>
              <ToolIcon iconUrl={tool.manifest.iconUrl} size={20} />
            </Box>
            <Typography
              id="tool-window-title"
              variant="body2"
              fontWeight={600}
              component="h2"
              noWrap
              sx={{ flex: 1, color: (theme) => theme.thingport.headingText }}
            >
              {tool.manifest.name}
            </Typography>
            {onAbout && (
              <Tooltip title={t("tools.window.about")}>
                <IconButton size="small" aria-label={t("tools.window.about")} onClick={onAbout}>
                  <InfoOutlinedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title={full ? t("tools.window.restore") : t("tools.window.maximize")}>
              <IconButton
                size="small"
                aria-label={full ? t("tools.window.restore") : t("tools.window.maximize")}
                onClick={() => setFull((value) => !value)}
              >
                {full ? <CloseFullscreenIcon fontSize="small" /> : <OpenInFullIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
            <Tooltip title={t("tools.window.close")}>
              <IconButton size="small" aria-label={t("tools.window.close")} onClick={onClose}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
          <Box sx={{ flex: 1, minHeight: 0, bgcolor: (theme) => theme.thingport.pageBackground }}>
            <ToolRunner tool={tool} context={context} onClose={onClose} onUnauthorized={onUnauthorized} />
          </Box>
        </>
      )}
    </Dialog>
  );
}
