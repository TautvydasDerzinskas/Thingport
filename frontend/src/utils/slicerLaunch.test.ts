import { describe, expect, it } from "vitest";
import { isBridgedSlicer, slicerLaunchUrl } from "./slicerLaunch";

const FILE = "https://things.example/api/t/tok/print/p1/plate/a1/file/Ghost%20light.stl";

describe("slicerLaunchUrl", () => {
  it("opens eufyMake Studio the way its site's own button does", () => {
    expect(slicerLaunchUrl("eufystudio3d", FILE, "Ghost light.stl")).toBe(
      `eufystudio3d://open/?file=${encodeURIComponent(FILE)}&name=Ghost%20light.stl`,
    );
  });

  it("names a 3MF for eufyMake Studio in the lowercase it opens", () => {
    expect(slicerLaunchUrl("eufystudio3d", FILE, "Ghost light.3MF")).toBe(
      `eufystudio3d://open/?file=${encodeURIComponent(FILE)}&name=Ghost%20light.3mf`,
    );
  });

  it("sends the slicers that won't take a self-hosted link through the Bridge", () => {
    expect(slicerLaunchUrl("prusaslicer", FILE, "a.stl")).toBe(
      `thingport://open?url=${encodeURIComponent(FILE)}&slicer=prusaslicer&filename=a.stl`,
    );
  });

  it("opens a slicer with its own protocol through the Bridge when the user picked that", () => {
    expect(slicerLaunchUrl("crealityprintlink", FILE)).toBe(
      `crealityprintlink://open?file=${encodeURIComponent(FILE)}`,
    );
    expect(slicerLaunchUrl("crealityprintlink", FILE, "Ghost light.stl", ["crealityprintlink"])).toBe(
      `thingport://open?url=${encodeURIComponent(FILE)}&slicer=crealityprintlink&filename=Ghost+light.stl`,
    );
    // Only for the slicer picked.
    expect(slicerLaunchUrl("orcaslicer", FILE, undefined, ["crealityprintlink"])).toBe(
      `orcaslicer://open?file=${encodeURIComponent(FILE)}`,
    );
  });

  it("tells which slicers open through the Bridge", () => {
    expect(isBridgedSlicer("bambustudio")).toBe(true);
    expect(isBridgedSlicer("elegooslicer")).toBe(false);
    expect(isBridgedSlicer("elegooslicer", ["elegooslicer"])).toBe(true);
    // Nothing to send through it.
    expect(isBridgedSlicer("other", ["other"])).toBe(false);
  });

  it("opens the others by their own scheme", () => {
    expect(slicerLaunchUrl("orcaslicer", FILE)).toBe(`orcaslicer://open?file=${encodeURIComponent(FILE)}`);
  });
});
