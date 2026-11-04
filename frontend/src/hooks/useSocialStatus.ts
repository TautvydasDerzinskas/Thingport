import { useEffect, useState } from "react";
import { socialApi, type SocialStatus } from "../api/social";

// Whether social features are on, and Explore offered: the instance's, so one answer does for every caller until an
// admin switches them (refreshSocialStatus), when everything showing them hears at once -- the sidebar's Explore
// included. A failed answer counts as off and isn't kept, so the next caller asks again.
const OFF: SocialStatus = { enabled: false, explore: false };
let cached: SocialStatus | undefined;
let inFlight: Promise<SocialStatus> | null = null;
const listeners = new Set<(status: SocialStatus) => void>();

function load(): Promise<SocialStatus> {
  if (cached) return Promise.resolve(cached);
  inFlight ??= socialApi
    .status()
    .then((status) => (cached = status))
    .catch(() => OFF)
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Asks again, after an admin changed the setting. */
export function refreshSocialStatus(): void {
  cached = undefined;
  void load().then((status) => listeners.forEach((listener) => listener(status)));
}

/** Null until known. */
export function useSocialStatus(): SocialStatus | null {
  const [status, setStatus] = useState<SocialStatus | null>(cached ?? null);
  useEffect(() => {
    let active = true;
    const listener = (next: SocialStatus) => {
      if (active) setStatus(next);
    };
    listeners.add(listener);
    void load().then(listener);
    return () => {
      active = false;
      listeners.delete(listener);
    };
  }, []);
  return status;
}
