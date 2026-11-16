import { useEffect, useState } from "react";
import { settingsApi, type SlicerSettings } from "../api/settings";

const EMPTY: SlicerSettings = { slicer: null, slicers: [], bridged: [], unadapted: [], printers: {}, sendTargets: [] };

// Shared by every mounted instance so there's one request, and saves propagate to all of them.
let cached: SlicerSettings | undefined; // undefined = not loaded yet
let inFlight: Promise<SlicerSettings> | null = null;
const listeners = new Set<(value: SlicerSettings) => void>();
// Moved on by every read and change, so a read that's overtaken never lands over what came after it.
let version = 0;
// Switches made, so only the latest one puts the slicer back when its save fails.
let switches = 0;

function load(): Promise<SlicerSettings> {
  if (cached !== undefined) return Promise.resolve(cached);
  if (!inFlight) {
    const at = version;
    inFlight = settingsApi
      .getSlicer()
      .then((res) => {
        if (version === at) cached = res;
        return cached ?? res;
      })
      // What a reload brought in meanwhile stays.
      .catch(() => cached ?? EMPTY)
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/** Reads them again, e.g. after the user changed where they send models. */
export async function reloadSlicerSettings(): Promise<void> {
  const at = ++version;
  try {
    const res = await settingsApi.getSlicer();
    if (version === at) setCachedSlicerSettings(res);
  } catch {
    // The page keeps what it had.
  }
}

export function setCachedSlicerSettings(value: SlicerSettings) {
  version++;
  cached = value;
  listeners.forEach((listener) => listener(value));
}

/** Makes `slicer` the one models open in, shown straight away and put back if the save fails. */
export async function switchSlicer(slicer: string): Promise<void> {
  const previous = cached ?? EMPTY;
  if (previous.slicer === slicer) return;
  setCachedSlicerSettings({ ...previous, slicer });
  const at = version;
  const mine = ++switches;
  try {
    const saved = await settingsApi.updateSlicer({ slicer });
    if (version === at) return setCachedSlicerSettings(saved);
  } catch {
    // Back to the one stored, unless another was picked meanwhile, whatever a read did or didn't bring: a later pick
    // of this same slicer may have been saved.
    if (mine === switches && cached?.slicer === slicer) setCachedSlicerSettings({ ...cached, slicer: previous.slicer });
  }
  // Settings read meanwhile, or kept from landing by this switch, such as a new Send to destination: read again.
  void reloadSlicerSettings();
}

export function useSlicerSettings(): SlicerSettings {
  const [value, setValue] = useState<SlicerSettings>(cached ?? EMPTY);

  useEffect(() => {
    let cancelled = false;
    void load().then((v) => {
      if (!cancelled) setValue(v);
    });
    listeners.add(setValue);
    return () => {
      cancelled = true;
      listeners.delete(setValue);
    };
  }, []);

  return value;
}

/** The slicer a model's main "Open in" button opens: the last one used. */
export function useSlicerPreference(): string | null {
  return useSlicerSettings().slicer;
}
