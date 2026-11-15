import { createInstance, type TFunction } from "i18next";
import { describe, expect, it } from "vitest";
import be from "../i18n/locales/be.json";
import en from "../i18n/locales/en.json";
import es from "../i18n/locales/es.json";
import fr from "../i18n/locales/fr.json";
import lt from "../i18n/locales/lt.json";
import ru from "../i18n/locales/ru.json";
import uk from "../i18n/locales/uk.json";
import { notificationTitle } from "../components/notifications/notificationTitle";
import type { Notification } from "../api/notifications";
import {
  ACHIEVEMENTS,
  achievementDef,
  achievementName,
  achievementRule,
  achievementStat,
  knownAchievements,
  materialOf,
  plateOf,
  tierLabel,
  type AchievementDef,
} from "./achievements";

const LOCALES = { en, lt, es, fr, ru, uk, be };

function defOf(id: string): AchievementDef {
  const def = achievementDef(id);
  if (!def) throw new Error(`No achievement ${id}`);
  return def;
}

async function translator(language: keyof typeof LOCALES): Promise<TFunction> {
  const i18n = createInstance();
  await i18n.init({
    lng: language,
    fallbackLng: false,
    ns: ["app"],
    defaultNS: "app",
    resources: { [language]: { app: LOCALES[language].app } },
    interpolation: { escapeValue: false },
  });
  return i18n.t;
}

describe("achievements catalogue", () => {
  it("has each id once", () => {
    const ids = ACHIEVEMENTS.map((def) => def.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("draws only what it knows, at a tier it has, in the order given", () => {
    const shown = knownAchievements([
      { id: "imports", tier: 9 },
      { id: "from-a-newer-instance", tier: 0 },
      { id: "downloads", tier: 1 },
    ]);
    expect(shown.map((item) => [item.id, item.tier])).toEqual([
      ["imports", 5],
      ["downloads", 1],
    ]);
  });

  it("strikes a ladder by its tier and a single badge in its own material", () => {
    const downloads = defOf("downloads");
    expect([0, 1, 2, 3, 4, 5].map((tier) => materialOf(downloads, tier))).toEqual([
      "bronze",
      "silver",
      "gold",
      "platinum",
      "diamond",
      "holo",
    ]);
    expect(plateOf(downloads, 0)).toBe("1");
    expect(plateOf(downloads, 5)).toBe("1K");
    expect(materialOf(defOf("regular"), 0)).toBe("gold");
    expect(plateOf(defOf("regular"), 0)).toBeUndefined();
    expect(materialOf(defOf("secret:weather-scene/guest"), 0)).toBe("secret");
  });

  it.each(Object.keys(LOCALES) as (keyof typeof LOCALES)[])("has every name, rule and stat in %s", async (language) => {
    const t = await translator(language);
    const missing: string[] = [];
    const check = (text: string | null, what: string) => {
      if (text === null || text.includes("achievements.") || text.includes("{{")) missing.push(`${what}: ${text}`);
    };
    for (const def of ACHIEVEMENTS) {
      check(achievementName(def, t), `${def.id} name`);
      def.thresholds.forEach((threshold, tier) => {
        check(achievementRule(def, tier, t), `${def.id} rule ${tier}`);
        check(tierLabel(def, tier, t), `${def.id} tier ${tier}`);
        // Counts in every plural form a language has.
        for (const count of [0, 1, 2, 5, 21, threshold]) {
          if (def.group !== "secrets") check(achievementStat(def, count, t), `${def.id} stat ${count}`);
        }
      });
      if (def.group === "secrets") check(achievementStat(def, null, t), `${def.id} stat`);
    }
    expect(missing).toEqual([]);
  });

  it("names the badge in an achievement's notification", async () => {
    const t = await translator("en");
    const note = (title: string, message: Notification["message"]): Notification => ({
      id: "n1",
      type: "achievement",
      title,
      message,
      body: null,
      external_url: null,
      internal_path: null,
      read: false,
      read_at: null,
      created_at: "2026-11-13T00:00:00.000Z",
    });
    const one = note("Achievement unlocked", {
      key: "achievementUnlocked",
      values: { badge: "site:makerworld", tier: 2 },
    });
    expect(notificationTitle(one, t)).toBe("Achievement unlocked: MakerWorld importer · Gold · 100");
    const several = note("3 achievements unlocked", { key: "achievementsUnlocked", values: { count: 3 } });
    expect(notificationTitle(several, t)).toBe("3 achievements unlocked");
  });
});
