import { useEffect, useMemo, useRef, useState } from "react";
import { UnauthorizedError } from "../../../api/client";
import { printsApi, type Print, type PrintProfile } from "../../../api/prints";

const POLL_MS = 1500;
// A read waits its turn behind other models' and asks each provider once; past this the page stops asking and keeps
// what it has, and the next visit picks up the rest.
const MAX_POLLS = 80;

function fromPlates(print: Print | null): Record<string, PrintProfile> {
  if (!print) return {};
  return Object.fromEntries(print.plates.flatMap((plate) => (plate.profile ? [[plate.id, plate.profile]] : [])));
}

/**
 * The model's print profiles, and whether they're still being read. An older import's are read the first time its
 * owner opens it: the page starts that and follows along, filling in names, times and filament without a reload.
 * Someone else's shared model shows what its owner's library has.
 */
export function usePrintProfiles(print: Print | null, onUnauthorized?: () => void) {
  // Tagged with their model, so another model's answer never shows here.
  const [state, setState] = useState<{
    printId: string;
    profiles: Record<string, PrintProfile>;
    filling: boolean;
  } | null>(null);
  const unauthorized = useRef(onUnauthorized);
  useEffect(() => {
    unauthorized.current = onUnauthorized;
  }, [onUnauthorized]);

  const printId = print?.id ?? null;
  const ownModel = Boolean(print) && !print?.owner;
  const startPending = Boolean(print?.profiles_pending);
  const startFilling = Boolean(print?.profiles_filling);

  useEffect(() => {
    if (!printId || !ownModel || !(startPending || startFilling)) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;

    const settle = (profiles: Record<string, PrintProfile>, filling: boolean) => {
      if (cancelled) return;
      setState({ printId, profiles, filling: filling && polls < MAX_POLLS });
      if (filling && polls < MAX_POLLS) timer = setTimeout(() => void poll(), POLL_MS);
    };
    const fail = (err: unknown) => {
      if (cancelled) return;
      // Stopped, even when the first request is the one that failed: nothing shows as still loading.
      setState((prev) =>
        prev?.printId === printId ? { ...prev, filling: false } : { printId, profiles: {}, filling: false },
      );
      if (err instanceof UnauthorizedError) unauthorized.current?.();
      // Otherwise the profiles stay as they are: what's missing is read on a later visit.
      else console.error(err);
    };
    const poll = async () => {
      polls++;
      try {
        const next = await printsApi.getProfiles(printId);
        settle(next.profiles, next.filling);
      } catch (err) {
        fail(err);
      }
    };

    (async () => {
      try {
        const started = startPending ? await printsApi.fillProfiles(printId) : await printsApi.getProfiles(printId);
        settle(started.profiles, started.filling);
      } catch (err) {
        fail(err);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // Started once per model opened: a later copy of the same model (an edit's answer) needn't start it again.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [printId]);

  const initial = useMemo(() => fromPlates(print), [print]);
  const current = state?.printId === printId ? state : null;
  const profiles = useMemo(() => (current ? { ...initial, ...current.profiles } : initial), [current, initial]);
  return {
    profiles,
    filling: current ? current.filling : ownModel && (startPending || startFilling),
  };
}
