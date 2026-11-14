// The top bar publishes its real height (it can wrap) as a CSS var for sticky elements below it, and says when it
// changes, which needn't come with a window resize (a longer title, other actions).

const VAR = "--topbar-height";
const EVENT = "thingport:topbar-height";

export function publishTopBarHeight(px: number): void {
  document.documentElement.style.setProperty(VAR, `${px}px`);
  window.dispatchEvent(new Event(EVENT));
}

/** The bar's height in px, or `fallback` before it has published one. */
export function readTopBarHeight(fallback: number): number {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue(VAR)) || fallback;
}

/** Hears every change; returns how to stop. */
export function onTopBarHeight(listener: () => void): () => void {
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
