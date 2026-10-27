import { apiBase } from "../api/client";
import { widgetsApi, headerRecord, type CustomWidget } from "../api/widgets";
import { authHeaders } from "../utils/auth";
import { applyLabels, translator, type Translate } from "./labels";
import { LIBRARIES, library } from "./libraries";
import type { SdkTheme } from "./theme";
import { buildUserLibrary, toFile, type SdkFileInput } from "./userLibrary";

// The `thingport` object a dashboard widget's script gets.
//
// It is the same SDK a tool gets, bar what only a tool has: a tool owns a window, brings models of its own and
// keeps data between openings, while a widget is a panel with settings on a dashboard. Everything else — the
// theme, the labels, the heavy libraries and the user's own library — comes from the modules beside this one, so
// a script written against one reads the same as a script written against the other.

/** What a panel measures: pixels, and the grid cells it covers. */
export type WidgetSize = { width: number; height: number; cols: number; rows: number };

/** The settings the panel was given, with the metadata's defaults filled in. */
export type WidgetSettings = Record<string, unknown>;

/** A language Thingport has, as a widget sees it. */
export type WidgetLanguage = { code: string; label: string; englishName: string };

export type WidgetUi = {
  toast: (message: string, severity?: "success" | "info" | "warning" | "error") => void;
  confirm: (options: {
    title?: string;
    message: string;
    confirmLabel?: string;
    destructive?: boolean;
  }) => Promise<boolean>;
  /** Leaves the dashboard for a model's page. */
  openModel: (id: string) => void;
};

type Build = {
  widget: CustomWidget;
  /** The panel this is, where several panels show the same widget. */
  instanceId: string;
  root: HTMLElement;
  selector: string;
  settings: WidgetSettings;
  theme: SdkTheme;
  language: string;
  languages: WidgetLanguage[];
  size: () => WidgetSize;
  onResize: (listener: (size: WidgetSize) => void) => () => void;
  ui: WidgetUi;
};

/** The object a widget's default export is called with. */
export function buildWidgetSdk({
  widget,
  instanceId,
  root,
  selector,
  settings,
  theme,
  language,
  languages,
  size,
  onResize,
  ui,
}: Build) {
  const translate: Translate = translator(widget.locales ?? {}, language);
  const { models, collections } = buildUserLibrary({ openModel: ui.openModel });

  return {
    root,
    /** A CSS selector for `root`, unique on the page, to scope the widget's styles. */
    selector,
    settings,
    theme,
    get size() {
      return size();
    },
    onResize,
    widgetId: widget.id,
    instanceId,
    widget: {
      id: widget.id,
      slug: widget.slug,
      name: widget.manifest.name,
      version: widget.manifest.version,
      source: widget.source,
    },
    /**
     * A library Thingport carries, for the jobs a widget can't fit inside its own script: `"three"` to draw
     * geometry, `"opentype"` for a font's real outlines, `"manifold"` for solid modelling, `"fonts"` for the
     * typefaces Thingport ships. Fetched the first time anything asks and shared with every widget and tool after.
     */
    library: (name: string) => library(name),
    /** Which libraries `library()` knows. */
    libraries: LIBRARIES,
    /**
     * The language Thingport is in, as a code like `"en"` or `"lt"`, already matched to one it has. The widget is
     * drawn again when the user changes language, as it is when they change theme, so this is read once at the
     * top of the script rather than watched.
     */
    language,
    /** Every language Thingport has, English first. */
    languages,
    /** The widget's own words, from its `locales/<code>.json` files, in the language above. */
    t: translate,
    /** Fills in every `data-t` under `where` (the panel by default) from those words. */
    labels: (where: ParentNode = root) => applyLabels(where, translate),
    models,
    collections,
    /** A request to one of the hosts the widget's metadata declares, made by the server; answers as `fetch` does. */
    fetch: (url: string, init?: RequestInit) => widgetsApi.fetchVia(widget.id, url, init),
    /** Thingport's own API, as the user: `api("/dashboard/summary")`. */
    api: (path: string, init: RequestInit = {}) =>
      fetch(`${apiBase()}${path.startsWith("/") ? path : `/${path}`}`, {
        ...init,
        headers: { ...headerRecord(authHeaders()), ...headerRecord(init.headers) },
      }),
    /** Hands the user a file to keep, as a browser download. */
    download: (file: SdkFileInput) => {
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
  };
}

export type WidgetSdk = ReturnType<typeof buildWidgetSdk>;
