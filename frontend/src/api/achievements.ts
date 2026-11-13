import { requestAchievementCheck } from "../components/achievements/achievementEvents";
import { authHeaders } from "../utils/auth";
import { apiBase, assertOkWithMessage, readErrorMessage, UnauthorizedError } from "./client";

/** A badge as anyone sees it (backend services/achievementService.ts): drawn from constants/achievements.ts by `id`. */
export type Achievement = {
  id: string;
  /** Which of its thresholds, from 0. */
  tier: number;
  /** Absent for a partner's person's, whose instance doesn't say. */
  earned_at?: string;
  /** A badge that lapses (Regular) no longer holding: shown grey. */
  expired?: boolean;
};

/** One of the user's own, with how far its next tier is. */
export type OwnAchievement = Achievement & {
  earned_at: string;
  /** What it counts now; null for a secret. */
  count: number | null;
  /** The next tier's threshold; null at the top. */
  next: number | null;
  /** The app has shown it reaching this tier. */
  seen: boolean;
};

export type AchievementSettings = { enabled: boolean };

/** Asked for the user's achievements while an admin has them off. */
export class AchievementsOffError extends Error {
  constructor() {
    super("Achievements are off");
  }
}

const json = (body: unknown) => ({
  method: "POST",
  headers: authHeaders({ "Content-Type": "application/json" }),
  body: JSON.stringify(body),
});

export const achievementsApi = {
  mine: async (): Promise<OwnAchievement[]> => {
    const res = await fetch(`${apiBase()}/me/achievements`, { headers: authHeaders() });
    if (res.status === 401) throw new UnauthorizedError();
    if (res.status === 404) throw new AchievementsOffError();
    await assertOkWithMessage(res, "Failed to load achievements");
    return res.json();
  },

  /** Only the ones the app hasn't shown yet, without counts: what the watcher asks for now and then. */
  unseen: async (): Promise<Achievement[]> => {
    const res = await fetch(`${apiBase()}/me/achievements?unseen=1`, { headers: authHeaders() });
    if (res.status === 401) throw new UnauthorizedError();
    if (res.status === 404) throw new AchievementsOffError();
    await assertOkWithMessage(res, "Failed to load achievements");
    return res.json();
  },

  markSeen: async (badges: string[]): Promise<void> => {
    const res = await fetch(`${apiBase()}/me/achievements/seen`, json({ badges }));
    if (res.status === 401) throw new UnauthorizedError();
    if (res.status === 404) throw new AchievementsOffError();
    await assertOkWithMessage(res, "Failed to update achievements");
  },

  /** A secret a widget or tool gives away: `<its slug>/<key>`. False when there's no such secret, or achievements are
   *  off. */
  claimSecret: async (secret: string): Promise<boolean> => {
    const res = await fetch(`${apiBase()}/me/achievements/secret`, json({ secret }));
    if (res.status === 401) throw new UnauthorizedError();
    if (res.status === 404) return false;
    await assertOkWithMessage(res, "Failed to unlock the achievement");
    requestAchievementCheck();
    return true;
  },

  getSettings: async (): Promise<AchievementSettings> => {
    const res = await fetch(`${apiBase()}/achievements/settings`, { headers: authHeaders() });
    if (res.status === 401) throw new UnauthorizedError();
    await assertOkWithMessage(res, "Failed to load achievement settings");
    return res.json();
  },

  updateSettings: async (settings: AchievementSettings): Promise<AchievementSettings> => {
    const res = await fetch(`${apiBase()}/achievements/settings`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(settings),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to update achievement settings"));
    return res.json();
  },
};
