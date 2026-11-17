import { describe, expect, it } from "vitest";
import { onToolSharedChange, toolSharedChanged } from "./toolSharedEvents";

describe("telling a tool's parts its shared entries changed", () => {
  it("tells a listener that stops and listens again once, not over and over", () => {
    let calls = 0;
    const again = () => {
      calls++;
      stop();
      // Capped, so the test ends either way: without it, the old loop never did.
      if (calls < 5) stop = onToolSharedChange("t1", again);
    };
    let stop = onToolSharedChange("t1", again);
    const stopOther = onToolSharedChange("t1", () => undefined);
    toolSharedChanged("t1");
    expect(calls).toBe(1);
    stop();
    stopOther();
  });

  it("skips a listener stopped by another earlier in the same telling", () => {
    const heard: string[] = [];
    let stop2: () => void = () => undefined;
    const stop1 = onToolSharedChange("t2", () => {
      heard.push("first");
      stop2();
    });
    stop2 = onToolSharedChange("t2", () => heard.push("second"));
    toolSharedChanged("t2");
    expect(heard).toEqual(["first"]);
    stop1();
  });
});
