import { describe, expect, it } from "vitest";
import { createInstance } from "i18next";
import { profileFormat } from "./format";

describe("profile weight formatting", () => {
  const i18n = createInstance();
  const t = i18n.t.bind(i18n);
  it.each(["ru", "uk", "be"])("uses localized units for %s", (language) => {
    const format = profileFormat(t, language);
    expect(format.grams(25)).toMatch(/^25\sг$/);
    expect(format.grams(1250)).toMatch(/^1,25\sкг$/);
    expect(format.grams(0)).toBeNull();
  });
  it("preserves English units", () => {
    const format = profileFormat(t, "en");
    expect(format.grams(25)).toBe("25 g");
    expect(format.grams(1250)).toBe("1.25 kg");
  });
});
