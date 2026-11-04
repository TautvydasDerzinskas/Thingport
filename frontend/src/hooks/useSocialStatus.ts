import { useEffect, useState } from "react";
import { socialApi, type SocialStatus } from "../api/social";

// Whether social features are on, and Explore offered: the instance's, so one answer does for every caller, and every
// answer reaches everything showing it -- the sidebar's Explore included. Asked again when an admin switches them here
// (refreshSocialStatus), when the tab comes back after a while (an admin may have switched them elsewhere), and a little
// after a failed answer, which counts as off meanwhile.
const OFF: SocialStatus = { enabled: false, explore: false };
const STALE_MS = 60_000;
const RETRY_MS = 30_000;
let cached: { status: SocialStatus; at: number } | undefined;
let inFlight: Promise<SocialStatus> | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<(status: SocialStatus) => void>();

function load(): Promise<SocialStatus> {
  if (cached) return Promise.resolve(cached.status);
  inFlight ??= socialApi
    .status()
    .then((status) => {
      cached = { status, at: Date.now() };
      return status;
    })
    .catch(() => {
      retry ??= setTimeout(() => {
        retry = null;
        refreshSocialStatus();
      }, RETRY_MS);
      return OFF;
    })
    .then((status) => {
      listeners.forEach((listener) => listener(status));
      return status;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Asks again, as after an admin changed the setting. */
export function refreshSocialStatus(): void {
  cached = undefined;
  void load();
}

function refreshIfStale() {
  if (document.visibilityState !== "visible") return;
  if (!cached || Date.now() - cached.at > STALE_MS) refreshSocialStatus();
}

/** Null until known. */
export function useSocialStatus(): SocialStatus | null {
  const [status, setStatus] = useState<SocialStatus | null>(cached?.status ?? null);
  useEffect(() => {
    let active = true;
    const listener = (next: SocialStatus) => {
      if (active) setStatus(next);
    };
    listeners.add(listener);
    void load().then(listener);
    // Each its own, so one going doesn't take the others' with it; they share the one request anyway.
    const onReturn = () => refreshIfStale();
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      active = false;
      listeners.delete(listener);
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, []);
  return status;
}
