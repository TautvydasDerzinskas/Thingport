import { describe, expect, it } from "vitest";
import { oneOrSeveral } from "./oneOrSeveral";

describe("oneOrSeveral", () => {
  it("picks the one form only for exactly one, in languages whose one form also covers 21", () => {
    for (const language of ["en", "lt", "ru", "uk", "be", "fr", "es"]) {
      const rules = new Intl.PluralRules(language);
      expect(rules.select(oneOrSeveral(1))).toBe("one");
      for (const count of [0, 2, 21, 31, 101]) expect(rules.select(oneOrSeveral(count))).not.toBe("one");
    }
  });
});
