import React from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import FormControlLabel from "@mui/material/FormControlLabel";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import { UnauthorizedError } from "../../api/client";
import { settingsApi, type QualityCheckSettings } from "../../api/settings";
import HelpTip from "../../components/HelpTip";
import SectionHeader from "../../components/SectionHeader";
import QualityCheckIllustration from "./QualityCheckIllustration";
import QualityChecksDialog from "./QualityChecksDialog";

const SECTION_ID = "quality-checks";

type Props = {
  onUnauthorized?: () => void;
};

/** Saves as soon as it's switched. */
export default function QualityChecksSection({ onUnauthorized }: Props) {
  const { t } = useTranslation("app");
  const [settings, setSettings] = React.useState<QualityCheckSettings | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [checksOpen, setChecksOpen] = React.useState(false);
  const enabled = settings?.enabled ?? null;
  const { hash } = useLocation();
  const sectionRef = React.useRef<HTMLDivElement>(null);
  const ready = settings !== null;

  // A model's quality report links here; scroll once the section has its height.
  React.useEffect(() => {
    if (ready && hash === `#${SECTION_ID}`) sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [hash, ready]);

  React.useEffect(() => {
    let active = true;
    settingsApi.getQualityChecks().then(
      (loaded) => {
        if (active) setSettings(loaded);
      },
      (err) => {
        if (!active) return;
        if (err instanceof UnauthorizedError) onUnauthorized?.();
        else setError(t("adminSettings.rendering.quality.loadFailed"));
      },
    );
    return () => {
      active = false;
    };
  }, [onUnauthorized, t]);

  const save = async (patch: Partial<QualityCheckSettings>) => {
    if (!settings) return;
    const previous = settings;
    setSettings({ ...settings, ...patch });
    setSaving(true);
    setError(null);
    try {
      setSettings(await settingsApi.updateQualityChecks(patch));
    } catch (err) {
      setSettings(previous);
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else setError(err instanceof Error ? err.message : t("adminSettings.rendering.quality.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const points = (["infoWhen", "infoChecks", "infoCost"] as const).map((key) =>
    t(`adminSettings.rendering.quality.${key}`),
  );
  const infoText = [t("adminSettings.rendering.quality.infoTitle"), ...points].join(" ");
  const info = (
    <>
      <Typography variant="subtitle2" component="div" sx={{ mb: 0.5 }}>
        {t("adminSettings.rendering.quality.infoTitle")}
      </Typography>
      <Box component="ul" sx={{ mt: 0.5, mb: 0, pl: 2.5 }}>
        {points.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </Box>
    </>
  );

  return (
    <Stack spacing={3} id={SECTION_ID} ref={sectionRef} sx={{ scrollMarginTop: 80 }}>
      <SectionHeader
        title={t("adminSettings.rendering.quality.heading")}
        subtitle={t("adminSettings.rendering.quality.subtitle")}
      />
      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Stack spacing={2}>
          <QualityCheckIllustration />
          <Stack direction="row" spacing={1} alignItems="center">
            <FormControlLabel
              control={
                <Switch
                  checked={enabled ?? false}
                  disabled={enabled === null || saving}
                  onChange={(e) => void save({ enabled: e.target.checked })}
                />
              }
              label={
                <Box>
                  <Typography variant="body2" fontWeight={600}>
                    {t("adminSettings.rendering.quality.label")}
                    <HelpTip text={infoText} content={info} />
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t(enabled ? "adminSettings.rendering.quality.helpOn" : "adminSettings.rendering.quality.helpOff")}
                  </Typography>
                </Box>
              }
              sx={{ alignItems: "flex-start", m: 0, "& .MuiSwitch-root": { mt: -0.5 } }}
            />
            <Tooltip title={t("adminSettings.rendering.quality.configure")}>
              <span>
                <IconButton
                  size="small"
                  aria-label={t("adminSettings.rendering.quality.configure")}
                  disabled={!settings}
                  onClick={() => setChecksOpen(true)}
                >
                  <SettingsOutlinedIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            {saving && <CircularProgress size={16} />}
          </Stack>
          {error && (
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}
        </Stack>
      </Paper>
      {settings && (
        <QualityChecksDialog
          open={checksOpen}
          checksOff={settings.checks_off}
          onChange={(checksOff) => void save({ checks_off: checksOff })}
          onClose={() => setChecksOpen(false)}
        />
      )}
    </Stack>
  );
}
