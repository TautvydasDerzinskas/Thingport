import { useEffect, useState } from "react";
import { DEFAULT_PRINT_PROFILES_VIEW, settingsApi, type PrintProfilesView } from "../api/settings";

// Saved on the account, so every device shows profiles the same way. One request however many parts ask.
let cached: PrintProfilesView | undefined;
let inFlight: Promise<PrintProfilesView> | null = null;
// Bumped on sign-in, so an answer still on its way for the previous account is dropped.
let account = 0;
// Saves go one at a time, so the last pick is the one that sticks.
let saving: Promise<unknown> = Promise.resolve();
let latestSave = 0;
const listeners = new Set<(value: PrintProfilesView) => void>();

function load(): Promise<PrintProfilesView> {
  if (cached !== undefined) return Promise.resolve(cached);
  if (inFlight) return inFlight;
  const forAccount = account;
  // A switch made while this is in flight is newer than the server's answer, so it wins.
  const request = settingsApi
    .getPrintProfilesView()
    .then((res) => (forAccount === account ? (cached ??= res.view) : res.view))
    .catch((): PrintProfilesView => cached ?? DEFAULT_PRINT_PROFILES_VIEW)
    .finally(() => {
      if (inFlight === request) inFlight = null;
    });
  inFlight = request;
  return request;
}

function publish(value: PrintProfilesView) {
  cached = value;
  listeners.forEach((listener) => listener(value));
}

/** Forgets the previous account's choice; call on sign-in. */
export function resetPrintProfilesView() {
  account++;
  cached = undefined;
  inFlight = null;
  saving = Promise.resolve();
}

/** Null until the saved choice is known, so a model page doesn't show files first and then swap to profiles. The
 *  setter shows the switch straight away, puts it back if the latest save fails, and rejects with that save's error. */
export function usePrintProfilesView(): [PrintProfilesView | null, (view: PrintProfilesView) => Promise<void>] {
  const [value, setValue] = useState<PrintProfilesView | null>(cached ?? null);

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

  const update = async (view: PrintProfilesView) => {
    const previous = cached ?? DEFAULT_PRINT_PROFILES_VIEW;
    const save = ++latestSave;
    const forAccount = account;
    publish(view);
    const request = saving.then(() => (forAccount === account ? settingsApi.updatePrintProfilesView(view) : undefined));
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
