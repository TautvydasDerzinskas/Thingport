import { describe, expect, it } from "vitest";
import { slicerLaunchUrl } from "./slicerLaunch";

const FILE = "https://things.example/api/t/tok/print/p1/plate/a1/file/Ghost%20light.stl";

describe("slicerLaunchUrl", () => {
  it("opens eufyMake Studio the way its site's own button does", () => {
    expect(slicerLaunchUrl("eufystudio3d", FILE, "Ghost light.stl")).toBe(
      `eufystudio3d://open/?file=${encodeURIComponent(FILE)}&name=Ghost%20light.stl`,
    );
  });

  it("sends the slicers that won't take a self-hosted link through the Bridge", () => {
    expect(slicerLaunchUrl("prusaslicer", FILE, "a.stl")).toBe(
      `thingport://open?url=${encodeURIComponent(FILE)}&slicer=prusaslicer&filename=a.stl`,
    );
  });

  it("opens the others by their own scheme", () => {
    expect(slicerLaunchUrl("orcaslicer", FILE)).toBe(`orcaslicer://open?file=${encodeURIComponent(FILE)}`);
  });
});
