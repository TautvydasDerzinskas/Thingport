import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { UnauthorizedError } from "../../api/client";
import { settingsApi, type StorageMove } from "../../api/settings";

type StorageMoveContextValue = {
  /** The latest move, finished or not; null before the first one (or for a member, who can't see them). */
  move: StorageMove | null;
  running: boolean;
  /** Follows a move the Storage page just started. */
  track: (move: StorageMove | null) => void;
  /** Counts up each time a move finishes, for pages to reload what it changed. */
  finishedCount: number;
};

const StorageMoveContext = createContext<StorageMoveContextValue | null>(null);

const POLL_INTERVAL_MS = 2000;

/** The background move of model files to a new storage structure, followed app-wide so its bar shows on every
 *  page; only admins start or see one. */
export function StorageMoveProvider({
  isAdmin,
  onUnauthorized,
  children,
}: {
  isAdmin: boolean;
  onUnauthorized?: () => void;
  children: React.ReactNode;
}) {
  const [move, setMove] = useState<StorageMove | null>(null);
  const [finishedCount, setFinishedCount] = useState(0);
  const running = Boolean(move?.running);

  const refresh = useCallback(async () => {
    try {
      setMove(await settingsApi.getStorageMove());
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
    }
  }, [onUnauthorized]);

  // One already going after a reload, or one a restart carried on with.
  useEffect(() => {
    if (isAdmin) void refresh();
  }, [isAdmin, refresh]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [running, refresh]);

  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running) setFinishedCount((count) => count + 1);
    wasRunning.current = running;
  }, [running]);

  const value = useMemo(() => ({ move, running, track: setMove, finishedCount }), [move, running, finishedCount]);
  return <StorageMoveContext.Provider value={value}>{children}</StorageMoveContext.Provider>;
}

export function useStorageMove(): StorageMoveContextValue {
  const value = useContext(StorageMoveContext);
  if (!value) throw new Error("useStorageMove must be used inside StorageMoveProvider");
  return value;
}
