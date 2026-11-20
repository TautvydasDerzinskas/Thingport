import { useLayoutEffect, useSyncExternalStore } from "react";

// Messages that outlive the session they were said in. A toast goes with the app it was shown in, which a renewed
// session starts over and an expired one swaps for the sign-in page; these are shown beside the session's own toast
// instead (App's SessionNotices), until closed.

let notices: readonly string[] = [];
const NONE: readonly string[] = [];
// Whose they are: the account signed in, which stays App's user while its ended session signs in again. They name
// that account's files, so another account, or none (signed out), takes them away.
let owner: string | null = null;
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

/** The account the app is for now: the notices kept for any other go. */
export function setNoticeOwner(account: string | null): void {
  if (account === owner) return;
  owner = account;
  if (!notices.length) return;
  notices = [];
  changed();
}

/** `account`'s notices: none while another's are still on their way out. */
export function useSessionNotices(account: string | null): readonly string[] {
  const all = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => notices,
  );
  // Before the page is drawn, so one account never sees another's.
  useLayoutEffect(() => setNoticeOwner(account), [account]);
  return account === owner ? all : NONE;
}
