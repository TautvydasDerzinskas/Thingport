import React from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Popover from "@mui/material/Popover";
import Switch from "@mui/material/Switch";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import SettingsIcon from "@mui/icons-material/Settings";
import { dialogIconButtonSx } from "../SectionedDialog";
import { useImportQueue } from "./ImportQueueContext";

/** The cog in the dialog's header. It's the viewer's own setting, for admins looking at everyone's imports too. */
export default function QueueSettingsPopover() {
  const { t } = useTranslation("app");
  const { startGrabLinks, setStartGrabLinks } = useImportQueue();
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);
  const label = t("importQueue.settings");

  return (
    <>
      <Tooltip title={label}>
        <IconButton
          size="small"
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={Boolean(anchorEl)}
          onClick={(event) => setAnchorEl(event.currentTarget)}
          sx={dialogIconButtonSx}
        >
          <SettingsIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Popover
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{ paper: { sx: { mt: 0.5, width: 290, maxWidth: "calc(100vw - 32px)", px: 1.75, py: 1.5 } } }}
      >
        <Box component="label" sx={{ display: "flex", alignItems: "flex-start", gap: 1.5, cursor: "pointer" }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" fontWeight={600} sx={{ color: (theme) => theme.thingport.headingText }}>
              {t("importQueue.autoStart")}
            </Typography>
            <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.25 }}>
              {t(startGrabLinks ? "importQueue.autoStartOn" : "importQueue.autoStartOff")}
            </Typography>
          </Box>
          <Switch
            size="small"
            checked={startGrabLinks}
            onChange={(event) => void setStartGrabLinks(event.target.checked)}
            inputProps={{ role: "switch" }}
            sx={{ flexShrink: 0 }}
          />
        </Box>
      </Popover>
    </>
  );
}
