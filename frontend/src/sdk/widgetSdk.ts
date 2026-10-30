import { apiBase } from "../api/client";
import { widgetsApi, headerRecord, type CustomWidget } from "../api/widgets";
import { authHeaders } from "../utils/auth";
import { applyLabels, translator, type Translate } from "./labels";
import { LIBRARIES, library } from "./libraries";
import type { SdkLanguage, SdkTheme, SdkUi, WidgetSdk, WidgetSize } from "./types";
import { buildUserLibrary, toFile, type SdkFileInput } from "./userLibrary";

// The `thingport` object a dashboard widget's script gets.
//
// It is the same SDK a tool gets, bar what only a tool has: a tool owns a window, brings models of its own and
// keeps data between openings, while a widget is a panel with settings on a dashboard. Everything else — the
// theme, the labels, the heavy libraries and the user's own library — comes from the modules beside this one, so
// a script written against one reads the same as a script written against the other. What each member does is
// written once, in types.ts, which the reference is generated from.

export type { WidgetSdk, WidgetSize };

/** The settings the panel was given, with the metadata's defaults filled in. */
export type WidgetSettings = WidgetSdk["settings"];

/** A language Thingport has, as a widget sees it. */
export type WidgetLanguage = SdkLanguage;

export type WidgetUi = SdkUi;

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

/** Hands the user a file to keep, through a link clicked on their behalf. */
export function downloadFile(file: SdkFileInput): void {
  const url = URL.createObjectURL(toFile(file));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Thingport's own API as the user, at a path under /api. */
export function apiAsUser(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${apiBase()}${path.startsWith("/") ? path : `/${path}`}`, {
    ...init,
    headers: { ...headerRecord(authHeaders()), ...headerRecord(init.headers) },
  });
}

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
}: Build): WidgetSdk {
  const translate: Translate = translator(widget.locales ?? {}, language);
  const { models, collections } = buildUserLibrary({ openModel: ui.openModel });

  return {
    root,
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
    library,
    libraries: LIBRARIES,
    language,
    languages,
    t: translate,
    labels: (where: ParentNode = root) => applyLabels(where, translate),
    models,
    collections,
    fetch: (url: string, init?: RequestInit) => widgetsApi.fetchVia(widget.id, url, init),
    api: apiAsUser,
    download: downloadFile,
    ui,
  };
}
