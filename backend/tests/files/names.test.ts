import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import {
  isJunk,
  NAME_MAX_BYTES,
  nameKey,
  normalizeFileName,
  numberedName,
  splitName,
  type NormalName,
} from "../../src/files/names";
import vectors from "./vectors.json";

// The name rule (src/files/names.ts): hard names by example in vectors.json, and what holds for any name by fast-check,
// with a fixed seed so a run is the same everywhere.

const SEED = { seed: 20261122, numRuns: 2000 };
const bytes = (text: string) => Buffer.byteLength(text, "utf8");
/** Any string, every code point a name could hold, control characters and lone surrogates included. */
const anyName = fc.string({ unit: "binary", maxLength: 300 });
/** Mostly the characters that interact: letters and their accents, control characters, dots, kinds of space. */
const trickyName = fc.string({
  unit: fc.constantFrom(
    "e",
    "a",
    "E",
    "\u0301",
    "\u0308",
    "\u0001",
    "\u0085",
    ".",
    " ",
    "\u3000",
    "\u00a0",
    "/",
    "組",
    "_",
  ),
  maxLength: 40,
});

describe("normalizeFileName", () => {
  it.each(vectors.normalized)("%j is %j", (input, expected) => {
    expect(normalizeFileName(input)).toBe(expected);
  });

  it("makes no name from nothing", () => {
    expect(normalizeFileName(null)).toBe("imported-file");
    expect(normalizeFileName(undefined, "script")).toBe("script");
  });

  it("changes nothing the second time", () => {
    fc.assert(
      fc.property(fc.oneof(anyName, trickyName), (raw) => {
        expect(normalizeFileName(normalizeFileName(raw))).toBe(normalizeFileName(raw));
      }),
      SEED,
    );
  });

  it("never leaves a name Windows reserves, even where a cut makes one", () => {
    const reservedThenSpaces = fc
      .tuple(
        fc.constantFrom("CON", "aux", "LPT1", "nul"),
        fc.integer({ min: 0, max: 120 }),
        fc.constantFrom(".stl", "", ".backup.stl", ".tar.gz"),
      )
      .map(([stem, spaces, ext]) => `${stem}${"\u3000".repeat(spaces)}${ext}`);
    fc.assert(
      fc.property(reservedThenSpaces, (raw) => {
        const name = normalizeFileName(raw);
        expect(normalizeFileName(name)).toBe(name);
        // Whatever follows its first dot: Windows reserves "NUL.backup.stl" as much as "NUL".
        expect(name.split(".")[0]).not.toMatch(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i);
      }),
      SEED,
    );
  });

  it("is never empty, nor longer than a file system holds", () => {
    fc.assert(
      fc.property(anyName, (raw) => {
        const name = normalizeFileName(raw);
        expect(name).not.toBe("");
        expect(bytes(name)).toBeLessThanOrEqual(NAME_MAX_BYTES);
        expect(name).not.toMatch(/[/\\]/);
        expect(name).toBe(name.trim());
      }),
      SEED,
    );
  });

  it("keeps an extension, however long the name in front of it", () => {
    const ext = fc.constantFrom(".stl", ".3mf", ".gcode.3mf", ".tar.gz", ".pdf", ".STEP");
    fc.assert(
      fc.property(anyName, ext, (stem, extension) => {
        expect(normalizeFileName(`${stem}${extension}`).endsWith(extension)).toBe(true);
      }),
      SEED,
    );
  });
});

describe("splitName", () => {
  it.each(vectors.split)("%j is %j and %j", (name, stem, ext) => {
    expect(splitName(name)).toEqual({ stem, ext });
  });
});

