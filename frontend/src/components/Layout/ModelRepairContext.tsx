import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { UnauthorizedError } from "../../api/client";
import {
  modelRepairApi,
  type MissingFilesSummary,
  type ModelRepairAction,
  type ModelRepairRun,
} from "../../api/modelRepair";

// The models whose files are gone, followed app-wide: the look that finds them, the dialog that offers the repair,
// and the run itself, whose bar shows on every page until it's done.
//
// Whether to ask is the backend's answer (`prompt`): an accident that took a fair share of the library, not a
// model or two. A "not now" is remembered against the count it was given at, so it comes back if things get worse
// but never nags about the same breakage.

const POLL_INTERVAL_MS = 2000;
const DISMISSED_KEY = "thingport.missingFiles.dismissedAt";

type ModelRepairContextValue = {
  /** What the last look found; null until one has been made (or for a library with nothing wrong). */
  summary: MissingFilesSummary | null;
  /** Whether the last look couldn't be made -- an unreadable storage folder answers neither way. */
  checkFailed: boolean;
  /** Looks again; `rescan` walks the files afresh instead of taking the server's last answer. */
  refresh: (rescan?: boolean) => Promise<MissingFilesSummary | null>;
  /** The latest run, finished or not. */
  run: ModelRepairRun | null;
  running: boolean;
  start: (action: ModelRepairAction) => Promise<void>;
  cancel: () => Promise<void>;
  /** Whether the dialog is up, and the ways it goes up and away. */
  promptOpen: boolean;
  openPrompt: () => void;
  closePrompt: () => void;
  /** Counts up each time a run finishes, for pages to reload what it changed. */
  finishedCount: number;
};

const ModelRepairContext = createContext<ModelRepairContextValue | null>(null);

function dismissedAt(): number {
  try {
    return Number(window.localStorage.getItem(DISMISSED_KEY)) || 0;
  } catch {
    // Private browsing, or site data switched off: the dialog simply shows again.
    return 0;
  }
}

function remember(broken: number): void {
  try {
    window.localStorage.setItem(DISMISSED_KEY, String(broken));
  } catch {
    // As above.
  }
}

export function ModelRepairProvider({
  onUnauthorized,
  onRepairFinished,
  children,
}: {
  onUnauthorized?: () => void;
  /** Models have changed, and the run's notification has arrived. */
  onRepairFinished?: () => void;
  children: React.ReactNode;
}) {
  const [summary, setSummary] = useState<MissingFilesSummary | null>(null);
  const [checkFailed, setCheckFailed] = useState(false);
  const [run, setRun] = useState<ModelRepairRun | null>(null);
  const [looked, setLooked] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  // Read once, and kept here rather than read back on each render: the dialog that came up on its own closes
  // because this changes, not because of the store behind it.
  const [dismissed, setDismissed] = useState(dismissedAt);
  const [finishedCount, setFinishedCount] = useState(0);
  const running = Boolean(run?.running);
  // Each ask about the run takes a number, and only the newest may answer: a poll sent before a stop can land after
  // it, and would set the run going again -- the bar back, and the end of it counted twice.
  const asked = useRef(0);

  const refresh = useCallback(
    async (rescan = false) => {
      try {
        const next = await modelRepairApi.missingFiles(rescan);
        setSummary(next);
        setCheckFailed(false);
        return next;
      } catch (err) {
        if (err instanceof UnauthorizedError) onUnauthorized?.();
        else setCheckFailed(true);
        return null;
      }
    },
    [onUnauthorized],
  );

  // Once per visit: the look, and a run already going picked up after a reload. The look runs the once, so what it
  // needs is held in a ref rather than taken as a dependency.
  const unauthorized = useRef(onUnauthorized);
  useEffect(() => {
    unauthorized.current = onUnauthorized;
  }, [onUnauthorized]);
  useEffect(() => {
    let active = true;
    void (async () => {
      const [look, state] = await Promise.all([
        modelRepairApi.missingFiles().then(
          (found) => ({ found, error: null as unknown }),
          (error: unknown) => ({ found: null, error }),
        ),
        modelRepairApi.runState().catch(() => null),
      ]);
      if (!active) return;
      if (look.found) setSummary(look.found);
      // A sign-in that has run out is the app's to answer, and says nothing about the library.
      else if (look.error instanceof UnauthorizedError) unauthorized.current?.();
      else setCheckFailed(true);
      // Only what the run state actually said: taken for an idle run, a repair already going would have the dialog
      // come up over it, with no bar to show for it. Nothing is assumed until it answers.
      if (!state) return;
      if (asked.current === 0) setRun(state.run);
      setLooked(true);
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      const mine = ++asked.current;
      void modelRepairApi
        .runState()
        .then(({ run: next }) => {
          if (mine === asked.current) setRun(next);
        })
        .catch((err: unknown) => {
          if (err instanceof UnauthorizedError) onUnauthorized?.();
        });
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [running, onUnauthorized]);

  // When a run ends: what it left behind, and a nudge to the pages showing it.
  const onFinished = useRef(onRepairFinished);
  useEffect(() => {
    onFinished.current = onRepairFinished;
  }, [onRepairFinished]);
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running) {
      void refresh(true);
      setFinishedCount((count) => count + 1);
      onFinished.current?.();
    }
    wasRunning.current = running;
  }, [running, refresh]);

  const start = useCallback(async (action: ModelRepairAction) => {
    const mine = ++asked.current;
    const { run: started } = await modelRepairApi.startRun(action);
    if (mine === asked.current) setRun(started);
    setDialogOpen(false);
  }, []);

  const cancel = useCallback(async () => {
    const mine = ++asked.current;
    const { run: next } = await modelRepairApi.cancelRun();
    if (mine === asked.current) setRun(next);
  }, []);

  const closePrompt = useCallback(() => {
    setDialogOpen(false);
    if (summary?.broken) {
      remember(summary.broken);
      setDismissed(summary.broken);
    }
  }, [summary]);

  // Up on its own once the first look is in, unless a repair is already going or this breakage was waved off.
  const promptOpen =
    dialogOpen || Boolean(looked && !running && summary?.prompt && summary.broken > dismissed && summary.broken > 0);

  const value = useMemo(
    () => ({
      summary,
      checkFailed,
      refresh,
      run,
      running,
      start,
      cancel,
      promptOpen,
      openPrompt: () => setDialogOpen(true),
      closePrompt,
      finishedCount,
    }),
    [summary, checkFailed, refresh, run, running, start, cancel, promptOpen, closePrompt, finishedCount],
  );
  return <ModelRepairContext.Provider value={value}>{children}</ModelRepairContext.Provider>;
}

export function useModelRepair(): ModelRepairContextValue {
  const value = useContext(ModelRepairContext);
  if (!value) throw new Error("useModelRepair must be used inside ModelRepairProvider");
  return value;
}
