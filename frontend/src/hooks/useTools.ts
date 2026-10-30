import { useCallback, useEffect, useState } from "react";
import { toolsApi, type Tool, type ToolAccess } from "../api/tools";

type State = { access: ToolAccess; tools: Tool[] };

// Shared by every user of the hook, as useCustomWidgets is: one request, and a tool saved, installed or removed shows
// in the sidebar and on the Tools page at once.
let cached: State | undefined;
let inFlight: Promise<State> | null = null;
// Bumped on sign-in and sign-out, so an answer still on its way for the previous account is dropped.
let account = 0;
const listeners = new Set<(state: State) => void>();
const NONE: State = { access: { canUse: false, canCreate: false }, tools: [] };

function publish(state: State) {
  cached = state;
  listeners.forEach((listener) => listener(state));
}

function load(): Promise<State> {
  if (cached) return Promise.resolve(cached);
  if (inFlight) return inFlight;
  const forAccount = account;
  const request = toolsApi
    .list()
    .then((state) => {
      if (forAccount === account) publish(state);
      return state;
    })
    // A failed load leaves tools out rather than breaking the page around them.
    .catch((): State => cached ?? NONE)
    .finally(() => {
      if (inFlight === request) inFlight = null;
    });
  inFlight = request;
  return request;
}

/** Forgets the previous account's tools; call on sign-in and sign-out. */
export function resetTools() {
  account++;
  cached = undefined;
  inFlight = null;
}

/** Loads them again, e.g. after an admin installed one or changed who may use them. */
export async function reloadTools(): Promise<void> {
  const forAccount = account;
  const state = await toolsApi.list();
  if (forAccount === account) publish(state);
}

/** The tools the user may open and whether they may make their own. Null until loaded. */
export function useTools(): (State & { reload: () => Promise<void> }) | null {
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

  const reload = useCallback(() => reloadTools(), []);
  return state ? { ...state, reload } : null;
}
