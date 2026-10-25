import { useEffect, useState } from "react";
import { settingsApi, type SlicerSettings } from "../api/settings";

const EMPTY: SlicerSettings = { slicer: null, slicers: [] };

// Shared by every mounted instance so there's one request, and saves propagate to all of them.
let cached: SlicerSettings | undefined; // undefined = not loaded yet
let inFlight: Promise<SlicerSettings> | null = null;
const listeners = new Set<(value: SlicerSettings) => void>();

function load(): Promise<SlicerSettings> {
  if (cached !== undefined) return Promise.resolve(cached);
  if (!inFlight) {
    inFlight = settingsApi
      .getSlicer()
      .then((res) => {
        cached = res;
        return cached;
      })
      .catch(() => EMPTY)
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

export function setCachedSlicerSettings(value: SlicerSettings) {
  cached = value;
  listeners.forEach((listener) => listener(value));
}

/** Makes `slicer` the one models open in, shown straight away and put back if the save fails. */
export async function switchSlicer(slicer: string): Promise<void> {
  const previous = cached ?? EMPTY;
  if (previous.slicer === slicer) return;
  setCachedSlicerSettings({ ...previous, slicer });
  try {
    setCachedSlicerSettings(await settingsApi.updateSlicer({ slicer }));
  } catch {
    setCachedSlicerSettings(previous);
  }
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
