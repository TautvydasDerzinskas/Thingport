import { describe, expect, it } from "vitest";
import { LANGUAGE_FLAGS } from "./languageFlags";
import {
  languageFlagUrl,
  LOCALES,
  matchLanguage,
  NAMESPACES,
  SUPPORTED_LANGUAGES,
  translatedPercent,
} from "./languages";

describe("language flags", () => {
  it("has a flag file for every language it names, and a flag for every language offered", () => {
    const files = new Set(
      Object.keys(import.meta.glob("../../public/flags/*.svg")).map((path) => path.split("/").pop()),
    );
    const missing = Object.values(LANGUAGE_FLAGS).filter((flag) => !files.has(`${flag}.svg`));
    expect(missing).toEqual([]);
    expect(SUPPORTED_LANGUAGES.filter((l) => !languageFlagUrl(l.code)).map((l) => l.code)).toEqual([]);
  });

  it("finds a regional language's flag, then its base language's, and none for an unknown one", () => {
    expect(languageFlagUrl("en")).toBe("/flags/US.svg");
    expect(languageFlagUrl("pt-BR")).toBe("/flags/BR.svg");
    expect(languageFlagUrl("lt-LT")).toBe("/flags/LT.svg");
    expect(languageFlagUrl("eo")).toBeNull();
  });
});

describe("translatedPercent", () => {
  it("is 100 for English and counts a plural key once, whatever forms a language gives it", () => {
    expect(translatedPercent("en")).toBe(100);
    for (const { code } of SUPPORTED_LANGUAGES) expect(translatedPercent(code)).toBeLessThanOrEqual(100);
    expect(translatedPercent("xx")).toBe(0);
  });
});

describe("languages", () => {
  it("offers every locale file, English first, each named in itself", () => {
    expect(SUPPORTED_LANGUAGES.map((l) => l.code).toSorted()).toEqual(Object.keys(LOCALES).toSorted());
    expect(SUPPORTED_LANGUAGES[0].code).toBe("en");
    expect(SUPPORTED_LANGUAGES.find((l) => l.code === "lt")).toMatchObject({
      label: "Lietuvių",
      englishName: "Lithuanian",
    });
  });

  it("matches a regional or unknown language to a supported one", () => {
    expect(matchLanguage("lt")).toBe("lt");
    expect(matchLanguage("lt-LT")).toBe("lt");
    expect(matchLanguage("xx")).toBe("en");
    expect(matchLanguage(undefined)).toBe("en");
  });

  it("keeps every locale to the known namespaces", () => {
    const unknown = Object.entries(LOCALES).flatMap(([code, locale]) =>
      Object.keys(locale)
        .filter((ns) => !NAMESPACES.includes(ns))
        .map((ns) => `${code}.${ns}`),
    );
    expect(unknown).toEqual([]);
  });
});
