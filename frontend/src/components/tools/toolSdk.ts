import { toolsApi, type ToolLocales, type ToolManifest, type ToolPerson } from "../../api/tools";
import { applyLabels, translator, type Translate } from "../../sdk/labels";
import { LIBRARIES, library } from "../../sdk/libraries";
import type {
  SdkAudience,
  SdkCollection,
  SdkFileInput,
  SdkLanguage,
  SdkModel,
  SdkPerson,
  SdkShared,
  SdkStorage,
  SdkTheme,
  ToolSdk,
  ToolUi as SdkToolUi,
} from "../../sdk/types";
import { buildUserLibrary, toCollection as toSdkCollection } from "../../sdk/userLibrary";
import { apiAsUser, downloadFile } from "../../sdk/widgetSdk";
import { buildAchievements } from "../../sdk/achievements";
import { onToolSharedChange, toolSharedChanged } from "./toolSharedEvents";
import { readUser } from "../../utils/auth";

// The `thingport` object a tool's script gets. Most of it is the SDK a dashboard widget gets as well — the theme,
// the libraries, the labels and the user's library all come from `src/sdk/` — and what's added here is what only a
// tool has: the window it owns, the models it brought, and the data it keeps between openings.

/** A tool as it runs: a saved one has an id; the editor's preview of one not saved yet has none, and keeps its data in
 *  memory only. */
export type RunnableTool = {
  id: string | null;
  slug: string;
  source: "repo" | "own";
  manifest: ToolManifest;
  script: string;
  html: string | null;
  /** Its labels by language, which `t()` reads. */
  locales?: ToolLocales;
  sha: string;
};

/** The theme as a tool sees it: Thingport's own colours, the same ones a widget gets. */
export type ToolTheme = SdkTheme;

/** A language Thingport has, as a tool sees it. */
export type ToolLanguage = SdkLanguage;

/** A model, a collection and a file to save, as the shared SDK describes them. */
export type ToolModel = SdkModel;
export type ToolCollection = SdkCollection;
export type ToolFileInput = SdkFileInput;

/** What the window gives a tool's `ui`: Thingport's toast and confirmation, the picker, and closing. */
export type ToolUi = SdkToolUi;

/** A collection as a tool sees it; the picker dialog hands its choice back through this. */
export const toCollection = toSdkCollection;

/** What a tool was opened on, where it was opened from something rather than from the Tools page: a model, and from
 *  one of its commands, which one and the file it was picked on; or, for a part of a model's page, which part. */
export type ToolContext = { modelId?: string; fileId?: string; command?: string; place?: ModelPagePlace };

/** Where on a model's page a tool draws a part, and the export that draws it. */
export type ModelPagePlace = "info" | "tab" | "image";
export const PLACE_EXPORTS: Record<ModelPagePlace, "modelInfo" | "modelTab" | "modelImage"> = {
  info: "modelInfo",
  tab: "modelTab",
  image: "modelImage",
};

type Build = {
  tool: RunnableTool;
  context?: ToolContext;
  root: HTMLElement;
  /** An image contribution can optionally draw over the visible static preview. */
  preview?: ToolSdk["preview"];
  selector: string;
  theme: ToolTheme;
  language: string;
  languages: ToolLanguage[];
  size: () => { width: number; height: number };
  onResize: (listener: (size: { width: number; height: number }) => void) => () => void;
  ui: ToolUi;
  /** Thingport's dialog asking whom the user's shared entries reach; what they chose, or null when closed. */
  pickAudience: () => Promise<SdkAudience | null>;
};

const person = (p: ToolPerson | null): SdkPerson | null =>
  p && { id: p.id, name: p.display_name, avatarUrl: p.avatar_url };

