export type MakerWorldSettings = {
  cookie: string;
};

// Theme used to live here too, mirrored to localStorage -- it's now server-persisted instead
// (see App.tsx's themeSelection state and api/settings.ts's getTheme/updateTheme) so it follows
// the account across devices rather than being stuck in one browser. MakerWorld's cookie stays
// local-mirrored: unlike theme it's write-only server-side (see makerworldCookieService.ts), so
// there's no value to fetch back -- this is just what the current browser last sent, used as the
// live cookie for this browser's own outgoing import requests.
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
  } catch {
    // ignore storage errors
  }
}
