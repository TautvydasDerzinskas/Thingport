import i18next from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";
import type { PlateProfile } from "../../api/prints";
import en from "../../i18n/locales/en.json";
import fr from "../../i18n/locales/fr.json";
import lt from "../../i18n/locales/lt.json";
import { fileRowText } from "./fileRowText";

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
    expect(fileRowText(t, "part.3mf", 0, profile).primary).toBe("0.22mm layer, 2 walls, 10% infill");
    expect(secondaryText(profile)).toBe("part|0.4|0.22|PLA|3|1h 23m|12g|Bambu Lab A1 mini");
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
    expect(secondaryText({ ...empty, nozzle_mm: 0.4, layer_height_mm: 0.2 })).toBe("0.4|0.2");
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
