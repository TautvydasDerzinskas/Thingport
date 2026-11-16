import { useCallback, useRef, useState } from "react";
import type { ToolCollection } from "./toolSdk";

type Asked = { id: number; owner: object; title?: string; resolve: (picked: ToolCollection | null) => void };

/** One run of a tool's picks. Once it has ended, its unanswered picks and any it asks for later never answer, so
 * nothing in a stopped run carries on, and a newer run's picks don't wait behind them. */
export type PickSession = { pick: (title?: string) => Promise<ToolCollection | null>; end: () => void };

/**
 * A tool's `collections.pick()` calls, answered one at a time: one made while the picker is open waits its turn
 * instead of taking the dialog over, so every call gets its own answer. Each run of a tool asks through its own
 * `session()`. `shown` is the one the dialog is for, kept while it closes; key the dialog by its `id` so each pick
 * starts afresh.
 */
export function useCollectionPicks() {
  const [state, setState] = useState<{ queue: Asked[]; last: Asked | null }>({ queue: [], last: null });
  const ids = useRef(0);

  const session = useCallback((): PickSession => {
    const owner = {};
    let ended = false;
    return {
      pick: (title) =>
        new Promise((resolve) => {
          if (ended) return;
          ids.current += 1;
          const asked: Asked = { id: ids.current, owner, title, resolve };
          setState((now) => ({ ...now, queue: [...now.queue, asked] }));
        }),
      end: () => {
        ended = true;
        setState((now) => {
          const queue = now.queue.filter((asked) => asked.owner !== owner);
          // Where the dialog's own pick is dropped and none waits, it closes on that one.
          return { queue, last: queue[0] === now.queue[0] ? now.last : (now.queue[0] ?? now.last) };
        });
      },
    };
  }, []);

  const current = state.queue[0] ?? null;
  const answer = (picked: ToolCollection | null) => {
    if (!current) return;
    current.resolve(picked);
    setState((now) => ({ queue: now.queue.filter((asked) => asked !== current), last: current }));
  };

  return { session, answer, open: current !== null, shown: current ?? state.last };
}
