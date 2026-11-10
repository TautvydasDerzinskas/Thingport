import path from "node:path";
import { compile } from "sass";
import { describe, expect, it } from "vitest";
import { BUBBLE_PLACES, BUBBLE_STYLES, DEFAULT_BUBBLE, bubbleLookOf, bubbleUpdate } from "./bubble";

const SRC = path.resolve(__dirname, "..");
const others = <T>(all: readonly T[], fallback: T) => all.filter((value) => value !== fallback);

describe("the bubble's look", () => {
  it("is today's white bubble, bottom right, until one is picked", () => {
    expect(bubbleLookOf({})).toEqual({ style: "bubble", place: "bottom-right" });
  });

  it("reads a pick back, and the default in place of one it doesn't know, such as a newer Grab's", () => {
    expect(bubbleLookOf({ bubbleStyle: "pill", bubblePlace: "top-left" })).toEqual({
      style: "pill",
      place: "top-left",
    });
    expect(bubbleLookOf({ bubbleStyle: "sparkly", bubblePlace: 3 })).toEqual(DEFAULT_BUBBLE);
  });

  it("stores only what a pick changes, and refuses one that isn't a style or place", () => {
    expect(bubbleUpdate({ style: "edge" })).toEqual({ bubbleStyle: "edge" });
    expect(bubbleUpdate({ place: "bottom-left" })).toEqual({ bubblePlace: "bottom-left" });
    expect(() => bubbleUpdate({ style: "sparkly" as never })).toThrow(/Unknown bubble style/);
    expect(() => bubbleUpdate({ place: "middle" as never })).toThrow(/Unknown bubble place/);
  });
});

describe("every style and corner has its styles", () => {
  // The page's bubble reads its pick from the host's attributes; the popup's tiles each draw one.
  const page = compile(path.join(SRC, "content/styles/content.scss")).css;
  const popup = compile(path.join(SRC, "popup/styles/popup.scss")).css;

  it.each(others(BUBBLE_STYLES, DEFAULT_BUBBLE.style))("the %s style, on the page and in the popup", (style) => {
    expect(page).toContain(`:host([data-style=${style}]) .tg-fab`);
    expect(popup).toContain(`.look__swatch[data-style=${style}] .tg-fab`);
  });

  it.each(others(BUBBLE_PLACES, DEFAULT_BUBBLE.place))(
    "the %s corner moves the bubble, its panel and its note",
    (place) => {
      // The corners are styled by side and by edge: each other corner is on the left, at the top, or both.
      const rules = [
        place.endsWith("-left") && "[data-place$=-left]",
        place.startsWith("top-") && "[data-place^=top-]",
      ];
      const selectors = rules.filter(Boolean) as string[];
      expect(selectors.length).toBeGreaterThan(0);
      for (const selector of selectors) {
        for (const part of [".tg-fab", ".tg-panel-stack", ".tg-fab-note"])
          expect(page).toContain(`:host(${selector}) ${part}`);
      }
    },
  );
});
