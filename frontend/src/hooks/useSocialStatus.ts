import { useEffect, useState } from "react";
import { socialApi, type SocialStatus } from "../api/social";

// Whether social features are on, and Explore offered: the instance's, so one answer does for every caller, and every
// answer reaches everything showing it -- the sidebar's Explore included. Asked again when an admin switches them here
// (refreshSocialStatus), when the tab comes back after a while (an admin may have switched them elsewhere), and a little
// after a failed answer, which counts as off meanwhile.
const OFF: SocialStatus = {
  enabled: false,
  explore: false,
  chats: false,
  federation: false,
  instance_host: null,
  achievements: false,
};
const STALE_MS = 60_000;
const RETRY_MS = 30_000;
let cached: { status: SocialStatus; at: number } | undefined;
let inFlight: Promise<SocialStatus> | null = null;
// Each refresh starts a new request; an answer to one asked before it is from before the change, and is dropped.
let generation = 0;
let retry: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<(status: SocialStatus) => void>();

function load(): Promise<SocialStatus> {
  if (cached) return Promise.resolve(cached.status);
  if (inFlight) return inFlight;
  const asked = generation;
  const request: Promise<SocialStatus> = socialApi
    .status()
    .then((status) => {
      if (asked === generation) cached = { status, at: Date.now() };
      return status;
    })
    .catch(() => {
      // Only while something shows it (signed out, nothing does), and not for a request a refresh has replaced.
      if (asked === generation && listeners.size) {
        retry ??= setTimeout(() => {
          retry = null;
          void refreshSocialStatus();
        }, RETRY_MS);
      }
      return OFF;
    })
    .then((status) => {
      if (asked !== generation) return load();
      listeners.forEach((listener) => listener(status));
      return status;
    })
    .finally(() => {
      if (inFlight === request) inFlight = null;
    });
  inFlight = request;
  return request;
}

/** Asks again, as after an admin changed the setting: whatever was asked before doesn't count. Answers with the fresh
 *  status, for a caller that needs it as well as everything showing it. */
export function refreshSocialStatus(): Promise<SocialStatus> {
  generation += 1;
  cached = undefined;
  inFlight = null;
  // This is the asking again a failure had put off.
  if (retry) {
    clearTimeout(retry);
    retry = null;
  }
  return load();
}

/** Hears every answer from now on, the current one first; returns how to stop. */
export function subscribeSocialStatus(listener: (status: SocialStatus) => void): () => void {
  listeners.add(listener);
  void load().then((status) => {
    if (listeners.has(listener)) listener(status);
  });
  return () => {
    listeners.delete(listener);
    if (!listeners.size && retry) {
      clearTimeout(retry);
      retry = null;
    }
  };
}

function refreshIfStale() {
  // An answer already on its way will do: asking again would only throw it away.
  if (document.visibilityState !== "visible" || inFlight) return;
  if (!cached || Date.now() - cached.at > STALE_MS) void refreshSocialStatus();
}

/** Null until known. */
export function useSocialStatus(): SocialStatus | null {
  const [status, setStatus] = useState<SocialStatus | null>(cached?.status ?? null);
  useEffect(() => {
    const stop = subscribeSocialStatus(setStatus);
    // Each its own, so one going doesn't take the others' with it; they share the one request anyway.
    const onReturn = () => refreshIfStale();
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      stop();
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, []);
  return status;
}
