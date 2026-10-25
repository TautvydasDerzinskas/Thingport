export type MakerWorldSettings = {
  cookie: string;
};

// The MakerWorld cookie is mirrored locally because it's write-only server-side; it's what this
// browser sends with its import requests. MakerWorld's alone, as a page link of no provider's imports with its session
// too (the backend's LINK_PROVIDER); the app's settings are one object, so it isn't kept in providers/makerworld/.
export type AppSettings = {
  makerworld: MakerWorldSettings;
};

const STORAGE_KEY = "thingport_settings";

const DEFAULT_SETTINGS: AppSettings = {
  makerworld: {
    cookie: "",
  },
};

export function loadSettings(): AppSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) || {} : {};
    const makerworld = parsed.makerworld || {};
    const cookie = typeof makerworld.cookie === "string" ? makerworld.cookie : DEFAULT_SETTINGS.makerworld.cookie;
    return {
      makerworld: {
        cookie,
      },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {}
}
