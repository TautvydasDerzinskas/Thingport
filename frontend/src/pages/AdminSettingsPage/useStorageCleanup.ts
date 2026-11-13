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
  const running = cleanup?.running ?? false;

  useEffect(() => {
    let active = true;
    adminApi.getStorageCleanup().then(
      (current) => active && setCleanup(current),
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
    let busy = false;
    const timer = window.setInterval(() => {
      if (busy) return;
      busy = true;
      adminApi
        .getStorageCleanup()
        .then((current) => {
          setCleanup(current);
          if (!current?.running) finished.current();
        })
        .catch((err: unknown) => {
          if (err instanceof UnauthorizedError) onUnauthorized?.();
        })
        .finally(() => {
          busy = false;
        });
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [running, onUnauthorized]);

  /** Throws the server's message when it refuses (one running already, files being moved or checked). */
  const start = useCallback(async (tasks: CleanupTaskKey[], keepPhotos: PhotoKeep | null) => {
    setCleanup(await adminApi.startStorageCleanup(tasks, keepPhotos));
  }, []);

  return { cleanup, running, start };
}
