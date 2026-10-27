import { apiBase } from "../../api/client";
import {
  toolsApi,
  type ToolLocales,
  type ToolManifest,
  type ToolModelCopy,
  type ToolModelsFetched,
} from "../../api/tools";
import { headerRecord } from "../../api/widgets";
import { applyLabels, translator, type Translate } from "../../sdk/labels";
import { LIBRARIES, library } from "../../sdk/libraries";
import type { SdkTheme } from "../../sdk/theme";
import {
  buildUserLibrary,
  toCollection as toSdkCollection,
  toFile,
  type SdkCollection,
  type SdkFileInput,
  type SdkModel,
} from "../../sdk/userLibrary";
import { authHeaders } from "../../utils/auth";

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
export type ToolLanguage = {
  code: string;
  /** Named in itself ("Lietuvių"), so it reads from any UI language. */
  label: string;
  /** Named in English. */
  englishName: string;
};

/** A model, a collection and a file to save, as the shared SDK describes them. */
export type ToolModel = SdkModel;
export type ToolCollection = SdkCollection;
export type ToolFileInput = SdkFileInput;

export type ToolUi = {
  toast: (message: string, severity?: "success" | "info" | "warning" | "error") => void;
  confirm: (options: {
    title?: string;
    message: string;
    confirmLabel?: string;
    destructive?: boolean;
  }) => Promise<boolean>;
  /** Asks the user for one of their collections, or a new one; null when they cancel. */
  pickCollection: (options?: { title?: string }) => Promise<ToolCollection | null>;
  /** Closes the tool and opens a model's page. */
  openModel: (id: string) => void;
  close: () => void;
};

/** A collection as a tool sees it; the picker dialog hands its choice back through this. */
export const toCollection = toSdkCollection;

type Build = {
  tool: RunnableTool;
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
export function buildToolSdk({ tool, root, selector, theme, language, languages, size, onResize, ui }: Build) {
  const translate: Translate = translator(tool.locales ?? {}, language);
  // An unsaved tool's data lasts as long as its preview does.
  const draftData = new Map<string, unknown>();
  const saved = (what: string) => {
    if (!tool.id) throw new Error(`Save the tool first: ${what} needs a saved tool`);
    return tool.id;
  };

  const { models, collections } = buildUserLibrary({ openModel: ui.openModel, pickCollection: ui.pickCollection });

  const storage = {
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

  return {
    root,
    /** A CSS selector for `root`, to scope the tool's styles. */
    selector,
    /**
     * A library Thingport carries, for the jobs a tool can't fit inside its own script: `"three"` to build or draw
     * geometry, `"opentype"` to read a font's real outlines, `"manifold"` for solid modelling that stays
     * watertight, `"fonts"` for the typefaces Thingport carries. Fetched the first time any tool asks and shared
     * with every tool after that.
     */
    library: (name: string) => library(name),
    /** Which libraries `library()` knows. */
    libraries: LIBRARIES,
    theme,
    /**
     * The language Thingport is in, as a code like `"en"` or `"lt"`, already matched to one it has (a browser
     * asking for `"pt-BR"` gets `"pt"` where that exists, else `"en"`). A tool that shows words of its own should
     * carry its own translations and pick by this, falling back to English for anything it hasn't got.
     *
     * The tool is started again when the user changes language, the same as when they change theme, so this is
     * read once at the top of `mount` rather than watched.
     */
    language,
    /** Every language Thingport has, English first: `{ code, label, englishName }`. */
    languages,
    /**
     * The tool's own words, from its `locales/<code>.json` files, in the language above. `t("save.title")`, and
     * `t("rings.ring", { n: 2 })` to fill `{n}` in. Missing words fall back to the tool's English key by key, and
     * a key with no words anywhere comes back as itself so the gap shows.
     */
    t: translate,
    /**
     * Writes the tool's words into its own markup: every `data-t` under `where` (the window by default) gets its
     * key's sentence as text, and `data-t-title`, `data-t-aria` and `data-t-placeholder` fill those attributes.
     * Saves a tool assigning each label by hand, and keeps readable English in the HTML for anyone reading it.
     */
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
    models,
    collections,
    /** The models this tool brought, by the keys its metadata gives them. */
    toolModels: async (): Promise<ToolModelCopy[]> => (tool.id ? toolsApi.models(tool.id) : []),
    /**
     * Fetches the ones that aren't here yet, by key, and gives the user their copies.
     *
     * A tool may be installed without its models -- a planner's parts run to gigabytes -- and still be asked for
     * something built out of a few of them. Ask for those few; what didn't come says why, in the provider's own
     * words, so a daily download limit can be read back to the user.
     */
    fetchToolModels: async (keys: string[]): Promise<ToolModelsFetched> =>
      tool.id ? toolsApi.fetchNeededModels(tool.id, keys) : { ready: [], failed: [] },
    storage,
    /** A request to one of the hosts the tool's metadata declares, made by the server; answers as `fetch` does. */
    fetch: (url: string, init?: RequestInit) => toolsApi.fetchVia(saved("thingport.fetch"), url, init),
    /** Thingport's own API, as the user: `api("/prints?limit=5")`. */
    api: (path: string, init: RequestInit = {}) =>
      fetch(`${apiBase()}${path.startsWith("/") ? path : `/${path}`}`, {
        ...init,
        headers: { ...headerRecord(authHeaders()), ...headerRecord(init.headers) },
      }),
    /** Hands the user a file to keep, as a browser download. */
    download: (file: ToolFileInput) => {
      const url = URL.createObjectURL(toFile(file));
      const link = document.createElement("a");
      link.href = url;
      link.download = file.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    },
    ui,
    close: ui.close,
  };
}

export type ToolSdk = ReturnType<typeof buildToolSdk>;
