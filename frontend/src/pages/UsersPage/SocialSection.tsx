import React from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import FormControlLabel from "@mui/material/FormControlLabel";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import { UnauthorizedError } from "../../api/client";
import { socialApi, type SocialSettings } from "../../api/social";
import HelpTip from "../../components/HelpTip";
import SharingAnimation from "../../components/adminAnimations/SharingAnimation";
import { AnimatedTile } from "../../components/storageAnimations/parts";
import { refreshSocialStatus } from "../../hooks/useSocialStatus";

type Props = {
  onUnauthorized?: () => void;
};

/** Social features, at the top of Users: Explore and public collections for the instance's users. Saves as switched. */
export default function SocialSection({ onUnauthorized }: Props) {
  const { t } = useTranslation(["app", "common"]);
  const [settings, setSettings] = React.useState<SocialSettings | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [loadFailed, setLoadFailed] = React.useState(false);
  // A read answering after a save started (or after the page went) would put back what was there before.
  const savingRef = React.useRef(false);
  const live = React.useRef(true);

  const read = React.useCallback(() => {
    socialApi.getSettings().then(
      (value) => {
        if (!live.current || savingRef.current) return;
        setSettings(value);
        setLoadFailed(false);
        setError(null);
      },
      (err) => {
        if (!live.current) return;
        if (err instanceof UnauthorizedError) onUnauthorized?.();
        else {
          setLoadFailed(true);
          setError(t("adminSettings.social.loadFailed"));
        }
      },
    );
  }, [onUnauthorized, t]);

  // Read on opening, and again when the tab comes back: another admin may have switched it meanwhile.
  React.useEffect(() => {
    live.current = true;
    read();
    const onReturn = () => {
      if (document.visibilityState === "visible" && !savingRef.current) read();
    };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      live.current = false;
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [read]);

  const toggle = async (enabled: boolean) => {
    const previous = settings;
    setSettings({ ...(settings ?? { enabled }), enabled });
    setSaving(true);
    savingRef.current = true;
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
      savingRef.current = false;
      setSaving(false);
    }
  };

  const points = (["infoPublic", "infoExplore", "infoCopy", "infoOff"] as const).map((key) =>
    t(`adminSettings.social.${key}`),
  );
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
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" spacing={2} alignItems="center">
        <AnimatedTile size={72}>
          <SharingAnimation key={String(enabled)} size={64} on={enabled} />
        </AnimatedTile>
        <Stack spacing={0.25} sx={{ flex: 1, minWidth: 0 }}>
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
                <Typography variant="body2" fontWeight={600} component="span">
                  {t("adminSettings.social.label")}
                  <HelpTip text={[t("adminSettings.social.infoTitle"), ...points].join(" ")} content={info} />
                </Typography>
              }
              sx={{ m: 0 }}
            />
            {saving && <CircularProgress size={16} />}
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {t("adminSettings.social.summary")}
          </Typography>
          {error && (
            <Alert
              severity="error"
              sx={{ mt: 1 }}
              // A failed read leaves nothing to switch: it offers to read again rather than to be dismissed.
              {...(loadFailed
                ? {
                    action: (
                      <Button color="inherit" size="small" onClick={read}>
                        {t("common:retry")}
                      </Button>
                    ),
                  }
                : { onClose: () => setError(null) })}
            >
              {error}
            </Alert>
          )}
        </Stack>
      </Stack>
    </Paper>
  );
}
