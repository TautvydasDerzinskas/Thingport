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
import { latestRequests } from "../../utils/latestRequests";
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
const REVEALED = new Set<string>(["diamond", "holo"]);

/** The toast for what one look found: its badge, or for several at once one toast for all of them. A toast waiting
 *  closes the one showing, so one each would show only the last for long enough to read. */
export function toastFor(
  toasted: ShownAchievement[],
): { many: false; item: ShownAchievement } | { many: true; count: number; first: ShownAchievement } | null {
  if (!toasted.length) return null;
  return toasted.length === 1
    ? { many: false, item: toasted[0] }
    : { many: true, count: toasted.length, first: toasted[0] };
}

const myModels = (badge?: string) =>
  badge ? `/authors/self?achievement=${encodeURIComponent(badge)}` : "/authors/self?achievements=all";

export default function AchievementWatcher() {
  const { t } = useTranslation("app");
  const toast = useToast();
  const navigate = useNavigate();
  const on = useSocialStatus()?.achievements ?? false;
  const [reveals, setReveals] = useState<ShownAchievement[]>([]);
  const looking = useRef(false);
  // Switching achievements off drops what a look still under way finds.
  const [requests] = useState(latestRequests);

  const look = useCallback(async () => {
    if (looking.current || document.visibilityState !== "visible") return;
    looking.current = true;
    const current = requests.next();
    try {
      const unseen = await achievementsApi.unseen();
      if (!unseen.length || !current()) return;
      // Marked first, each at the tier shown: if that fails, they're shown at the next look rather than again and
      // again; one raised meanwhile stays unseen.
      await achievementsApi.markSeen(unseen.map(({ id, tier }) => ({ id, tier })));
      if (!current()) return;
      const shown = knownAchievements(unseen);
      const revealed = shown.filter((item) => REVEALED.has(materialOf(item.def, item.tier)));
      const toastNow = toastFor(shown.filter((item) => !revealed.includes(item)));
      if (toastNow?.many) {
        toast({
          message: t("achievements.unlockedMany", { count: toastNow.count }),
          icon: <AchievementBadge def={toastNow.first.def} tier={toastNow.first.tier} size={34} />,
          action: { label: t("achievements.view"), onClick: () => navigate(myModels()) },
          autoHideMs: 8000,
        });
      } else if (toastNow) {
        const { item } = toastNow;
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
      if (revealed.length) setReveals((before) => [...before, ...revealed]);
    } catch {
      // Off, signed out or unreachable: the next look tries again.
    } finally {
      looking.current = false;
    }
  }, [navigate, requests, t, toast]);

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

  // Switched off: nothing more is shown, neither what a look under way finds nor the reveals still waiting.
  useEffect(() => {
    if (on) return;
    requests.cancel();
    setReveals([]);
  }, [on, requests]);

  return (
    <AchievementReveal
      achievement={on ? (reveals[0] ?? null) : null}
      onClose={() => setReveals((before) => before.slice(1))}
    />
  );
}
