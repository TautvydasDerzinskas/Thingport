import { achievementsApi } from "../api/achievements";
import type { SdkAchievements } from "./types";

/** `thingport.achievements` for the script with this slug; null for an unsaved draft, which unlocks nothing. Its
 *  secrets are `<slug>/<key>` in the backend's catalogue (services/achievementCatalog.ts). */
export function buildAchievements(slug: string | null): SdkAchievements {
  return {
    unlock: async (key: string) => {
      if (!slug || typeof key !== "string" || !key) return false;
      try {
        return await achievementsApi.claimSecret(`${slug}/${key}`);
      } catch {
        // An easter egg mustn't break the script around it.
        return false;
      }
    },
  };
}
