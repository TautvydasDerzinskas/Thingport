import { afterEach, describe, expect, it, vi } from "vitest";
import { onTopBarHeight, publishTopBarHeight, readTopBarHeight } from "./topBarHeight";

// No DOM here: the root element's style is a plain map, and the window a bare event target.
function stubPage() {
  const vars = new Map<string, string>();
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("document", {
    documentElement: { style: { setProperty: (name: string, value: string) => vars.set(name, value) } },
  });
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: (name: string) => vars.get(name) ?? "" }));
}

afterEach(() => vi.unstubAllGlobals());

describe("the top bar's height", () => {
  it("reads the fallback until the bar publishes one", () => {
    stubPage();
    expect(readTopBarHeight(80)).toBe(80);
    publishTopBarHeight(112);
    expect(readTopBarHeight(80)).toBe(112);
  });

  it("tells whoever listens each time it's published, until they stop", () => {
    stubPage();
    const listener = vi.fn<() => void>();
    const stop = onTopBarHeight(listener);
    publishTopBarHeight(64);
    publishTopBarHeight(112);
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    publishTopBarHeight(64);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
