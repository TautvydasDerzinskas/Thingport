import React from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import { UnauthorizedError } from "../../api/client";
import { achievementsApi } from "../../api/achievements";
import HelpTip from "../../components/HelpTip";
import AchievementsAnimation from "../../components/adminAnimations/AchievementsAnimation";
import { refreshSocialStatus } from "../../hooks/useSocialStatus";
import FeatureRow from "./FeatureRow";

type Props = { onUnauthorized?: () => void };

/** Achievements: their own switch, apart from social features, so it's never greyed out with them. Saves as
 *  switched. */
export default function AchievementsRow({ onUnauthorized }: Props) {
  const { t } = useTranslation(["app", "common"]);
  const [enabled, setEnabled] = React.useState<boolean | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [loadFailed, setLoadFailed] = React.useState(false);

  const read = React.useCallback(
    () =>
      achievementsApi.getSettings().then(
        (settings) => {
          setEnabled(settings.enabled);
          setLoadFailed(false);
        },
        (err: unknown) => {
          if (err instanceof UnauthorizedError) onUnauthorized?.();
          else setLoadFailed(true);
        },
      ),
    [onUnauthorized],
  );

  const load = React.useCallback(() => {
    setLoadFailed(false);
    void read();
  }, [read]);

  React.useEffect(load, [load]);

  const save = async (next: boolean) => {
    const before = enabled;
    setEnabled(next);
    setBusy(true);
    setError(null);
    try {
      setEnabled((await achievementsApi.updateSettings({ enabled: next })).enabled);
    } catch (err) {
      setEnabled(before);
      if (err instanceof UnauthorizedError) {
        onUnauthorized?.();
        return;
      }
      setError(err instanceof Error ? err.message : t("adminSettings.social.achievements.saveFailed"));
      // It may have been saved all the same, its answer lost: the switch shows what's saved, the error stays.
      await read();
    } finally {
      setBusy(false);
    }
    // My models' badges and the watcher follow straight away, after a failed save too.
    void refreshSocialStatus();
  };

  const title = t("adminSettings.social.achievements.infoTitle");
  const points = (["infoBadges", "infoProfile", "infoSecrets", "infoIndependent", "infoOff"] as const).map((key) =>
    t(`adminSettings.social.achievements.${key}`),
  );

  return (
    <>
      <FeatureRow
        animation={<AchievementsAnimation key={String(enabled)} size={76} on={enabled === true} />}
        title={t("adminSettings.social.achievements.label")}
        help={
          <HelpTip
            text={[title, ...points].join(" ")}
            content={
              <>
                <Typography variant="subtitle2" component="div" sx={{ mb: 0.5 }}>
                  {title}
                </Typography>
                <Box component="ul" sx={{ mt: 1, mb: 0, pl: 2.5 }}>
                  {points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </Box>
              </>
            }
          />
        }
        summary={t("adminSettings.social.achievements.summary")}
        checked={enabled === true}
        // One save at a time: a second, started while the first is under way, could be answered first.
        disabled={enabled === null || busy}
        busy={busy}
        onChange={(checked) => void save(checked)}
        extra={
          (error || loadFailed) && (
            <Alert
              severity="error"
              sx={{ mt: 1 }}
              onClose={error ? () => setError(null) : undefined}
              action={
                loadFailed ? (
                  <Button color="inherit" size="small" onClick={load}>
                    {t("common:retry")}
                  </Button>
                ) : undefined
              }
            >
              {error ?? t("adminSettings.social.achievements.loadFailed")}
            </Alert>
          )
        }
      />
    </>
  );
}
