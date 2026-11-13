import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { achievementsApi, type OwnAchievement } from "../../api/achievements";
import { knownAchievements } from "../../constants/achievements";
import AchievementsShowcase, { type ShowcaseOpen } from "./AchievementsShowcase";
import { onAchievementCheck } from "./achievementEvents";

// The user's own badges on My models, read again a moment after something may have earned one. A notification's
// link opens one (?achievement=<id>) or all of them (?achievements=all); closing it takes that off the address.

const AFTER_MS = 3000;

export default function MyAchievements() {
  const [items, setItems] = useState<OwnAchievement[] | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const load = useCallback(() => {
    achievementsApi.mine().then(setItems, () => {
      // Off or unreachable: nothing to show until the next try.
    });
  }, []);

  useEffect(() => {
    load();
    const timers = new Set<number>();
    const stop = onAchievementCheck(() => {
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        load();
      }, AFTER_MS);
      timers.add(timer);
    });
    return () => {
      stop();
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [load]);

  const badge = searchParams.get("achievement");
  const open: ShowcaseOpen = badge ? { badge } : searchParams.get("achievements") === "all" ? "all" : null;
  const onOpenChange = (next: ShowcaseOpen) =>
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.delete("achievement");
        params.delete("achievements");
        if (next === "all") params.set("achievements", "all");
        else if (next) params.set("achievement", next.badge);
        return params;
      },
      { replace: true },
    );

  if (!items) return null;
  return <AchievementsShowcase items={knownAchievements(items)} own open={open} onOpenChange={onOpenChange} />;
}
