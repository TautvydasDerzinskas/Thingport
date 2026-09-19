import { authHeaders } from "../utils/auth";
import { apiBase, assertOk, readErrorMessage, UnauthorizedError } from "./client";
import type { ThemeSelection } from "../constants/settingsOptions";

export type StorageSettings = {
  template: string;
  default_template: string;
  allowed_tokens: string[];
  plate_paths: string[];
  moved: number;
  skipped: number;
};

export type PreviewMode = "automatic" | "on-demand" | "disabled";

export type AuthSettings = {
  token_ttl_seconds: number;
};

export type SmtpSettings = {
  host: string | null;
  port: number;
  secure: boolean;
  user: string | null;
  from: string;
  configured: boolean;
};

// `pass` is only ever sent, never received back (write-only, like the Thingiverse token) --
// omit it entirely to leave the stored password untouched.
export type SmtpSettingsInput = {
  host?: string | null;
  port?: number;
  secure?: boolean;
  user?: string | null;
  pass?: string | null;
  from?: string;
};

export type DatabaseInfo = {
  host: string | null;
  port: number | null;
  database: string | null;
  user: string | null;
};

export type DatabaseCredentialsInput = {
  database: string;
  user: string;
  password: string;
};

export type VersionCheck = {
  backend_sha: string | null;
  latest_backend_sha: string | null;
  latest_frontend_sha: string | null;
};

// This bundle's own build commit, inlined by Vite at build time from the frontend Dockerfile's
// GIT_SHA build arg -- null for `npm run dev` / a hand-built image with no --build-arg, which the
// update checker treats as "can't check" rather than as outdated.
export const FRONTEND_GIT_SHA: string | null =
  (import.meta.env.VITE_GIT_SHA as string | undefined) || null;

