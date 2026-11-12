import { describe, expect, it } from "vitest";
import { frameSize, printerArtSvg, type ArtPrinter } from "./printerArt";

const printer = (over: Partial<ArtPrinter> = {}): ArtPrinter => ({
  bed: { shape: "rectangle", x: 256, y: 256 },
  height: 250,
  extruders: 1,
  ...over,
});
const count = (svg: string, part: string) => svg.split(`class="${part}"`).length - 1;

describe("a printer's outline", () => {
  it("is wider for a bigger bed and taller for a taller printer, within the box", () => {
    const small = frameSize(printer({ bed: { shape: "rectangle", x: 180, y: 180 }, height: 180 }));
    const big = frameSize(printer({ bed: { shape: "rectangle", x: 350, y: 320 }, height: 325 }));
    expect(big.width).toBeGreaterThan(small.width);
    expect(big.height).toBeGreaterThan(small.height);
    const huge = frameSize(printer({ bed: { shape: "rectangle", x: 1000, y: 1000 }, height: 1000 }));
    expect(huge).toEqual({ width: 84, height: 84 });
    expect(frameSize(printer({ bed: null, height: null }))).toEqual(
      frameSize(printer({ bed: { shape: "rectangle", x: 220, y: 220 }, height: 220 })),
    );
  });

  it("has a head per extruder, up to four", () => {
    expect(count(printerArtSvg(printer()), "pa__head")).toBe(1);
    expect(count(printerArtSvg(printer({ extruders: 2 })), "pa__head")).toBe(2);
    expect(count(printerArtSvg(printer({ extruders: 8 })), "pa__head")).toBe(4);
    expect(count(printerArtSvg(printer({ extruders: 0 })), "pa__head")).toBe(1);
  });

  it("draws a round bed's printer as a delta's towers", () => {
    const svg = printerArtSvg(printer({ bed: { shape: "circle", x: 300, y: 300 } }));
    expect(svg).toContain("<ellipse");
    expect(count(svg, "pa__window")).toBe(0);
  });

  it("is decorative", () => {
    expect(printerArtSvg(printer())).toMatch(/^<svg class="pa" viewBox="0 0 100 100" aria-hidden="true"/);
  });
});
