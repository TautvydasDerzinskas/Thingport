import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { achievementsApi, type OwnAchievement } from "../../api/achievements";
import { knownAchievements } from "../../constants/achievements";
import { latestRequests } from "../../utils/latestRequests";
import AchievementsShowcase, { type ShowcaseOpen } from "./AchievementsShowcase";
import { onAchievementCheck, onAchievementsFound } from "./achievementEvents";

// The user's own badges on My models, read again a moment after something may have earned one, and as soon as the
// watcher finds one, as nothing here asked about what the server raised by itself (an import, a day's visit). A
// notification's link opens one (?achievement=<id>) or all of them (?achievements=all); closing it takes that off the
// address.

const AFTER_MS = 3000;

export default function MyAchievements() {
  const [items, setItems] = useState<OwnAchievement[] | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  // An older read answering after a newer one would put back badges from before, so it's dropped; while the newer one
  // hasn't answered, or if it fails, the older one is shown.
  const [requests] = useState(latestRequests);

  const load = useCallback(() => {
    const current = requests.next();
    achievementsApi.mine().then(
      (mine) => {
        if (current()) setItems(mine);
      },
      () => {
        // Off or unreachable: nothing to show until the next try.
      },
    );
  }, [requests]);

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
    const stopFound = onAchievementsFound(load);
    return () => {
      requests.cancel();
      stop();
      stopFound();
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [load, requests]);

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