export const settingsApi = {
  // Admin-only. See versionService.ts (backend) for why latest_backend_sha/latest_frontend_sha
  // are each the latest commit touching that project's own directory, not raw main HEAD.
  getVersionCheck: async (): Promise<VersionCheck> => {
    const res = await fetch(`${apiBase()}/settings/version-check`, { headers: authHeaders() });
    assertOk(res, "Failed to check for updates");
    return res.json();
  },

  getStorage: async (): Promise<StorageSettings> => {
    const res = await fetch(`${apiBase()}/settings/storage`, { headers: authHeaders() });
    assertOk(res, "Failed to load storage settings");
    return res.json();
  },

  updateStorage: async (payload: {
    template: string;
    apply_existing: boolean;
  }): Promise<StorageSettings> => {
    const res = await fetch(`${apiBase()}/settings/storage`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) {
      throw new Error(await readErrorMessage(res, "Failed to update storage settings"));
    }
    return res.json();
  },

  // Instance-wide preview generation mode -- read by every user (the model detail page needs it
  // to know whether to generate previews at all), written only from the admin settings panel.
  getPreviews: async (): Promise<{ mode: PreviewMode }> => {
    const res = await fetch(`${apiBase()}/settings/previews`, { headers: authHeaders() });
    assertOk(res, "Failed to load preview settings");
    return res.json();
  },

  updatePreviews: async (mode: PreviewMode): Promise<{ mode: PreviewMode }> => {
    const res = await fetch(`${apiBase()}/settings/previews`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ mode }),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) {
      throw new Error(await readErrorMessage(res, "Failed to update preview settings"));
    }
    return res.json();
  },

  // Instance-wide Thingiverse Developer API Access Token, shared by every user's Thingiverse
  // imports -- write-only like any other API secret: GET only ever reports whether one is
  // configured, never the value itself.
  getThingiverse: async (): Promise<{ configured: boolean }> => {
    const res = await fetch(`${apiBase()}/settings/thingiverse`, { headers: authHeaders() });
    assertOk(res, "Failed to load Thingiverse settings");
    return res.json();
  },

  updateThingiverse: async (accessToken: string | null): Promise<{ configured: boolean }> => {
    const res = await fetch(`${apiBase()}/settings/thingiverse`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ access_token: accessToken }),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) {
      throw new Error(await readErrorMessage(res, "Failed to update Thingiverse settings"));
    }
    return res.json();
  },

  // Instance-wide: how long a signed-in session's token stays valid before requiring another
  // login (see backend's auth.ts issueToken). Admin-only both ways, like Storage above -- this
  // affects every session on the instance, not just the caller's own.
  getAuth: async (): Promise<AuthSettings> => {
    const res = await fetch(`${apiBase()}/settings/auth`, { headers: authHeaders() });
    assertOk(res, "Failed to load session settings");
    return res.json();
  },

  updateAuth: async (tokenTtlSeconds: number): Promise<AuthSettings> => {
    const res = await fetch(`${apiBase()}/settings/auth`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ token_ttl_seconds: tokenTtlSeconds }),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) {
      throw new Error(await readErrorMessage(res, "Failed to update session settings"));
    }
    return res.json();
  },

  // SMTP is used to send the account-verification email on registration (see backend's
  // routes/auth.ts) -- write-only for the password like the Thingiverse token above.
  getSmtp: async (): Promise<SmtpSettings> => {
    const res = await fetch(`${apiBase()}/settings/smtp`, { headers: authHeaders() });
    assertOk(res, "Failed to load SMTP settings");
    return res.json();
  },

  updateSmtp: async (payload: SmtpSettingsInput): Promise<SmtpSettings> => {
    const res = await fetch(`${apiBase()}/settings/smtp`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) {
      throw new Error(await readErrorMessage(res, "Failed to update SMTP settings"));
    }
    return res.json();
  },

  // Host/port always reflect the live DATABASE_URL the backend process was started with --
  // database/user reflect whatever's currently active, which a "Test & Save" switch below may
  // have changed for this running process.
  getDatabase: async (): Promise<DatabaseInfo> => {
    const res = await fetch(`${apiBase()}/settings/database`, { headers: authHeaders() });
    assertOk(res, "Failed to load database info");
    return res.json();
  },

  // Tests the candidate database/user/password against the live Postgres server before applying
  // anything -- see backend's databaseSettingsService.ts. On success, hot-swaps every database
  // call in the running backend process over to it; does NOT persist across a restart.
  testAndSaveDatabase: async (payload: DatabaseCredentialsInput): Promise<DatabaseInfo> => {
    const res = await fetch(`${apiBase()}/settings/database`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) {
      throw new Error(await readErrorMessage(res, "Failed to switch database"));
    }
    return res.json();
  },

  // Per-user (not admin-only, unlike Thingiverse above): each user's own MakerWorld session
  // cookie, saved server-side so it (a) follows them across devices and (b) makes "connected"
  // a real fact the admin Users table can show -- see services/makerworldCookieService.ts.
  // Write-only like the other credentials here.
  getMakerworld: async (): Promise<{ configured: boolean }> => {
    const res = await fetch(`${apiBase()}/settings/makerworld`, { headers: authHeaders() });
    assertOk(res, "Failed to load MakerWorld settings");
    return res.json();
  },

  // `verify: true` -- unlike the extension's own best-effort PATCH to this same endpoint (a
  // live-captured browser cookie it already knows just worked) -- has the backend test a
  // non-empty cookie against MakerWorld before storing it, so a stale/mistyped paste is caught
  // here instead of only surfacing as a failed import later. Clearing the cookie (null) is
  // never tested, only a new value.
  updateMakerworld: async (cookie: string | null): Promise<{ configured: boolean }> => {
    const res = await fetch(`${apiBase()}/settings/makerworld`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ cookie, verify: true }),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) {
      throw new Error(await readErrorMessage(res, "Failed to update MakerWorld settings"));
    }
    return res.json();
  },

  // Per-user preferred slicer, for a future "open in {slicer}" launch via that slicer's own URL
  // protocol -- not a secret, so unlike the credentials above this echoes the value back plainly.
  getSlicer: async (): Promise<{ slicer: string | null }> => {
    const res = await fetch(`${apiBase()}/settings/slicer`, { headers: authHeaders() });
    assertOk(res, "Failed to load slicer setting");
    return res.json();
  },

  updateSlicer: async (slicer: string | null): Promise<{ slicer: string | null }> => {
    const res = await fetch(`${apiBase()}/settings/slicer`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ slicer }),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) {
      throw new Error(await readErrorMessage(res, "Failed to update slicer setting"));
    }
    return res.json();
  },

  // Per-user theme (light/dark/system), server-persisted so it follows the account across
  // devices/browsers instead of being stuck in one browser's localStorage -- see App.tsx's
  // themeSelection state. Not a secret, so like slicer above this echoes the value back plainly.
  // Null means "never set"; the caller falls back to its own default in that case.
  getTheme: async (): Promise<{ theme: ThemeSelection | null }> => {
    const res = await fetch(`${apiBase()}/settings/theme`, { headers: authHeaders() });
    assertOk(res, "Failed to load theme setting");
    return res.json();
  },

  updateTheme: async (theme: ThemeSelection): Promise<{ theme: ThemeSelection | null }> => {
    const res = await fetch(`${apiBase()}/settings/theme`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ theme }),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) {
      throw new Error(await readErrorMessage(res, "Failed to update theme setting"));
    }
    return res.json();
  },
};
