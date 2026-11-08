import { describe, expect, it } from "vitest";
import type { Plate, PrintProfile } from "../../../api/prints";
import { formatDuration, formatGrams, profileEntries, shortPrinter } from "./entries";

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
      plates,
      { a: profile("By someone", "community", 60), b: profile(null, null), d: profile("Designer's", "designer") },
      false,
    );
    expect(entries.map((entry) => entry.key)).toEqual(["d", "a", "b"]);
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
    expect(formatDuration(2415)).toBe("40m");
    expect(formatDuration(91880)).toBe("25h 31m");
    expect(formatDuration(7200)).toBe("2h");
    expect(formatDuration(0)).toBeNull();
    expect(formatGrams(295)).toBe("295 g");
    expect(formatGrams(2.25)).toBe("2.3 g");
    expect(formatGrams(1500)).toBe("1.50 kg");
    expect(formatGrams(null)).toBeNull();
  });

  it("drops the maker where there's little room", () => {
    expect(shortPrinter("Bambu Lab A1 mini")).toBe("A1 mini");
    expect(shortPrinter("Creality K2 Pro")).toBe("K2 Pro");
    expect(shortPrinter("Voron 2.4")).toBe("Voron 2.4");
  });
});
