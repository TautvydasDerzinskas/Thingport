import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.fn();
vi.mock("../../shared/messages", () => ({ request: (...args: unknown[]) => request(...args) }));

const { WATCH_DELAYS_MS, resetPickWatch, watchPicks } = await import("./adaptSite");

describe("watching a MakerOnline page's picks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("location", { href: "https://www.makeronline.com/model/1" });
    request.mockReset();
    resetPickWatch();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps asking past the first seconds while the page's store isn't there yet", async () => {
    // Ready only on the sixth ask, about ten seconds in.
    request.mockImplementation(() => Promise.resolve(request.mock.calls.length >= 6));
    const watched = watchPicks();
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(watched).resolves.toBe(true);
    expect(request).toHaveBeenCalledTimes(6);
  });

  it("stops once the tab has moved to another page", async () => {
    request.mockResolvedValue(false);
    const watched = watchPicks();
    await vi.advanceTimersByTimeAsync(500);
    (location as { href: string }).href = "https://www.makeronline.com/model/2";
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(watched).resolves.toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("gives up after about a minute, and asks again when asked again", async () => {
    request.mockResolvedValue(false);
    const watched = watchPicks();
    await vi.advanceTimersByTimeAsync(120_000);
    await expect(watched).resolves.toBe(false);
    expect(request).toHaveBeenCalledTimes(WATCH_DELAYS_MS.length + 1);
    request.mockResolvedValue(true);
    await expect(watchPicks()).resolves.toBe(true);
  });

  it("asks once at a time, and not again once the page keeps its picks", async () => {
    request.mockResolvedValue(true);
    await Promise.all([watchPicks(), watchPicks()]);
    await watchPicks();
    expect(request).toHaveBeenCalledTimes(1);
  });
});
