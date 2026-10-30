import { toolsApi, type ToolLocales, type ToolManifest } from "../../api/tools";
import { applyLabels, translator, type Translate } from "../../sdk/labels";
import { LIBRARIES, library } from "../../sdk/libraries";
import type {
  SdkCollection,
  SdkFileInput,
  SdkLanguage,
  SdkModel,
  SdkStorage,
  SdkTheme,
  ToolSdk,
  ToolUi as SdkToolUi,
} from "../../sdk/types";
import { buildUserLibrary, toCollection as toSdkCollection } from "../../sdk/userLibrary";
import { apiAsUser, downloadFile } from "../../sdk/widgetSdk";

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

/** What a tool was opened on, where it was opened from something rather than from the Tools page. */
export type ToolContext = { modelId?: string };

type Build = {
  tool: RunnableTool;
  context?: ToolContext;
  root: HTMLElement;
  selector: string;
  theme: ToolTheme;
  language: string;
  languages: ToolLanguage[];
  size: () => { width: number; height: number };
  onResize: (listener: (size: { width: number; height: number }) => void) => () => void;
  ui: ToolUi;
};

/** The object a tool's default export is called with. */
export function buildToolSdk({
  tool,
  context,
  root,
  selector,
  theme,
  language,
  languages,
  size,
  onResize,
  ui,
}: Build): ToolSdk {
  const translate: Translate = translator(tool.locales ?? {}, language);
  // An unsaved tool's data lasts as long as its preview does.
  const draftData = new Map<string, unknown>();
  const saved = (what: string) => {
    if (!tool.id) throw new Error(`Save the tool first: ${what} needs a saved tool`);
    return tool.id;
  };

  const { models, collections } = buildUserLibrary({ openModel: ui.openModel });

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

  // What each member does is written once, in sdk/types.ts, which the reference is generated from.
  return {
    root,
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
    context: { ...context },
    models,
    // Only a tool has a "save where?" dialog to offer.
    collections: { ...collections, pick: (options?: { title?: string }) => ui.pickCollection(options) },
    toolModels: async () => (tool.id ? toolsApi.models(tool.id) : []),
    fetchToolModels: async (keys: string[]) =>
      tool.id ? toolsApi.fetchNeededModels(tool.id, keys) : { ready: [], failed: [] },
    storage,
    fetch: (url: string, init?: RequestInit) => toolsApi.fetchVia(saved("thingport.fetch"), url, init),
    api: apiAsUser,
    download: downloadFile,
    ui,
    close: ui.close,
  };
}

export type { ToolSdk };
