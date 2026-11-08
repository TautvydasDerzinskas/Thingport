import { useEffect, useState } from "react";
import { DEFAULT_PRINT_PROFILES_VIEW, settingsApi, type PrintProfilesView } from "../api/settings";

// Saved on the account, so every device shows profiles the same way. One request however many parts ask.
let cached: PrintProfilesView | undefined;
// What the server last said it holds: a failed save goes back to this, not to a pick still being saved.
let confirmed: PrintProfilesView | undefined;
// Counts confirmed saves, so a load that set out before one can't put back what the save replaced.
let confirmedSaves = 0;
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
  const savesBefore = confirmedSaves;
  // A switch made while this is in flight is newer than the server's answer, so it wins.
  const request = settingsApi
    .getPrintProfilesView()
    .then((res) => {
      if (forAccount !== account) return res.view;
      if (confirmedSaves === savesBefore) confirmed = res.view;
      // Parts already showing a fallback (an earlier load failed) take the saved choice too.
      if (cached === undefined) publish(res.view);
      return cached ?? res.view;
    })
    .catch((): PrintProfilesView => cached ?? DEFAULT_PRINT_PROFILES_VIEW)
    .finally(() => {
      if (inFlight === request) inFlight = null;
    });
  inFlight = request;
  return request;
}

/** `known: false` shows a fallback without keeping it, so the next page asks the server again. */
function publish(value: PrintProfilesView, { known = true } = {}) {
  cached = known ? value : undefined;
  listeners.forEach((listener) => listener(value));
}

/** Forgets the previous account's choice; call on sign-in. */
export function resetPrintProfilesView() {
  account++;
  cached = undefined;
  confirmed = undefined;
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
    const save = ++latestSave;
    const forAccount = account;
    publish(view);
    const request = saving.then(() => (forAccount === account ? settingsApi.updatePrintProfilesView(view) : undefined));
    saving = request.catch(() => undefined);
    try {
      await request;
      if (forAccount === account) {
        confirmed = view;
        confirmedSaves++;
      }
    } catch (err) {
      // A newer pick, or another account, has taken over; this failure is no longer theirs to hear about.
      if (save !== latestSave || forAccount !== account) return;
      // Nothing heard from the server yet, its load having failed too: the default until a load gets through.
      publish(confirmed ?? DEFAULT_PRINT_PROFILES_VIEW, { known: confirmed !== undefined });
      throw err;
    }
  };

  return [value, update];
}
