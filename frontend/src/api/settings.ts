import { authHeaders } from "../utils/auth";
import { apiBase, assertOk, readErrorMessage, UnauthorizedError } from "./client";
import type { ThemeSelection } from "../constants/settingsOptions";
import { invalidateAiCategorizationStatus } from "./aiCategorization";

export type StorageSettings = {
  template: string;
  default_template: string;
  allowed_tokens: string[];
  plate_paths: string[];
  moved: number;
  skipped: number;
};

/** Which tree the models page shows. Kept in sync by hand with the backend's CATEGORIES_VIEWS. */
export type CategoriesView = "categories" | "folders";
// Kept in sync by hand with the backend's DASHBOARD_WIDGETS.
export type DashboardWidgetId =
  | "collectionCount"
  | "modelCount"
  | "authorCount"
  | "categoryCount"
  | "topViewed"
  | "topPrinted"
  | "recentlyAdded"
  | "topAuthors"
  | "topProviders";
/** Only the widgets the user has switched; the rest follow their default. */
export type DashboardWidgetChoices = Partial<Record<DashboardWidgetId, boolean>>;

export type PreviewMode = "automatic" | "on-demand" | "disabled";

/** Kept in sync by hand with the backend's CONSUME_MODES. */
export type ConsumeMode = "separate" | "folder";

export type ConsumeSettings = {
  /** False when nothing is mounted at `path`, so nothing is watched. */
  available: boolean;
  path: string;
  not_imported_dir: string;
  mode: ConsumeMode;
  /** Whose library consumed models go to. */
  user_id: string | null;
};

export type RenderingSettings = { simplify_previews: boolean };

export type AuthSettings = {
  token_ttl_seconds: number;
};

export type AiCategorizationSettings = {
  mode: "off" | "suggest" | "auto";
  base_url: string | null;
  model: string | null;
  has_api_key: boolean;
  threshold: number;
  on_import: boolean;
  concurrency: number;
  send_image: boolean;
  timeout_ms: number;
};

export type AiCategorizationSettingsInput = Partial<Omit<AiCategorizationSettings, "has_api_key">> & {
  api_key?: string | null;
};

export type SmtpSettings = {
  host: string | null;
  port: number;
  secure: boolean;
  user: string | null;
  from: string;
  configured: boolean;
};

// Omit `pass` to keep the stored password.
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

// Inlined by Vite from the GIT_SHA build arg; null in dev, which the update checker treats as
// "can't check".
export const FRONTEND_GIT_SHA: string | null = (import.meta.env.VITE_GIT_SHA as string | undefined) || null;

