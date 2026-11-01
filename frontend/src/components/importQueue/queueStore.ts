import type { TFunction } from "i18next";
import { UnauthorizedError } from "../../api/client";
import {
  adminQueueApi,
  importQueueApi,
  importsApi,
  type ImportJobItem,
  type LineOut,
  type QueueSubmitAnswer,
} from "../../api/imports";
import type { ProviderId } from "../../providers/index.generated";
import type { ToastOptions } from "../ToastProvider";
import {
  diffSnapshots,
  EMPTY_LINE,
  everyoneDelay,
  finishedBeyondList,
  finishToastOf,
  indicatorState,
  pollDelay,
  submittedText,
  toEveryoneQueue,
  toQueueSnapshot,
  type QueueJob,
  type QueueLocation,
  type QueueScope,
  type QueueSection,
} from "./queueView";

// Three of the fast polls.
const FLASH_MS = 4500;
// Long enough to reach its Open button.
const FINISH_TOAST_MS = 8000;

export type QueueState = {
  viewerId: string | null;
  /** False once the backend turned out to be older than the line: no indicator, nothing to list of one's own. */
  supported: boolean;
  /** Until the first answer. */
  loading: boolean;
  /** The last read failed; what's shown is from the one before. */
  failed: boolean;
  /** The viewer's own, unfinished and needing attention, plus the newest of the finished. */
  jobs: QueueJob[];
  line: LineOut;
  finishedTotal: number;
  startGrabLinks: boolean;
  /** Their imports just all finished, for a few seconds. */
  flash: boolean;
  /** Goes up whenever one of theirs finishes, for pages showing what it may have brought in. */
  finishedVersion: number;
  dialog: { open: boolean; section: QueueSection; scope: QueueScope; person: string | null };
  /** Everyone's imports, read only while on screen. */
  everyone: { jobs: QueueJob[]; olderBackend: boolean; loading: boolean; failed: boolean };
  /** Job and link ids, and bulk action names, with a request on its way. */
  busy: ReadonlySet<string>;
};

export function initialQueueState(viewerId: string | null = null): QueueState {
  return {
    viewerId,
    supported: true,
    loading: true,
    failed: false,
    jobs: [],
    line: EMPTY_LINE,
    finishedTotal: 0,
    startGrabLinks: false,
    flash: false,
    finishedVersion: 0,
    dialog: { open: false, section: "run", scope: "mine", person: null },
    everyone: { jobs: [], olderBackend: false, loading: true, failed: false },
    busy: new Set(),
  };
}

export type QueueStoreDeps = {
  viewerId: string | null;
  isAdmin: boolean;
  isHidden: () => boolean;
};

/** What the store reaches out to, which changes as the app renders. */
export type QueueStoreLinks = {
  t: TFunction;
  toast: (options: ToastOptions) => void;
  navigate: (path: string) => void;
  onUnauthorized: () => void;
  /** One of the viewer's imports finished. */
  onCompleted: () => void;
};

const noop = () => undefined;
const UNCONNECTED: QueueStoreLinks = {
  t: ((key: string) => key) as TFunction,
  toast: noop,
  navigate: noop,
  onUnauthorized: noop,
  onCompleted: noop,
};

/** Runs `run` now and again `delay()` after each time it ends, one at a time. `run` must not reject. */
function createPoller(run: () => Promise<void>, delay: () => number) {
  let active = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | null = null;
  let queued: Promise<void> | null = null;

  const now = (): Promise<void> => {
    if (!active) return Promise.resolve();
    if (inFlight) {
      // What's on its way may have read the server before this was asked for.
      queued ??= inFlight.then(() => {
        queued = null;
        return now();
      });
      return queued;
    }
    clearTimeout(timer);
    inFlight = run().finally(() => {
      inFlight = null;
      if (active) timer = setTimeout(() => void now(), delay());
    });
    return inFlight;
  };

  return {
    start: () => {
      active = true;
      return now();
    },
    stop: () => {
      active = false;
      clearTimeout(timer);
    },
    now,
  };
}

/** The viewer's queue, one poll of it for the whole app, and all that can be done to it. Plain enough to test without
 *  a DOM; ImportQueueContext gives it to React. One store per signed-in account. */