/** The object a tool's default export is called with. */
export function buildToolSdk({
  tool,
  context,
  root,
  preview,
  selector,
  theme,
  language,
  languages,
  size,
  onResize,
  ui,
  pickAudience,
}: Build): ToolSdk {
  const translate: Translate = translator(tool.locales ?? {}, language);
  // Kept with the session, as the app keeps it, so every place a tool runs knows who's signed in.
  const viewer = readUser();
  // An unsaved tool's data lasts as long as its preview does.
  const draftData = new Map<string, unknown>();
  const saved = (what: string) => {
    if (!tool.id) throw new Error(`Save the tool first: ${what} needs a saved tool`);
    return tool.id;
  };

  // A saved tool's models say they're its: what made them (Print.createdWith), which its achievement counts.
  const slug = tool.id ? tool.slug : null;
  const { models, collections } = buildUserLibrary({ openModel: ui.openModel, createdWithTool: slug ?? undefined });

  const storage: SdkStorage = {
    get: async (key: string) => (tool.id ? toolsApi.storageGet(tool.id, key) : draftData.get(key)),
    set: async (key: string, value: unknown) => {
      if (tool.id) await toolsApi.storageSet(tool.id, key, value);
      else draftData.set(key, structuredClone(value));
    },
    remove: async (key: string) => {
      if (tool.id) await toolsApi.storageDelete(tool.id, key);
      else draftData.delete(key);
    },
    keys: async () =>
      tool.id ? (await toolsApi.storageKeys(tool.id)).map((entry) => entry.key) : [...draftData.keys()],
  };

  // Each entry is the writer's; the tool's parts of a model's page are told when one changes.
  const shared: SdkShared = {
    list: async (options) =>
      tool.id
        ? (await toolsApi.sharedList(tool.id, options)).map((entry) => ({
            key: entry.key,
            value: entry.value,
            user: person(entry.user),
            mine: entry.mine,
            modelId: entry.model_id,
            previewMatch: entry.preview_match,
            updatedAt: entry.updated_at,
            cursor: entry.cursor,
          }))
        : [],
    set: async (key, value, options) => {
      const id = saved("thingport.shared");
      await toolsApi.sharedSet(id, key, { value, model: options?.model ?? null });
      toolSharedChanged(id);
    },
    remove: async (key) => {
      const id = saved("thingport.shared");
      await toolsApi.sharedDelete(id, key);
      toolSharedChanged(id);
    },
    audience: async () => {
      const audience = await toolsApi.audience(saved("thingport.shared"));
      return { everyone: audience.everyone, people: audience.people.flatMap((p) => person(p) ?? []) };
    },
    share: () => {
      saved("thingport.shared");
      return pickAudience();
    },
    onChange: (listener) => (tool.id ? onToolSharedChange(tool.id, listener) : () => undefined),
  };

  // What each member does is written once, in sdk/types.ts, which the reference is generated from.
  return {
    root,
    preview,
    selector,
    library,
    libraries: LIBRARIES,
    theme,
    language,
    languages,
    t: translate,
    labels: (where: ParentNode = root) => applyLabels(where, translate),
    get size() {
      return size();
    },
    onResize,
    tool: {
      id: tool.id,
      slug: tool.slug,
      name: tool.manifest.name,
      version: tool.manifest.version,
      source: tool.source,
    },
    user: viewer && { id: viewer.id, name: viewer.display_name, avatarUrl: viewer.avatar_url ?? null },
    context: { ...context },
    models,
    // Only a tool has a "save where?" dialog to offer.
    collections: { ...collections, pick: (options?: { title?: string }) => ui.pickCollection(options) },
    toolModels: async () => (tool.id ? toolsApi.models(tool.id) : []),
    fetchToolModels: async (keys: string[]) =>
      tool.id ? toolsApi.fetchNeededModels(tool.id, keys) : { ready: [], failed: [] },
    storage,
    shared,
    fetch: (url: string, init?: RequestInit) => toolsApi.fetchVia(saved("thingport.fetch"), url, init),
    api: apiAsUser,
    download: downloadFile,
    ui,
    achievements: buildAchievements(slug),
    close: ui.close,
  };
}

export type { ToolSdk };
