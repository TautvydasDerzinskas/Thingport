import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { achievementsApi } from "../../api/achievements";
import {
  achievementName,
  knownAchievements,
  materialOf,
  tierLabel,
  type ShownAchievement,
} from "../../constants/achievements";
import { useSocialStatus } from "../../hooks/useSocialStatus";
import { useToast } from "../ToastProvider";
import AchievementBadge from "./AchievementBadge";
import AchievementReveal from "./AchievementReveal";
import { onAchievementCheck } from "./achievementEvents";

// Tells the user, wherever they are in the app, about a badge they've just earned: a toast with it (View opens it on
// My models), or for Diamond and Holographic the reveal. Looks now and then, when the tab comes back, and a moment
// after something that may have earned one (requestAchievementCheck), while achievements are on. Mounted once, in
// AppLayout. The bell's notification comes from the server either way.

const ROUND_MS = 45_000;
// The server checks a moment after what earned it, so the first look waits a little longer, and a second makes sure.
const AFTER_MS = [2500, 7000];
// More than this at once is one toast, not a queue of them.
const TOASTS_AT_ONCE = 3;
const REVEALED = new Set<string>(["diamond", "holo"]);

const myModels = (badge?: string) =>
  badge ? `/authors/self?achievement=${encodeURIComponent(badge)}` : "/authors/self?achievements=all";

export default function AchievementWatcher() {
  const { t } = useTranslation("app");
  const toast = useToast();
  const navigate = useNavigate();
  const on = useSocialStatus()?.achievements ?? false;
  const [reveals, setReveals] = useState<ShownAchievement[]>([]);
  const looking = useRef(false);

  const look = useCallback(async () => {
    if (looking.current || document.visibilityState !== "visible") return;
    looking.current = true;
    try {
      const unseen = await achievementsApi.unseen();
      if (!unseen.length) return;
      // Marked first: if that fails, they're shown at the next look rather than again and again.
      await achievementsApi.markSeen(unseen.map((item) => item.id));
      const shown = knownAchievements(unseen);
      const revealed = shown.filter((item) => REVEALED.has(materialOf(item.def, item.tier)));
      const toasted = shown.filter((item) => !revealed.includes(item));
      if (toasted.length > TOASTS_AT_ONCE) {
        toast({
          message: t("achievements.unlockedMany", { count: toasted.length }),
          icon: <AchievementBadge def={toasted[0].def} tier={toasted[0].tier} size={34} />,
          action: { label: t("achievements.view"), onClick: () => navigate(myModels()) },
          autoHideMs: 8000,
        });
      } else {
        for (const item of toasted) {
          toast({
            message: t("achievements.unlockedToast", {
              name: achievementName(item.def, t),
              tier: tierLabel(item.def, item.tier, t),
            }),
            icon: <AchievementBadge def={item.def} tier={item.tier} size={34} />,
            action: { label: t("achievements.view"), onClick: () => navigate(myModels(item.id)) },
            autoHideMs: 8000,
          });
        }
      }
      if (revealed.length) setReveals((before) => [...before, ...revealed]);
    } catch {
      // Off, signed out or unreachable: the next look tries again.
    } finally {
      looking.current = false;
    }
  }, [navigate, t, toast]);

  useEffect(() => {
    if (!on) return;
    void look();
    const round = window.setInterval(() => void look(), ROUND_MS);
    const timers = new Set<number>();
    const stop = onAchievementCheck(() => {
      for (const ms of AFTER_MS) {
        const timer = window.setTimeout(() => {
          timers.delete(timer);
          void look();
        }, ms);
        timers.add(timer);
      }
    });
    const onReturn = () => {
      if (document.visibilityState === "visible") void look();
    };
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      window.clearInterval(round);
      timers.forEach((timer) => window.clearTimeout(timer));
      stop();
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [on, look]);

  return <AchievementReveal achievement={reveals[0] ?? null} onClose={() => setReveals((before) => before.slice(1))} />;
}
