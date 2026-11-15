import { describe, expect, it, vi } from "vitest";
import { closeOnBackdrop } from "./dialog";

// A dialog at 100,100 to 300,200, with only what the helper touches.
function fakeDialog() {
  const listeners = new Map<string, (event: unknown) => void>();
  const dialog = {
    addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
    getBoundingClientRect: () => ({ left: 100, right: 300, top: 100, bottom: 200 }),
  };
  const fire = (type: string, x: number, y: number, target: unknown = dialog) =>
    listeners.get(type)?.({ target, clientX: x, clientY: y });
  return { dialog: dialog as unknown as HTMLDialogElement, fire };
}

function press(from: [number, number], to: [number, number], target?: unknown) {
  const { dialog, fire } = fakeDialog();
  const close = vi.fn();
  closeOnBackdrop(dialog, close);
  fire("pointerdown", ...from, target);
  fire("click", ...to, target);
  return close;
}

describe("closeOnBackdrop", () => {
  it("closes on a click beside the dialog", () => {
    expect(press([50, 50], [50, 50])).toHaveBeenCalledOnce();
    expect(press([150, 250], [150, 250])).toHaveBeenCalledOnce();
  });

  it("stays open for a click on its padding, which lands on the dialog too", () => {
    expect(press([105, 105], [105, 105])).not.toHaveBeenCalled();
    expect(press([300, 200], [300, 200])).not.toHaveBeenCalled();
  });

  it("stays open for a click on what's inside it", () => {
    expect(press([50, 50], [50, 50], { tagName: "P" })).not.toHaveBeenCalled();
  });

  it("stays open when a press inside it ends outside, as a dragged text selection does", () => {
    expect(press([150, 150], [50, 50])).not.toHaveBeenCalled();
  });

  it("forgets a press once its click is over", () => {
    const { dialog, fire } = fakeDialog();
    const close = vi.fn();
    closeOnBackdrop(dialog, close);
    fire("pointerdown", 50, 50);
    fire("click", 150, 150);
    fire("click", 50, 50);
    expect(close).not.toHaveBeenCalled();
  });
});
