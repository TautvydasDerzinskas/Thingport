import { useEffect, useState } from "react";
import { settingsApi, type ToolsView } from "../api/settings";

// How the user arranged their Tools page: which layout, which order, and any tool they moved to a shelf of their
// own. Saved on the account, so the page opens the same way on every device, and shared by every user of the hook
// so a change shows everywhere at once — the same shape as useCategoriesView.

const NEVER_CHOSEN: ToolsView = { layout: "categories", sort: "newest", categories: {} };

let cached: ToolsView | undefined;
let inFlight: Promise<ToolsView> | null = null;
let pendingSaves = Promise.resolve();
let account = 0;
let latestSave = 0;
const listeners = new Set<(value: ToolsView) => void>();

function load(): Promise<ToolsView> {
  if (cached !== undefined) return Promise.resolve(cached);
  const owner = account;
  // A change made while this is in flight is newer than the server's answer, so it wins.
  inFlight ??= settingsApi
    .getToolsView()
    .then((view) => (owner === account ? (cached ??= view) : view))
    .catch((): ToolsView => cached ?? NEVER_CHOSEN)
    .finally(() => {
      if (owner === account) inFlight = null;
    });
  return inFlight;
}

function publish(value: ToolsView) {
  cached = value;
  listeners.forEach((listener) => listener(value));
}

/** Forgets the previous account's arrangement; call on sign-in and sign-out. */
export function resetToolsView() {
  account += 1;
  cached = undefined;
  inFlight = null;
  pendingSaves = Promise.resolve();
}

/** Null until the saved arrangement is known, so the page doesn't flash the wrong one. */
export function useToolsView(): [ToolsView | null, (patch: Partial<ToolsView>) => void] {
  const [value, setValue] = useState<ToolsView | null>(cached ?? null);

  useEffect(() => {
    let cancelled = false;
    void load().then((view) => {
      if (!cancelled) setValue(cached ?? view);
    });
    listeners.add(setValue);
    return () => {
      cancelled = true;
      listeners.delete(setValue);
    };
  }, []);

  const update = (patch: Partial<ToolsView>) => {
    const next: ToolsView = {
      ...(cached ?? NEVER_CHOSEN),
      ...patch,
      categories: { ...(cached ?? NEVER_CHOSEN).categories, ...patch.categories },
    };
    // Shown at once; the server catches up, and a failure leaves what's on screen rather than snapping back.
    publish(next);
    const owner = account;
    const save = ++latestSave;
    // Keep rapid direction changes in the order they were made.
    pendingSaves = pendingSaves.then(async () => {
      if (owner !== account) return;
      const saved = await settingsApi.updateToolsView(patch).catch(() => null);
      if (saved && owner === account && save === latestSave) publish(saved);
    });
  };

  return [value, update];
}
