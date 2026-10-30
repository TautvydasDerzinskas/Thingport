import { appendTokenToUrl, authHeaders } from "../utils/auth";
import { apiBase, assertOk, readErrorMessage, UnauthorizedError } from "./client";

export type WidgetSettingSpec =
  | { key: string; type: "text"; label: string; default?: string; placeholder?: string; secret?: boolean }
  | { key: string; type: "number"; label: string; default?: number }
  | { key: string; type: "toggle"; label: string; default?: boolean }
  | { key: string; type: "choice"; label: string; options: { value: string; label: string }[]; default?: string };

/** A widget's metadata, as its widget.json (or .yml) holds it, checked by the server. */
export type WidgetManifest = {
  name: string;
  description: string;
  /** The icon: one of Thingport's own (`builtin:…`), an uploaded one (`/api/icons/…`) or an image address. */
  iconUrl?: string;
  version: string;
  /** The author's full name. */
  author?: string;
  authorUrl?: string;
  size: { w: number; h: number; minW?: number; minH?: number };
  settings: WidgetSettingSpec[];
  /** The hosts its `thingport.fetch` may reach. */
  hosts: string[];
  /** The languages it has labels for, as `locales/<code>.json` beside widget.json. */
  locales: string[];
  /** Pictures of it at work, which only a widget shared through the repository carries. */
  screenshots: WidgetScreenshot[];
};

/** A picture of a shared widget at work, beside its metadata. */
export type WidgetScreenshot = { file: string; caption?: string };

/** A widget's words by language: `{ "en": { "wind.label": "Wind" } }`. English is the fallback, key by key. */
export type WidgetLocales = Record<string, Record<string, string>>;

export type CustomWidget = {
  id: string;
  /** "own" for one the user made; "community" for one installed from the repository. */
  source: "own" | "community";
  slug: string;
  manifest: WidgetManifest;
  script: string;
  html: string | null;
  /** Its labels by language; `{}` for a widget that ships none. */
  locales: WidgetLocales;
  sha: string;
  updatedAt: string;
};

/** Which kinds of custom widget an admin allows: users' own, and the community repository's. */
export type WidgetSources = { own: boolean; community: boolean };

/** A custom widget someone on the instance has: a community one once with all who installed it, an own one per owner. */
export type WidgetInUse = {
  key: string;
  source: "own" | "community";
  slug: string;
  manifest: WidgetManifest;
  /** `placed` when it's on one of their dashboards, not only installed. */
  users: { id: string; displayName: string; email: string; placed: boolean }[];
};

/** A community repository widget with how many users installed it, and how many of those copies are behind. */
export type CommunityWidgetUsage = { slug: string; manifest: WidgetManifest; installs: number; outdated: number };

export type CommunityWidget = {
  slug: string;
  manifest: WidgetManifest;
  sha: string;
  installed: { id: string; updateAvailable: boolean } | null;
};

/** Any form of headers as a plain record, as JSON carries them. */
export function headerRecord(headers?: HeadersInit): Record<string, string> {
  const record: Record<string, string> = {};
  new Headers(headers).forEach((value, name) => {
    record[name] = value;
  });
  return record;
}

async function failed(res: Response, fallback: string): Promise<never> {
  if (res.status === 401) throw new UnauthorizedError();
  throw new Error(await readErrorMessage(res, fallback));
}

/** One of a community widget's screenshots, by its place in its metadata; an <img> sends the session as ?token=. */
export const communityScreenshotUrl = (slug: string, index: number): string =>
  appendTokenToUrl(`${apiBase()}/widgets/community/${encodeURIComponent(slug)}/screenshots/${index}`);

export const widgetsApi = {
  /** Only widgets from the sources an admin allows. */
  list: async (): Promise<{ sources: WidgetSources; widgets: CustomWidget[] }> => {
    const res = await fetch(`${apiBase()}/widgets`, { headers: authHeaders() });
    assertOk(res, "Failed to load your widgets");
    return res.json();
  },

  /** Creates or replaces one of the user's own widgets, by its slug. The metadata is JSON or YAML text. */
  save: async (widget: {
    slug: string;
    metadata: string;
    script: string;
    html: string | null;
    /** Its words by language, as its `locales/<code>.json` files hold them. */
    locales?: WidgetLocales;
  }): Promise<CustomWidget> => {
    const res = await fetch(`${apiBase()}/widgets`, {
      method: "PUT",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(widget),
    });
    if (!res.ok) return failed(res, "Failed to save the widget");
    return res.json();
  },

  remove: async (id: string): Promise<void> => {
    const res = await fetch(`${apiBase()}/widgets/${id}`, { method: "DELETE", headers: authHeaders() });
    if (!res.ok) return failed(res, "Failed to remove the widget");
  },

  community: async (): Promise<CommunityWidget[]> => {
    const res = await fetch(`${apiBase()}/widgets/community`, { headers: authHeaders() });
    if (!res.ok) return failed(res, "Failed to load the community widgets");
    return (await res.json()).widgets;
  },

  /** Installs a community widget, or takes its update. */
  install: async (slug: string): Promise<CustomWidget> => {
    const res = await fetch(`${apiBase()}/widgets/community/${encodeURIComponent(slug)}/install`, {
      method: "POST",
      headers: authHeaders(),
    });
    if (!res.ok) return failed(res, "Failed to install the widget");
    return res.json();
  },

  /** A widget's request to a host it declares, made by the server; as a Response, as `fetch` gives. */
  fetchVia: async (id: string, url: string, init: RequestInit = {}): Promise<Response> => {
    const res = await fetch(`${apiBase()}/widgets/${id}/fetch`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        url,
        method: (init.method ?? "GET").toUpperCase(),
        headers: headerRecord(init.headers),
        body: typeof init.body === "string" ? init.body : undefined,
      }),
    });
    if (!res.ok) return failed(res, "The request through Thingport failed");
    const answer: { status: number; contentType: string | null; body: string } = await res.json();
    // Statuses that can't carry a body, as the Response constructor insists.
    const empty = [101, 204, 205, 304].includes(answer.status);
    return new Response(empty ? null : answer.body, {
      status: answer.status < 200 || answer.status > 599 ? 502 : answer.status,
      headers: answer.contentType ? { "content-type": answer.contentType } : {},
    });
  },

  getSources: async (): Promise<WidgetSources> => {
    const res = await fetch(`${apiBase()}/settings/custom-widgets`, { headers: authHeaders() });
    if (!res.ok) return failed(res, "Failed to load the custom widgets setting");
    return res.json();
  },

  /** Changes only the sources given. */
  setSources: async (patch: Partial<WidgetSources>): Promise<WidgetSources> => {
    const res = await fetch(`${apiBase()}/settings/custom-widgets`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(patch),
    });
    if (!res.ok) return failed(res, "Failed to change the custom widgets setting");
    return res.json();
  },

  /** For admins: every custom widget users have. */
  inUse: async (): Promise<WidgetInUse[]> => {
    const res = await fetch(`${apiBase()}/admin/widgets`, { headers: authHeaders() });
    if (!res.ok) return failed(res, "Failed to load the widgets in use");
    return (await res.json()).widgets;
  },

  /** For admins: the community repository's widgets with their installs. */
  communityUsage: async (): Promise<CommunityWidgetUsage[]> => {
    const res = await fetch(`${apiBase()}/admin/widgets/community`, { headers: authHeaders() });
    if (!res.ok) return failed(res, "Failed to load the community widgets");
    return (await res.json()).widgets;
  },
};
