import { useEffect, useState } from "react";
import { settingsApi } from "../api/settings";

// Shared by every model card so there's one request, and a switch shows everywhere at once.
let cached: boolean | undefined;
let inFlight: Promise<boolean> | null = null;
// Bumped on sign-in, so an answer still on its way for the previous account is dropped.
let account = 0;
// Saves go one at a time, so the last pick is the one that sticks.
let saving: Promise<unknown> = Promise.resolve();
let latestSave = 0;
const listeners = new Set<(value: boolean) => void>();

function load(): Promise<boolean> {
  if (cached !== undefined) return Promise.resolve(cached);
  if (inFlight) return inFlight;
  const forAccount = account;
  // A switch made while this is in flight is newer than the server's answer, so it wins.
  const request = settingsApi
    .getHoverSlideshow()
    .then((res) => (forAccount === account ? (cached ??= res.enabled) : res.enabled))
    // A failed load shouldn't silently switch the feature off.
    .catch(() => cached ?? true)
    .finally(() => {
      if (inFlight === request) inFlight = null;
    });
  inFlight = request;
  return request;
}

function publish(value: boolean) {
  cached = value;
  listeners.forEach((listener) => listener(value));
}

/** Forgets the previous account's choice; call on sign-in. */
export function resetHoverSlideshowEnabled() {
  account++;
  cached = undefined;
  inFlight = null;
  saving = Promise.resolve();
}

/** On until the saved choice says otherwise. The setter shows the switch straight away, puts it back if the latest
 *  save fails, and rejects with that save's error. */
export function useHoverSlideshowEnabled(): [boolean, (enabled: boolean) => Promise<void>] {
  const [value, setValue] = useState<boolean>(cached ?? true);

  useEffect(() => {
    let cancelled = false;
    void load().then((v) => {
      if (!cancelled) setValue(cached ?? v);
    });
    listeners.add(setValue);
    return () => {
      cancelled = true;
      listeners.delete(setValue);
    };
  }, []);

  const update = async (enabled: boolean) => {
    const previous = cached ?? true;
    const save = ++latestSave;
    const forAccount = account;
    publish(enabled);
    const request = saving.then(() => (forAccount === account ? settingsApi.updateHoverSlideshow(enabled) : undefined));
    saving = request.catch(() => undefined);
    try {
      await request;
    } catch (err) {
      // A newer pick, or another account, has taken over; this failure is no longer theirs to hear about.
      if (save !== latestSave || forAccount !== account) return;
      publish(previous);
      throw err;
    }
  };

  return [value, update];
}
