import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";
import type { Plate, PrintProfile } from "../../../api/prints";
import en from "../../../i18n/locales/en.json";
import fr from "../../../i18n/locales/fr.json";
import { printerLine, profileEntries, settingsLine, shortPrinter } from "./entries";
import { profileFormat } from "./format";

/** The locale's own strings, filled in as i18next does: enough for the profile keys. */
function tFrom(locale: { models: { detail: { profiles: Record<string, string> } } }): TFunction {
  return ((key: string, values: Record<string, unknown> = {}) => {
    const name = key.replace(/^models:detail\.profiles\./, "");
    const count = typeof values.count === "number" ? values.count : null;
    const strings = locale.models.detail.profiles;
    const text = (count !== null && strings[`${name}_${count === 1 ? "one" : "other"}`]) || strings[name] || key;
    return text.replace(/\{\{(\w+)\}\}/g, (_, field: string) => String(values[field]));
  }) as unknown as TFunction;
}

const plate = (id: string, position: number, filename: string, profileId: string | null): Plate => ({
  id,
  print_id: "print",
  position,
  filename,
  mime: "model/3mf",
  size: 1,
  url: `/print/print/plate/${id}/file/${filename}`,
  profile_id: profileId,
});

const profile = (
  title: string | null,
  origin: PrintProfile["origin"],
  seconds: number | null = null,
): PrintProfile => ({
  title,
  description: null,
  origin,
  creator: null,
  seconds,
  grams: null,
  filaments: [],
  plates: [],
  printer: null,
  nozzle_mm: null,
  layer_mm: null,
  infill: null,
  walls: null,
  supports: null,
});

describe("a model's print profiles", () => {
  const plates = [
    plate("a", 0, "first.3mf", "1"),
    plate("b", 1, "second.3mf", "2"),
    plate("c", 2, "raw.stl", null),
    plate("d", 3, "fourth.3mf", "4"),
  ];

  it("lists the designer's first, then the community's, then the rest, each in file order", () => {
    const entries = profileEntries(
      // Given out of order: the files' positions decide within each group.
      [plates[3], plate("e", 4, "fifth.3mf", "5"), plates[1], plate("f", 5, "sixth.3mf", "6"), plates[0], plates[2]],
      {
        a: profile("By someone", "community", 60),
        b: profile(null, null),
        d: profile("Designer's", "designer"),
        e: profile("Community", "community"),
        f: profile("Designer", "designer"),
      },
      false,
    );
    expect(entries.map((entry) => entry.key)).toEqual(["d", "f", "a", "e", "b"]);
  });

  it("names a profile after its file until its name is known, and says it's still being read", () => {
    const [entry] = profileEntries([plates[1]], {}, true);
    expect(entry).toMatchObject({ title: "second", loading: true });
    const [read] = profileEntries([plates[1]], { b: profile("Fine detail", null, 3600) }, true);
    expect(read).toMatchObject({ title: "Fine detail", loading: false });
  });

  it("is none at all on a backend that doesn't mark profiles", () => {
    expect(profileEntries([{ ...plates[0], profile_id: undefined }], {}, false)).toEqual([]);
  });
});

describe("profile numbers", () => {
  it("reads times and weights the way slicers do", () => {
    const format = profileFormat(tFrom(en), "en");
    expect(format.duration(2415)).toBe("40m");
    expect(format.duration(91880)).toBe("25h 31m");
    expect(format.duration(7200)).toBe("2h");
    expect(format.duration(0)).toBeNull();
    expect(format.grams(295)).toBe("295 g");
    expect(format.grams(2.25)).toBe("2.3 g");
    expect(format.grams(1500)).toBe("1.50 kg");
    expect(format.grams(null)).toBeNull();
  });

  it("writes them in the reader's language", () => {
    const t = tFrom(fr);
    const format = profileFormat(t, "fr");
    expect(format.duration(2415)).toBe("40 min");
    expect(format.duration(91880)).toBe("25 h 31 min");
    expect(format.grams(2.25)).toBe("2,3 g");
    const settings = { ...profile(null, null), printer: "Bambu Lab A1 mini", nozzle_mm: 0.4, layer_mm: 0.2, walls: 2 };
    expect(printerLine(t, format, settings)).toBe("Bambu Lab A1 mini · buse de 0,4 mm");
    expect(settingsLine(t, format, settings)).toBe("couches de 0,20 mm · 2 parois");
  });

  it("drops the maker where there's little room", () => {
    expect(shortPrinter("Bambu Lab A1 mini")).toBe("A1 mini");
    expect(shortPrinter("Creality K2 Pro")).toBe("K2 Pro");
    expect(shortPrinter("Voron 2.4")).toBe("Voron 2.4");
  });
});
