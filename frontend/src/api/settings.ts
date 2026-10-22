import { authHeaders } from "../utils/auth";
import { apiBase, assertOk, readErrorMessage, UnauthorizedError } from "./client";
import type { AccentColor, RenderColor, ThemeSelection } from "../constants/settingsOptions";
import { invalidateAiCategorizationStatus } from "./aiCategorization";
import type { QualityIssueCode, QualitySeverity } from "./prints";

/** What API tokens may do at /api/mcp, instance-wide. */
export type McpAccess = "off" | "read" | "write";

export type FileReuse = "off" | "reflink";

/** `slicer` is the one a model's main button opens (the last one used), `slicers` the ones installed. */
export type SlicerSettings = { slicer: string | null; slicers: string[] };

/** A backend older than the installed-slicers list answers with `slicer` alone: that one is the one installed. */
function toSlicerSettings(body: Partial<SlicerSettings>): SlicerSettings {
  const slicer = body.slicer ?? null;
  return { slicer, slicers: body.slicers ?? (slicer ? [slicer] : []) };
}

export type StorageToken =
  "category-or-folder" | "collection" | "tags" | "creator" | "model" | "filename" | "id" | "plate";

/** Why a storage template can't be saved; the backend's storageTemplateRules. */
export type StorageTemplateProblem =
  | { code: "empty" }
  | { code: "unknown_token"; token: string }
  | { code: "stray_brace" }
  | { code: "empty_folder" }
  | { code: "filename_count" }
  | { code: "filename_not_last" }
  | { code: "duplicate_token"; token: StorageToken }
  | { code: "plate_in_folder" }
  | { code: "category_not_whole_folder" }
  | { code: "not_unique" }
  | { code: "unsafe_text"; segment: string }
  | { code: "too_deep"; max: number };

export type StorageSettings = {
  template: string;
  default_template: string;
  allowed_tokens: StorageToken[];
  plate_paths: string[];
  /** For the saved template: one saved before the rules still works, but can't be saved again. */
  problems: StorageTemplateProblem[];
  /** Files left in an older structure; null while a move is going. */
  out_of_place: StorageOutOfPlace | null;
  move: StorageMove | null;
};

export type StorageOutOfPlace = { files: number; models: number };

/** Every user's files moving to the saved structure, in the background; the latest one, finished or not. */
export type StorageMove = {
  running: boolean;
  started_at: string;
  finished_at: string | null;
  /** Models; each one's files move together. */
  total: number;
  done: number;
  /** Files moved so far. */
  moved: number;
  skipped: number;
};

