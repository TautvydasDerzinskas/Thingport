import { useSyncExternalStore } from "react";

// Messages that outlive the session they were said in. A toast goes with the app it was shown in, which a renewed
// session starts over and an expired one swaps for the sign-in page; these are shown beside the session's own toast
// instead (App's SessionNotices), until closed.

let notices: readonly string[] = [];
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((listener) => listener());

/** Says `message` where signing in again, or the app starting over on a renewed session, doesn't take it away. */
export function keepNotice(message: string): void {
  notices = [...notices, message];
  changed();
}

/** The one showing goes; the next, if any, shows. */
export function dismissNotice(): void {
  notices = notices.slice(1);
  changed();
}

export function useSessionNotices(): readonly string[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => notices,
  );
}
