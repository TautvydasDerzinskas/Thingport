import React from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useToast } from "../ToastProvider";
import { createQueueStore, initialQueueState, type QueueActions, type QueueState, type QueueStore } from "./queueStore";
import { deepLinkTarget, handsOnQueueParam, indicatorState, QUEUE_PARAM, type IndicatorState } from "./queueView";

export type ImportQueueValue = QueueState & QueueActions & { indicator: IndicatorState };

const ImportQueueContext = React.createContext<ImportQueueValue | null>(null);
const QueueStoreContext = React.createContext<QueueStore | null>(null);

const isTabHidden = () => document.visibilityState === "hidden";

type Props = {
  viewerId: string | null;
  isAdmin: boolean;
  onUnauthorized?: () => void;
  /** One of the viewer's imports finished, so what's on screen may be out of date. */
  onJobCompleted?: () => void;
  children: React.ReactNode;
};

/** The viewer's import queue, for the indicator, the dialog and whatever submits an import. A link with
 *  "?import-queue=<section>" opens the dialog on any page, and is taken off the URL once read, so going back doesn't
 *  reopen it. */
export function ImportQueueProvider({ viewerId, isAdmin, onUnauthorized, onJobCompleted, children }: Props) {
  const { t } = useTranslation("app");
  const showToast = useToast();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  // A session can change hands without a remount (another tab signing in), and the list mustn't carry over.
  const store = React.useMemo(
    () => createQueueStore({ viewerId, isAdmin, isHidden: isTabHidden }),
    [viewerId, isAdmin],
  );
  const state = React.useSyncExternalStore(store.subscribe, store.getState, store.getState);

  // First, so the store can reach these as soon as it starts.
  React.useEffect(() => {
    store.connect({
      t,
      toast: showToast,
      navigate,
      onUnauthorized: () => onUnauthorized?.(),
      onCompleted: () => onJobCompleted?.(),
    });
  }, [store, t, showToast, navigate, onUnauthorized, onJobCompleted]);

  React.useEffect(() => {
    store.start();
    const onVisible = () => {
      if (!isTabHidden()) store.wake();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      store.stop();
    };
  }, [store]);

  React.useEffect(() => {
    const value = searchParams.get(QUEUE_PARAM);
    if (value === null || handsOnQueueParam(pathname)) return;
    const { section, scope } = deepLinkTarget(value, isAdmin);
    store.actions.open(section, scope);
    const rest = new URLSearchParams(searchParams);
    rest.delete(QUEUE_PARAM);
    setSearchParams(rest, { replace: true });
  }, [pathname, searchParams, setSearchParams, isAdmin, store]);

  const value = React.useMemo(
    () => ({ ...state, ...store.actions, indicator: indicatorState(state.jobs, state.flash) }),
    [state, store],
  );

  return (
    <QueueStoreContext.Provider value={store}>
      <ImportQueueContext.Provider value={value}>{children}</ImportQueueContext.Provider>
    </QueueStoreContext.Provider>
  );
}

// Never started: its reads stay empty, and a submit still reaches the server.
const OUTSIDE_PROVIDER: ImportQueueValue = {
  ...initialQueueState(),
  supported: false,
  loading: false,
  ...createQueueStore({ viewerId: null, isAdmin: false, isHidden: () => true }).actions,
  indicator: indicatorState([], false),
};

/** Safe outside the layout, where the home page's search sits: there's no queue there, and nothing throws. */
export function useImportQueue(): ImportQueueValue {
  return React.useContext(ImportQueueContext) ?? OUTSIDE_PROVIDER;
}

const neverChanges = () => () => undefined;

/** Goes up when one of the viewer's imports finishes, for pages showing what it may have brought in. Its own hook, so
 *  they don't render again at every poll. Safe outside the layout too, where it stays still. */
export function useFinishedVersion(): number {
  const store = React.useContext(QueueStoreContext);
  const read = () => store?.getState().finishedVersion ?? 0;
  return React.useSyncExternalStore(store?.subscribe ?? neverChanges, read, read);
}
