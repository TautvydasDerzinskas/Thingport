import { useCallback, useEffect, useState } from "react";
import { settingsApi, type DashboardConfig, type DashboardTemplate } from "../api/settings";
import { initialConfig, offerNewPresets } from "../pages/DashboardPage/templates";
import { readUser } from "../utils/auth";

// Saved on the account so every device shows the same dashboard. Shared by every user of the hook so there's one
// request, and a change shows everywhere at once.
let cached: DashboardConfig | undefined;
let inFlight: Promise<DashboardConfig> | null = null;
const listeners = new Set<(value: DashboardConfig) => void>();

// Dragging and resizing change the config many times a second; the server hears the result once things settle.
const SAVE_DELAY_MS = 600;
let saveTimer: number | undefined;

/** The user's templates, or on their first visit since templates arrived, ones built from their old dashboard
 *  choices, saved straight away so that happens once. */
async function fetchConfig(): Promise<DashboardConfig> {
  const { config } = await settingsApi.getDashboard();
  const isAdmin = readUser()?.role === "ADMIN";
  if (config) {
    const updated = offerNewPresets(config, isAdmin);
    if (updated !== config) settingsApi.updateDashboard(updated).catch(() => {});
    return updated;
  }
  const [layout, widgets] = await Promise.all([
    settingsApi.getDashboardLayout().then((res) => res.layout),
    settingsApi.getDashboardWidgets().then((res) => res.widgets),
  ]).catch(() => [null, {}] as const);
  const built = initialConfig({ layout, widgets }, isAdmin);
  settingsApi.updateDashboard(built).catch(() => {});
  return built;
}

function load(): Promise<DashboardConfig> {
  if (cached !== undefined) return Promise.resolve(cached);
  // A change made while this is in flight is newer than the server's answer, so it wins.
  inFlight ??= fetchConfig()
    .then((config) => (cached ??= config))
    // A failed load shows the default templates rather than nothing; they're only saved once the user changes them.
    .catch(() => (cached ??= initialConfig(undefined, readUser()?.role === "ADMIN")))
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

// The change already shows here, but a save that fails is gone with the next reload, so the dashboard says so: once
// when saving starts failing rather than with every drag, and again if it fails after one has gone through. A failure
// while no dashboard is open is said when one opens, unless a newer save has gone through by then. Saves can finish
// out of order, so only a newer one settles what an older one did: a failure older than a save that went through isn't
// said at all, as what shows is stored after all, and a success older than a failure doesn't clear it.
let saveFailing = false;
let failureUnsaid = false;
let savesSent = 0;
let lastSaved = 0;
let lastFailed = 0;
const failureListeners = new Set<() => void>();

function save(value: DashboardConfig) {
  const sent = ++savesSent;
  settingsApi.updateDashboard(value).then(
    () => {
      lastSaved = Math.max(lastSaved, sent);
      if (sent < lastFailed) return;
      saveFailing = false;
      failureUnsaid = false;
    },
    () => {
      if (sent < lastSaved) return;
      lastFailed = Math.max(lastFailed, sent);
      if (saveFailing) return;
      saveFailing = true;
      failureUnsaid = failureListeners.size === 0;
      failureListeners.forEach((listener) => listener());
    },
  );
}

function publish(value: DashboardConfig) {
  cached = value;
  listeners.forEach((listener) => listener(value));
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => save(value), SAVE_DELAY_MS);
}

/** Calls back when a change to the dashboard couldn't be saved, straight away if one failed while nothing listened;
 *  returns the way to stop. */
export function onDashboardSaveFailed(listener: () => void): () => void {
  failureListeners.add(listener);
  if (failureUnsaid) {
    failureUnsaid = false;
    listener();
  }
  return () => {
    failureListeners.delete(listener);
  };
}

export type DashboardConfigApi = {
  config: DashboardConfig;
  /** The template showing: the one asked for, else the active one. */
  template: DashboardTemplate;
  /** Changes the template showing. */
  updateTemplate: (change: (template: DashboardTemplate) => DashboardTemplate) => void;
  /** Changes the whole config: switching, adding and removing templates. */
  update: (change: (config: DashboardConfig) => DashboardConfig) => void;
};

/**
 * Null until the saved templates are known, so the dashboard doesn't flash the wrong one. `templateId` shows that
 * template rather than the active one, as the homepage view does, and edits go to it; one since deleted falls back.
 */
export function useDashboardConfig(templateId?: string | null): DashboardConfigApi | null {
  const [value, setValue] = useState<DashboardConfig | null>(cached ?? null);

  useEffect(() => {
    let cancelled = false;
    void load().then((v) => {
      if (!cancelled) setValue(cached ?? v);
    });
    listeners.add(setValue);
    return () => {
      cancelled = true;
      listeners.delete(setValue);
    };
  }, []);

  const update = useCallback((change: (config: DashboardConfig) => DashboardConfig) => {
    if (cached) publish(change(cached));
  }, []);
  const updateTemplate = useCallback(
    (change: (template: DashboardTemplate) => DashboardTemplate) =>
      update((config) => {
        const target = config.templates.some((t) => t.id === templateId) ? templateId : config.active;
        return {
          ...config,
          templates: config.templates.map((template) => (template.id === target ? change(template) : template)),
        };
      }),
    [update, templateId],
  );

  if (!value) return null;
  const template =
    value.templates.find((t) => t.id === templateId) ??
    value.templates.find((t) => t.id === value.active) ??
    value.templates[0];
  return { config: value, template, update, updateTemplate };
}
