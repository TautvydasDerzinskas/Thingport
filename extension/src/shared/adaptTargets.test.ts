import { describe, expect, it } from "vitest";
import type { AdaptView } from "./messages";
import {
  DEFAULT_TARGET,
  adaptInUse,
  adaptTargets,
  pickTarget,
  targetLine,
  targetName,
  type TargetPrinter,
} from "./adaptTargets";

const printer = (id: string, model: string, nozzle = "0.4"): TargetPrinter => ({
  id,
  brandName: "Bambu Lab",
  model,
  nozzle,
  bed: { shape: "rectangle", x: 256, y: 256 },
  height: 250,
  extruders: 1,
});
const P1S = printer("bambulab-p1s", "P1S");
const H2D = printer("bambulab-h2d", "H2D", "0.6");
const known: Record<string, TargetPrinter> = { [P1S.id]: P1S, [H2D.id]: H2D };
const describeKnown = ({ id, nozzle }: { id: string; nozzle: string }) => ({ ...known[id], nozzle });

const view = (over: Partial<AdaptView> = {}): AdaptView => ({
  own: { slicers: ["bambustudio", "prusaslicer"], printers: [{ id: P1S.id, nozzle: "0.4" }], placement: "beside" },
  thingport: null,
  instanceUrl: "",
  ...over,
});

describe("who copies are made for", () => {
  it("is Grab's own while not connected", () => {
    const use = adaptInUse(view(), describeKnown);
    expect(use).toMatchObject({ slicers: ["bambustudio", "prusaslicer"], printers: [P1S], fallback: null });
  });

  it("is the instance's once connected, Grab's printers where it has none of its own kind", () => {
    const thingport = { slicers: ["orcaslicer"], printers: [H2D], slicerPrinters: {}, unadapted: [] };
    expect(adaptInUse(view({ thingport }), describeKnown)).toMatchObject({
      slicers: ["orcaslicer"],
      printers: [H2D],
      slicersFromThingport: true,
      printersFromThingport: true,
      fallback: null,
    });
    expect(adaptInUse(view({ thingport: { ...thingport, printers: null } }), describeKnown)).toMatchObject({
      printers: [P1S],
      printersFromThingport: false,
      fallback: "no-printers",
    });
    expect(adaptInUse(view({ thingport: { error: "Failed to fetch" } }), describeKnown)).toMatchObject({
      slicers: ["bambustudio", "prusaslicer"],
      fallback: "unreachable",
      error: "Failed to fetch",
    });
  });

  it("is the copy PrusaSlicer and the like read until a slicer is picked", () => {
    const use = adaptInUse(view({ own: { slicers: [], printers: [], placement: "beside" } }), describeKnown);
    expect(adaptTargets(use)).toEqual([DEFAULT_TARGET]);
  });

  it("is one copy per printer for a slicer that loads presets by name, one for any other slicer", () => {
    const use = adaptInUse(
      view({
        own: {
          ...view().own,
          printers: [
            { id: P1S.id, nozzle: "0.4" },
            { id: H2D.id, nozzle: "0.6" },
          ],
        },
      }),
      describeKnown,
    );
    expect(adaptTargets(use).map((target) => target.key)).toEqual([
      "bambustudio|bambulab-p1s|0.4",
      "bambustudio|bambulab-h2d|0.6",
      "prusaslicer",
    ]);
  });

  it("is only the printer the instance names for a slicer, and leaves out a slicer wanted as it is", () => {
    const thingport = {
      slicers: ["bambustudio", "orcaslicer", "cura"],
      printers: [P1S, H2D],
      slicerPrinters: { orcaslicer: H2D.id, cura: P1S.id },
      unadapted: ["cura"],
    };
    expect(adaptTargets(adaptInUse(view({ thingport }), describeKnown)).map((target) => target.key)).toEqual([
      "bambustudio|bambulab-p1s|0.4",
      "bambustudio|bambulab-h2d|0.6",
      "orcaslicer|bambulab-h2d|0.6",
    ]);
    const allAsTheyAre = { ...thingport, slicers: ["cura"] };
    expect(adaptTargets(adaptInUse(view({ thingport: allAsTheyAre }), describeKnown))).toEqual([]);
  });

  it("makes the last one used again while it's on offer, else the first", () => {
    const targets = adaptTargets(adaptInUse(view(), describeKnown));
    expect(pickTarget(targets, "prusaslicer")?.key).toBe("prusaslicer");
    expect(pickTarget(targets, "gone")?.key).toBe("bambustudio|bambulab-p1s|0.4");
    expect(pickTarget([], "prusaslicer")).toBeNull();
  });

  it("names each copy by its printer, else its slicer", () => {
    const [forPrinter, forSlicer] = adaptTargets(adaptInUse(view(), describeKnown));
    expect(targetName(forPrinter)).toEqual({ name: "Bambu Lab P1S", sub: "Bambu Studio" });
    expect(targetLine(forPrinter)).toBe("Bambu Lab P1S · Bambu Studio");
    expect(targetName(forSlicer)).toEqual({ name: "PrusaSlicer", sub: "Your own printer and settings" });
    expect(targetLine(DEFAULT_TARGET)).toBe("For PrusaSlicer · pick your slicer");
  });
});
