import i18next from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";
import type { PlateProfile } from "../api/prints";
import en from "../i18n/locales/en.json";
import ProfileDetails, { plateStatText, statForPlate } from "./ProfileDetails";

const i18n = i18next.createInstance();
await i18n.init({ lng: "en", defaultNS: "models", resources: { en: { models: en.models } } });

const profile: PlateProfile = {
  title: "Body",
  printer: "Bambu Lab X1C",
  nozzle_mm: 0.4,
  layer_height_mm: 0.2,
  materials: ["PLA", "PETG"],
  plates: 2,
  estimated_seconds: 4980,
  weight_g: 12.34,
  plate_stats: [
    { index: 1, estimated_seconds: 3600, weight_g: 8 },
    { index: 2, estimated_seconds: null, weight_g: null },
  ],
};

const render = (filename: string, p?: PlateProfile | null) =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <ProfileDetails filename={filename} profile={p} />
    </I18nextProvider>,
  );

describe("ProfileDetails", () => {
  it("lists every value of a full profile", () => {
    const html = render("body.3mf", profile);
    for (const k of ["printer", "nozzle", "layer", "material", "time", "weight", "plates", "file"]) {
      expect(html).toContain(`data-row="${k}"`);
    }
    expect(html).toContain("Bambu Lab X1C");
    expect(html).toContain("PLA / PETG");
    expect(html).toContain("ca. 1h 23m");
    expect(html).not.toContain('data-row="type"');
  });

  it("leaves out what the file does not say", () => {
    const html = render("a.3mf", { ...profile, printer: null, nozzle_mm: null, estimated_seconds: 0, weight_g: null });
    expect(html).not.toContain('data-row="printer"');
    expect(html).not.toContain('data-row="nozzle"');
    expect(html).not.toContain('data-row="time"');
    expect(html).not.toContain('data-row="weight"');
    expect(html).toContain('data-row="layer"');
  });

  it("shows only file name and type without a profile", () => {
    const html = render("part.stl", null);
    expect(html).toContain('data-row="file"');
    expect(html).toContain('data-row="type"');
    expect(html).toContain("STL");
    expect(html).not.toContain('data-row="printer"');
  });
});

describe("plateStatText", () => {
  it("joins time and weight of the plate with that index", () => {
    expect(plateStatText(statForPlate(profile, 1), "en")).toBe("1h · 8g");
  });
  it("is null for an unknown plate, a plate without values or no profile", () => {
    expect(plateStatText(statForPlate(profile, 3), "en")).toBeNull();
    expect(plateStatText(statForPlate(profile, 2), "en")).toBeNull();
    expect(plateStatText(statForPlate(null, 1), "en")).toBeNull();
  });
});
