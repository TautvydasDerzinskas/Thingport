import { describe, expect, it } from "vitest";
import { DEFAULT_ADAPT, adaptSettingsOf, adaptUpdate, defaultNozzle } from "./adaptSettings";

describe("Adapt 3MFs' own settings", () => {
  it("are nothing picked and the button beside the site's until something is", () => {
    expect(adaptSettingsOf({})).toEqual(DEFAULT_ADAPT);
    expect(DEFAULT_ADAPT).toEqual({ slicers: [], printers: [], placement: "beside" });
  });

  it("keep only slicers Grab knows, in the web app's order", () => {
    expect(adaptSettingsOf({ adaptSlicers: ["prusaslicer", "nope", 3, "bambustudio", "bambustudio"] }).slicers).toEqual(
      ["bambustudio", "prusaslicer"],
    );
  });

  it("keep each well-formed printer once, in the order added", () => {
    const printers = adaptSettingsOf({
      adaptPrinters: [
        { id: "bambulab-p1s", nozzle: "0.4" },
        { id: "bambulab-p1s", nozzle: "0.6" },
        { id: "Bad Id", nozzle: "0.4" },
        { id: "prusaresearch-mk4s", nozzle: "HF0.4" },
        { id: "creality-k1", nozzle: "wide" },
        null,
      ],
    }).printers;
    expect(printers).toEqual([
      { id: "bambulab-p1s", nozzle: "0.4" },
      { id: "prusaresearch-mk4s", nozzle: "HF0.4" },
    ]);
  });

  it("read a place a newer Grab wrote as the default", () => {
    expect(adaptSettingsOf({ adaptPlacement: "bubble" }).placement).toBe("bubble");
    expect(adaptSettingsOf({ adaptPlacement: "sidebar" }).placement).toBe("beside");
  });

  it("write only what changed, cleaned", () => {
    expect(adaptUpdate({ placement: "bubble" })).toEqual({ adaptPlacement: "bubble" });
    expect(adaptUpdate({ slicers: ["cura", "nope"] })).toEqual({ adaptSlicers: ["cura"] });
    expect(adaptUpdate({ placement: "sidebar" as never })).toEqual({});
  });

  it("add a printer with its 0.4 nozzle, else its first", () => {
    expect(defaultNozzle(["0.2", "0.4", "0.6"])).toBe("0.4");
    expect(defaultNozzle(["0.6", "0.8"])).toBe("0.6");
    expect(defaultNozzle([])).toBe("0.4");
  });
});
