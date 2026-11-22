import { useCallback, useEffect, useState } from "react";
import { toolsApi, type Tool, type ToolAccess } from "../api/tools";

type State = { access: ToolAccess; tools: Tool[] };

// Shared by every user of the hook, as useCustomWidgets is: one request, and a tool saved, installed or removed shows
// in the sidebar and on the Tools page at once.
let cached: State | undefined;
let inFlight: Promise<State> | null = null;
// Bumped on sign-in and sign-out, so an answer still on its way for the previous account is dropped.
let account = 0;
// A fresh load supersedes any older request for the same account.
let generation = 0;
let statusInFlight: Promise<void> | null = null;
let poll: ReturnType<typeof setInterval> | null = null;
const POLL_MS = 30_000;
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
  const forGeneration = generation;
  const request = toolsApi
    .list()
    .then((state) => {
      if (forAccount === account && forGeneration === generation) publish(state);
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
  generation++;
  statusInFlight = null;
  cached = undefined;
  inFlight = null;
}

/** Loads them again, e.g. after an admin installed one or changed who may use them. */
export async function reloadTools(): Promise<void> {
  const forAccount = account;
  const forGeneration = ++generation;
  const state = await toolsApi.list();
  if (forAccount === account && forGeneration === generation) publish(state);
}

// Check only IDs, not the potentially large scripts, while a tab is active. A failed check keeps the last list and
// tries again later; server-side calls still enforce availability.
function checkAvailability() {
  if (document.visibilityState !== "visible") return;
  // No list yet: the first load failed, or a reload that superseded it did. Load it again instead.
  if (!cached) {
    void load();
    return;
  }
  if (statusInFlight) return;
  const current = cached;
  const forAccount = account;
  const forGeneration = generation;
  const request = toolsApi
    .status()
    .then(async ({ access, ids }) => {
      if (forAccount !== account || forGeneration !== generation) return;
      const previous = current.tools.map((tool) => tool.id).toSorted();
      const next = ids.toSorted();
      if (
        access.canUse !== current.access.canUse ||
        access.canCreate !== current.access.canCreate ||
        previous.length !== next.length ||
        previous.some((id, index) => id !== next[index])
      )
        await reloadTools();
    })
    .catch(() => undefined)
    .finally(() => {
      if (statusInFlight === request) statusInFlight = null;
    });
  statusInFlight = request;
}

function startPolling() {
  if (poll) return;
  poll = setInterval(checkAvailability, POLL_MS);
  window.addEventListener("focus", checkAvailability);
  document.addEventListener("visibilitychange", checkAvailability);
}

function stopPolling() {
  if (poll) clearInterval(poll);
  poll = null;
  window.removeEventListener("focus", checkAvailability);
  document.removeEventListener("visibilitychange", checkAvailability);
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
    startPolling();
    return () => {
      cancelled = true;
      listeners.delete(setState);
      if (!listeners.size) stopPolling();
    };
  }, []);

  const reload = useCallback(() => reloadTools(), []);
  return state ? { ...state, reload } : null;
}
