import { useEffect, useState } from "react";
import { settingsApi, type StudioPromptLayout } from "../api/settings";

// Saved on the account, as the Appearance panel sets it, so every device shows Studio's assistant the same way. Shared
// by the panel and Studio so there's one request, and a switch shows in both at once.
let cached: StudioPromptLayout | undefined;
let inFlight: Promise<StudioPromptLayout> | null = null;
// Bumped on sign-in, so an answer still on its way for the previous account is dropped.
let account = 0;
// Saves go one at a time, so the last pick is the one that sticks.
let saving: Promise<unknown> = Promise.resolve();
let latestSave = 0;
const listeners = new Set<(value: StudioPromptLayout) => void>();

function load(): Promise<StudioPromptLayout> {
  if (cached !== undefined) return Promise.resolve(cached);
  if (inFlight) return inFlight;
  const forAccount = account;
  // A switch made while this is in flight is newer than the server's answer, so it wins.
  const request = settingsApi
    .getStudioPromptLayout()
    .then((res) => (forAccount === account ? (cached ??= res.layout) : res.layout))
    .catch((): StudioPromptLayout => cached ?? "bar")
    .finally(() => {
      if (inFlight === request) inFlight = null;
    });
  inFlight = request;
  return request;
}

function publish(value: StudioPromptLayout) {
  cached = value;
  listeners.forEach((listener) => listener(value));
}

/** Forgets the previous account's choice; call on sign-in. */
export function resetStudioPromptLayout() {
  account++;
  cached = undefined;
  inFlight = null;
  saving = Promise.resolve();
}

/** The bar until the saved choice says otherwise. The setter shows the switch straight away, puts it back if the
 *  latest save fails, and rejects with that save's error. */
export function useStudioPromptLayout(): [StudioPromptLayout, (layout: StudioPromptLayout) => Promise<void>] {
  const [value, setValue] = useState<StudioPromptLayout>(cached ?? "bar");

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

  const update = async (layout: StudioPromptLayout) => {
    const previous = cached ?? "bar";
    const save = ++latestSave;
    const forAccount = account;
    publish(layout);
    const request = saving.then(() =>
      forAccount === account ? settingsApi.updateStudioPromptLayout(layout) : undefined,
    );
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
