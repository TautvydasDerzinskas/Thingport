import { useEffect, useState } from "react";
import { studioApi, type StudioGridSettings, type StudioSettings } from "../api/studio";

// The person's Studio settings, saved on the account so every device has them: where the assistant shows, the units a
// new design starts in, and the grid. Shared by Studio's settings dialog and the page so there's one request, and a change shows in
// both at once.
/** An adaptive grid at normal density, snapped to; fixed, 10 mm with 1 mm between. */
export const GRID_DEFAULTS: StudioGridSettings = {
  show: true,
  spacing: "adaptive",
  density: "normal",
  major: 10,
  subdivisions: 10,
  snap: true,
};
const DEFAULTS: StudioSettings = { prompt_layout: "bar", units: "mm", grid: GRID_DEFAULTS };

/** A change: any of the settings, the grid's one by one. */
export type StudioSettingsChange = Partial<Omit<StudioSettings, "grid">> & { grid?: Partial<StudioGridSettings> };
let cached: StudioSettings | undefined;
let inFlight: Promise<StudioSettings> | null = null;
// Bumped on sign-in, so an answer still on its way for the previous account is dropped.
let account = 0;
// Saves go one at a time, so the last change is the one that sticks.
let saving: Promise<unknown> = Promise.resolve();
let latestSave = 0;
const listeners = new Set<(value: StudioSettings) => void>();

function load(): Promise<StudioSettings> {
  if (cached !== undefined) return Promise.resolve(cached);
  if (inFlight) return inFlight;
  const forAccount = account;
  // A change made while this is in flight is newer than the server's answer, so it wins.
  const request = studioApi
    .settings()
    .then((res) => (forAccount === account ? (cached ??= res) : res))
    .catch((): StudioSettings => cached ?? DEFAULTS)
    .finally(() => {
      if (inFlight === request) inFlight = null;
    });
  inFlight = request;
  return request;
}

function publish(value: StudioSettings) {
  cached = value;
  listeners.forEach((listener) => listener(value));
}

/** Forgets the previous account's settings; call on sign-in. */
export function resetStudioSettings() {
  account++;
  cached = undefined;
  inFlight = null;
  saving = Promise.resolve();
}

/** The defaults until the saved settings say otherwise. The setter shows a change straight away, puts it back if the
 *  latest save fails, and rejects with that save's error. */
export function useStudioSettings(): [StudioSettings, (changes: StudioSettingsChange) => Promise<void>] {
  const [value, setValue] = useState<StudioSettings>(cached ?? DEFAULTS);

  useEffect(() => {
    let cancelled = false;
    void load().then((loaded) => {
      if (!cancelled) setValue(cached ?? loaded);
    });
    listeners.add(setValue);
    return () => {
      cancelled = true;
      listeners.delete(setValue);
    };
  }, []);

  const update = async (changes: StudioSettingsChange) => {
    const previous = cached ?? DEFAULTS;
    const save = ++latestSave;
    const forAccount = account;
    publish({ ...previous, ...changes, grid: { ...previous.grid, ...changes.grid } });
    const request = saving.then(() => (forAccount === account ? studioApi.updateSettings(changes) : undefined));
    saving = request.catch(() => undefined);
    try {
      await request;
    } catch (err) {
      // A newer change, or another account, has taken over; this failure is no longer theirs to hear about.
      if (save !== latestSave || forAccount !== account) return;
      publish(previous);
      throw err;
    }
  };

  return [value, update];
}
