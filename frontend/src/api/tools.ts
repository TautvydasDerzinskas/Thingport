import { authHeaders } from "../utils/auth";
import { apiBase, readErrorMessage, UnauthorizedError } from "./client";
import { headerRecord } from "./widgets";

/** A model a repository tool brings: its own files, or a page Thingport imports from when the tool is installed. */
export type ToolModelSpec = {
  key: string;
  name: string;
  description?: string;
  tags: string[];
  files?: string[];
  source?: string;
};

/** A picture of a repository tool at work, beside its tool.json. */
export type ToolScreenshot = { file: string; caption?: string };

/** A tool's metadata, as its tool.json (or .yml) holds it, checked by the server. */
/** The shelves the Tools page sorts tools onto. Kept in step with the backend's TOOL_CATEGORIES. */
export const TOOL_CATEGORIES = ["generators", "planners", "calculators", "files", "library", "other"] as const;
export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

export type ToolManifest = {
  name: string;
  description: string;
  /** As a widget's: one of Thingport's icons (`builtin:…`), an uploaded one (`/api/icons/…`) or an image address. */
  iconUrl?: string;
  version: string;
  author?: string;
  authorUrl?: string;
  /** The window it opens in, in pixels. */
  window: { width: number; height: number };
  /** The hosts its `thingport.fetch` may reach. */
  hosts: string[];
  /** Which shelf it belongs on, where the user hasn't moved it themselves. */
  category?: ToolCategory;
  /** For an admin to look at before installing it; the server fills in none for a tool that has none. */
  screenshots?: ToolScreenshot[];
  /** The models it brings, in a collection of their own; only a repository tool has them. */
  collection?: { name: string; description?: string; models: ToolModelSpec[] };
  /** The languages it has labels for, as `locales/<code>.json` beside tool.json. */
  locales?: string[];
};

/** One language's labels: a flat map of key to sentence, as `locales/<code>.json` holds it. */
export type ToolLocale = Record<string, string>;
/** A tool's labels, by language code. */
export type ToolLocales = Record<string, ToolLocale>;

export type Tool = {
  id: string;
  /** "repo" for one an admin installed from the repository; "own" for one the user made. */
  source: "repo" | "own";
  slug: string;
  manifest: ToolManifest;
  script: string;
  html: string | null;
  /** Its labels by language; empty for a tool that ships none. */
  locales: ToolLocales;
  sha: string;
  updatedAt: string;
  /** The user's collection of the models the tool brings, once they have it. */
  collectionId: string | null;
};

export type ToolAccess = { canUse: boolean; canCreate: boolean };

/** One of the user's copies of a tool's models; `printId` null until it has come. */
export type ToolModelCopy = { key: string; name: string; source: string | null; printId: string | null };

export type ToolsAudience = "admins" | "everyone" | "selected";
export type ToolsAccessSettings = { audience: ToolsAudience; userIds: string[]; userTools: boolean };

export type ToolModelsState = {
  total: number;
  ready: number;
  failed: { key: string; name: string; reason: string }[];
  fetching: boolean;
  /** False where the tool was installed without its models; they can be asked for at any time. */
  imported: boolean;
};

/** A repository tool, with what's installed of it. `inRepo` false for one the repository no longer lists. */
export type AdminTool = {
  slug: string;
  manifest: ToolManifest;
  inRepo: boolean;
  installed: {
    id: string;
    version: string;
    installedAt: string;
    updatedAt: string;
    updateAvailable: boolean;
    models: ToolModelsState | null;
  } | null;
};

/** Where the offered tools come from: a folder on disk (a checkout of Thingport, or TOOLS_DIR), or the repository's
 *  tools folder on GitHub, on the branch the image follows. */
export type ToolsSource = { kind: "folder" | "repository"; location: string };

export type ToolCatalog = { tools: AdminTool[]; repoError: string | null; source?: ToolsSource };

export type OwnToolInUse = {
  id: string;
  slug: string;
  manifest: ToolManifest;
  owner: { id: string; displayName: string; email: string };
};

async function failed(res: Response, fallback: string): Promise<never> {
  if (res.status === 401) throw new UnauthorizedError();
  throw new Error(await readErrorMessage(res, fallback));
}

const json = (body: unknown) => ({
  headers: authHeaders({ "Content-Type": "application/json" }),
  body: JSON.stringify(body),
});

