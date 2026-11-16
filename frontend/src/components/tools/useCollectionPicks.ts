import { useCallback, useRef, useState } from "react";
import type { ToolCollection } from "./toolSdk";

type Asked = { id: number; title?: string; resolve: (picked: ToolCollection | null) => void };

/**
 * A tool's `collections.pick()` calls, answered one at a time: one made while the picker is open waits its turn
 * instead of taking the dialog over, so every call gets its own answer. `shown` is the one the dialog is for, kept
 * while it closes; key the dialog by its `id` so each pick starts afresh.
 */
export function useCollectionPicks() {
  const [state, setState] = useState<{ queue: Asked[]; last: Asked | null }>({ queue: [], last: null });
  const ids = useRef(0);

  const pick = useCallback(
    (title?: string) =>
      new Promise<ToolCollection | null>((resolve) => {
        ids.current += 1;
        const asked: Asked = { id: ids.current, title, resolve };
        setState((now) => ({ ...now, queue: [...now.queue, asked] }));
      }),
    [],
  );

  const current = state.queue[0] ?? null;
  const answer = (picked: ToolCollection | null) => {
    if (!current) return;
    current.resolve(picked);
    setState((now) => ({ queue: now.queue.filter((asked) => asked !== current), last: current }));
  };

  return { pick, answer, open: current !== null, shown: current ?? state.last };
}
