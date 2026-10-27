import { useCallback, useEffect, useState } from "react";
import { widgetsApi, type CustomWidget, type WidgetSources } from "../api/widgets";
import { matchLanguage } from "../constants/languages";
import i18n from "../i18n";
import { registerCustomWidgets } from "../pages/DashboardPage/widgets";

type State = { sources: WidgetSources; widgets: CustomWidget[] };

// Shared by every user of the hook, so there's one request, and a widget saved or installed shows everywhere at once.
let cached: State | undefined;
let inFlight: Promise<State> | null = null;
// Bumped on sign-in and sign-out, so an answer still on its way for the previous account is dropped.
let account = 0;
const listeners = new Set<(state: State) => void>();

function publish(state: State) {
  cached = state;
  // Registered before anyone renders with it, so a panel showing the widget finds it. The language goes with
  // them: a widget's own labels are what its name and its cog's words are read from.
  registerCustomWidgets(state.widgets, matchLanguage(i18n.language));
  listeners.forEach((listener) => listener({ ...state }));
}

// A widget's words follow the language the user picks, as the rest of Thingport does.
i18n.on("languageChanged", () => {
  if (cached) publish(cached);
});

function load(): Promise<State> {
  if (cached) return Promise.resolve(cached);
  if (inFlight) return inFlight;
  const forAccount = account;
  const request = widgetsApi
    .list()
    .then((state) => {
      if (forAccount === account) publish(state);
      return state;
    })
    // A failed load leaves custom widgets out rather than breaking the dashboard.
    .catch((): State => cached ?? { sources: { own: true, community: true }, widgets: [] })
    .finally(() => {
      if (inFlight === request) inFlight = null;
    });
  inFlight = request;
  return request;
}

/** Forgets the previous account's widgets, scripts included; call on sign-in and sign-out. */
export function resetCustomWidgets() {
  account++;
  cached = undefined;
  inFlight = null;
  registerCustomWidgets([]);
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
