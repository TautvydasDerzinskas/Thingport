// Thingiverse's Offline features: dark mode and hidden ads. Runs at document_start, apart from the main content
// script, so the page is restyled before it first paints rather than flashing white or showing the ads first.

import { STORAGE_KEYS, offlineFeatureOn, type OfflineFeature, type StoredConfig } from "../../shared/storage";
import adsCss from "./ads.scss?inline";
import darkCss from "./dark.scss?inline";

// Dark mode's selectors hang off this attribute, which outranks the `:root` Thingiverse sets its colors on.
const DARK_ATTRIBUTE = "data-thingport-dark";

const STYLES: Partial<Record<OfflineFeature, HTMLStyleElement>> = {
  thingiverseDark: styleElement(darkCss),
  thingiverseHideAds: styleElement(adsCss),
};
const FEATURES = Object.keys(STYLES) as OfflineFeature[];

let active: OfflineFeature[] = [];
let observer: MutationObserver | null = null;

function styleElement(css: string): HTMLStyleElement {
  const style = document.createElement("style");
  style.textContent = css;
  return style;
}

/** Puts the attribute and styles back if the page's own scripts rebuild <html> or <head>. */
function attach(): void {
  const root = document.documentElement;
  if (!root) return;
  if (active.includes("thingiverseDark") && !root.hasAttribute(DARK_ATTRIBUTE)) root.setAttribute(DARK_ATTRIBUTE, "");
  // Where they sit doesn't matter: their selectors outrank Thingiverse's.
  const parent = document.head ?? root;
  for (const feature of active) {
    const style = STYLES[feature]!;
    if (style.parentNode !== parent) parent.append(style);
  }
}

function apply(next: OfflineFeature[]): void {
  active = next;
  for (const feature of FEATURES) if (!active.includes(feature)) STYLES[feature]!.remove();
  if (!active.includes("thingiverseDark")) document.documentElement?.removeAttribute(DARK_ATTRIBUTE);
  if (!active.length) {
    observer?.disconnect();
    observer = null;
    return;
  }
  attach();
  if (!observer) {
    observer = new MutationObserver(attach);
    observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: [DARK_ATTRIBUTE] });
  }
}

async function load(): Promise<void> {
  const config = (await chrome.storage.local.get([...FEATURES, STORAGE_KEYS.disabled])) as StoredConfig;
  apply(config.disabled ? [] : FEATURES.filter((feature) => offlineFeatureOn(config, feature)));
}

// Switched in the popup: follows at once, no reload.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && [...FEATURES, STORAGE_KEYS.disabled].some((key) => key in changes)) void load();
});

void load();
