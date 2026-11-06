import i18next from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";
import type { PlateProfile } from "../../api/prints";
import en from "../../i18n/locales/en.json";
import fr from "../../i18n/locales/fr.json";
import lt from "../../i18n/locales/lt.json";
import { fileRowText, isRedundantTitle, profileSummary } from "./fileRowText";

const i18n = i18next.createInstance();
await i18n.init({ lng: "en", defaultNS: "models", resources: { en: { models: en.models } } });
const t = i18n.t.bind(i18n);

const i18nLt = i18next.createInstance();
await i18nLt.init({ lng: "lt", defaultNS: "models", resources: { lt: { models: lt.models } } });

const empty: PlateProfile = {
  title: null,
  printer: null,
  nozzle_mm: null,
  layer_height_mm: null,
  materials: [],
  plates: null,
  estimated_seconds: null,
  plate_stats: [],
  weight_g: null,
};

const i18nFr = i18next.createInstance();
await i18nFr.init({ lng: "fr", defaultNS: "models", resources: { fr: { models: fr.models } } });

/** The row's second line as rendered markup. */
function secondaryHtml(profile?: PlateProfile | null, filename = "part.3mf"): string {
  const { secondary } = fileRowText(t, filename, 0, profile);
  return renderToStaticMarkup(<I18nextProvider i18n={i18n}>{secondary}</I18nextProvider>);
}

/** The row's second line as visible text, icons and markup stripped. */
function secondaryText(profile?: PlateProfile | null, filename = "part.3mf"): string {
  return secondaryHtml(profile, filename)
    .replace(/<(svg|style)[^>]*>.*?<\/\1>/g, "")
    .replace(/<[^>]+>/g, "|")
    .replace(/\|+/g, "|")
    .replace(/^\||\|$/g, "");
}

describe("fileRowText", () => {
  it("keeps today's text without a profile", () => {
    expect(fileRowText(t, "part.stl", 1)).toEqual({ primary: "part", secondary: "File 2 · STL" });
  });

  it("shows the profile title and one badge per known value", () => {
    const profile: PlateProfile = {
      ...empty,
      title: "0.22mm layer, 2 walls, 10% infill",
      printer: "Bambu Lab A1 mini",
      nozzle_mm: 0.4,
      layer_height_mm: 0.22,
      materials: ["PLA"],
      plates: 3,
      estimated_seconds: 4980,
      weight_g: 12.34,
    };
    expect(fileRowText(t, "part.3mf", 0, profile).primary).toBe("0.22 mm");
    expect(secondaryText(profile)).toBe(
      "0.22mm layer, 2 walls, 10% infill|0.4|0.22|PLA|3|1h 23m|12g|Bambu Lab A1 mini",
    );
  });

  it("builds the headline from the fields and keeps the file name as hover text", () => {
    const profile: PlateProfile = { ...empty, title: "Draft", layer_height_mm: 0.08, walls: 6, supports: "tree" };
    expect(fileRowText(t, "part.3mf", 0, profile).primary).toBe("0.08 mm · 6 walls · Tree supports");
    expect(secondaryHtml(profile)).toContain('title="part · File 1 · 3MF"');
  });

  it("shows the file name under the headline when the profile has no title", () => {
    const profile: PlateProfile = { ...empty, layer_height_mm: 0.2, nozzle_mm: 0.4 };
    expect(fileRowText(t, "part.3mf", 0, profile).primary).toBe("0.2 mm");
    expect(secondaryText(profile)).toBe("part|0.4|0.2");
  });

  it("keeps the title as headline when there are no print settings", () => {
    const profile: PlateProfile = { ...empty, title: "Draft", printer: "MK4" };
    expect(fileRowText(t, "part.3mf", 0, profile).primary).toBe("Draft");
    expect(secondaryText(profile)).toBe("part|MK4");
  });

  it("falls back to the file name when only badges are known", () => {
    const profile = { ...empty, printer: "MK4" };
    expect(fileRowText(t, "part.3mf", 0, profile).primary).toBe("part");
    expect(secondaryText(profile)).toBe("MK4");
  });

  it("falls back fully for an empty profile", () => {
    expect(fileRowText(t, "part.3mf", 0, empty)).toEqual(fileRowText(t, "part.3mf", 0));
  });

  it("joins materials", () => {
    expect(secondaryText({ ...empty, materials: ["PLA", "PETG"] })).toBe("PLA/PETG");
  });

  it("drops trailing zeros from numbers", () => {
    expect(secondaryText({ ...empty, nozzle_mm: 0.4, layer_height_mm: 0.2 })).toBe("part|0.4|0.2");
  });

  it("shows time and weight alone", () => {
    expect(secondaryText({ ...empty, estimated_seconds: 45 * 60, weight_g: 120 })).toBe("45m|120g");
  });

  it("names each badge for screen readers", () => {
    const html = secondaryHtml({ ...empty, nozzle_mm: 0.4, estimated_seconds: 4980 });
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="0.4 mm nozzle"');
    expect(secondaryHtml({ ...empty, layer_height_mm: 0.22 })).toContain('aria-label="0.22 mm layer height"');
    expect(html).toContain('aria-label="Print time 1h 23m"');
  });

  it("formats nozzle and layer with the language's decimal mark", () => {
    const { secondary } = fileRowText(i18nLt.t.bind(i18nLt), "part.3mf", 0, {
      ...empty,
      nozzle_mm: 0.4,
      layer_height_mm: 0.2,
    });
    const html = renderToStaticMarkup(<I18nextProvider i18n={i18nLt}>{secondary}</I18nextProvider>);
    expect(html).toContain(">0,4<");
    expect(html).toContain(">0,2<");
  });

  it("treats zero time and weight as unknown", () => {
    expect(fileRowText(t, "part.3mf", 0, { ...empty, estimated_seconds: 0, weight_g: 0 })).toEqual(
      fileRowText(t, "part.3mf", 0),
    );
  });

  it("keeps the title with today's secondary text when there are no badges", () => {
    expect(fileRowText(t, "part.3mf", 0, { ...empty, title: "Draft" })).toEqual({
      primary: "Draft",
      secondary: "part · File 1 · 3MF",
    });
  });

  it("shows a tiny time and weight as a lower bound, not zero", () => {
    const text = secondaryText({ ...empty, estimated_seconds: 20, weight_g: 0.02 });
    expect(text).toContain("&lt;1m");
    expect(text).toContain("&lt;0.1g");
  });

  it.each([
    ["lt", i18nLt, "1 h 23 min.", "2,5 g"],
    ["fr", i18nFr, "1h 23min", "2,5g"],
  ])("formats time and weight in %s", (_lng, instance, time, weight) => {
    const { secondary } = fileRowText(instance.t.bind(instance), "part.3mf", 0, {
      ...empty,
      estimated_seconds: 4980,
      weight_g: 2.5,
    });
    const html = renderToStaticMarkup(<I18nextProvider i18n={instance}>{secondary}</I18nextProvider>);
    // Intl separates number and unit with a no-break space in some languages.
    const text = html.replace(/\s/g, " ");
    expect(text).toContain(`>${time}<`);
    expect(text).toContain(`>${weight}<`);
  });
});

