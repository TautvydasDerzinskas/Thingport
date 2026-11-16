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
// The slicer the server last said it has: what a failed switch goes back to, whatever was picked meanwhile.
let stored: string | null | undefined;
// Saves that went through, so a read started before one, and answered after, doesn't say the slicer is still the one
// before it.
let saves = 0;

function load(): Promise<SlicerSettings> {
  if (cached !== undefined) return Promise.resolve(cached);
  if (!inFlight) {
    const at = version;
    const savesAt = saves;
    inFlight = settingsApi
      .getSlicer()
      .then((res) => {
        if (saves === savesAt) stored = res.slicer;
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
  const savesAt = saves;
  try {
    const res = await settingsApi.getSlicer();
    if (saves === savesAt) stored = res.slicer;
    if (version === at) setCachedSlicerSettings(res);
  } catch {
    // The page keeps what it had.
  }
}

/** The settings as the page has them now, for code outside React; undefined until they're read. */
export function slicerSettingsNow(): SlicerSettings | undefined {
  return cached;
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
    stored = saved.slicer;
    saves++;
    if (version === at) return setCachedSlicerSettings(saved);
    // Read or changed meanwhile: what came stays, with this slicer if it's still the one picked last, as a read
    // answered before the save would show the one before. Then it's all read again, below.
    if (mine === switches && cached) setCachedSlicerSettings({ ...cached, slicer: saved.slicer });
  } catch {
    // Back to the one stored, by the latest switch only: an earlier one failing mustn't undo a later pick, which may
    // still be saved. The one stored, not the one before this switch, which may have been another still saving.
    if (mine === switches && cached?.slicer === slicer)
      setCachedSlicerSettings({ ...cached, slicer: stored === undefined ? previous.slicer : stored });
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
