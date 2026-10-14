import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { aiCategorizationApi, type AiRun, type AiRunScope } from "../../api/aiCategorization";
import { UnauthorizedError } from "../../api/client";

type AiRunContextValue = {
  /** The latest run, finished or not; null before the first one. */
  run: AiRun | null;
  running: boolean;
  startRun: (scope: AiRunScope) => Promise<void>;
  cancelRun: () => Promise<void>;
};

const AiRunContext = createContext<AiRunContextValue | null>(null);

const POLL_INTERVAL_MS = 2000;

/** A library AI categorization run, followed app-wide so its progress bar outlives the dialog that started it. */
export function AiRunProvider({
  onUnauthorized,
  onRunFinished,
  children,
}: {
  onUnauthorized?: () => void;
  /** Models may have changed category, and the run's summary notification has arrived. */
  onRunFinished?: () => void;
  children: React.ReactNode;
}) {
  const [run, setRun] = useState<AiRun | null>(null);
  const running = Boolean(run?.running);
  const onRunFinishedRef = useRef(onRunFinished);
  useEffect(() => {
    onRunFinishedRef.current = onRunFinished;
  }, [onRunFinished]);

  const refresh = useCallback(async () => {
    try {
      setRun((await aiCategorizationApi.runState()).run);
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
    }
  }, [onUnauthorized]);

  // Picks up a run already going after a reload; with AI off there can't be one.
  useEffect(() => {
    let active = true;
    void aiCategorizationApi
      .status()
      .then((status) => {
        if (active && status.enabled) void refresh();
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [refresh]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [running, refresh]);

  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running) onRunFinishedRef.current?.();
    wasRunning.current = running;
  }, [running]);

  const startRun = useCallback(async (scope: AiRunScope) => {
    setRun((await aiCategorizationApi.startRun(scope)).run);
  }, []);
  const cancelRun = useCallback(async () => {
    setRun((await aiCategorizationApi.cancelRun()).run);
  }, []);

  const value = useMemo(() => ({ run, running, startRun, cancelRun }), [run, running, startRun, cancelRun]);
  return <AiRunContext.Provider value={value}>{children}</AiRunContext.Provider>;
}

export function useAiRun(): AiRunContextValue {
  const value = useContext(AiRunContext);
  if (!value) throw new Error("useAiRun must be used inside AiRunProvider");
  return value;
}
