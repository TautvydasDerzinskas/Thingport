import React from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import ExtensionOutlinedIcon from "@mui/icons-material/ExtensionOutlined";
import { UnauthorizedError } from "../../api/client";
import { widgetsApi } from "../../api/widgets";
import HelpTip from "../../components/HelpTip";
import SectionHeader from "../../components/SectionHeader";
import { useToast } from "../../components/ToastProvider";

type Props = {
  onUnauthorized?: () => void;
};

/** Whether users may add custom dashboard widgets, whose scripts run in their own dashboards with their access. */
export default function CustomWidgetsSection({ onUnauthorized }: Props) {
  const { t } = useTranslation("app");
  const toast = useToast();
  const [enabled, setEnabled] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    let active = true;
    widgetsApi
      .getEnabled()
      .then((value) => active && setEnabled(value))
      .catch((err: unknown) => {
        if (err instanceof UnauthorizedError) onUnauthorized?.();
      });
    return () => {
      active = false;
    };
  }, [onUnauthorized]);

  const toggle = async (next: boolean) => {
    const previous = enabled;
    setEnabled(next);
    try {
      setEnabled(await widgetsApi.setEnabled(next));
    } catch (err) {
      setEnabled(previous);
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else toast({ message: t("adminSettings.customWidgets.failed"), severity: "error" });
    }
  };

  return (
    <Stack spacing={3}>
      <SectionHeader
        title={t("adminSettings.customWidgets.heading")}
        subtitle={t("adminSettings.customWidgets.subtitle")}
      />
      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Stack direction="row" spacing={2} alignItems="center">
          <Box sx={{ color: "primary.main", display: "flex" }}>
            <ExtensionOutlinedIcon />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" fontWeight={600} id="custom-widgets-label">
              {t("adminSettings.customWidgets.label")}
              <HelpTip text={t("adminSettings.customWidgets.help")} />
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t(enabled === false ? "adminSettings.customWidgets.off" : "adminSettings.customWidgets.on")}
            </Typography>
          </Box>
          <Switch
            checked={enabled ?? false}
            disabled={enabled === null}
            onChange={(event) => void toggle(event.target.checked)}
            slotProps={{ input: { "aria-labelledby": "custom-widgets-label" } }}
          />
        </Stack>
      </Paper>
    </Stack>
  );
}
