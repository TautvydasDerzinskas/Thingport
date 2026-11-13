import { describe, expect, it } from "vitest";
import { knownAchievements } from "../../constants/achievements";
import { toastFor } from "./AchievementWatcher";

const shown = knownAchievements([
  { id: "downloads", tier: 1, earned_at: "2026-11-13T00:00:00.000Z" },
  { id: "imports", tier: 0, earned_at: "2026-11-13T00:00:00.000Z" },
]);

describe("toastFor", () => {
  it("is one toast for several badges found at once, not one each to close one another", () => {
    expect(shown).toHaveLength(2);
    expect(toastFor(shown)).toEqual({ many: true, count: 2, first: shown[0] });
  });

  it("names the badge when there's one, and is nothing when there's none", () => {
    expect(toastFor(shown.slice(0, 1))).toEqual({ many: false, item: shown[0] });
    expect(toastFor([])).toBeNull();
  });
});