export type StorageTemplatePreview = {
  template: string;
  problems: StorageTemplateProblem[];
  plate_paths: string[];
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
  | "topProviders"
  | "clock"
  | "weather"
  | "featuredModel"
  | "activityHeatmap"
  | "rss"
  | "cpu"
  | "uptime"
  | "launcher";
/** Where the dashboard's weather is for; "device" came from the browser, "manual" from a search. */
export type WeatherLocation = { lat: number; lon: number; name: string | null; source: "device" | "manual" };
// Kept in sync by hand with the backend's DASHBOARD_LAYOUTS.
export type DashboardLayout = "left" | "top" | "right" | "bottom" | "topTwo" | "puzzle";
/** What model pictures lead with, on cards, dashboard lists and tag tiles: the model's own pictures, or our render
 *  tinted with the render colour. */
export type CardPreview = "images" | "renders";
/** Only the widgets the user has switched; the rest follow their default. */
export type DashboardWidgetChoices = Partial<Record<DashboardWidgetId, boolean>>;
// Kept in sync by hand with the backend's DASHBOARD_BREAKPOINTS.
export type DashboardBreakpoint = "lg" | "md" | "sm";
/** A panel's cell on the grid, in columns and rows; `i` is the panel's id. */
export type DashboardGridItem = { i: string; x: number; y: number; w: number; h: number };
/**
 * A placed widget: its id, or for a further copy of one that may repeat, its id and a suffix ("rss:k3j2h9"). The first
 * copy keeps the bare id, so settings saved before copies existed still match. Kept in sync by hand with the backend.
 */
export type WidgetInstanceId = string;
/** One box on the dashboard. More than one widget makes it a tabbed panel, showing the one at `tab`. */
export type DashboardPanel = { id: string; widgets: WidgetInstanceId[]; tab?: number };
export type DashboardTemplate = {
  id: string;
  /** Null shows the preset's translated name. */
  name: string | null;
  /** The built-in template it started from, if any. */
  preset: string | null;
  panels: DashboardPanel[];
  /** Only the breakpoints the user has arranged; the rest are derived from the widest one. */
  layouts: Partial<Record<DashboardBreakpoint, DashboardGridItem[]>>;
  /** Each widget instance's options that differ from its defaults. */
  settings?: Record<WidgetInstanceId, WidgetSettingValues>;
};
export type WidgetSettingValues = Record<
  string,
  string | number | boolean | null | string[] | Record<string, string>[] | Record<string, string | number | null>
>;
export type DashboardConfig = {
  active: string;
  templates: DashboardTemplate[];
  /** The built-in templates the user has been given; missing on configs saved before it was tracked. */
  offered?: string[];
};

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

/** One switch per kind of print problem; related issues share one. */
export type QualityCheckKey =
  "damaged" | "missingParts" | "openEdges" | "nonManifoldEdges" | "flippedFaces" | "insideOut" | "fragments" | "scale";
export const QUALITY_CHECK_KEYS: readonly QualityCheckKey[] = [
  "damaged",
  "missingParts",
  "openEdges",
  "nonManifoldEdges",
  "flippedFaces",
  "insideOut",
  "fragments",
  "scale",
];
// The backend's QUALITY_CHECK_OF_ISSUE: the switch each issue in a model's report falls under.
export const QUALITY_CHECK_OF_ISSUE: Record<QualityIssueCode, QualityCheckKey> = {
  unreadable: "damaged",
  empty: "damaged",
  missingParts: "missingParts",
  openEdges: "openEdges",
  nonManifoldEdges: "nonManifoldEdges",
  flippedFaces: "flippedFaces",
  insideOut: "insideOut",
  fragments: "fragments",
  tooSmall: "scale",
  tooLarge: "scale",
};

// The backend's QUALITY_SEVERITY (services/meshQuality.ts), which sets each issue's severity in results.
export const QUALITY_CHECK_SEVERITY: Record<QualityCheckKey, QualitySeverity> = {
  damaged: "critical",
  missingParts: "critical",
  openEdges: "major",
  flippedFaces: "major",
  insideOut: "major",
  nonManifoldEdges: "minor",
  fragments: "minor",
  scale: "minor",
};
export type QualityCheckSettings = { enabled: boolean; checks_off: QualityCheckKey[] };

export type AuthSettings = {
  /** How long an access token lasts before the browser renews it. */
  token_ttl_seconds: number;
  /** How long a browser stays signed in without being used. 0 is off. */
  remember_session_ttl_seconds: number;
};

/** How categorization behaves; the AIs themselves are in api/aiConnections.ts. */
export type AiCategorizationSettings = {
  /** Off hides categorization everywhere; the mode is kept for when it's back on. */
  enabled: boolean;
  mode: "suggest" | "auto";
  threshold: number;
  on_import: boolean;
  send_image: boolean;
  /** Null uses the default AI. */
  ai_connection_id: string | null;
};

export type AiCategorizationSettingsInput = Partial<AiCategorizationSettings>;

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

export type ImportProvider =
  | "makerworld"
  | "printables"
  | "thingiverse"
  | "myminifactory"
  | "snapmaker"
  | "makeronline"
  | "crealitycloud"
  | "nexprint"
  | "thangs"
  | "cults3d";
export type Cults3dSettings = {
  configured: boolean;
  expired: boolean;
  nick: string | null;
  session_configured: boolean;
  session_expired: boolean;
};

/** An admin can turn a provider off for the whole instance; menus hide it then. */
export type ProviderSetting = { id: ImportProvider; enabled: boolean };

export type VersionCheck = {
  /** Null from a backend older than versioning. */
  backend_version?: string | null;
  backend_sha: string | null;
  latest_backend_sha: string | null;
  latest_frontend_sha: string | null;
};

// Inlined by Vite from the GIT_SHA build arg; null in dev, which the update checker treats as
// "can't check".
/** From frontend/package.json, which each release bumps. */
export const FRONTEND_VERSION: string = import.meta.env.VITE_APP_VERSION as string;

export const FRONTEND_GIT_SHA: string | null = (import.meta.env.VITE_GIT_SHA as string | undefined) || null;

export type ThemePreferences = {
  theme: ThemeSelection | null;
  accent: AccentColor | null;
  /** Null follows the accent. */
  renderColor: RenderColor | null;
};

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

  previewStorage: async (template: string): Promise<StorageTemplatePreview> => {
    const res = await fetch(`${apiBase()}/settings/storage/preview`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ template }),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to check the storage structure"));
    return res.json();
  },

  /** Saves the structure and starts moving every file that isn't where it puts them. */
  updateStorage: async (template: string): Promise<StorageSettings> => {
    const res = await fetch(`${apiBase()}/settings/storage`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ template }),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to update storage settings"));
    return res.json();
  },

  /** What saving `template` would move. */
  storageImpact: async (template: string): Promise<StorageOutOfPlace> => {
    const res = await fetch(`${apiBase()}/settings/storage/impact`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ template }),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to check the storage structure"));
    return res.json();
  },

  getStorageMove: async (): Promise<StorageMove | null> => {
    const res = await fetch(`${apiBase()}/settings/storage/move`, { headers: authHeaders() });
    assertOk(res, "Failed to load the file move");
    return (await res.json()).move;
  },

  getMcp: async (): Promise<{ access: McpAccess }> => {
    const res = await fetch(`${apiBase()}/settings/mcp`, { headers: authHeaders() });
    if (res.status === 401) throw new UnauthorizedError();
    assertOk(res, "Failed to load MCP settings");
    return res.json();
  },

  updateMcp: async (access: McpAccess): Promise<{ access: McpAccess }> => {
    const res = await fetch(`${apiBase()}/settings/mcp`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ access }),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to update MCP settings"));
    return res.json();
  },

  getFileReuse: async (): Promise<{ mode: FileReuse }> => {
    const res = await fetch(`${apiBase()}/settings/file-reuse`, { headers: authHeaders() });
    if (res.status === 401) throw new UnauthorizedError();
    assertOk(res, "Failed to load file reuse settings");
    return res.json();
  },

  updateFileReuse: async (mode: FileReuse): Promise<{ mode: FileReuse }> => {
    const res = await fetch(`${apiBase()}/settings/file-reuse`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ mode }),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to update file reuse settings"));
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

  getQualityChecks: async (): Promise<QualityCheckSettings> => {
    const res = await fetch(`${apiBase()}/settings/quality-checks`, { headers: authHeaders() });
    if (res.status === 401) throw new UnauthorizedError();
    assertOk(res, "Failed to load quality check settings");
    return res.json();
  },

  updateQualityChecks: async (patch: Partial<QualityCheckSettings>): Promise<QualityCheckSettings> => {
    const res = await fetch(`${apiBase()}/settings/quality-checks`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(patch),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to update quality check settings"));
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

  getProviders: async (): Promise<ProviderSetting[]> => {
    const res = await fetch(`${apiBase()}/settings/providers`, { headers: authHeaders() });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to load providers"));
    return ((await res.json()) as { providers: ProviderSetting[] }).providers;
  },

  setProviderEnabled: async (provider: ImportProvider, enabled: boolean): Promise<ProviderSetting[]> => {
    const res = await fetch(`${apiBase()}/settings/providers/${provider}`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ enabled }),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to update the provider"));
    return ((await res.json()) as { providers: ProviderSetting[] }).providers;
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

  // Write-only, like Thingiverse's token: GET only reports whether a key is configured.
  getMyminifactory: async (): Promise<{ configured: boolean }> => {
    const res = await fetch(`${apiBase()}/settings/myminifactory`, { headers: authHeaders() });
    assertOk(res, "Failed to load MyMiniFactory settings");
    return res.json();
  },

  updateMyminifactory: async (apiKey: string | null): Promise<{ configured: boolean }> => {
    const res = await fetch(`${apiBase()}/settings/myminifactory`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ api_key: apiKey }),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) {
      throw new Error(await readErrorMessage(res, "Failed to update MyMiniFactory settings"));
    }
    return res.json();
  },

  // The user's own MyMiniFactory sign-in, for paid and login-only models. Write-only, like MakerWorld's cookie.
  getMyminifactorySession: async (): Promise<{ configured: boolean; expired: boolean }> => {
    const res = await fetch(`${apiBase()}/settings/myminifactory-session`, { headers: authHeaders() });
    assertOk(res, "Failed to load MyMiniFactory settings");
    return res.json();
  },

  /** Checked with MyMiniFactory before it's saved. */
  updateMyminifactorySession: async (cookie: string | null): Promise<{ configured: boolean }> => {
    const res = await fetch(`${apiBase()}/settings/myminifactory-session`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ cookie, verify: true }),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to update MyMiniFactory settings"));
    return res.json();
  },

  // The user's own Snapmaker Space sign-in (its access token), which Thingport Grab keeps fresh. Write-only.
  getSnapmakerSession: async (): Promise<{ configured: boolean; expired: boolean }> => {
    const res = await fetch(`${apiBase()}/settings/snapmaker-session`, { headers: authHeaders() });
    assertOk(res, "Failed to load Snapmaker Space settings");
    return res.json();
  },

  /** Checked with Snapmaker before it's saved. */
  updateSnapmakerSession: async (token: string | null): Promise<{ configured: boolean }> => {
    const res = await fetch(`${apiBase()}/settings/snapmaker-session`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ token, verify: true }),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to update Snapmaker Space settings"));
    return res.json();
  },

  // The user's own MakerOnline sign-in (its access token), which Thingport Grab sends on. Write-only.
  getMakeronlineSession: async (): Promise<{ configured: boolean; expired: boolean }> => {
    const res = await fetch(`${apiBase()}/settings/makeronline-session`, { headers: authHeaders() });
    assertOk(res, "Failed to load MakerOnline settings");
    return res.json();
  },

  /** Checked with MakerOnline before it's saved. */
  updateMakeronlineSession: async (token: string | null): Promise<{ configured: boolean }> => {
    const res = await fetch(`${apiBase()}/settings/makeronline-session`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ token, verify: true }),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to update MakerOnline settings"));
    return res.json();
  },

  // The user's own Creality Cloud sign-in (its model_token and model_user_id cookies), which Thingport Grab sends on.
  // Write-only.
  getCrealitycloudSession: async (): Promise<{ configured: boolean; expired: boolean }> => {
    const res = await fetch(`${apiBase()}/settings/crealitycloud-session`, { headers: authHeaders() });
    assertOk(res, "Failed to load Creality Cloud settings");
    return res.json();
  },

  /** Checked with Creality Cloud before it's saved. */
  updateCrealitycloudSession: async (token: string | null): Promise<{ configured: boolean }> => {
    const res = await fetch(`${apiBase()}/settings/crealitycloud-session`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ token, verify: true }),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to update Creality Cloud settings"));
    return res.json();
  },

  // The user's own NexPrint sign-in (its auth_token cookie), which Thingport Grab sends on. Write-only.
  getNexprintSession: async (): Promise<{ configured: boolean; expired: boolean }> => {
    const res = await fetch(`${apiBase()}/settings/nexprint-session`, { headers: authHeaders() });
    assertOk(res, "Failed to load NexPrint settings");
    return res.json();
  },

  /** Checked with NexPrint before it's saved. */
  updateNexprintSession: async (token: string | null): Promise<{ configured: boolean }> => {
    const res = await fetch(`${apiBase()}/settings/nexprint-session`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ token, verify: true }),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to update NexPrint settings"));
    return res.json();
  },

  // The user's own Thangs sign-in (its accessToken and refreshToken cookies), which Thingport Grab sends on. Write-only.
  getThangsSession: async (): Promise<{ configured: boolean; expired: boolean }> => {
    const res = await fetch(`${apiBase()}/settings/thangs-session`, { headers: authHeaders() });
    assertOk(res, "Failed to load Thangs settings");
    return res.json();
  },

  /** Checked with Thangs before it's saved. Takes a token, either cookie, or a whole Cookie header. */
  updateThangsSession: async (token: string | null): Promise<{ configured: boolean }> => {
    const res = await fetch(`${apiBase()}/settings/thangs-session`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ token, verify: true }),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to update Thangs settings"));
    return res.json();
  },

  // The user's own Cults3D API credentials, their nickname and an API key made on the site, and whether Thingport
  // Grab has sent the browser's sign-in, which the downloads need. The key is write-only.
  getCults3d: async (): Promise<Cults3dSettings> => {
    const res = await fetch(`${apiBase()}/settings/cults3d`, { headers: authHeaders() });
    assertOk(res, "Failed to load Cults3D settings");
    return res.json();
  },

  /** Checked with Cults3D before it's saved; null forgets them. */
  updateCults3d: async (
    credentials: { nick: string; apiKey: string } | null,
  ): Promise<{ configured: boolean; nick: string | null }> => {
    const res = await fetch(`${apiBase()}/settings/cults3d`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ nick: credentials?.nick ?? null, api_key: credentials?.apiKey ?? null, verify: true }),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to update Cults3D settings"));
    return res.json();
  },

  /** The browser's sign-in by hand: a signed-in cults3d.com request's copied headers. Null forgets it. */
  updateCults3dSession: async (session: string | null): Promise<{ configured: boolean }> => {
    const res = await fetch(`${apiBase()}/settings/cults3d-session`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ session }),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to update the Cults3D sign-in"));
    return res.json();
  },

  getAuth: async (): Promise<AuthSettings> => {
    const res = await fetch(`${apiBase()}/settings/auth`, { headers: authHeaders() });
    assertOk(res, "Failed to load session settings");
    return res.json();
  },

  updateAuth: async (patch: Partial<AuthSettings>): Promise<AuthSettings> => {
    const res = await fetch(`${apiBase()}/settings/auth`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(patch),
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

  getPublicUrl: async (): Promise<{ public_url: string | null }> => {
    const res = await fetch(`${apiBase()}/settings/public-url`, { headers: authHeaders() });
    assertOk(res, "Failed to load the public URL");
    return res.json();
  },

  /** It can be changed but not cleared. */
  updatePublicUrl: async (publicUrl: string): Promise<{ public_url: string | null }> => {
    const res = await fetch(`${apiBase()}/settings/public-url`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ public_url: publicUrl }),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to save the public URL"));
    return res.json();
  },

  getFlaresolverr: async (): Promise<{ url: string | null }> => {
    const res = await fetch(`${apiBase()}/settings/flaresolverr`, { headers: authHeaders() });
    assertOk(res, "Failed to load FlareSolverr settings");
    return res.json();
  },

  // The backend tests a non-empty URL before saving it.
  updateFlaresolverr: async (url: string | null): Promise<{ url: string | null }> => {
    const res = await fetch(`${apiBase()}/settings/flaresolverr`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ url }),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to update FlareSolverr settings"));
    return res.json();
  },

  testFlaresolverr: async (
    url: string,
  ): Promise<{ ok: boolean; latency_ms?: number; version?: string | null; error?: string }> => {
    const res = await fetch(`${apiBase()}/settings/flaresolverr/test`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ url }),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to test FlareSolverr"));
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

  // `expired`: MakerWorld turned the saved cookie down; scheduled syncs wait for a new one.
  getMakerworld: async (): Promise<{ configured: boolean; expired: boolean }> => {
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

  getSlicer: async (): Promise<SlicerSettings> => {
    const res = await fetch(`${apiBase()}/settings/slicer`, { headers: authHeaders() });
    assertOk(res, "Failed to load slicer setting");
    return toSlicerSettings(await res.json());
  },

  /** A field left out keeps its value. `enable`/`disable` switch one slicer in the list as the server has it. */
  updateSlicer: async (
    patch: Partial<SlicerSettings> & { enable?: string; disable?: string },
  ): Promise<SlicerSettings> => {
    const res = await fetch(`${apiBase()}/settings/slicer`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(patch),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) {
      throw new Error(await readErrorMessage(res, "Failed to update slicer setting"));
    }
    return toSlicerSettings(await res.json());
  },

  // Null means never set.
  getTheme: async (): Promise<ThemePreferences> => {
    const res = await fetch(`${apiBase()}/settings/theme`, { headers: authHeaders() });
    assertOk(res, "Failed to load theme setting");
    return res.json();
  },

  updateTheme: async (patch: Partial<ThemePreferences>): Promise<ThemePreferences> => {
    const res = await fetch(`${apiBase()}/settings/theme`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(patch),
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

  getWeatherLocation: async (): Promise<{ location: WeatherLocation | null }> => {
    const res = await fetch(`${apiBase()}/settings/weather-location`, { headers: authHeaders() });
    assertOk(res, "Failed to load the weather location");
    return res.json();
  },

  /** Null forgets the location. */
  updateWeatherLocation: async (location: WeatherLocation | null): Promise<{ location: WeatherLocation | null }> => {
    const res = await fetch(`${apiBase()}/settings/weather-location`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ location }),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to update the weather location"));
    return res.json();
  },

  getCardPreview: async (): Promise<{ preview: CardPreview }> => {
    const res = await fetch(`${apiBase()}/settings/card-preview`, { headers: authHeaders() });
    assertOk(res, "Failed to load the model card preview setting");
    return res.json();
  },

  updateCardPreview: async (preview: CardPreview): Promise<{ preview: CardPreview }> => {
    const res = await fetch(`${apiBase()}/settings/card-preview`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ preview }),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to update the model card preview setting"));
    return res.json();
  },

  /** Null until the user's templates have been saved once. */
  getDashboard: async (): Promise<{ config: DashboardConfig | null }> => {
    const res = await fetch(`${apiBase()}/settings/dashboard`, { headers: authHeaders() });
    assertOk(res, "Failed to load the dashboard settings");
    return res.json();
  },

  updateDashboard: async (config: DashboardConfig): Promise<{ config: DashboardConfig }> => {
    const res = await fetch(`${apiBase()}/settings/dashboard`, {
      method: "PUT",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ config }),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to save the dashboard settings"));
    return res.json();
  },

  getDashboardLayout: async (): Promise<{ layout: DashboardLayout }> => {
    const res = await fetch(`${apiBase()}/settings/dashboard-layout`, { headers: authHeaders() });
    assertOk(res, "Failed to load the dashboard layout setting");
    return res.json();
  },

  updateDashboardLayout: async (layout: DashboardLayout): Promise<{ layout: DashboardLayout }> => {
    const res = await fetch(`${apiBase()}/settings/dashboard-layout`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ layout }),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to update the dashboard layout setting"));
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

  getHoverSlideshow: async (): Promise<{ enabled: boolean }> => {
    const res = await fetch(`${apiBase()}/settings/hover-slideshow`, { headers: authHeaders() });
    assertOk(res, "Failed to load hover slideshow setting");
    return res.json();
  },

  updateHoverSlideshow: async (enabled: boolean): Promise<{ enabled: boolean }> => {
    const res = await fetch(`${apiBase()}/settings/hover-slideshow`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ enabled }),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) {
      throw new Error(await readErrorMessage(res, "Failed to update hover slideshow setting"));
    }
    return res.json();
  },
};
