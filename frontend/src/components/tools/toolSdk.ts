import { apiBase } from "../../api/client";
import { collectionsApi, type Collection } from "../../api/collections";
import { printsApi, type Print } from "../../api/prints";
import { searchApi } from "../../api/search";
import { toolsApi, type ToolLocales, type ToolManifest, type ToolModelCopy } from "../../api/tools";
import { headerRecord } from "../../api/widgets";
import { TOOL_LIBRARIES, toolLibrary } from "./toolLibraries";
import { applyToolLabels, toolTranslator } from "./toolTranslate";
import { authHeaders } from "../../utils/auth";

// The `thingport` object a tool's script gets: what it may do with the user's library, through the same API the app
// uses, as the user. Kept small and plain (no Print objects, no React), so it stays the same as the app changes and a
// tool's author can read all of it in the editor's starter script.

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

export type ToolTheme = {
  mode: "light" | "dark";
  primary: string;
  /** What reads on `primary`: white for most accents, dark for the light ones. Text and icons on an accent-filled
   *  button take this, not the paper colour, which is dark in the dark theme. */
  primaryContrast: string;
  background: string;
  paper: string;
  text: string;
  textSecondary: string;
  divider: string;
  error: string;
  warning: string;
  success: string;
  fontFamily: string;
};

/** A model as a tool sees it. */
/** A language Thingport has, as a tool sees it. */
export type ToolLanguage = {
  code: string;
  /** Named in itself ("Lietuvių"), so it reads from any UI language. */
  label: string;
  /** Named in English. */
  englishName: string;
};

export type ToolModel = {
  id: string;
  name: string;
  description: string | null;
  tags: string[];
  /** A picture of it, an address an <img> can show. */
  thumbnail: string | null;
  /** Its 3D files (plates), in order. */
  files: { id: string; name: string; size: number; url: string }[];
  /** Brought by a tool: it can be read, not changed. */
  toolOwned: boolean;
  createdAt: string | null;
};

export type ToolCollection = {
  id: string;
  name: string;
  description: string | null;
  tags: string[];
  modelCount: number;
  /** A tool's own collection, which can't be saved into. */
  toolOwned: boolean;
};

/** A file to save: its name (with the extension, e.g. "bin-2x3.stl") and its content. */
export type ToolFileInput = { name: string; data: Blob | ArrayBuffer | ArrayBufferView | string; type?: string };

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

const toModel = (print: Print): ToolModel => ({
  id: print.id,
  name: print.title || print.name,
  description: print.notes ?? null,
  tags: print.tags,
  thumbnail: print.thumb_url ? printsApi.fileUrl(print.thumb_url) : null,
  files: (print.plates ?? []).map((plate) => ({
    id: plate.id,
    name: plate.filename,
    size: plate.size,
    url: printsApi.fileUrl(plate.url),
  })),
  toolOwned: Boolean(print.tool_id),
  createdAt: print.created_at ?? null,
});

export const toCollection = (collection: Collection): ToolCollection => ({
  id: collection.id,
  name: collection.name,
  description: collection.description,
  tags: collection.tags,
  modelCount: collection.item_count,
  toolOwned: Boolean(collection.tool_id),
});

function toFile(input: ToolFileInput): File {
  if (!input || typeof input.name !== "string" || !input.name.trim()) throw new Error("A file needs a name");
  const data = input.data instanceof Blob ? input.data : new Blob([input.data as BlobPart]);
  return new File([data], input.name, { type: input.type ?? (data.type || "application/octet-stream") });
}

