import { describe, expect, it } from "vitest";
import { LOCALES, matchLanguage, NAMESPACES, SUPPORTED_LANGUAGES } from "./languages";

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
