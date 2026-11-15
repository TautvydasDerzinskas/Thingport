import { describe, expect, it, vi } from "vitest";
import { scriptToast } from "./toast";

describe("scriptToast", () => {
  it("is just the message without a model to open", () => {
    const openModel = vi.fn<(id: string) => void>();
    expect(scriptToast("Saved", "success", undefined, { label: "Open", openModel })).toEqual({
      message: "Saved",
      severity: "success",
    });
    expect(scriptToast(42, "info", { openModel: "  " }, { label: "Open", openModel })).toEqual({
      message: "42",
      severity: "info",
    });
  });

  it("ignores an openModel that isn't an id", () => {
    const options = { openModel: { id: "m1" } } as unknown as { openModel: string };
    expect(
      scriptToast("Saved", "success", options, { label: "Open", openModel: vi.fn<(id: string) => void>() }).action,
    ).toBeUndefined();
  });

  it("puts an Open button on it that opens the model, and stays up longer", () => {
    const openModel = vi.fn<(id: string) => void>();
    const toast = scriptToast("Saved", "success", { openModel: "m1" }, { label: "Open", openModel });
    expect(toast.action?.label).toBe("Open");
    expect(toast.autoHideMs).toBeGreaterThan(4000);
    toast.action?.onClick();
    expect(openModel).toHaveBeenCalledWith("m1");
  });
});