function listOptions(options: { limit?: number; offset?: number } = {}) {
  return { limit: Math.min(Math.max(1, options.limit ?? 50), 200), offset: Math.max(0, options.offset ?? 0) };
}

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
  const translate = toolTranslator(tool.locales ?? {}, language);
  // An unsaved tool's data lasts as long as its preview does.
  const draftData = new Map<string, unknown>();
  const saved = (what: string) => {
    if (!tool.id) throw new Error(`Save the tool first: ${what} needs a saved tool`);
    return tool.id;
  };

  const getModel = async (id: string) => toModel(await printsApi.get(id));

  const models = {
    /** Models in the library, newest first; `q` searches as the models page does. */
    list: async (
      options: { q?: string; tags?: string[]; collectionId?: string; limit?: number; offset?: number } = {},
    ) => {
      const page = await printsApi.list({
        q: options.q,
        tags: options.tags,
        collection_id: options.collectionId,
        ...listOptions(options),
      });
      return { models: page.items.map(toModel), hasMore: page.hasMore, total: page.total ?? null };
    },
    /** The best matches for a search, as the search box finds them. */
    search: async (q: string) => {
      const result = await searchApi.search(q);
      return {
        models: result.models.map(toModel),
        collections: result.collections.map((c) => ({ id: c.id, name: c.name, modelCount: c.item_count })),
        tags: result.tags,
      };
    },
    get: getModel,
    /** One of its files' content; the first when `fileId` is left out. */
    file: async (id: string, fileId?: string): Promise<ArrayBuffer> => {
      const model = await getModel(id);
      const file = fileId ? model.files.find((f) => f.id === fileId) : model.files[0];
      if (!file) throw new Error("The model has no such file");
      const res = await fetch(file.url);
      if (!res.ok) throw new Error(`Couldn't read ${file.name}`);
      return res.arrayBuffer();
    },
    /** A new model of the files given, each a plate, saved into a collection when one is given. */
    create: async (input: {
      name: string;
      description?: string;
      tags?: string[];
      collectionId?: string;
      files: ToolFileInput[];
    }) => {
      if (!input.files?.length) throw new Error("A model needs at least one file");
      const { prints } = await printsApi.upload(input.files.map(toFile), {
        title: input.name,
        notes: input.description,
        tags: input.tags,
        mode: "multiplate",
      });
      const print = prints[0];
      if (input.collectionId) await collectionsApi.addItems(input.collectionId, [print.id]);
      return toModel(print);
    },
    /** Adds files to a model, each a plate. */
    addFiles: async (id: string, files: ToolFileInput[]) =>
      toModel((await printsApi.addPlates(id, files.map(toFile))).print),
    /** Adds pictures (PNG, JPEG, WebP) to a model's gallery; the first becomes its cover in place of the render. */
    addImages: async (id: string, images: ToolFileInput[]) =>
      toModel((await printsApi.addPreviewImages(id, images.map(toFile))).print),
    /** Replaces one of a model's files with a new one, in its place. */
    replaceFile: async (id: string, fileId: string, file: ToolFileInput) => {
      const before = await printsApi.get(id);
      const order = before.plates.map((plate) => plate.id);
      if (!order.includes(fileId)) throw new Error("The model has no such file");
      const added = (await printsApi.addPlates(id, [toFile(file)])).print;
      const fresh = added.plates.find((plate) => !order.includes(plate.id));
      if (!fresh) throw new Error("The new file didn't arrive");
      await printsApi.reorderPlates(
        id,
        order.map((plateId) => (plateId === fileId ? fresh.id : plateId)).concat(fileId),
      );
      return toModel((await printsApi.deletePlate(id, fileId)).print);
    },
    /** Its name, description or tags. */
    update: async (id: string, patch: { name?: string; description?: string; tags?: string[] }) => {
      if (patch.name !== undefined || patch.description !== undefined)
        await printsApi.updateMeta(id, {
          ...(patch.name !== undefined ? { title: patch.name } : {}),
          ...(patch.description !== undefined ? { notes: patch.description } : {}),
        });
      if (patch.tags) await printsApi.setTags(id, patch.tags);
      return getModel(id);
    },
    open: (id: string) => ui.openModel(id),
  };

  const collections = {
    /** The user's collections, not the built-in Favourites and History. */
    list: async () => (await collectionsApi.list()).filter((collection) => !collection.system_key).map(toCollection),
    get: async (id: string) => toCollection(await collectionsApi.get(id)),
    create: async (input: { name: string; description?: string; tags?: string[] }) =>
      toCollection(await collectionsApi.create(input)),
    models: (id: string, options: { limit?: number; offset?: number } = {}) =>
      models.list({ ...options, collectionId: id }),
    add: (id: string, modelIds: string[]) => collectionsApi.addItems(id, modelIds),
    remove: (id: string, modelIds: string[]) => collectionsApi.removeItems(id, modelIds),
    /** Asks the user which collection, as a Save dialog would. */
    pick: (options?: { title?: string }) => ui.pickCollection(options),
  };

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
    library: (name: string) => toolLibrary(name),
    /** Which libraries `library()` knows. */
    libraries: TOOL_LIBRARIES,
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
    labels: (where: ParentNode = root) => applyToolLabels(where, translate),
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
