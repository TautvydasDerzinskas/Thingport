import { describe, expect, it } from "vitest";
import { MAKERWORLD_ADAPT } from "../../providers/makerworld/adaptSite";
import { DEFAULT_TARGET, type AdaptTarget, type TargetPrinter } from "../../shared/adaptTargets";
import { copiesFor, explanation, outputFor } from "./offer";

const P1S: TargetPrinter = {
  id: "bambulab-p1s",
  brandName: "Bambu Lab",
  model: "P1S",
  nozzle: "0.4",
  bed: { shape: "rectangle", x: 256, y: 256 },
  height: 250,
  extruders: 1,
};
const target = (slicer: string, printer: TargetPrinter | null = null): AdaptTarget => ({
  key: printer ? `${slicer}|${printer.id}|${printer.nozzle}` : slicer,
  slicer,
  printer,
});

describe("Download adapted's copies of MakerWorld's files", () => {
  it("are made for every slicer that mis-reads Bambu Studio projects, and for a printer in Bambu Studio itself", () => {
    expect(outputFor(MAKERWORLD_ADAPT, target("bambustudio"))).toBeNull();
    expect(outputFor(MAKERWORLD_ADAPT, target("bambustudio", P1S))).toBe("bambu");
    expect(outputFor(MAKERWORLD_ADAPT, target("prusaslicer"))).toBe("prusa");
    expect(outputFor(MAKERWORLD_ADAPT, target("cura"))).toBe("cura");
    expect(outputFor(MAKERWORLD_ADAPT, DEFAULT_TARGET)).toBe("prusa");
  });

  it("leave out a slicer that opens them as they are", () => {
    const offered = copiesFor(MAKERWORLD_ADAPT, [target("bambustudio"), target("bambustudio", P1S), target("cura")]);
    expect(offered.map((t) => t.key)).toEqual(["bambustudio|bambulab-p1s|0.4", "cura"]);
  });

  it("say what each keeps", () => {
    const forPrinter = explanation(MAKERWORLD_ADAPT, target("bambustudio", P1S));
    expect(forPrinter).toContain("your Bambu Lab P1S with its 0.4 mm nozzle in Bambu Studio");
    expect(forPrinter).toContain("lays the plates out on its bed");
    expect(explanation(MAKERWORLD_ADAPT, target("cura"))).toContain("Cura doesn't read painted colors");
    expect(explanation(MAKERWORLD_ADAPT, target("prusaslicer"))).toMatch(
      /^MakerWorld's files are Bambu Studio projects, which PrusaSlicer often opens/,
    );
    const unpicked = explanation(MAKERWORLD_ADAPT, DEFAULT_TARGET);
    expect(unpicked).toContain("PrusaSlicer, Cura and other slicers often open");
    expect(unpicked).toContain("Pick your slicer in Grab's Adapt 3MFs settings");
  });
});
