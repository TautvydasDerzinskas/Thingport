import { useEffect, useState } from "react";
import { settingsApi } from "../api/settings";

// Module-level cache, same pattern as useSlicerPreference: every author link on a page (one per
// model card) shares a single GET /settings/author-preview, and the Profile page's switch pushes
// a freshly-saved value into all of them via setCachedAuthorPreviewEnabled below.
let cached: boolean | undefined; // undefined = not loaded yet
let inFlight: Promise<boolean> | null = null;
const listeners = new Set<(value: boolean) => void>();

function load(): Promise<boolean> {
  if (cached !== undefined) return Promise.resolve(cached);
  if (!inFlight) {
    inFlight = settingsApi.getAuthorPreview()
      .then(res => { cached = res.enabled; return cached; })
      // On by default: a failed load shouldn't silently switch the feature off.
      .catch(() => true)
      .finally(() => { inFlight = null; });
  }
  return inFlight;
}

export function setCachedAuthorPreviewEnabled(value: boolean) {
  cached = value;
  listeners.forEach(listener => listener(value));
}

/** Whether hovering an author link should open the author preview card -- the user's Profile
 *  setting, true until it's loaded (the default) and kept in sync across every mounted link. */
export function useAuthorPreviewEnabled(): boolean {
  const [value, setValue] = useState<boolean>(cached ?? true);

  useEffect(() => {
    let cancelled = false;
    void load().then(v => { if (!cancelled) setValue(v); });
    listeners.add(setValue);
    return () => {
      cancelled = true;
      listeners.delete(setValue);
    };
  }, []);

  return value;
}
