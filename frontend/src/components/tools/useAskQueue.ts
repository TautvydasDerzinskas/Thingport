import { useCallback, useRef, useState } from "react";

type Asked<Q, A> = Q & { id: number; resolve: (answer: A) => void };

/**
 * A tool's questions that a dialog answers, such as `collections.pick()`, answered one at a time: one asked while the
 * dialog is open waits its turn instead of taking it over, so every call gets its own answer. `shown` is the one the
 * dialog is for, kept while it closes; key the dialog by its `id` so each question starts afresh.
 */
export function useAskQueue<Q extends object, A>() {
  const [state, setState] = useState<{ queue: Asked<Q, A>[]; last: Asked<Q, A> | null }>({ queue: [], last: null });
  const ids = useRef(0);

  const ask = useCallback(
    (question: Q) =>
      new Promise<A>((resolve) => {
        ids.current += 1;
        const asked = { ...question, id: ids.current, resolve };
        setState((now) => ({ ...now, queue: [...now.queue, asked] }));
      }),
    [],
  );

  const current = state.queue[0] ?? null;
  const answer = (given: A) => {
    if (!current) return;
    current.resolve(given);
    setState((now) => ({ queue: now.queue.filter((asked) => asked !== current), last: current }));
  };

  return { ask, answer, open: current !== null, shown: current ?? state.last };
}
