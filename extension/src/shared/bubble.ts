// How the floating bubble on model pages looks and which corner it sits in, as picked in the popup's Bubble tab.
// Pages already open follow a new pick at once (content/index.ts), as host attributes their stylesheet reads
// (content/styles/_bubble.scss).

export const BUBBLE_STYLES = ["bubble", "pill", "mini", "brand", "glass", "edge"] as const;
export const BUBBLE_PLACES = ["bottom-right", "bottom-left", "top-right", "top-left"] as const;

export type BubbleStyle = (typeof BUBBLE_STYLES)[number];
export type BubblePlace = (typeof BUBBLE_PLACES)[number];
export type BubbleLook = { style: BubbleStyle; place: BubblePlace };

/** The white bubble in the bottom right corner, as Grab has always shown it. */
export const DEFAULT_BUBBLE: BubbleLook = { style: "bubble", place: "bottom-right" };

const isStyle = (value: unknown): value is BubbleStyle => BUBBLE_STYLES.includes(value as BubbleStyle);
const isPlace = (value: unknown): value is BubblePlace => BUBBLE_PLACES.includes(value as BubblePlace);

/** The look stored, with the default in place of anything unset or not known (a newer Grab's, say). */
export function bubbleLookOf(stored: { bubbleStyle?: unknown; bubblePlace?: unknown }): BubbleLook {
  return {
    style: isStyle(stored.bubbleStyle) ? stored.bubbleStyle : DEFAULT_BUBBLE.style,
    place: isPlace(stored.bubblePlace) ? stored.bubblePlace : DEFAULT_BUBBLE.place,
  };
}

/** What a pick changes, as stored; throws on a style or place that isn't one. */
export function bubbleUpdate(pick: Partial<BubbleLook>): { bubbleStyle?: BubbleStyle; bubblePlace?: BubblePlace } {
  if (pick.style !== undefined && !isStyle(pick.style)) throw new Error(`Unknown bubble style: ${pick.style}`);
  if (pick.place !== undefined && !isPlace(pick.place)) throw new Error(`Unknown bubble place: ${pick.place}`);
  return {
    ...(pick.style ? { bubbleStyle: pick.style } : {}),
    ...(pick.place ? { bubblePlace: pick.place } : {}),
  };
}
