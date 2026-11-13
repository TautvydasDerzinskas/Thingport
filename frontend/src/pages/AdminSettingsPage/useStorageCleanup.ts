import { useCallback, useEffect, useRef, useState } from "react";
import { adminApi, type CleanupTaskKey, type PhotoKeep, type StorageCleanup } from "../../api/admin";
import { UnauthorizedError } from "../../api/client";

const POLL_INTERVAL_MS = 1000;

/** The clean-up running (or last run), followed while it runs; `onFinished` once one this page saw running ends. */
export function useStorageCleanup(onFinished: () => void, onUnauthorized?: () => void) {
  const [cleanup, setCleanup] = useState<StorageCleanup | null>(null);
  const finished = useRef(onFinished);
  useEffect(() => {
    finished.current = onFinished;
  });
  // Moves on when a run starts: an answer to a read sent before then is dropped, as it would put back the run as it
  // was before the start, and stop the page following it.
  const starts = useRef(0);
  const running = cleanup?.running ?? false;

  useEffect(() => {
    let active = true;
    const asked = starts.current;
    adminApi.getStorageCleanup().then(
      (current) => {
        if (active && asked === starts.current) setCleanup(current);
      },
      (err: unknown) => {
        if (active && err instanceof UnauthorizedError) onUnauthorized?.();
      },
    );
    return () => {
      active = false;
    };
  }, [onUnauthorized]);

  useEffect(() => {
    if (!running) return;
    // A read still out when this ends (the run ended, or the page went) is dropped too.
    let active = true;
    let busy = false;
    const timer = window.setInterval(() => {
      if (busy) return;
      busy = true;
      const asked = starts.current;
      adminApi
        .getStorageCleanup()
        .then((current) => {
          if (!active || asked !== starts.current) return;
          setCleanup(current);
          if (!current?.running) finished.current();
        })
        .catch((err: unknown) => {
          if (active && err instanceof UnauthorizedError) onUnauthorized?.();
        })
        .finally(() => {
          busy = false;
        });
    }, POLL_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [running, onUnauthorized]);

  /** Throws the server's message when it refuses (one running already, files being moved or checked). */
  const start = useCallback(async (tasks: CleanupTaskKey[], keepPhotos: PhotoKeep | null) => {
    const started = await adminApi.startStorageCleanup(tasks, keepPhotos);
    starts.current++;
    setCleanup(started);
  }, []);

  return { cleanup, running, start };
}
