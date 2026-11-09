import { useCallback, useEffect, useRef, useState } from "react";
import { UnauthorizedError } from "../../api/client";
import { printsApi, type License, type Print, type PrintLicense } from "../../api/prints";

const POLL_MS = 1500;
// One read waits behind other models' and asks its site once; past this the page stops asking, and the next visit
// tries again.
const MAX_POLLS = 40;

/**
 * Whether the model's licence is still being read. An older import's is read the first time its owner opens it: this
 * starts that, follows along, and hands the licence to `onRead` once it's there, so the strip fills in without a
 * reload. A read that failed is `failed`, apart from a site that stated none, and `retry` asks again. Someone else's
 * shared model shows what its owner's library has.
 */
export function useLicenseFill(
  print: Print | null,
  onRead: (printId: string, license: License | null) => void,
  onUnauthorized?: () => void,
) {
  const [fillingId, setFillingId] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);
  // A model whose page said its last read failed, until its owner retried.
  const [retriedId, setRetriedId] = useState<string | null>(null);
  // The last retry asked for, numbered, and the number answered last: an effect run again for another reason (or twice,
  // in development) asks again only for one not answered yet, and only for the model it was asked for.
  const [asked, setAsked] = useState<{ printId: string; n: number } | null>(null);
  const answered = useRef(0);
  const callbacks = useRef({ onRead, onUnauthorized });
  useEffect(() => {
    callbacks.current = { onRead, onUnauthorized };
  }, [onRead, onUnauthorized]);

  const printId = print?.id ?? null;
  const ownModel = Boolean(print) && !print?.owner;
  const startPending = Boolean(print?.license_pending);
  const startFilling = Boolean(print?.license_filling);
  const retryN = asked && asked.printId === printId ? asked.n : 0;

  useEffect(() => {
    const retrying = retryN > answered.current;
    if (!printId || !ownModel || !(startPending || startFilling || retrying)) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;

    const settle = (state: PrintLicense) => {
      if (cancelled) return;
      if (state.filling && polls < MAX_POLLS) {
        timer = setTimeout(() => void poll(), POLL_MS);
        return;
      }
      answered.current = Math.max(answered.current, retryN);
      setFillingId(null);
      // Still pending once it's done: the read never got as far as saying anything.
      if (state.filling || state.failed || state.pending) setFailedId(printId);
      else callbacks.current.onRead(printId, state.license);
    };
    const fail = (err: unknown) => {
      if (cancelled) return;
      answered.current = Math.max(answered.current, retryN);
      setFillingId(null);
      if (err instanceof UnauthorizedError) {
        callbacks.current.onUnauthorized?.();
        return;
      }
      console.error(err);
      setFailedId(printId);
    };
    const poll = async () => {
      polls++;
      try {
        settle(await printsApi.getLicense(printId));
      } catch (err) {
        fail(err);
      }
    };

    setFillingId(printId);
    (async () => {
      try {
        settle(
          retrying
            ? await printsApi.fillLicense(printId, { retry: true })
            : startPending
              ? await printsApi.fillLicense(printId)
              : await printsApi.getLicense(printId),
        );
      } catch (err) {
        fail(err);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      setFillingId(null);
    };
  }, [printId, ownModel, startPending, startFilling, retryN]);

  const retry = useCallback(() => {
    if (!printId) return;
    setFailedId(null);
    setRetriedId(printId);
    setAsked((prev) => ({ printId, n: (prev?.n ?? 0) + 1 }));
  }, [printId]);

  const loading = fillingId !== null && fillingId === printId;
  const failed =
    ownModel && !loading && (failedId === printId || (Boolean(print?.license_failed) && retriedId !== printId));
  return { loading, failed, retry };
}
