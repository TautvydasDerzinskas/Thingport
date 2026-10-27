import { useCallback, useRef, useState } from "react";
import type { ParameterValues } from "./parameters";

/** Changes to one parameter closer together than this are the same edit: one drag of a slider, not forty. */
const COALESCE_MS = 700;

/** How far back it remembers. A snapshot is a handful of values, so this is nothing to hold. */
const DEPTH = 100;

export type History = { past: ParameterValues[]; present: ParameterValues; future: ParameterValues[] };

export const historyOf = (values: ParameterValues): History => ({ past: [], present: values, future: [] });

/**
 * One parameter changed.
 *
 * `continuing` says this is more of the edit already on top of the stack -- a slider still being dragged -- so
 * that step is replaced rather than added to. The value the drag started from is the snapshot underneath,
 * which is the one undo should land on.
 */
export function withValue(history: History, name: string, value: unknown, continuing: boolean): History {
  if (JSON.stringify(history.present[name]) === JSON.stringify(value)) return history;
  const past = continuing && history.past.length ? history.past : [...history.past, history.present];
  return { past: past.slice(-DEPTH), present: { ...history.present, [name]: value }, future: [] };
}

/** Everything replaced as one step: Reset, or a set of values loaded in. */
export function withValues(history: History, values: ParameterValues): History {
  return { past: [...history.past, history.present].slice(-DEPTH), present: values, future: [] };
}

export function undone(history: History): History {
  const previous = history.past.at(-1);
  if (!previous) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future].slice(0, DEPTH),
  };
}

export function redone(history: History): History {
  const [next, ...rest] = history.future;
  if (!next) return history;
  return { past: [...history.past, history.present].slice(-DEPTH), present: next, future: rest };
}

export type ValueHistory = {
  values: ParameterValues;
  /** Changes one parameter, coalescing a run of changes to the same one into a single step. */
  set: (name: string, value: unknown) => void;
  /** Replaces everything as one step: Reset, or a parameter set loaded in. */
  replace: (values: ParameterValues) => void;
  /** Starts again on a new script: nothing to undo back into the last one's values. */
  restart: (values: ParameterValues) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
};

/**
 * The reader's values, with every change undoable.
 *
 * Whole snapshots rather than a log of edits: a snapshot is a dozen numbers, and undoing one is then the same
 * work whether the step was a slider moving or Reset putting everything back at once.
 */
export function useValueHistory(initial: ParameterValues): ValueHistory {
  const [history, setHistory] = useState<History>(() => historyOf(initial));
  // Which parameter the last change touched and when, to tell one drag from two edits.
  const last = useRef<{ name: string; at: number } | null>(null);

  const set = useCallback((name: string, value: unknown) => {
    const now = Date.now();
    const continuing = last.current?.name === name && now - last.current.at < COALESCE_MS;
    last.current = { name, at: now };
    setHistory((current) => withValue(current, name, value, continuing));
  }, []);

  const replace = useCallback((values: ParameterValues) => {
    last.current = null;
    setHistory((current) => withValues(current, values));
  }, []);

  const restart = useCallback((values: ParameterValues) => {
    last.current = null;
    setHistory(historyOf(values));
  }, []);

  const undo = useCallback(() => {
    last.current = null;
    setHistory(undone);
  }, []);

  const redo = useCallback(() => {
    last.current = null;
    setHistory(redone);
  }, []);

  return {
    values: history.present,
    set,
    replace,
    restart,
    undo,
    redo,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
  };
}
