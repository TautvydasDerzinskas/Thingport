import { achievementsApi } from "../api/achievements";
import type { SdkAchievements } from "./types";

/** `thingport.achievements` for the script with this slug; null for an unsaved draft, which unlocks nothing. Its
 *  secrets are `<slug>/<key>` in the backend's catalogue (services/achievementCatalog.ts). */
export function buildAchievements(slug: string | null): SdkAchievements {
  const unlockWithStatus: SdkAchievements["unlockWithStatus"] = async (key) => {
    if (!slug || typeof key !== "string" || !key) return "unavailable";
    try {
      return (await achievementsApi.claimSecret(`${slug}/${key}`)) ? "earned" : "unavailable";
    } catch {
      return "retry";
    }
  };
  return {
    unlock: async (key) => (await unlockWithStatus(key)) === "earned",
    unlockWithStatus,
  };
}
