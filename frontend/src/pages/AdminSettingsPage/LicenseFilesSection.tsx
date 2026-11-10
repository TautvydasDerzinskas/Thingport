import React from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import FormControlLabel from "@mui/material/FormControlLabel";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import { UnauthorizedError } from "../../api/client";
import { settingsApi } from "../../api/settings";
import HelpTip from "../../components/HelpTip";
import SectionHeader from "../../components/SectionHeader";
import { useToast } from "../../components/ToastProvider";
import { AnimatedTile } from "../../components/storageAnimations/parts";
import LicenseFileAnimation from "../../components/storageAnimations/LicenseFileAnimation";

type Props = {
  onUnauthorized?: () => void;
};

/** Whether a LICENSE.txt is written beside the files of every model with a licence. */
export default function LicenseFilesSection({ onUnauthorized }: Props) {
  const { t } = useTranslation("app");
  const toast = useToast();
  // Null until loaded, so a value that never loaded isn't shown, or saved over, as the current one.
  const [enabled, setEnabled] = React.useState<boolean | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [loadFailed, setLoadFailed] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    settingsApi
      .getLicenseFiles()
      .then((data) => {
        if (active) setEnabled(data.enabled);
      })
      .catch((err) => {
        if (err instanceof UnauthorizedError) onUnauthorized?.();
        else if (active) setLoadFailed(true);
      });
    return () => {
      active = false;
    };
  }, [onUnauthorized]);

  const toggle = async (next: boolean) => {
    if (enabled === null || saving) return;
    setEnabled(next);
    setSaving(true);
    try {
      setEnabled((await settingsApi.updateLicenseFiles(next)).enabled);
    } catch (err) {
      setEnabled(!next);
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else toast({ message: t("adminSettings.licenseFiles.failed"), severity: "error" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack spacing={3}>
      <SectionHeader
        title={t("adminSettings.licenseFiles.heading")}
        subtitle={t("adminSettings.licenseFiles.subtitle")}
      />
      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Stack direction="row" spacing={2.5} alignItems="center">
          <AnimatedTile>
            <LicenseFileAnimation size={76} on={enabled !== false} />
          </AnimatedTile>
          <Stack spacing={1} alignItems="flex-start" sx={{ flex: 1, minWidth: 0 }}>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <FormControlLabel
                control={
                  <Switch
                    checked={enabled === true}
                    disabled={enabled === null || saving}
                    onChange={(e) => void toggle(e.target.checked)}
                  />
                }
                label={
                  <Box>
                    <Typography variant="body2" fontWeight={600}>
                      {t("adminSettings.licenseFiles.label")}
                      <HelpTip text={t("adminSettings.licenseFiles.help")} />
                    </Typography>
                    {enabled !== null && (
                      <Typography variant="caption" color="text.secondary">
                        {t(enabled ? "adminSettings.licenseFiles.on" : "adminSettings.licenseFiles.off")}
                      </Typography>
                    )}
                  </Box>
                }
                sx={{ alignItems: "flex-start", m: 0, "& .MuiSwitch-root": { mt: -0.5 } }}
              />
              {saving && <CircularProgress size={16} />}
            </Stack>
            {loadFailed && <Alert severity="error">{t("adminSettings.licenseFiles.loadFailed")}</Alert>}
          </Stack>
        </Stack>
      </Paper>
    </Stack>
  );
}
