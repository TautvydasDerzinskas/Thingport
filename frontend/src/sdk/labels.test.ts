import { describe, expect, it } from "vitest";
import { translator } from "./labels";

const LOCALES = {
  en: {
    "bar.pieces.one": "piece",
    "bar.pieces.other": "pieces",
    "only.en.one": "{count} box",
    "only.en.other": "{count} boxes",
  },
  ru: { "bar.pieces.one": "деталь", "bar.pieces.few": "детали", "bar.pieces.many": "деталей" },
  lt: { "bar.pieces.one": "dalis", "bar.pieces.few": "dalys", "bar.pieces.other": "dalių" },
};

describe("translator plurals", () => {
  it("picks each language's form by its own rules, 21 included", () => {
    const ru = translator(LOCALES, "ru");
    expect([1, 2, 5, 21, 22, 25].map((count) => ru("bar.pieces", { count }))).toEqual([
      "деталь",
      "детали",
      "деталей",
      "деталь",
      "детали",
      "деталей",
    ]);
    const lt = translator(LOCALES, "lt-LT");
    expect([1, 2, 10, 21].map((count) => lt("bar.pieces", { count }))).toEqual(["dalis", "dalys", "dalių", "dalis"]);
  });

  it("falls back to .other, then to English by English's rules, filling {count} in", () => {
    const ru = translator(LOCALES, "ru");
    // Russian has no .other for 1.5, so English answers.
    expect(ru("bar.pieces", { count: 1.5 })).toBe("pieces");
    expect(ru("only.en", { count: 1 })).toBe("1 box");
    expect(ru("only.en", { count: 2 })).toBe("2 boxes");
    expect(translator(LOCALES, "xx-invalid-")("bar.pieces", { count: 1 })).toBe("piece");
  });

  it("takes the language's plain words over English's plural forms", () => {
    const ru = translator(
      { en: { "unit.kmh.one": "km/h", "unit.kmh.other": "km/h" }, ru: { "unit.kmh": "км/ч" } },
      "ru",
    );
    expect(ru("unit.kmh", { count: 5 })).toBe("км/ч");
  });

  it("leaves a key without plural forms as it was", () => {
    const en = translator({ en: { hello: "Hi {count}" } }, "en");
    expect(en("hello", { count: 3 })).toBe("Hi 3");
    expect(en("missing")).toBe("missing");
  });
});
