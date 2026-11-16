import { afterEach, describe, expect, it, vi } from "vitest";
import type { SlicerSettings } from "../api/settings";

const settings = (slicer: string): SlicerSettings => ({
  slicer,
  slicers: ["a", "b", "c"],
  bridged: [],
  unadapted: [],
  printers: {},
  sendTargets: [],
});

/** A save the test answers when it likes. */
function deferred() {
  let settle!: { resolve: (value: SlicerSettings) => void; reject: (error: Error) => void };
  const promise = new Promise<SlicerSettings>((resolve, reject) => (settle = { resolve, reject }));
  return { promise, ...settle };
}

describe("switching slicer", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("goes back to the one stored when switches made one after another all fail, reads failing too", async () => {
    const { settingsApi } = await import("../api/settings");
    const slicers = await import("./useSlicerPreference");
    vi.spyOn(settingsApi, "getSlicer").mockResolvedValueOnce(settings("a")).mockRejectedValue(new Error("offline"));
    await slicers.reloadSlicerSettings();
    const toB = deferred();
    const toC = deferred();
    vi.spyOn(settingsApi, "updateSlicer").mockReturnValueOnce(toB.promise).mockReturnValueOnce(toC.promise);
    const b = slicers.switchSlicer("b");
    const c = slicers.switchSlicer("c");
    toC.reject(new Error("offline"));
    await c;
    toB.reject(new Error("offline"));
    await b;
    expect(slicers.slicerSettingsNow()?.slicer).toBe("a");
  });

  it("keeps a later pick that was saved when an earlier one fails", async () => {
    const { settingsApi } = await import("../api/settings");
    const slicers = await import("./useSlicerPreference");
    vi.spyOn(settingsApi, "getSlicer").mockResolvedValueOnce(settings("a")).mockRejectedValue(new Error("offline"));
    await slicers.reloadSlicerSettings();
    const firstB = deferred();
    vi.spyOn(settingsApi, "updateSlicer")
      .mockReturnValueOnce(firstB.promise)
      .mockResolvedValueOnce(settings("c"))
      .mockResolvedValueOnce(settings("b"));
    const first = slicers.switchSlicer("b");
    await slicers.switchSlicer("c");
    await slicers.switchSlicer("b");
    firstB.reject(new Error("offline"));
    await first;
    expect(slicers.slicerSettingsNow()?.slicer).toBe("b");
  });
});
