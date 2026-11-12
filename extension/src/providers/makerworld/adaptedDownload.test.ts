import { afterEach, describe, expect, it, vi } from "vitest";

const api = vi.fn();
vi.mock("../../content/runtime", () => ({ api: (...args: unknown[]) => api(...args) }));

const { instanceSlicer, offerFor } = await import("./adaptedDownload");

afterEach(() => {
  api.mockReset();
  vi.useRealTimers();
});

describe("what Download adapted offers", () => {
  it("is the copy for the instance's slicer, nothing where that slicer opens MakerWorld's files as they are", () => {
    expect(offerFor({ slicer: "cura" })).toEqual({ target: { known: true, slicer: "cura" }, output: "cura" });
    expect(offerFor({ slicer: "bambustudio" })).toBeNull();
    expect(offerFor({ slicer: null })).toEqual({ target: { known: true, slicer: null }, output: "prusa" });
  });

  it("asks again when the instance didn't answer, rather than taking it as having no slicer", () => {
    expect(offerFor(null)).toEqual({ target: { known: false }, output: "prusa" });
  });

  it("is nothing for a slicer whose adapted copies its user switched off", () => {
    expect(offerFor({ slicer: "cura", adapted: false })).toBeNull();
  });
});

describe("the instance's slicer", () => {
  it("is its answer, or null when it fails or doesn't answer in time", async () => {
    api.mockResolvedValueOnce({ slicer: "orcaslicer" });
    expect(await instanceSlicer()).toEqual({ slicer: "orcaslicer" });
    api.mockResolvedValueOnce({ slicer: null });
    expect(await instanceSlicer()).toEqual({ slicer: null });
    api.mockResolvedValueOnce({ slicer: "cura", unadapted: ["cura"] });
    expect(await instanceSlicer()).toEqual({ slicer: "cura", adapted: false });
    api.mockResolvedValueOnce({ slicer: "cura", unadapted: ["orcaslicer"] });
    expect(await instanceSlicer()).toEqual({ slicer: "cura" });
    api.mockRejectedValueOnce(new Error("offline"));
    expect(await instanceSlicer()).toBeNull();

    vi.useFakeTimers();
    api.mockReturnValueOnce(new Promise(() => {}));
    const pending = instanceSlicer(5000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toBeNull();
  });
});
