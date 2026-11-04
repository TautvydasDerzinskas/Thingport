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
  // Kept apart: reading the setting again after a failed save fixes the switch, not what the save said.
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const savingRef = React.useRef(false);
  const live = React.useRef(true);
  // Moved on as a save starts and as it ends: a read sent before either is from before the save, and its answer --
  // the old value, or a failure the save has since made moot -- is dropped.
  const saves = React.useRef(0);
  // Only the latest read counts: two at once (opening, then the tab coming back) can answer in either order.
  const reads = React.useRef(0);
  // What the server last said: a read that finds it changed (another admin switched it) tells the rest of the app too.
  const known = React.useRef<boolean | null>(null);

  const read = React.useCallback(() => {
    const reading = ++reads.current;
    const sent = saves.current;
    const current = () => live.current && reading === reads.current && sent === saves.current && !savingRef.current;
    socialApi.getSettings().then(
      (value) => {
        if (!current()) return;
        setSettings(value);
        setLoadFailed(false);
        if (known.current !== null && known.current !== value.enabled) void refreshSocialStatus();
        known.current = value.enabled;
      },
      (err) => {
        if (!current()) return;
        if (err instanceof UnauthorizedError) onUnauthorized?.();
        else setLoadFailed(true);
      },
    );
  }, [onUnauthorized]);

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
    saves.current += 1;
    setSaveError(null);
    setLoadFailed(false);
    let failed = false;
    try {
      const saved = await socialApi.updateSettings({ enabled });
      setSettings(saved);
      known.current = saved.enabled;
      // The sidebar's Explore and the collection form's Private/Public follow straight away.
      void refreshSocialStatus();
    } catch (err) {
      failed = true;
      setSettings(previous);
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else setSaveError(err instanceof Error ? err.message : t("adminSettings.social.saveFailed"));
    } finally {
      savingRef.current = false;
      saves.current += 1;
      setSaving(false);
    }
    // What was shown before may not be what's saved, here or elsewhere in the app: another admin may have switched it
    // meanwhile, or the save may have gone through after all.
    if (failed) {
      void refreshSocialStatus();
      read();
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
          {saveError && (
            <Alert severity="error" sx={{ mt: 1 }} onClose={() => setSaveError(null)}>
              {saveError}
            </Alert>
          )}
          {loadFailed && (
            <Alert
              severity="error"
              sx={{ mt: 1 }}
              // A failed read leaves nothing to switch: it offers to read again rather than to be dismissed.
              action={
                <Button color="inherit" size="small" onClick={read}>
                  {t("common:retry")}
                </Button>
              }
            >
              {t("adminSettings.social.loadFailed")}
            </Alert>
          )}
        </Stack>
      </Stack>
    </Paper>
  );
}