export const settingsApi = {
  getAiCategorization: async (): Promise<AiCategorizationSettings> => {
    const res = await fetch(`${apiBase()}/settings/ai-categorization`, { headers: authHeaders() });
    if (res.status === 401) throw new UnauthorizedError();
    assertOk(res, "Failed to load AI categorization settings");
    return res.json();
  },

  updateAiCategorization: async (payload: AiCategorizationSettingsInput): Promise<AiCategorizationSettings> => {
    const res = await fetch(`${apiBase()}/settings/ai-categorization`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to update AI categorization settings"));
    invalidateAiCategorizationStatus();
    return res.json();
  },

  testAiCategorization: async (): Promise<{ ok: boolean; latency_ms?: number; model?: string; error?: string }> => {
    const res = await fetch(`${apiBase()}/settings/ai-categorization/test`, {
      method: "POST",
      headers: authHeaders(),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to test AI connection"));
    return res.json();
  },

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

  updateStorage: async (payload: { template: string; apply_existing: boolean }): Promise<StorageSettings> => {
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

  getPreviews: async (): Promise<{ mode: PreviewMode }> => {
    const res = await fetch(`${apiBase()}/settings/previews`, { headers: authHeaders() });
    assertOk(res, "Failed to load preview settings");
    return res.json();
  },

  getRendering: async (): Promise<RenderingSettings> => {
    const res = await fetch(`${apiBase()}/settings/rendering`, { headers: authHeaders() });
    if (res.status === 401) throw new UnauthorizedError();
    assertOk(res, "Failed to load rendering settings");
    return res.json();
  },

  updateRendering: async (settings: RenderingSettings): Promise<RenderingSettings> => {
    const res = await fetch(`${apiBase()}/settings/rendering`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(settings),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to update rendering settings"));
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

  // Closed means only invited emails, and the very first account, can register.
  getRegistrations: async (): Promise<{ allow_registrations: boolean }> => {
    const res = await fetch(`${apiBase()}/settings/registrations`, { headers: authHeaders() });
    assertOk(res, "Failed to load registration settings");
    return res.json();
  },

  updateRegistrations: async (allowRegistrations: boolean): Promise<{ allow_registrations: boolean }> => {
    const res = await fetch(`${apiBase()}/settings/registrations`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ allow_registrations: allowRegistrations }),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) {
      throw new Error(await readErrorMessage(res, "Failed to update registration settings"));
    }
    return res.json();
  },

  // Write-only: GET only reports whether a token is configured.
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

  // Host/port are fixed at startup; database/user may have been switched by "Test & Save".
  getDatabase: async (): Promise<DatabaseInfo> => {
    const res = await fetch(`${apiBase()}/settings/database`, { headers: authHeaders() });
    assertOk(res, "Failed to load database info");
    return res.json();
  },

  // Not persisted across a backend restart.
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

  getMakerworld: async (): Promise<{ configured: boolean }> => {
    const res = await fetch(`${apiBase()}/settings/makerworld`, { headers: authHeaders() });
    assertOk(res, "Failed to load MakerWorld settings");
    return res.json();
  },

  // Clearing (null) is never verified.
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

  // Null means never set.
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

  getCategoriesView: async (): Promise<{ view: CategoriesView }> => {
    const res = await fetch(`${apiBase()}/settings/categories-view`, { headers: authHeaders() });
    assertOk(res, "Failed to load the categories view setting");
    return res.json();
  },

  updateCategoriesView: async (view: CategoriesView): Promise<{ view: CategoriesView }> => {
    const res = await fetch(`${apiBase()}/settings/categories-view`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ view }),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to update the categories view setting"));
    return res.json();
  },

  getDashboardWidgets: async (): Promise<{ widgets: DashboardWidgetChoices }> => {
    const res = await fetch(`${apiBase()}/settings/dashboard-widgets`, { headers: authHeaders() });
    assertOk(res, "Failed to load the dashboard widget settings");
    return res.json();
  },

  /** Sends only the changed widgets; the server merges them into what's saved. */
  updateDashboardWidgets: async (widgets: DashboardWidgetChoices): Promise<{ widgets: DashboardWidgetChoices }> => {
    const res = await fetch(`${apiBase()}/settings/dashboard-widgets`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ widgets }),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to update the dashboard widget settings"));
    return res.json();
  },

  getConsume: async (): Promise<ConsumeSettings> => {
    const res = await fetch(`${apiBase()}/settings/consume`, { headers: authHeaders() });
    assertOk(res, "Failed to load consume folder settings");
    return res.json();
  },

  updateConsume: async (patch: { mode?: ConsumeMode; user_id?: string }): Promise<ConsumeSettings> => {
    const res = await fetch(`${apiBase()}/settings/consume`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(patch),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to update consume folder settings"));
    return res.json();
  },

  getAuthorPreview: async (): Promise<{ enabled: boolean }> => {
    const res = await fetch(`${apiBase()}/settings/author-preview`, { headers: authHeaders() });
    assertOk(res, "Failed to load author preview setting");
    return res.json();
  },

  updateAuthorPreview: async (enabled: boolean): Promise<{ enabled: boolean }> => {
    const res = await fetch(`${apiBase()}/settings/author-preview`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ enabled }),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) {
      throw new Error(await readErrorMessage(res, "Failed to update author preview setting"));
    }
    return res.json();
  },
};
