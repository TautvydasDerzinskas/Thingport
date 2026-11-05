import { useEffect, useState } from "react";
import { studioApi } from "../api/studio";

// Whether this Thingport's backend has Studio: one older than Studio has no answer, and its page would have nothing
// behind it. The instance's, not the account's, so one answer does for the page's lifetime; a failed one isn't kept,
// and the next caller asks again.
let cached: boolean | undefined;
let inFlight: Promise<boolean> | null = null;

function load(): Promise<boolean> {
  if (cached !== undefined) return Promise.resolve(cached);
  inFlight ??= studioApi
    .status()
    .then(({ enabled }) => (cached = enabled))
    .catch(() => false)
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Null until known. */
export function useStudioEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(cached ?? null);
  useEffect(() => {
    let cancelled = false;
    void load().then((value) => {
      if (!cancelled) setEnabled(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return enabled;
}
