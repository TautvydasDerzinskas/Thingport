import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadTarget, forgetSlicer, knownSlicer, lookUpSlicer } from "./slicerTarget";

// The "Download normalized" button's slicer: a click made while the instance is still answering waits for it, so a
// Snapmaker Orca user never gets the flat copy just for clicking early.

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("slicerTarget", () => {
  beforeEach(() => forgetSlicer());

  it("waits for the instance's answer before picking the Orca copy", async () => {
    const answer = deferred<string | null>();
    void lookUpSlicer(() => answer.promise);
    const target = downloadTarget();
    expect(knownSlicer()).toBeNull();
    answer.resolve("snapmaker-orca");
    await expect(target).resolves.toBe("orca");
    expect(knownSlicer()).toBe("snapmaker-orca");
  });

  it("makes the flat copy for other slicers, no slicer or a failed answer", async () => {
    void lookUpSlicer(async () => "prusaslicer");
    await expect(downloadTarget()).resolves.toBe("flat");
    void lookUpSlicer(async () => null);
    await expect(downloadTarget()).resolves.toBe("flat");
    void lookUpSlicer(() => Promise.reject(new Error("offline")));
    await expect(downloadTarget()).resolves.toBe("flat");
    expect(knownSlicer()).toBeNull();
  });

  it("makes the flat copy when nothing is asked, as on an instance that isn't set up", async () => {
    await expect(downloadTarget()).resolves.toBe("flat");
  });

  it("drops an answer that arrives after the button is gone", async () => {
    const late = deferred<string | null>();
    void lookUpSlicer(() => late.promise);
    forgetSlicer();
    late.resolve("snapmaker-orca");
    await late.promise;
    expect(knownSlicer()).toBeNull();
    await expect(downloadTarget()).resolves.toBe("flat");
  });

  it("still gives a click made before the button went its answer", async () => {
    const answer = deferred<string | null>();
    void lookUpSlicer(() => answer.promise);
    const target = downloadTarget();
    forgetSlicer();
    answer.resolve("snapmaker-orca");
    await expect(target).resolves.toBe("orca");
    expect(knownSlicer()).toBeNull();
  });

  describe("when the instance is slow", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("makes the flat copy once 5 s pass without an answer", async () => {
      void lookUpSlicer(() => new Promise<string | null>(() => {}));
      const target = downloadTarget();
      await vi.advanceTimersByTimeAsync(4999);
      let settled = false;
      void target.then(() => (settled = true));
      await Promise.resolve();
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await expect(target).resolves.toBe("flat");
      expect(knownSlicer()).toBeNull();
    });

    it("takes the target from an answer that comes before 5 s, and clears the timer", async () => {
      const answer = deferred<string | null>();
      void lookUpSlicer(() => answer.promise);
      const target = downloadTarget();
      await vi.advanceTimersByTimeAsync(4000);
      answer.resolve("snapmaker-orca");
      await expect(target).resolves.toBe("orca");
      expect(vi.getTimerCount()).toBe(0);
      expect(knownSlicer()).toBe("snapmaker-orca");
    });
  });
});