describe("profileSummary", () => {
  const full: PlateProfile = {
    ...empty,
    layer_height_mm: 0.08,
    walls: 6,
    infill_density_pct: 40,
    infill_pattern: "gyroid",
    supports: "tree",
  };

  it("joins layer, walls, infill and supports in a fixed order", () => {
    expect(profileSummary(t, full, "en")).toBe("0.08 mm · 6 walls · 40% Gyroid · Tree supports");
  });

  it("leaves out what the file doesn't say", () => {
    expect(profileSummary(t, { ...empty, walls: 1, infill_pattern: "grid" }, "en")).toBe("1 wall · Grid");
    expect(profileSummary(t, { ...empty, supports: "normal" }, "en")).toBe("Normal supports");
  });

  it("is null when nothing is known, and ignores 'no supports' and the title", () => {
    expect(profileSummary(t, empty, "en")).toBeNull();
    expect(profileSummary(t, { ...empty, supports: "none", walls: 0, title: "0.2mm, 3 walls" }, "en")).toBeNull();
  });

  it("uses the language's number format and plural", () => {
    expect(profileSummary(i18nLt.t.bind(i18nLt), { ...full, walls: 2 }, "lt")).toMatch(/^0,08 mm · 2 sienelės · 40\s%/);
    expect(profileSummary(i18nFr.t.bind(i18nFr), { ...full, walls: 3 }, "fr")).toContain("3 parois");
  });
});

describe("isRedundantTitle", () => {
  const p: PlateProfile = { ...empty, layer_height_mm: 0.275, walls: 1, infill_density_pct: 5 };

  it("flags a title that only repeats the shown numbers", () => {
    expect(isRedundantTitle("0.275mm layer, 1 walls, 5% infill (modifiers)", p)).toBe(true);
    expect(isRedundantTitle("0.2750 MM LAYER", p)).toBe(true);
  });

  it("keeps titles with other numbers or words", () => {
    expect(isRedundantTitle("0.28mm layer, 1 walls", p)).toBe(false);
    expect(isRedundantTitle("Draft, 0.275mm", p)).toBe(false);
    expect(isRedundantTitle("0.275mm Standard @BBL X1C", p)).toBe(false);
  });

  it("handles empty, number-free and zero cases", () => {
    expect(isRedundantTitle(null, p)).toBe(false);
    expect(isRedundantTitle("", p)).toBe(false);
    expect(isRedundantTitle("layer walls", p)).toBe(false);
    expect(isRedundantTitle("0 walls", { ...p, walls: 0 })).toBe(true);
    expect(isRedundantTitle("1 walls", empty)).toBe(false);
  });

  it("stays fast on hostile input", () => {
    const start = performance.now();
    expect(isRedundantTitle("1".repeat(190) + ".".repeat(5), p)).toBe(false);
    expect(isRedundantTitle("1.".repeat(100_000), p)).toBe(false);
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it("swaps a redundant title for the file name in the row", () => {
    const profile: PlateProfile = { ...p, title: "0.275mm layer, 1 walls, 5% infill (modifiers)" };
    expect(secondaryText(profile)).toBe("part|0.275");
  });
});
