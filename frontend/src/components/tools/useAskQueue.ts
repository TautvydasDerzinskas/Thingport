import { useCallback, useRef, useState } from "react";

type Asked<Q, A> = Q & { id: number; owner: object; resolve: (answer: A) => void };

/** One run of a tool's questions. Once it has ended, its unanswered ones and any it asks later never answer, so
 * nothing in a stopped run carries on, and a newer run's questions don't wait behind them. */
export type AskSession<Q, A> = { ask: (question: Q) => Promise<A>; end: () => void };

/**
 * A tool's questions that a dialog answers, such as `collections.pick()`, answered one at a time: one asked while the
 * dialog is open waits its turn instead of taking it over, so every call gets its own answer. Each run of a tool asks
 * through its own `session()`. `shown` is the one the dialog is for, kept while it closes; key the dialog by its `id`
 * so each question starts afresh.
 */
export function useAskQueue<Q extends object, A>() {
  const [state, setState] = useState<{ queue: Asked<Q, A>[]; last: Asked<Q, A> | null }>({ queue: [], last: null });
  const ids = useRef(0);

  const session = useCallback((): AskSession<Q, A> => {
    const owner = {};
    let ended = false;
    return {
      ask: (question) =>
        new Promise<A>((resolve) => {
          if (ended) return;
          ids.current += 1;
          const asked = { ...question, id: ids.current, owner, resolve };
          setState((now) => ({ ...now, queue: [...now.queue, asked] }));
        }),
      end: () => {
        ended = true;
        setState((now) => {
          const queue = now.queue.filter((asked) => asked.owner !== owner);
          // Where the dialog's own question is dropped and none waits, it closes on that one.
          return { queue, last: queue[0] === now.queue[0] ? now.last : (now.queue[0] ?? now.last) };
        });
      },
    };
  }, []);

  const current = state.queue[0] ?? null;
  const answer = (given: A) => {
    if (!current) return;
    current.resolve(given);
    setState((now) => ({ queue: now.queue.filter((asked) => asked !== current), last: current }));
  };

  return { session, answer, open: current !== null, shown: current ?? state.last };
}
