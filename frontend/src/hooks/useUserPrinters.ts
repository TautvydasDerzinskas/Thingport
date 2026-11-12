import { useCallback, useEffect, useState } from "react";
import { UnauthorizedError } from "../api/client";
import { printersApi, type MyPrinters } from "../api/printers";

const EMPTY: MyPrinters = { printers: [], suggestions: [], bambu: false };

// Shared by every mounted instance so there's one request, and changes reach all of them.
let cached: MyPrinters | undefined;
let inFlight: Promise<MyPrinters> | null = null;
// A read asked for while one was out, which may have missed the change it was asked after.
let queued: Promise<MyPrinters> | null = null;
// Which account's they are: a read from before a sign-in or sign-out doesn't fill the cache.
let session = 0;
const listeners = new Set<(value: MyPrinters) => void>();

export function setCachedPrinters(value: MyPrinters) {
  cached = value;
  listeners.forEach((listener) => listener(value));
}

/** Forgets them, on signing in or out: they're the account's. */
export function resetUserPrinters() {
  session += 1;
  cached = undefined;
  inFlight = null;
  queued = null;
}

function read(): Promise<MyPrinters> {
  const started = session;
  const request: Promise<MyPrinters> = printersApi
    .mine()
    .then((res) => {
      if (started === session) setCachedPrinters(res);
      return res;
    })
    .finally(() => {
      if (inFlight === request) inFlight = null;
    });
  inFlight = request;
  return request;
}

/** Reads them again, e.g. after a change the server makes more of (suggestions, the Bambu offer). */
export function reloadPrinters(): Promise<MyPrinters> {
  const running = inFlight;
  if (!running) return read();
  if (!queued) {
    const asked = session;
    const next: Promise<MyPrinters> = running
      .catch(() => undefined)
      .then(() => {
        // Signed in or out since: the new account's reads aren't this one's to start or to stand in for.
        if (asked !== session) return running;
        if (queued === next) queued = null;
        // One started since the last settled already reads after the change; two at once could land out of order.
        return inFlight ?? read();
      });
    queued = next;
  }
  return queued;
}

/** The user's printers, their library's suggestions and the Bambu offer; `loaded` false until the first answer, and
 *  `failed` when that answer was an error, which `reload` tries again. */
export function useUserPrinters(onUnauthorized?: () => void) {
  const [value, setValue] = useState<MyPrinters>(cached ?? EMPTY);
  const [loaded, setLoaded] = useState(cached !== undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    const listener = (next: MyPrinters) => {
      if (!active) return;
      setValue(next);
      setLoaded(true);
      setFailed(false);
    };
    listeners.add(listener);
    if (cached === undefined) {
      reloadPrinters().catch((err: unknown) => {
        if (!active) return;
        if (err instanceof UnauthorizedError) onUnauthorized?.();
        else setFailed(true);
        setLoaded(true);
      });
    }
    return () => {
      active = false;
      listeners.delete(listener);
    };
  }, [onUnauthorized]);

  const reload = useCallback(() => {
    setFailed(false);
    // Without an answer to show, they're unknown again until this one comes back.
    setLoaded(cached !== undefined);
    return reloadPrinters().catch((err: unknown) => {
      setLoaded(true);
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else setFailed(true);
      throw err;
    });
  }, [onUnauthorized]);
  return { ...value, loaded, failed, reload };
}
