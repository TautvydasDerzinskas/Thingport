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
import { socialApi, type SocialSettings } from "../../api/social";
import HelpTip from "../../components/HelpTip";
import SectionHeader from "../../components/SectionHeader";
import { refreshSocialStatus } from "../../hooks/useSocialStatus";
import SocialIllustration from "./SocialIllustration";

type Props = {
  onUnauthorized?: () => void;
};

/** Administration > Social. Saves as soon as it's switched. */
export default function SocialAdminPage({ onUnauthorized }: Props) {
  const { t } = useTranslation("app");
  const [settings, setSettings] = React.useState<SocialSettings | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    socialApi.getSettings().then(
      (value) => {
        if (active) setSettings(value);
      },
      (err) => {
        if (!active) return;
        if (err instanceof UnauthorizedError) onUnauthorized?.();
        else setError(t("adminSettings.social.loadFailed"));
      },
    );
    return () => {
      active = false;
    };
  }, [onUnauthorized, t]);

  const toggle = async (enabled: boolean) => {
    const previous = settings;
    setSettings({ ...(settings ?? { enabled }), enabled });
    setSaving(true);
    setError(null);
    try {
      setSettings(await socialApi.updateSettings({ enabled }));
      // The sidebar's Explore and the collection form's Private/Public follow straight away.
      refreshSocialStatus();
    } catch (err) {
      setSettings(previous);
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else setError(err instanceof Error ? err.message : t("adminSettings.social.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const points = (["infoPublic", "infoExplore", "infoCopy", "infoOff"] as const).map((key) =>
    t(`adminSettings.social.${key}`),
  );
  const infoText = [t("adminSettings.social.infoTitle"), ...points].join(" ");
  const info = (
    <>
      <Typography variant="subtitle2" component="div" sx={{ mb: 0.5 }}>
        {t("adminSettings.social.infoTitle")}
      </Typography>
      <Box component="ul" sx={{ mt: 1, mb: 0, pl: 2.5 }}>
        {points.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </Box>
    </>
  );
  const enabled = settings?.enabled ?? false;

  return (
    <Stack spacing={3} sx={{ maxWidth: 720 }}>
      <SectionHeader title={t("adminSettings.social.featuresHeading")} subtitle={t("adminSettings.social.subtitle")} />
      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Stack spacing={2}>
          <Stack spacing={2.5} alignItems="flex-start">
            <SocialIllustration />
            <Stack direction="row" spacing={1} alignItems="center">
              <FormControlLabel
                control={
                  <Switch
                    checked={enabled}
                    disabled={settings === null || saving}
                    onChange={(e) => void toggle(e.target.checked)}
                  />
                }
                label={
                  <Box>
                    <Typography variant="body2" fontWeight={600}>
                      {t("adminSettings.social.label")}
                      <HelpTip text={infoText} content={info} />
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t(enabled ? "adminSettings.social.helpOn" : "adminSettings.social.helpOff")}
                    </Typography>
                  </Box>
                }
                sx={{ alignItems: "flex-start", m: 0, "& .MuiSwitch-root": { mt: -0.5 } }}
              />
              {saving && <CircularProgress size={16} />}
            </Stack>
          </Stack>
          {error && (
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}
        </Stack>
      </Paper>
    </Stack>
  );
}
