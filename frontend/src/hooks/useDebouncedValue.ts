import { useEffect, useState } from "react";

/** Returns `value`, but only after it's stayed unchanged for `delayMs` -- e.g. a search box's
 *  live query text, so the query effect that actually fetches only fires once typing pauses
 *  instead of on every keystroke. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
