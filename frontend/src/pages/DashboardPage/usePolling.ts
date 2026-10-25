import { useEffect, useRef } from "react";

/**
 * Calls `poll` now and every `intervalMs` after, while the page is visible: a dashboard left open in a background tab
 * shouldn't keep asking the server. Coming back to the tab polls straight away. `key` restarts it, e.g. when the
 * addresses to poll change, and an empty one means there's nothing to poll.
 */
export function usePolling(poll: () => void, intervalMs: number, key: string): void {
  const latest = useRef(poll);
  useEffect(() => {
    latest.current = poll;
  });

  useEffect(() => {
    if (!key) return;
    let timer: number | undefined;
    const run = () => {
      window.clearTimeout(timer);
      if (document.visibilityState !== "visible") return;
      latest.current();
      timer = window.setTimeout(run, intervalMs);
    };
    run();
    document.addEventListener("visibilitychange", run);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", run);
    };
  }, [intervalMs, key]);
}
