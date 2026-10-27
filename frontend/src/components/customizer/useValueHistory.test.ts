import { describe, expect, it } from "vitest";
import { historyOf, redone, undone, withValue, withValues } from "./useValueHistory";

const start = () => historyOf({ size: 10, label: "a" });

describe("withValue", () => {
  it("puts the values before the change on the stack", () => {
    const after = withValue(start(), "size", 12, false);
    expect(after.present).toEqual({ size: 12, label: "a" });
    expect(after.past).toEqual([{ size: 10, label: "a" }]);
  });

  it("ignores a change that sets the value it already has", () => {
    const before = start();
    expect(withValue(before, "size", 10, false)).toBe(before);
  });

  it("compares vectors by their contents, not their identity", () => {
    const before = historyOf({ size: [1, 2, 3] });
    expect(withValue(before, "size", [1, 2, 3], false)).toBe(before);
    expect(withValue(before, "size", [1, 2, 4], false).past).toHaveLength(1);
  });

  it("keeps one step for a run of changes to the same parameter", () => {
    // A slider dragged from 10 through to 40.
    let history = withValue(start(), "size", 20, false);
    for (const value of [30, 40]) history = withValue(history, "size", value, true);

    expect(history.present).toEqual({ size: 40, label: "a" });
    // One step, holding where the drag started -- not one per pixel.
    expect(history.past).toEqual([{ size: 10, label: "a" }]);
    expect(undone(history).present).toEqual({ size: 10, label: "a" });
  });

  it("starts a step even mid-run when there is nothing on the stack yet", () => {
    const history = withValue(start(), "size", 20, true);
    expect(history.past).toEqual([{ size: 10, label: "a" }]);
  });

  it("drops anything that was undone, so a new edit forks the history", () => {
    const edited = withValue(start(), "size", 20, false);
    const back = undone(edited);
    expect(back.future).toHaveLength(1);
    expect(withValue(back, "label", "b", false).future).toEqual([]);
  });
});

describe("withValues", () => {
  it("replaces everything as one undoable step", () => {
    const after = withValues(withValue(start(), "size", 20, false), { size: 10, label: "a" });
    expect(after.present).toEqual({ size: 10, label: "a" });
    expect(after.past).toHaveLength(2);
    expect(undone(after).present).toEqual({ size: 20, label: "a" });
  });
});

describe("undone and redone", () => {
  it("walks back and forward over several edits", () => {
    const one = withValue(start(), "size", 20, false);
    const two = withValue(one, "label", "b", false);

    const back = undone(undone(two));
    expect(back.present).toEqual({ size: 10, label: "a" });
    expect(redone(redone(back)).present).toEqual({ size: 20, label: "b" });
  });

  it("stays put at either end", () => {
    const fresh = start();
    expect(undone(fresh)).toBe(fresh);
    expect(redone(fresh)).toBe(fresh);
  });
});
