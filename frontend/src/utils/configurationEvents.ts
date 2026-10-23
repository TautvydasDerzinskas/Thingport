import type { ConfigurationTab } from "../components/Layout/ConfigurationDialog";

// The top bar owns the Configuration dialog; anything else asks it to open through these.
const OPEN_EVENT = "thingport:open-configuration";
const CLOSED_EVENT = "thingport:configuration-closed";

/** `?configuration=<tab>` on any page opens it at that tab, for a page without the top bar (the homepage view). */
export const CONFIGURATION_PARAM = "configuration";
const TABS: readonly ConfigurationTab[] = ["appearance", "providers", "slicer"];

/** The link that opens the app with Configuration at `tab`. */
export function configurationLink(tab: ConfigurationTab): string {
  return `/?${CONFIGURATION_PARAM}=${tab}`;
}

/** The tab a `?configuration=` asks for, if it's one; the parameter is taken out of the address. */
export function takeConfigurationParam(): ConfigurationTab | null {
  const url = new URL(window.location.href);
  const tab = url.searchParams.get(CONFIGURATION_PARAM);
  if (tab === null) return null;
  url.searchParams.delete(CONFIGURATION_PARAM);
  window.history.replaceState(window.history.state, "", url);
  return TABS.find((known) => known === tab) ?? null;
}

export function openConfiguration(tab: ConfigurationTab): void {
  window.dispatchEvent(new CustomEvent<ConfigurationTab>(OPEN_EVENT, { detail: tab }));
}

/** Returns the unsubscribe. */
export function onOpenConfiguration(handler: (tab: ConfigurationTab) => void): () => void {
  const listener = (event: Event) => handler((event as CustomEvent<ConfigurationTab>).detail);
  window.addEventListener(OPEN_EVENT, listener);
  return () => window.removeEventListener(OPEN_EVENT, listener);
}

export function notifyConfigurationClosed(): void {
  window.dispatchEvent(new Event(CLOSED_EVENT));
}

/** For whatever depends on settings changed there, e.g. a provider just connected. */
export function onConfigurationClosed(handler: () => void): () => void {
  window.addEventListener(CLOSED_EVENT, handler);
  return () => window.removeEventListener(CLOSED_EVENT, handler);
}