export const toolsApi = {
  list: async (): Promise<{ access: ToolAccess; tools: Tool[] }> => {
    const res = await fetch(`${apiBase()}/tools`, { headers: authHeaders() });
    if (!res.ok) return failed(res, "Failed to load the tools");
    return res.json();
  },

  /** Creates or replaces one of the user's own tools, by its slug. The metadata is JSON or YAML text. */
  save: async (tool: {
    slug: string;
    metadata: string;
    script: string;
    html: string | null;
    locales?: ToolLocales;
  }): Promise<Tool> => {
    const res = await fetch(`${apiBase()}/tools`, { method: "PUT", ...json(tool) });
    if (!res.ok) return failed(res, "Failed to save the tool");
    return res.json();
  },

  remove: async (id: string): Promise<void> => {
    const res = await fetch(`${apiBase()}/tools/${id}`, { method: "DELETE", headers: authHeaders() });
    if (!res.ok) return failed(res, "Failed to delete the tool");
  },

  models: async (id: string): Promise<ToolModelCopy[]> => {
    const res = await fetch(`${apiBase()}/tools/${id}/models`, { headers: authHeaders() });
    if (!res.ok) return failed(res, "Failed to load the tool's models");
    return (await res.json()).models;
  },

  storageKeys: async (id: string): Promise<{ key: string; size: number; updatedAt: string }[]> => {
    const res = await fetch(`${apiBase()}/tools/${id}/storage`, { headers: authHeaders() });
    if (!res.ok) return failed(res, "Failed to read the tool's data");
    return (await res.json()).keys;
  },

  /** Undefined when nothing is kept under the key. */
  storageGet: async (id: string, key: string): Promise<unknown> => {
    const res = await fetch(`${apiBase()}/tools/${id}/storage/${encodeURIComponent(key)}`, { headers: authHeaders() });
    if (!res.ok) return failed(res, "Failed to read the tool's data");
    const answer: { found: boolean; value?: unknown } = await res.json();
    return answer.found ? answer.value : undefined;
  },

  storageSet: async (id: string, key: string, value: unknown): Promise<void> => {
    const res = await fetch(`${apiBase()}/tools/${id}/storage/${encodeURIComponent(key)}`, {
      method: "PUT",
      ...json({ value }),
    });
    if (!res.ok) return failed(res, "Failed to save the tool's data");
  },

  storageDelete: async (id: string, key: string): Promise<void> => {
    const res = await fetch(`${apiBase()}/tools/${id}/storage/${encodeURIComponent(key)}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    if (!res.ok) return failed(res, "Failed to delete the tool's data");
  },

  /** A tool's request to a host it declares, made by the server; as a Response, as `fetch` gives. */
  fetchVia: async (id: string, url: string, init: RequestInit = {}): Promise<Response> => {
    const res = await fetch(`${apiBase()}/tools/${id}/fetch`, {
      method: "POST",
      ...json({
        url,
        method: (init.method ?? "GET").toUpperCase(),
        headers: headerRecord(init.headers),
        body: typeof init.body === "string" ? init.body : undefined,
      }),
    });
    if (!res.ok) return failed(res, "The request through Thingport failed");
    const answer: { status: number; contentType: string | null; body: string } = await res.json();
    const empty = [101, 204, 205, 304].includes(answer.status);
    return new Response(empty ? null : answer.body, {
      status: answer.status < 200 || answer.status > 599 ? 502 : answer.status,
      headers: answer.contentType ? { "content-type": answer.contentType } : {},
    });
  },

  // --- For admins ---------------------------------------------------------------------------------------------------

  catalog: async (): Promise<ToolCatalog> => {
    const res = await fetch(`${apiBase()}/admin/tools`, { headers: authHeaders() });
    if (!res.ok) return failed(res, "Failed to load the tools repository");
    return res.json();
  },

  /** Installs a repository tool, or takes its update. `models` false leaves the models it brings for later. */
  install: async (slug: string, models = true): Promise<AdminTool["installed"]> => {
    const res = await fetch(`${apiBase()}/admin/tools/${encodeURIComponent(slug)}/install`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ models }),
    });
    if (!res.ok) return failed(res, "Failed to install the tool");
    return res.json();
  },

  /** The models of a tool installed without them. */
  importModels: async (slug: string): Promise<AdminTool["installed"]> => {
    const res = await fetch(`${apiBase()}/admin/tools/${encodeURIComponent(slug)}/import-models`, {
      method: "POST",
      headers: authHeaders(),
    });
    if (!res.ok) return failed(res, "Failed to import the tool's models");
    return res.json();
  },

  uninstall: async (slug: string): Promise<void> => {
    const res = await fetch(`${apiBase()}/admin/tools/${encodeURIComponent(slug)}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    if (!res.ok) return failed(res, "Failed to uninstall the tool");
  },

  /** Tries the models that didn't come again. */
  fetchModels: async (slug: string): Promise<void> => {
    const res = await fetch(`${apiBase()}/admin/tools/${encodeURIComponent(slug)}/fetch-models`, {
      method: "POST",
      headers: authHeaders(),
    });
    if (!res.ok) return failed(res, "Failed to fetch the tool's models");
  },

  getAccess: async (): Promise<ToolsAccessSettings> => {
    const res = await fetch(`${apiBase()}/admin/tools/access`, { headers: authHeaders() });
    if (!res.ok) return failed(res, "Failed to load who may use tools");
    return res.json();
  },

  /** Changes only what's given. */
  setAccess: async (patch: Partial<ToolsAccessSettings>): Promise<ToolsAccessSettings> => {
    const res = await fetch(`${apiBase()}/admin/tools/access`, { method: "POST", ...json(patch) });
    if (!res.ok) return failed(res, "Failed to change who may use tools");
    return res.json();
  },

  ownInUse: async (): Promise<OwnToolInUse[]> => {
    const res = await fetch(`${apiBase()}/admin/tools/own`, { headers: authHeaders() });
    if (!res.ok) return failed(res, "Failed to load users' tools");
    return (await res.json()).tools;
  },
};
