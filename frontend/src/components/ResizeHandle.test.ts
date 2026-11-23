import { describe, expect, it } from "vitest";
import { keyedWidth } from "./ResizeHandle";

describe("keyedWidth", () => {
  const right = { min: 180, max: 480, edge: "right" as const };

  it("widens with the arrow pointing away from the panel and narrows with the other", () => {
    expect(keyedWidth("ArrowRight", false, 220, right)).toBe(236);
    expect(keyedWidth("ArrowLeft", false, 220, right)).toBe(204);
    expect(keyedWidth("ArrowLeft", false, 220, { ...right, edge: "left" })).toBe(236);
    expect(keyedWidth("ArrowRight", true, 220, right)).toBe(284);
  });

  it("stays within the limits, with Home and End going to them", () => {
    expect(keyedWidth("ArrowRight", true, 470, right)).toBe(480);
    expect(keyedWidth("ArrowLeft", false, 185, right)).toBe(180);
    expect(keyedWidth("Home", false, 300, right)).toBe(180);
    expect(keyedWidth("End", false, 300, right)).toBe(480);
  });

  it("leaves other keys alone", () => {
    expect(keyedWidth("Enter", false, 220, right)).toBeNull();
    expect(keyedWidth("ArrowUp", false, 220, right)).toBeNull();
  });
});
