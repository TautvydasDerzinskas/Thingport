import { useCallback, useEffect, useState } from "react";
import { UnauthorizedError } from "../api/client";
import { printersApi, type MyPrinters } from "../api/printers";

const EMPTY: MyPrinters = { printers: [], suggestions: [], bambu: false };

// Shared by every mounted instance so there's one request, and changes reach all of them.
let cached: MyPrinters | undefined;
let inFlight: Promise<MyPrinters> | null = null;
const listeners = new Set<(value: MyPrinters) => void>();

export function setCachedPrinters(value: MyPrinters) {
  cached = value;
  listeners.forEach((listener) => listener(value));
}

/** Reads them again, e.g. after a change the server makes more of (suggestions, the Bambu offer). */
export function reloadPrinters(): Promise<MyPrinters> {
  inFlight ??= printersApi
    .mine()
    .then((res) => {
      setCachedPrinters(res);
      return res;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** The user's printers, their library's suggestions and the Bambu offer; `loaded` false until the first answer. */
export function useUserPrinters(onUnauthorized?: () => void) {
  const [value, setValue] = useState<MyPrinters>(cached ?? EMPTY);
  const [loaded, setLoaded] = useState(cached !== undefined);

  useEffect(() => {
    let active = true;
    const listener = (next: MyPrinters) => {
      if (!active) return;
      setValue(next);
      setLoaded(true);
    };
    listeners.add(listener);
    if (cached === undefined) {
      reloadPrinters().catch((err: unknown) => {
        if (active && err instanceof UnauthorizedError) onUnauthorized?.();
        if (active) setLoaded(true);
      });
    }
    return () => {
      active = false;
      listeners.delete(listener);
    };
  }, [onUnauthorized]);

  const reload = useCallback(() => reloadPrinters(), []);
  return { ...value, loaded, reload };
}