describe("numberedName", () => {
  it.each(vectors.numbered)("%j number %i is %j", (name, n, expected) => {
    expect(numberedName(name as NormalName, n as number)).toBe(expected);
  });

  it.each(vectors.numberedWithin)("%j number %i within %i units is %j", (name, n, max, expected) => {
    expect(numberedName(name as NormalName, n as number, max as number)).toBe(expected);
  });

  it("stays within a storage segment's length too, keeping the number and the extension", () => {
    fc.assert(
      fc.property(anyName, fc.integer({ min: 2, max: 1000 }), (raw, n) => {
        const name = normalizeFileName(raw);
        const numbered = numberedName(name, n, 120);
        expect(numbered.length).toBeLessThanOrEqual(120);
        expect(numbered.endsWith(` (${n})${splitName(name).ext}`)).toBe(true);
      }),
      SEED,
    );
  });

  it("never gives two numbers the same name, and stays within the limit", () => {
    fc.assert(
      fc.property(anyName, fc.integer({ min: 2, max: 1000 }), fc.integer({ min: 2, max: 1000 }), (raw, n, m) => {
        fc.pre(n !== m);
        const name = normalizeFileName(raw);
        const [a, b] = [numberedName(name, n), numberedName(name, m)];
        expect(bytes(a)).toBeLessThanOrEqual(NAME_MAX_BYTES);
        expect(nameKey(null, a)).not.toBe(nameKey(null, b));
      }),
      SEED,
    );
  });
});

describe("nameKey", () => {
  it("tells names apart by folder and name, not by case", () => {
    const name = normalizeFileName("Frog.STL");
    expect(nameKey("Docs", name)).toBe(nameKey("docs", normalizeFileName("frog.stl")));
    expect(nameKey(null, name)).not.toBe(nameKey("docs", name));
  });
});

describe("isJunk", () => {
  it.each(vectors.junk)("%j: %s", (entryPath, junk) => {
    expect(isJunk(entryPath as string)).toBe(junk);
  });
});

describe("a name cut without Intl.Segmenter", () => {
  // As an older browser plans a rename: its cut must land where the server's does, or the extension it predicts differs.
  async function withoutSegmenter(): Promise<typeof normalizeFileName> {
    vi.resetModules();
    vi.stubGlobal("Intl", Object.create(Intl, { Segmenter: { value: undefined } }));
    try {
      return (await import("../../src/files/names")).normalizeFileName;
    } finally {
      vi.unstubAllGlobals();
    }
  }
  const tricky = [
    ..."aeb.界 _-0",
    "\u0301",
    "\u0338",
    "\u200D",
    "\uFE0F",
    "👨",
    "👧",
    "🏽",
    "🇱",
    "🇹",
    "☺",
    "क",
    "्",
    "ष",
    "ি",
    "ক",
    "্",
    "ত",
    "ก",
    "ำ",
    "้",
    "ம",
    "ி",
    "ຳ",
    "가",
    "각",
    "\u1100",
    "\u1161",
    "\u11A8",
    "ٌ",
    "ద",
    "్",
    "ര",
    "്",
  ];

  it("keeps a combining mark with its letter", async () => {
    const name = "界".repeat(76) + "aa.gcode\u0338x.3mf";
    expect((await withoutSegmenter())(name)).toBe(normalizeFileName(name));
  });

  it("keeps leading Hangul consonants together, which NFC leaves apart", async () => {
    const name = "界".repeat(75) + "aa.gcode\u1100\u1100.3mf";
    expect((await withoutSegmenter())(name)).toBe(normalizeFileName(name));
  });

  it("reads a long run of viramas one way, not at every split", async () => {
    const fallback = await withoutSegmenter();
    const name = `क${"्".repeat(50_000)}.stl`;
    const started = performance.now();
    expect(fallback(name)).toBe(normalizeFileName(name));
    // Linear, it's milliseconds; tried at every split, it took seconds.
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it("cuts between the same clusters as the server", async () => {
    const fallback = await withoutSegmenter();
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...tricky), { minLength: 1, maxLength: 40 }), (parts) => {
        const name = `${"界".repeat(70)}${parts.join("")}.3mf`;
        expect(fallback(name)).toBe(normalizeFileName(name));
      }),
      { numRuns: 500 },
    );
  });
});
