import { useSyncExternalStore } from "react";
import { DEFAULT_ACCENT, type AccentColor, type RenderColor } from "../constants/settingsOptions";

// One value for the whole app: App builds the theme from it and the Appearance panel changes it, so a pick
// recolours everything at once. App loads it with the theme.
let current: AccentColor = DEFAULT_ACCENT;
// The render colour picked apart from the accent; null follows the accent.
let renderOverride: RenderColor | null = null;
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((listener) => listener());

export function setCachedAccentColor(accent: AccentColor) {
  current = accent;
  notify();
}

export function setCachedRenderColor(color: RenderColor | null) {
  renderOverride = color;
  notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAccentColor(): AccentColor {
  return useSyncExternalStore(subscribe, () => current);
}

/** What generated renders are tinted: the picked render colour, or the accent. */
export function useRenderColor(): RenderColor {
  return useSyncExternalStore(subscribe, () => renderOverride ?? current);
}

/** The render colour as saved, null while it follows the accent. */
export function getCachedRenderColor(): RenderColor | null {
  return renderOverride;
}
