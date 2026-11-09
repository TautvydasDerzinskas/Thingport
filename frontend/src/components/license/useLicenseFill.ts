import { useEffect, useRef, useState } from "react";
import { UnauthorizedError } from "../../api/client";
import { printsApi, type License, type Print } from "../../api/prints";

const POLL_MS = 1500;
// One read waits behind other models' and asks its site once; past this the page stops asking, and the next visit
// tries again.
const MAX_POLLS = 40;

/**
 * Whether the model's licence is still being read. An older import's is read the first time its owner opens it: this
 * starts that, follows along, and hands the licence to `onRead` once it's there, so the strip fills in without a
 * reload. Someone else's shared model shows what its owner's library has.
 */
export function useLicenseFill(
  print: Print | null,
  onRead: (printId: string, license: License | null) => void,
  onUnauthorized?: () => void,
) {
  const [fillingId, setFillingId] = useState<string | null>(null);
  const callbacks = useRef({ onRead, onUnauthorized });
  useEffect(() => {
    callbacks.current = { onRead, onUnauthorized };
  }, [onRead, onUnauthorized]);

  const printId = print?.id ?? null;
  const ownModel = Boolean(print) && !print?.owner;
  const startPending = Boolean(print?.license_pending);
  const startFilling = Boolean(print?.license_filling);

  useEffect(() => {
    if (!printId || !ownModel || !(startPending || startFilling)) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;

    const settle = (license: License | null, filling: boolean) => {
      if (cancelled) return;
      if (filling && polls < MAX_POLLS) {
        timer = setTimeout(() => void poll(), POLL_MS);
        return;
      }
      setFillingId(null);
      if (!filling) callbacks.current.onRead(printId, license);
    };
    const fail = (err: unknown) => {
      if (cancelled) return;
      setFillingId(null);
      if (err instanceof UnauthorizedError) callbacks.current.onUnauthorized?.();
      else console.error(err);
    };
    const poll = async () => {
      polls++;
      try {
        const next = await printsApi.getLicense(printId);
        settle(next.license, next.filling);
      } catch (err) {
        fail(err);
      }
    };

    setFillingId(printId);
    (async () => {
      try {
        const started = startPending ? await printsApi.fillLicense(printId) : await printsApi.getLicense(printId);
        settle(started.license, started.filling);
      } catch (err) {
        fail(err);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      setFillingId(null);
    };
  }, [printId, ownModel, startPending, startFilling]);

  return { loading: fillingId !== null && fillingId === printId };
}
