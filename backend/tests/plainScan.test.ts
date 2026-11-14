import { describe, expect, it } from "vitest";
import { MAX_CARRY, plainModelScanner } from "../src/adapter/plainScan";

describe("reading a plain 3MF's models in pieces", () => {
  it("reads a tag split between two pieces with the second", () => {
    const scan = plainModelScanner();
    scan.add('<m:color color="#ff0000"/><triangle v1="0" v2="1" ');
    scan.add('v3="2" paint_color="4"/>');
    scan.endFile();
    expect(scan.result()).toEqual({ colours: 1, painted: true });
  });

  it("reads a tag that never ends once, rather than again with every piece", { timeout: 5000 }, () => {
    const scan = plainModelScanner();
    // 64 MiB of a comment with no end, in 64 KiB pieces: read again with each, that's terabytes of searching.
    const piece = "x".repeat(64 * 1024);
    scan.add('<triangle v1="0" v2="1" v3="2"/><!-- ');
    for (let i = 0; i < 1024; i++) scan.add(piece);
    scan.add(' --><triangle v1="0" v2="1" v3="2" paint_color="8"/>');
    scan.endFile();
    // One plain triangle and one painted: not every triangle is painted.
    expect(scan.result()).toEqual({ colours: 0, painted: false });
  });

  it("still counts a triangle too long to keep, by its start", () => {
    const scan = plainModelScanner();
    scan.add('<triangle v1="0" v2="1" v3="2" paint_color="4"/><triangle v1="0" v2="1" v3="2" slic3rpe:junk="');
    scan.add("0".repeat(MAX_CARRY + 1));
    scan.add('"/>');
    scan.endFile();
    // The long one isn't painted, so not every triangle is.
    expect(scan.result()).toEqual({ colours: 0, painted: false });
  });
});
