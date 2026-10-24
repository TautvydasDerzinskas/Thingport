import { useEffect, useMemo, useState } from "react";
import { type ProviderState, providersApi } from "../api/providers";
import type { ImportProvider, ProviderSetting } from "../api/settings";
import { PROVIDER_IDS } from "../providers/_generated";

// Asked once and shared, as every Add menu and sync dialog needs it; a change to one refreshes everyone's.
let cached: Promise<ProviderState[]> | null = null;
let latest: ProviderState[] | null = null;
const listeners = new Set<(providers: ProviderState[]) => void>();

function publish(providers: ProviderState[]): void {
  latest = providers;
  cached = Promise.resolve(providers);
  for (const listener of listeners) listener(providers);
}

function load(): Promise<ProviderState[]> {
  cached ??= providersApi.list().then(
    (providers) => {
      latest = providers;
      return providers;
    },
    (error: unknown) => {
      cached = null;
      throw error;
    },
  );
  return cached;
}

/** Asks again, after a connection changed, or where it may have changed elsewhere (Thingport Grab sends sign-ins). */
export async function refreshProviders(): Promise<void> {
  cached = null;
  publish(await load());
}

/** After an admin turns one on or off: everyone using the hook sees it at once. */
export function publishProviders(settings: ProviderSetting[]): void {
  if (!latest) {
    void refreshProviders().catch(() => undefined);
    return;
  }
  const enabled = new Map(settings.map((s) => [s.id, s.enabled]));
  publish(latest.map((p) => ({ ...p, enabled: enabled.get(p.id) ?? p.enabled })));
}

/** Every provider's state; null until it's known, or if it can't be. */
export function useProviders(): ProviderState[] | null {
  const [providers, setProviders] = useState<ProviderState[] | null>(latest);
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
  return providers;
}

const NONE: ReadonlySet<ImportProvider> = new Set();

/** With every provider off there's nothing to import from or connect to, so those parts of the app hide. */
export function allProvidersOff(disabled: ReadonlySet<ImportProvider>): boolean {
  return PROVIDER_IDS.every((provider) => disabled.has(provider));
}

/** The providers an admin turned off; the same set until that changes. Until it's known, or if it can't be, none
 *  counts as off: the server still refuses. */
export function useDisabledProviders(): ReadonlySet<ImportProvider> {
  const providers = useProviders();
  return useMemo(() => (providers ? new Set(providers.filter((p) => !p.enabled).map((p) => p.id)) : NONE), [providers]);
}
