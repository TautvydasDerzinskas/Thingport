const STORAGE_KEY = "thingport_tags_min_count";

export const DEFAULT_MIN_COUNT = 2;

/** What was typed or stored as a number of models, or null when it can't be one. */
export function parseMinCount(text: string | null): number | null {
  const value = Number(text);
  return text && Number.isSafeInteger(value) && value >= 1 ? value : null;
}

export function readMinCount(): number {
  try {
    return parseMinCount(window.localStorage.getItem(STORAGE_KEY)) ?? DEFAULT_MIN_COUNT;
  } catch {
    return DEFAULT_MIN_COUNT;
  }
}

export function saveMinCount(value: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(value));
  } catch {}
}
