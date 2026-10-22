import { useCallback, useEffect, useState } from "react";
import { widgetsApi, type CustomWidget } from "../api/widgets";
import { registerCustomWidgets } from "../pages/DashboardPage/widgets";

type State = { enabled: boolean; widgets: CustomWidget[] };

// Shared by every user of the hook, so there's one request, and a widget saved or installed shows everywhere at once.
let cached: State | undefined;
let inFlight: Promise<State> | null = null;
const listeners = new Set<(state: State) => void>();

function publish(state: State) {
  cached = state;
  // Registered before anyone renders with it, so a panel showing the widget finds it.
  registerCustomWidgets(state.enabled ? state.widgets : []);
  listeners.forEach((listener) => listener(state));
}

function load(): Promise<State> {
  if (cached) return Promise.resolve(cached);
  inFlight ??= widgetsApi
    .list()
    .then((state) => {
      publish(state);
      return state;
    })
    // A failed load leaves custom widgets out rather than breaking the dashboard.
    .catch((): State => cached ?? { enabled: true, widgets: [] })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** The user's custom widgets, their own and installed ones. Null until loaded, so their panels don't flash "gone". */
export function useCustomWidgets(): (State & { reload: () => Promise<void> }) | null {
  const [state, setState] = useState<State | null>(cached ?? null);

  useEffect(() => {
    let cancelled = false;
    void load().then((value) => {
      if (!cancelled) setState(cached ?? value);
    });
    listeners.add(setState);
    return () => {
      cancelled = true;
      listeners.delete(setState);
    };
  }, []);

  const reload = useCallback(async () => {
    publish(await widgetsApi.list());
  }, []);

  return state ? { ...state, reload } : null;
}
