import { useEffect, useMemo, useState } from "react";
import { type ImportProvider, type ProviderSetting, settingsApi } from "../api/settings";

// Asked once and shared, as every Add menu and sync dialog needs it; turning one on or off refreshes everyone's.
let cached: Promise<ProviderSetting[]> | null = null;
const listeners = new Set<(providers: ProviderSetting[]) => void>();

function load(): Promise<ProviderSetting[]> {
  cached ??= settingsApi.getProviders().catch((error: unknown) => {
    cached = null;
    throw error;
  });
  return cached;
}

/** After an admin changes one: everyone using the hook sees it at once. */
export function publishProviders(providers: ProviderSetting[]): void {
  cached = Promise.resolve(providers);
  for (const listener of listeners) listener(providers);
}

const NONE: ReadonlySet<ImportProvider> = new Set();
const ALL: readonly ImportProvider[] = ["makerworld", "printables", "thingiverse"];

/** With every provider off there's nothing to import from or connect to, so those parts of the app hide. */
export function allProvidersOff(disabled: ReadonlySet<ImportProvider>): boolean {
  return ALL.every((provider) => disabled.has(provider));
}

/** The providers an admin turned off; the same set until that changes. Until it's known, or if it can't be, none
 *  counts as off: the server still refuses. */
export function useDisabledProviders(): ReadonlySet<ImportProvider> {
  const [providers, setProviders] = useState<ProviderSetting[] | null>(null);
  useEffect(() => {
    let active = true;
    listeners.add(setProviders);
    load().then(
      (loaded) => active && setProviders(loaded),
      () => undefined,
    );
    return () => {
      active = false;
      listeners.delete(setProviders);
    };
  }, []);
  return useMemo(() => (providers ? new Set(providers.filter((p) => !p.enabled).map((p) => p.id)) : NONE), [providers]);
}