export function createQueueStore(deps: QueueStoreDeps) {
  let links = UNCONNECTED;
  let state = initialQueueState(deps.viewerId);
  const listeners = new Set<() => void>();
  const set = (patch: Partial<QueueState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };

  let started = false;
  // Answers to requests made before a stop() are dropped.
  let session = 0;
  let previous: QueueJob[] | null = null;
  let flashTimer: ReturnType<typeof setTimeout> | undefined;

  const go = (location: QueueLocation) => {
    if ("path" in location) {
      close();
      links.navigate(location.path);
    } else {
      open(location.section, "mine");
    }
  };

  const announce = (finished: QueueJob[], flash: boolean, beyondList: number) => {
    if (flash) {
      clearTimeout(flashTimer);
      set({ flash: true });
      flashTimer = setTimeout(() => set({ flash: false }), FLASH_MS);
    }
    set({ finishedVersion: state.finishedVersion + 1 });
    links.onCompleted();
    const toast = finishToastOf(finished, links.t, beyondList);
    if (!toast) return;
    const { message, severity, open: location } = toast;
    links.toast(
      location
        ? {
            message,
            severity,
            action: { label: links.t("importQueue.toast.open"), onClick: () => go(location) },
            autoHideMs: FINISH_TOAST_MS,
          }
        : { message, severity },
    );
  };

  // A setting being saved is newer than what a poll read before the save got there.
  let saves = 0;
  let savedStartGrabLinks = false;

  const loadOwn = async () => {
    const asked = session;
    try {
      const body = await importQueueApi.get();
      if (asked !== session) return;
      if (!body) {
        // Seen as new if the backend is upgraded, without replaying what finished before then.
        previous = null;
        set({ supported: false, loading: false, failed: false, jobs: [], line: EMPTY_LINE, finishedTotal: 0 });
        return;
      }
      const snapshot = toQueueSnapshot(body);
      const { finished, flash } = diffSnapshots(previous, snapshot.jobs);
      const beyondList = finishedBeyondList(finished, state.finishedTotal, snapshot.finishedTotal);
      previous = snapshot.jobs;
      if (!saves) savedStartGrabLinks = snapshot.startGrabLinks;
      set({
        supported: true,
        loading: false,
        failed: false,
        jobs: snapshot.jobs,
        line: snapshot.line,
        finishedTotal: snapshot.finishedTotal,
        startGrabLinks: saves ? state.startGrabLinks : snapshot.startGrabLinks,
      });
      if (finished.length) announce(finished, flash, beyondList);
    } catch (err) {
      if (asked !== session) return;
      // Whatever answers the 401 either renews the session, which starts a new store, or ends it.
      if (err instanceof UnauthorizedError) links.onUnauthorized();
      else set({ loading: false, failed: true });
    }
  };

  const loadEveryone = async () => {
    const asked = session;
    try {
      const queue = toEveryoneQueue(await adminQueueApi.get());
      if (asked !== session) return;
      set({ everyone: { ...queue, loading: false, failed: false } });
    } catch (err) {
      if (asked !== session) return;
      if (err instanceof UnauthorizedError) links.onUnauthorized();
      else set({ everyone: { ...state.everyone, loading: false, failed: true } });
    }
  };

  const own = createPoller(loadOwn, () =>
    pollDelay({
      supported: state.supported,
      hidden: deps.isHidden(),
      dialogOpen: state.dialog.open,
      jobs: state.jobs,
      line: state.line,
    }),
  );
  const everyone = createPoller(loadEveryone, () =>
    everyoneDelay({ hidden: deps.isHidden(), jobs: state.everyone.jobs }),
  );

  const showingEveryone = () => deps.isAdmin && state.dialog.scope === "everyone";

  const watchEveryone = () => {
    if (started && state.dialog.open && showingEveryone()) void everyone.start();
    else everyone.stop();
  };

  // An older backend has nothing to read, and its timer looks again in a while.
  const readOwn = () => (state.supported ? own.now() : undefined);

  const refresh = async () => {
    await Promise.all([readOwn(), everyone.now()]);
  };

  const open = (section?: QueueSection, scope: QueueScope = "mine") => {
    set({
      dialog: {
        open: true,
        section: section ?? indicatorState(state.jobs, state.flash).section,
        scope: deps.isAdmin ? scope : "mine",
        person: null,
      },
    });
    watchEveryone();
    void readOwn();
  };

  const close = () => {
    set({ dialog: { ...state.dialog, open: false } });
    watchEveryone();
  };

  /** One action: its button off meanwhile, the server's reason shown if refused, and the list read again after. */
  const perform = async <T>(key: string, call: () => Promise<T>, done?: (result: T) => void): Promise<T | null> => {
    if (state.busy.has(key)) return null;
    set({ busy: new Set(state.busy).add(key) });
    try {
      const result = await call();
      done?.(result);
      return result;
    } catch (err) {
      if (err instanceof UnauthorizedError) links.onUnauthorized();
      else links.toast({ message: err instanceof Error ? err.message : String(err), severity: "error" });
      return null;
    } finally {
      await refresh();
      const busy = new Set(state.busy);
      busy.delete(key);
      set({ busy });
    }
  };

  const countToast = (key: string, count: number) => {
    if (count > 0) links.toast({ message: links.t(key, { count }) });
  };

  const submitted = (answer: QueueSubmitAnswer) => {
    const message = submittedText(answer, links.t);
    if (message) links.toast({ message });
    void refresh();
    return answer;
  };

  let latestSave = 0;
  // Saves go one at a time, so the last pick is the one that sticks.
  let saving: Promise<unknown> = Promise.resolve();

  const actions = {
    /** Opens on `section`, or on what the indicator is showing. An everyone scope is for admins only. */
    open,
    close,
    setSection: (section: QueueSection) => set({ dialog: { ...state.dialog, section } }),
    setScope: (scope: QueueScope) => {
      set({ dialog: { ...state.dialog, scope: deps.isAdmin ? scope : "mine" } });
      watchEveryone();
    },
    /** Narrows everyone's list to one person; bulk actions follow it. */
    setPerson: (person: string | null) => set({ dialog: { ...state.dialog, person } }),
    /** Reads the queue again now. */
    refresh,

    // Submits reject to the caller, who knows what to say and what to offer next.
    submitLink: (payload: Parameters<typeof importQueueApi.submitLink>[0]) =>
      importQueueApi.submitLink(payload).then(submitted),
    submitLinks: (payload: Parameters<typeof importQueueApi.submitLinks>[0]) =>
      importQueueApi.submitLinks(payload).then(submitted),
    submitZip: (payload: Parameters<typeof importQueueApi.submitZip>[0]) =>
      importQueueApi.submitZip(payload).then(submitted),
    submitList: (provider: ProviderId, payload: Parameters<typeof importQueueApi.submitList>[1]) =>
      importQueueApi.submitList(provider, payload).then(submitted),
    submitProfiles: (provider: ProviderId, payload: Parameters<typeof importQueueApi.submitProfiles>[1]) =>
      importQueueApi.submitProfiles(provider, payload).then(submitted),

    startJob: (jobId: string) =>
      perform<unknown>(jobId, () => (showingEveryone() ? adminQueueApi.start(jobId) : importQueueApi.start(jobId))),
    retryJob: (jobId: string) =>
      perform<unknown>(jobId, () => (showingEveryone() ? adminQueueApi.retry(jobId) : importQueueApi.retry(jobId))),
    /** Hold when it's waiting, Pause when it's running. */
    pauseJob: (jobId: string) =>
      perform(jobId, () => (showingEveryone() ? adminQueueApi.pause(jobId) : importQueueApi.pause(jobId))),
    deleteJob: (jobId: string) =>
      perform(jobId, () => (showingEveryone() ? adminQueueApi.remove(jobId) : importQueueApi.remove(jobId))),
    removeLink: (itemId: string) =>
      perform(itemId, () => (showingEveryone() ? adminQueueApi.removeLink(itemId) : importQueueApi.removeLink(itemId))),
    /** A job's links, whichever list it's on. Rejects to the card showing them. */
    loadLinks: async (jobId: string): Promise<ImportJobItem[]> => {
      try {
        return await (showingEveryone() ? adminQueueApi.links(jobId) : importsApi.getImportJobItems(jobId));
      } catch (err) {
        if (err instanceof UnauthorizedError) links.onUnauthorized();
        throw err;
      }
    },

    startAll: () =>
      perform(
        "startAll",
        () => (showingEveryone() ? adminQueueApi.startAll(state.dialog.person) : importQueueApi.startAll()),
        ({ queued }) => countToast("importQueue.toast.startedAll", queued),
      ),
    retryAll: () =>
      perform(
        "retryAll",
        () => (showingEveryone() ? adminQueueApi.retryFailed(state.dialog.person) : importQueueApi.retryFailed()),
        ({ queued }) => countToast("importQueue.toast.retriedAll", queued),
      ),
    pauseAll: () =>
      perform("pauseAll", () =>
        showingEveryone() ? adminQueueApi.pauseAll(state.dialog.person) : importQueueApi.pauseAll(),
      ),
    clearFinished: () =>
      perform(
        "clearFinished",
        () => (showingEveryone() ? adminQueueApi.clearFinished(state.dialog.person) : importQueueApi.clearFinished()),
        ({ deleted }) => countToast("importQueue.toast.cleared", deleted),
      ),

    /** Shows straight away, and goes back with an error toast if the latest save fails. */
    setStartGrabLinks: async (value: boolean) => {
      const save = ++latestSave;
      saves += 1;
      set({ startGrabLinks: value });
      const request = saving.then(() => importQueueApi.saveSettings({ start_grab_links: value }));
      saving = request.catch(() => undefined);
      try {
        await request;
        savedStartGrabLinks = value;
      } catch (err) {
        if (save !== latestSave) return;
        set({ startGrabLinks: savedStartGrabLinks });
        if (err instanceof UnauthorizedError) links.onUnauthorized();
        else links.toast({ message: err instanceof Error ? err.message : String(err), severity: "error" });
      } finally {
        saves -= 1;
      }
    },
  };

  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    connect: (next: QueueStoreLinks) => {
      links = next;
    },
    start: () => {
      started = true;
      void own.start();
      watchEveryone();
    },
    stop: () => {
      started = false;
      session += 1;
      own.stop();
      everyone.stop();
      clearTimeout(flashTimer);
    },
    /** The tab came back into view. */
    wake: () => void refresh(),
    actions,
  };
}

export type QueueStore = ReturnType<typeof createQueueStore>;
export type QueueActions = QueueStore["actions"];
