import { describe, expect, it } from "vitest";
import { guessDelimiter, parseDelimited, previewTable } from "./delimited";

describe("a CSV or TSV preview", () => {
  it("reads quoted fields holding the delimiter, quotes and line breaks", () => {
    const text = 'part,qty,note\r\n"M3, 8 mm",4,"say ""hi""\nand bye"\nbelly,1,\n';
    expect(parseDelimited(text, ",")).toEqual([
      ["part", "qty", "note"],
      ["M3, 8 mm", "4", 'say "hi"\nand bye'],
      ["belly", "1", ""],
    ]);
  });

  it("skips a byte-order mark and blank lines, and stops at the rows it shows", () => {
    const text = "﻿a\tb\n\n1\t2\n3\t4\n5\t6";
    expect(parseDelimited(text, "\t")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
      ["5", "6"],
    ]);
    expect(parseDelimited(text, "\t", 2)).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("guesses the delimiter from the first line", () => {
    expect(guessDelimiter("a,b,c", "csv")).toBe(",");
    expect(guessDelimiter("a;b;c", "csv")).toBe(";");
    expect(guessDelimiter("a\tb\tc", "csv")).toBe("\t");
    expect(guessDelimiter("a,b", "tsv")).toBe("\t");
  });

  it("keeps a quoted empty field, which a blank line isn't", () => {
    expect(parseDelimited('name\n""\nbolt\n\n""', ",")).toEqual([["name"], [""], ["bolt"], [""]]);
  });

  it("counts a delimiter only outside quotes when guessing it", () => {
    expect(guessDelimiter('"size;colour;material",qty', "csv")).toBe(",");
    expect(guessDelimiter('"a ""b"", c";d;e', "csv")).toBe(";");
  });

  it("guesses from the whole header, though a quoted name in it spans lines", () => {
    const text = '"part\nname";qty\nbolt;2\n';
    expect(guessDelimiter(text, "csv")).toBe(";");
    expect(previewTable(text, "csv", 10)).toMatchObject({ head: ["part\nname", "qty"], body: [["bolt", "2"]] });
    // Only the header: the rows under it don't outvote it.
    expect(guessDelimiter("a;b\n1,2,3,4\n", "csv")).toBe(";");
  });

  it("says when a table has more rows than its preview shows", () => {
    const table = (rows: number) => ["part,qty", ...Array.from({ length: rows }, (_, i) => `p${i},${i}`)].join("\n");
    expect(previewTable(table(3), "csv", 3)).toMatchObject({ head: ["part", "qty"], more: false });
    const longer = previewTable(table(4), "csv", 3);
    expect(longer.body).toHaveLength(3);
    expect(longer.more).toBe(true);
  });
});
