import React from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { UnauthorizedError } from "../../api/client";
import { socialApi, type SocialSettings } from "../../api/social";
import HelpTip from "../../components/HelpTip";
import ChatAnimation from "../../components/adminAnimations/ChatAnimation";
import SharingAnimation from "../../components/adminAnimations/SharingAnimation";
import { refreshSocialStatus } from "../../hooks/useSocialStatus";
import FeatureRow from "./FeatureRow";

type Props = {
  onUnauthorized?: () => void;
};

/** A title and a list, for a feature's `HelpTip`. */
function HelpList({ title, points }: { title: string; points: string[] }) {
  return (
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
  );
}

/** Social features and chats, a row each. Saves as switched. */
export default function SocialFeaturesSection({ onUnauthorized }: Props) {
  const { t } = useTranslation(["app", "common"]);
  const [settings, setSettings] = React.useState<SocialSettings | null>(null);
  // Which switch is saving, for its spinner.
  const [pending, setPending] = React.useState<keyof SocialSettings | null>(null);
  // Kept apart: reading the setting again after a failed save fixes the switch, not what the save said.
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const savingRef = React.useRef(false);
  // A change made while another saves, sent once that's done.
  const queued = React.useRef<Partial<SocialSettings> | null>(null);
  const live = React.useRef(true);
  // Moved on as a save starts and as it ends: a read sent before either is from before the save, and its answer --
  // the old value, or a failure the save has since made moot -- is dropped.
  const saves = React.useRef(0);
  // Only the latest read counts: two at once (opening, then the tab coming back) can answer in either order.
  const reads = React.useRef(0);
  // What the server last said: a read that finds it changed (another admin switched it) tells the rest of the app too.
  const known = React.useRef<SocialSettings | null>(null);

  const read = React.useCallback(() => {
    const reading = ++reads.current;
    const sent = saves.current;
    const current = () => live.current && reading === reads.current && sent === saves.current && !savingRef.current;
    socialApi.getSettings().then(
      (value) => {
        if (!current()) return;
        setSettings(value);
        setLoadFailed(false);
        const was = known.current;
        if (was && (was.enabled !== value.enabled || was.chats !== value.chats)) void refreshSocialStatus();
        known.current = value;
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

  const save = async (patch: Partial<SocialSettings>) => {
    // Shown at once, whatever is saving.
    setSettings((current) => ({ ...(current ?? { enabled: false, chats: false }), ...patch }));
    // One save at a time: a change made meanwhile (chats, right after turning social features on) waits and goes next.
    // The switches stay enabled throughout, since disabling the focused one would drop keyboard focus.
    if (savingRef.current) {
      queued.current = { ...queued.current, ...patch };
      return;
    }
    const before = known.current ?? settings;
    savingRef.current = true;
    setSaveError(null);
    setLoadFailed(false);
    let failed = false;
    let next: Partial<SocialSettings> | null = patch;
    try {
      while (next) {
        setPending(Object.keys(next)[0] as keyof SocialSettings);
        saves.current += 1;
        try {
          const saved = await socialApi.updateSettings(next);
          known.current = saved;
          next = queued.current;
          queued.current = null;
          // What's saved, with anything still waiting shown on top of it.
          setSettings(next ? { ...saved, ...next } : saved);
          // The sidebar's Explore and Chats, and the collection form's Private/Public, follow straight away.
          void refreshSocialStatus();
        } catch (err) {
          failed = true;
          next = null;
          queued.current = null;
          setSettings(known.current ?? before);
          if (err instanceof UnauthorizedError) onUnauthorized?.();
          else setSaveError(err instanceof Error ? err.message : t("adminSettings.social.saveFailed"));
        } finally {
          saves.current += 1;
        }
      }
    } finally {
      savingRef.current = false;
      setPending(null);
    }
    // What was shown before may not be what's saved, here or elsewhere in the app: another admin may have switched it
    // meanwhile, or the save may have gone through after all.
    if (failed) {
      void refreshSocialStatus();
      read();
    }
  };

  const enabled = settings?.enabled ?? false;
  const chats = settings?.chats ?? false;
  const socialPoints = (["infoPublic", "infoExplore", "infoCopy", "infoOff"] as const).map((key) =>
    t(`adminSettings.social.${key}`),
  );
  const chatPoints = (["infoDirect", "infoRooms", "infoModels", "infoNotify", "infoOff"] as const).map((key) =>
    t(`adminSettings.social.chats.${key}`),
  );
  const socialTitle = t("adminSettings.social.infoTitle");
  const chatTitle = t("adminSettings.social.chats.infoTitle");

  return (
    <Stack spacing={1.5}>
      <Paper variant="outlined">
        <FeatureRow
          // Keyed by the state, so switching starts the animation over in its new state.
          animation={<SharingAnimation key={String(enabled)} size={76} on={enabled} />}
          title={t("adminSettings.social.label")}
          help={
            <HelpTip
              text={[socialTitle, ...socialPoints].join(" ")}
              content={<HelpList title={socialTitle} points={socialPoints} />}
            />
          }
          summary={t("adminSettings.social.summary")}
          checked={enabled}
          disabled={settings === null}
          busy={pending === "enabled"}
          onChange={(checked) => void save({ enabled: checked })}
        />
        <Divider />
        <FeatureRow
          // Off while social features are: chats come with them.
          animation={<ChatAnimation key={String(enabled && chats)} size={76} on={enabled && chats} />}
          title={t("adminSettings.social.chats.label")}
          help={
            <HelpTip
              text={[chatTitle, ...chatPoints].join(" ")}
              content={<HelpList title={chatTitle} points={chatPoints} />}
            />
          }
          summary={t("adminSettings.social.chats.summary")}
          // Off while social features are, as chats are then; the saved choice is back with them.
          checked={enabled && chats}
          disabled={settings === null || !enabled}
          busy={pending === "chats"}
          blockedReason={settings !== null && !enabled ? t("adminSettings.social.chats.needsSocial") : undefined}
          onChange={(checked) => void save({ chats: checked })}
        />
      </Paper>
      {saveError && (
        <Alert severity="error" onClose={() => setSaveError(null)}>
          {saveError}
        </Alert>
      )}
      {loadFailed && (
        <Alert
          severity="error"
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
  );
}
