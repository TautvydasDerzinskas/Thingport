import type { TFunction } from "i18next";
import { cloneLayout, moveElement, verticalCompactor } from "react-grid-layout/core";
import type {
  DashboardBreakpoint,
  DashboardConfig,
  DashboardGridItem,
  DashboardLayout,
  DashboardPanel,
  DashboardTemplate,
  DashboardWidgetChoices,
  DashboardWidgetId,
  WidgetInstanceId,
  WidgetSettingValues,
} from "../../api/settings";
import { allowed, DASHBOARD_WIDGETS, widgetById, widgetOf, type ResolvedSettings } from "./widgets";

/** Widest first; a breakpoint applies from its width up. Phones get one column, so panels simply stack. */
export const BREAKPOINTS: { id: DashboardBreakpoint; minWidth: number; cols: number }[] = [
  { id: "lg", minWidth: 1100, cols: 12 },
  { id: "md", minWidth: 600, cols: 6 },
  { id: "sm", minWidth: 0, cols: 1 },
];
export const ROW_HEIGHT = 64;
export const GRID_GAP = 16;
export const MAX_TEMPLATES = 30;

export function breakpointFor(width: number): (typeof BREAKPOINTS)[number] {
  return BREAKPOINTS.find((breakpoint) => width >= breakpoint.minWidth) ?? BREAKPOINTS[BREAKPOINTS.length - 1];
}

const colsOf = (breakpoint: DashboardBreakpoint) => BREAKPOINTS.find((b) => b.id === breakpoint)!.cols;

/** Not crypto.randomUUID: that needs a secure context, and Thingport is often reached over plain http on a LAN. */
export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

const compact = (items: DashboardGridItem[], cols: number): DashboardGridItem[] =>
  verticalCompactor.compact(items, cols).map(({ i, x, y, w, h }) => ({ i, x, y, w, h }));

const bottomOf = (items: DashboardGridItem[]) => items.reduce((max, item) => Math.max(max, item.y + item.h), 0);

/** The smallest a panel can be: big enough for the largest minimum among its widgets. */
export function panelMinSize(panel: DashboardPanel): { minW: number; minH: number } {
  const sizes = panel.widgets.map((id) => widgetById(id)?.size).filter((size) => size !== undefined);
  return {
    minW: Math.max(1, ...sizes.map((size) => size.minW)),
    // A tabbed panel's tab strip takes part of a row.
    minH: Math.max(1, ...sizes.map((size) => size.minH)) + (panel.widgets.length > 1 ? 1 : 0),
  };
}

function defaultItem(panel: DashboardPanel, y: number): DashboardGridItem {
  const size = widgetById(panel.widgets[0])?.size ?? { w: 4, h: 3 };
  const min = panelMinSize(panel);
  return { i: panel.id, x: 0, y, w: Math.max(size.w, min.minW), h: Math.max(size.h, min.minH) };
}

/**
 * Fits a wide layout into fewer columns. On a phone the panels stack in reading order. On the medium grid each keeps to
 * the half its middle was in, or spans both when it took most of the width, so columns keep their order and neighbours;
 * halving every position instead leaves slivers and holes.
 */
function fitLayout(items: DashboardGridItem[], cols: number): DashboardGridItem[] {
  if (cols === 1) {
    let y = 0;
    return items
      .toSorted((a, b) => a.y - b.y || a.x - b.x)
      .map((item) => {
        const placed = { i: item.i, x: 0, y, w: 1, h: item.h };
        y += item.h;
        return placed;
      });
  }
  const half = cols / 2;
  return compact(
    items.map((item) =>
      item.w >= 9 ? { ...item, x: 0, w: cols } : { ...item, x: item.x + item.w / 2 <= 6 ? 0 : half, w: half },
    ),
    cols,
  );
}

/**
 * Where each panel sits at a breakpoint: the layout the user arranged there, or one derived from the widest grid.
 * Panels missing from a saved layout (added since) go at the bottom.
 */
export function resolveLayout(template: DashboardTemplate, breakpoint: DashboardBreakpoint): DashboardGridItem[] {
  const cols = colsOf(breakpoint);
  const ids = new Set(template.panels.map((panel) => panel.id));
  const fit = (item: DashboardGridItem) => {
    const w = Math.min(cols, item.w);
    return { ...item, w, x: Math.min(item.x, cols - w) };
  };
  const wide = template.layouts.lg?.filter((item) => ids.has(item.i)) ?? [];
  // Panels the wide layout doesn't place yet, below the ones it does.
  const placedWide = new Set(wide.map((item) => item.i));
  let y = bottomOf(wide);
  for (const panel of template.panels) {
    if (placedWide.has(panel.id)) continue;
    const item = defaultItem(panel, y);
    wide.push(item);
    y += item.h;
  }
  if (breakpoint === "lg") return compact(wide.map(fit), cols);

  const saved = template.layouts[breakpoint]?.filter((item) => ids.has(item.i));
  if (!saved) return fitLayout(wide, cols);
  const placed = new Set(saved.map((item) => item.i));
  const missing = fitLayout(
    wide.filter((item) => !placed.has(item.i)),
    cols,
  ).map((item) => ({ ...item, y: item.y + bottomOf(saved) }));
  return compact([...saved.map(fit), ...missing], cols);
}

/**
 * The keyboard's way to arrange: moves a panel a cell (pushing others aside as a drag would) or, with `resize`,
 * grows or shrinks it a cell, within its minimum size and the grid.
 */
export function nudgeLayout(
  layout: DashboardGridItem[],
  id: string,
  dx: number,
  dy: number,
  resize: boolean,
  cols: number,
  min: { minW: number; minH: number },
): DashboardGridItem[] {
  const items = cloneLayout(layout);
  const item = items.find((cell) => cell.i === id);
  if (!item) return layout;
  if (resize) {
    const w = Math.max(Math.min(min.minW, cols), Math.min(cols - item.x, item.w + dx));
    const h = Math.max(min.minH, item.h + dy);
    const resized = items.map((cell) => (cell.i === id ? { ...cell, w, h } : cell));
    return compact(resized, cols);
  }
  const x = Math.max(0, Math.min(cols - item.w, item.x + dx));
  // A step of one row only overlaps the neighbour, and the compactor floats things straight back. So a step jumps
  // past the neighbour in that direction, which swaps the two.
  let y = item.y;
  const column = items.filter((cell) => cell.i !== id && cell.x < x + item.w && x < cell.x + cell.w);
  if (dy > 0) {
    const next = column.filter((cell) => cell.y >= item.y + item.h).toSorted((a, b) => a.y - b.y)[0];
    y = next ? next.y + next.h - item.h + 1 : item.y + 1;
  } else if (dy < 0) {
    const previous = column.filter((cell) => cell.y + cell.h <= item.y).toSorted((a, b) => b.y + b.h - (a.y + a.h))[0];
    y = previous ? previous.y : Math.max(0, item.y - 1);
  }
  return compact(moveElement(items, item, x, Math.max(0, y), true, false, "vertical", cols), cols);
}

/** Every widget the template shows, in any panel, however many copies of it. */
export function templateWidgets(template: DashboardTemplate): Set<DashboardWidgetId> {
  return new Set(template.panels.flatMap((panel) => panel.widgets.map(widgetOf)));
}

/** How many copies of a widget the template shows. */
export function instanceCount(template: DashboardTemplate, id: DashboardWidgetId): number {
  return template.panels.reduce((sum, panel) => sum + panel.widgets.filter((w) => widgetOf(w) === id).length, 0);
}

/**
 * Keeps only the panels that still exist in every saved layout, and drops the options of a removed copy of a widget
 * that may repeat, so a copy added later starts fresh. A widget shown once keeps its options for when it's back.
 */
function pruneLayouts(template: DashboardTemplate): DashboardTemplate {
  const ids = new Set(template.panels.map((panel) => panel.id));
  const layouts: DashboardTemplate["layouts"] = {};
  for (const [breakpoint, items] of Object.entries(template.layouts) as [DashboardBreakpoint, DashboardGridItem[]][])
    layouts[breakpoint] = items.filter((item) => ids.has(item.i));
  if (!template.settings) return { ...template, layouts };
  const placed = new Set(template.panels.flatMap((panel) => panel.widgets));
  const settings = Object.fromEntries(
    Object.entries(template.settings).filter(([instance]) => placed.has(instance) || !widgetById(instance)?.multiple),
  );
  return { ...template, layouts, settings };
}

/** Applies `change` to the panel's cell in each saved layout. */
function mapItems(
  template: DashboardTemplate,
  change: (item: DashboardGridItem, breakpoint: DashboardBreakpoint) => DashboardGridItem[],
): DashboardTemplate["layouts"] {
  const layouts: DashboardTemplate["layouts"] = {};
  for (const [breakpoint, items] of Object.entries(template.layouts) as [DashboardBreakpoint, DashboardGridItem[]][])
    layouts[breakpoint] = items.flatMap((item) => change(item, breakpoint));
  return layouts;
}

export function setLayout(
  template: DashboardTemplate,
  breakpoint: DashboardBreakpoint,
  items: readonly DashboardGridItem[],
): DashboardTemplate {
  return {
    ...template,
    layouts: { ...template.layouts, [breakpoint]: items.map(({ i, x, y, w, h }) => ({ i, x, y, w, h })) },
  };
}

/** The highest spot, then the leftmost, where a w × h panel fits without overlapping any other. */
export function firstFit(items: DashboardGridItem[], w: number, h: number, cols: number): { x: number; y: number } {
  const width = Math.min(w, cols);
  for (let y = 0; ; y++)
    for (let x = 0; x + width <= cols; x++)
      if (items.every((p) => x >= p.x + p.w || p.x >= x + width || y >= p.y + p.h || p.y >= y + h)) return { x, y };
}

/**
 * A widget in a panel of its own, in the first free spot it fits in each layout: a gap if there's one, else below. A
 * widget already shown is added again only if it may repeat, as a new copy with its own options.
 */
export function addWidget(
  template: DashboardTemplate,
  id: DashboardWidgetId,
  panelId: string = newId(),
): DashboardTemplate {
  const shown = templateWidgets(template).has(id);
  if (shown && !widgetById(id)?.multiple) return template;
  // The first copy keeps the widget's own id; while that one's placed, a further copy gets a suffix.
  const placed = new Set(template.panels.flatMap((panel) => panel.widgets));
  const instance: WidgetInstanceId = placed.has(id) ? `${id}:${newId()}` : id;
  return placeInstance(template, instance, panelId);
}

/** An instance in a new panel of its own, in the first free spot of each saved layout. It's the widget's usual size,
 *  or with `sizeOf`, the size that panel is in each layout, as a tab taken out of a tabbed panel keeps. */
function placeInstance(
  template: DashboardTemplate,
  instance: WidgetInstanceId,
  panelId: string,
  sizeOf?: string,
): DashboardTemplate {
  const panel: DashboardPanel = { id: panelId, widgets: [instance] };
  const layouts: DashboardTemplate["layouts"] = {};
  for (const [breakpoint, items] of Object.entries(template.layouts) as [DashboardBreakpoint, DashboardGridItem[]][]) {
    const cols = colsOf(breakpoint);
    const wide = defaultItem(panel, 0);
    const parent = sizeOf ? items.find((cell) => cell.i === sizeOf) : undefined;
    const item = parent ? { ...wide, w: parent.w, h: parent.h } : cols === 12 ? wide : fitLayout([wide], cols)[0];
    layouts[breakpoint] = [...items, { ...item, ...firstFit(items, item.w, item.h, cols) }];
  }
  return { ...template, panels: [...template.panels, panel], layouts };
}

export function removePanels(template: DashboardTemplate, ids: ReadonlySet<string>): DashboardTemplate {
  return pruneLayouts({ ...template, panels: template.panels.filter((panel) => !ids.has(panel.id)) });
}

/** Takes a widget off the dashboard, every copy of it, and a panel with it once the panel holds nothing else. */
export function removeWidget(template: DashboardTemplate, id: DashboardWidgetId): DashboardTemplate {
  return withoutInstances(template, (instance) => widgetOf(instance) === id);
}

function withoutInstances(
  template: DashboardTemplate,
  drop: (instance: WidgetInstanceId) => boolean,
): DashboardTemplate {
  const panels = template.panels.flatMap((panel) => {
    if (!panel.widgets.some(drop)) return [panel];
    const widgets = panel.widgets.filter((instance) => !drop(instance));
    return widgets.length ? [{ ...panel, widgets, tab: 0 }] : [];
  });
  return pruneLayouts({ ...template, panels });
}

/** The given panels in reading order on the wide grid. */
function inReadingOrder(template: DashboardTemplate, ids: ReadonlySet<string>): DashboardPanel[] {
  const wide = resolveLayout(template, "lg");
  const rank = (id: string) => {
    const item = wide.find((cell) => cell.i === id);
    return item ? item.y * 100 + item.x : Infinity;
  };
  return template.panels.filter((panel) => ids.has(panel.id)).toSorted((a, b) => rank(a.id) - rank(b.id));
}

/**
 * Joins panels into one tabbed panel, where the first of them (in reading order) was. It takes the largest of their
 * widths and heights, so no widget ends up cramped.
 */
export function mergePanels(template: DashboardTemplate, ids: ReadonlySet<string>): DashboardTemplate {
  const merging = inReadingOrder(template, ids);
  if (merging.length < 2) return template;
  const [target, ...rest] = merging;
  const merged: DashboardPanel = { id: target.id, widgets: merging.flatMap((panel) => panel.widgets), tab: 0 };
  const restIds = new Set(rest.map((panel) => panel.id));
  const min = panelMinSize(merged);
  const layouts = mapItems(template, (item, breakpoint) => {
    if (restIds.has(item.i)) return [];
    if (item.i !== target.id) return [item];
    const cols = colsOf(breakpoint);
    const all = template.layouts[breakpoint]!.filter((cell) => ids.has(cell.i));
    const w = Math.min(cols, Math.max(min.minW, ...all.map((cell) => cell.w)));
    return [{ ...item, w, x: Math.min(item.x, cols - w), h: Math.max(min.minH, ...all.map((cell) => cell.h)) }];
  });
  const panels = template.panels.flatMap((panel) =>
    panel.id === target.id ? [merged] : restIds.has(panel.id) ? [] : [panel],
  );
  return { ...template, panels, layouts };
}

/**
 * Moves a widget into another panel as a tab, shown straight away. Dragging a panel's only widget this way merges the
 * two panels; the target keeps its place and size, grown only if the widget needs it.
 */
export function moveWidgetToPanel(
  template: DashboardTemplate,
  id: WidgetInstanceId,
  targetId: string,
): DashboardTemplate {
  const source = template.panels.find((panel) => panel.widgets.includes(id));
  const target = template.panels.find((panel) => panel.id === targetId);
  if (!source || !target || source.id === target.id) return template;
  const grown: DashboardPanel = { ...target, widgets: [...target.widgets, id], tab: target.widgets.length };
  const panels = template.panels.flatMap((panel) => {
    if (panel.id === target.id) return [grown];
    if (panel.id !== source.id) return [panel];
    const widgets = panel.widgets.filter((widget) => widget !== id);
    return widgets.length ? [{ ...panel, widgets, tab: 0 }] : [];
  });
  const min = panelMinSize(grown);
  const layouts = mapItems(template, (item, breakpoint) => {
    if (item.i !== target.id) return [item];
    const cols = colsOf(breakpoint);
    const w = Math.min(cols, Math.max(item.w, min.minW));
    return [{ ...item, w, x: Math.min(item.x, cols - w), h: Math.max(item.h, min.minH) }];
  });
  return pruneLayouts({ ...template, panels, layouts });
}

/** Moves a tab to `to` in its panel's tab order; the tab that was showing stays showing. */
export function moveTab(template: DashboardTemplate, id: WidgetInstanceId, to: number): DashboardTemplate {
  const source = template.panels.find((panel) => panel.widgets.includes(id));
  if (!source) return template;
  const from = source.widgets.indexOf(id);
  const at = Math.max(0, Math.min(to, source.widgets.length - 1));
  if (at === from) return template;
  const shown = source.widgets[Math.min(source.tab ?? 0, source.widgets.length - 1)];
  const widgets = source.widgets.filter((widget) => widget !== id);
  widgets.splice(at, 0, id);
  const panels = template.panels.map((panel) =>
    panel.id === source.id ? { ...panel, widgets, tab: widgets.indexOf(shown) } : panel,
  );
  return { ...template, panels };
}

/** Takes a widget out of a tabbed panel into a panel of its own, the size the tabbed panel is, in the first gap it
 *  fits; it keeps its options. */
export function detachWidget(template: DashboardTemplate, id: WidgetInstanceId): DashboardTemplate {
  const source = template.panels.find((panel) => panel.widgets.includes(id));
  if (!source || source.widgets.length < 2) return template;
  const panels = template.panels.map((panel) =>
    panel.id === source.id ? { ...panel, widgets: panel.widgets.filter((instance) => instance !== id), tab: 0 } : panel,
  );
  return placeInstance({ ...template, panels }, id, newId(), source.id);
}

/**
 * Every tab of a tabbed panel becomes a panel of its own, the size the panel was: the first where it was, the others
 * one under another below it, in tab order. What was below moves down to make room.
 */
export function splitPanel(template: DashboardTemplate, panelId: string): DashboardTemplate {
  const panel = template.panels.find((p) => p.id === panelId);
  if (!panel || panel.widgets.length < 2) return template;
  const [first, ...rest] = panel.widgets;
  const pieces: DashboardPanel[] = rest.map((instance) => ({ id: newId(), widgets: [instance] }));
  const panels = template.panels.flatMap((p) =>
    p.id === panelId ? [{ ...p, widgets: [first], tab: 0 }, ...pieces] : [p],
  );
  const layouts: DashboardTemplate["layouts"] = {};
  for (const [breakpoint, items] of Object.entries(template.layouts) as [DashboardBreakpoint, DashboardGridItem[]][]) {
    const at = items.find((item) => item.i === panelId);
    // Not placed in this layout yet: the pieces go where unplaced panels go, at the bottom.
    if (!at) {
      layouts[breakpoint] = items;
      continue;
    }
    const below = at.y + at.h;
    const room = at.h * pieces.length;
    // Moved down first, so the pieces take the space right under the panel rather than queueing behind them.
    const moved = items.map((item) => (item.y >= below ? { ...item, y: item.y + room } : item));
    const placed = pieces.map((piece, index) => ({ i: piece.id, x: at.x, y: below + at.h * index, w: at.w, h: at.h }));
    layouts[breakpoint] = compact([...moved, ...placed], colsOf(breakpoint));
  }
  return { ...template, panels, layouts };
}

/**
 * Saves a widget's options. Only what differs from its defaults is kept, so a default changed in a later release
 * reaches everyone who never picked otherwise.
 */
export function setWidgetSettings(
  template: DashboardTemplate,
  id: WidgetInstanceId,
  values: ResolvedSettings,
): DashboardTemplate {
  const widget = widgetById(id);
  const changed = Object.fromEntries(
    (widget?.settings ?? [])
      .filter(
        (setting) =>
          values[setting.key] !== undefined && JSON.stringify(values[setting.key]) !== JSON.stringify(setting.default),
      )
      .map((setting) => [setting.key, values[setting.key]]),
  );
  const { [id]: _previous, ...others } = template.settings ?? {};
  const settings = Object.keys(changed).length ? { ...others, [id]: changed } : others;
  return { ...template, settings };
}

export function setTab(template: DashboardTemplate, panelId: string, tab: number): DashboardTemplate {
  return {
    ...template,
    panels: template.panels.map((panel) => (panel.id === panelId ? { ...panel, tab } : panel)),
  };
}

// --- Presets -------------------------------------------------------------------------------------------------------

/** `otherwise` stands in for the panel's widgets when none are allowed, e.g. admin-only ones for everyone else. */
type PresetPanel = {
  widgets: DashboardWidgetId[];
  otherwise?: DashboardWidgetId;
  x: number;
  y: number;
  w: number;
  h: number;
};
/** `settings` are the widgets' options, by widget id: a preset holds one of each. */
export type DashboardPreset = {
  id: string;
  panels: PresetPanel[];
  settings?: Partial<Record<DashboardWidgetId, WidgetSettingValues>>;
};

const one = (id: DashboardWidgetId, x: number, y: number, w: number, h: number): PresetPanel => ({
  widgets: [id],
  x,
  y,
  w,
  h,
});

const BLOG = { feeds: ["https://www.thingport.net/rss.xml"], title: "Thingport Blog" };
const LAUNCHER = {
  items: [
    { url: "https://thingport.net", icon: "/icon-192.png", name: "Thingport" },
    { url: "https://github.com/TautvydasDerzinskas/Thingport", icon: "https://github.com/favicon.ico", name: "GitHub" },
    { url: "https://makerworld.com", icon: "builtin:providers/makerworld", name: "MakerWorld" },
    { url: "https://www.thingiverse.com", icon: "builtin:providers/thingiverse", name: "Thingiverse" },
    { url: "https://www.printables.com", icon: "builtin:providers/printables", name: "Printables" },
    { url: "https://www.crealitycloud.com", icon: "builtin:providers/crealitycloud", name: "Creality Cloud" },
    { url: "https://space.snapmaker.com", icon: "builtin:providers/snapmaker", name: "Snapmaker Space" },
    { url: "https://www.makeronline.com", icon: "builtin:providers/makeronline", name: "MakerOnline" },
    { url: "https://www.nexprint.com/en/models", icon: "builtin:providers/nexprint", name: "NexPrint" },
  ],
};

/** In the order the template picker shows them. Laid out on the wide 12-column grid. */
export const DASHBOARD_PRESETS: DashboardPreset[] = [
  {
    // The default: the time and the server up top, the user's sites, their library, and what's trending elsewhere.
    id: "homepage",
    panels: [
      one("clock", 0, 0, 3, 2),
      one("weather", 3, 0, 3, 2),
      one("uptime", 6, 0, 3, 2),
      { ...one("cpu", 9, 0, 3, 4), otherwise: "featuredModel" },
      one("launcher", 0, 2, 9, 2),
      { widgets: ["recentlyAdded", "topPrinted", "topViewed"], x: 0, y: 4, w: 6, h: 4 },
      one("rss", 6, 4, 6, 4),
      one("authorCount", 0, 8, 2, 2),
      one("categoryCount", 2, 8, 2, 2),
      one("collectionCount", 4, 8, 2, 2),
      one("modelCount", 6, 8, 2, 2),
      { widgets: ["topProviders", "topAuthors"], x: 8, y: 8, w: 4, h: 7 },
      one("trending", 0, 10, 8, 5),
    ],
    settings: {
      rss: { ...BLOG, title: "Thingport blog" },
      launcher: LAUNCHER,
      trending: {
        view: "cards",
        providers: [
          "printables",
          "makerworld",
          "thingiverse",
          "thangs",
          "makeronline",
          "myminifactory",
          "cults3d",
          "crealitycloud",
          "nexprint",
          "snapmaker",
        ],
      },
      recentlyAdded: { count: "3" },
      topPrinted: { count: "3" },
      topViewed: { count: "3" },
      topProviders: { count: "10" },
      topAuthors: { count: "10" },
    },
  },
  {
    // The dashboard as it first was: the counts down the left, two columns of lists beside them.
    id: "classic",
    panels: [
      one("collectionCount", 0, 0, 3, 2),
      one("recentlyAdded", 3, 0, 5, 4),
      one("topAuthors", 8, 0, 4, 4),
      one("modelCount", 0, 2, 3, 2),
      one("authorCount", 0, 4, 3, 2),
      one("topViewed", 3, 4, 5, 4),
      one("topProviders", 8, 4, 4, 4),
      one("categoryCount", 0, 6, 3, 2),
      one("featuredModel", 0, 8, 3, 4),
      one("topPrinted", 3, 8, 5, 4),
      one("rss", 8, 8, 4, 4),
    ],
    settings: { rss: BLOG },
  },
  {
    id: "overview",
    panels: [
      one("collectionCount", 0, 0, 3, 2),
      one("modelCount", 3, 0, 3, 2),
      one("authorCount", 6, 0, 3, 2),
      one("categoryCount", 9, 0, 3, 2),
      one("topViewed", 0, 2, 4, 4),
      one("topPrinted", 4, 2, 4, 4),
      one("recentlyAdded", 8, 2, 4, 4),
      one("topAuthors", 0, 6, 6, 4),
      one("topProviders", 6, 6, 6, 4),
    ],
  },
  {
    // The lists gathered into two tabbed panels, so everything fits on one screen.
    id: "compact",
    panels: [
      one("collectionCount", 0, 0, 3, 2),
      one("modelCount", 3, 0, 3, 2),
      one("authorCount", 6, 0, 3, 2),
      one("categoryCount", 9, 0, 3, 2),
      { widgets: ["recentlyAdded", "topViewed", "topPrinted"], x: 0, y: 2, w: 6, h: 7 },
      { widgets: ["topAuthors", "topProviders"], x: 6, y: 2, w: 6, h: 7 },
    ],
    settings: {
      recentlyAdded: { count: "10" },
      topViewed: { count: "10" },
      topPrinted: { count: "10" },
      topAuthors: { count: "10" },
      topProviders: { count: "10" },
    },
  },
  {
    id: "minimal",
    panels: [
      one("clock", 0, 0, 4, 2),
      one("modelCount", 4, 0, 4, 2),
      one("collectionCount", 8, 0, 4, 2),
      one("recentlyAdded", 0, 2, 6, 4),
      one("rss", 6, 2, 6, 4),
      one("trending", 0, 6, 6, 4),
      one("launcher", 6, 6, 3, 4),
      one("featuredModel", 9, 6, 3, 4),
    ],
    settings: {
      rss: BLOG,
      trending: { providers: ["printables", "makerworld", "thingiverse"] },
      launcher: LAUNCHER,
    },
  },
];

export function presetById(id: string | null): DashboardPreset | undefined {
  return DASHBOARD_PRESETS.find((preset) => preset.id === id);
}

/** A built-in template's name follows the user's language until they rename it. */
export function templateName(t: TFunction, template: DashboardTemplate): string {
  if (template.name) return template.name;
  // Also a template made from a built-in since retired, like Showcase, whose name is still translated.
  return template.preset
    ? t(`dashboard.templates.presets.${template.preset}`, { defaultValue: t("dashboard.templates.untitled") })
    : t("dashboard.templates.untitled");
}

/** `base`, or `base 2`, `base 3`... when a template already goes by it. */
export function uniqueTemplateName(t: TFunction, templates: DashboardTemplate[], base: string): string {
  const taken = new Set(templates.map((template) => templateName(t, template)));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/** A preset as a new template; one who isn't an admin gets it without the admin-only widgets, or their stand-ins. */
export function templateFromPreset(preset: DashboardPreset, isAdmin: boolean): DashboardTemplate {
  const panels = preset.panels.flatMap((p) => {
    const shown = p.widgets.filter((id) => allowed(widgetById(id) ?? {}, isAdmin));
    const widgets = shown.length || !p.otherwise ? shown : [p.otherwise];
    return widgets.length ? [{ panel: { id: newId(), widgets } as DashboardPanel, p }] : [];
  });
  const kept = new Set(panels.flatMap(({ panel }) => panel.widgets));
  const settings = Object.entries(preset.settings ?? {}).filter(([id]) => kept.has(id as DashboardWidgetId));
  return {
    id: newId(),
    name: null,
    preset: preset.id,
    panels: panels.map(({ panel }) => panel),
    layouts: { lg: panels.map(({ panel, p }) => ({ i: panel.id, x: p.x, y: p.y, w: p.w, h: p.h })) },
    ...(settings.length && { settings: structuredClone(Object.fromEntries(settings)) }),
  };
}

/** Back to the preset it started from, keeping its id and name. */
export function resetTemplate(template: DashboardTemplate, isAdmin: boolean): DashboardTemplate {
  const preset = presetById(template.preset);
  return preset ? { ...templateFromPreset(preset, isAdmin), id: template.id, name: template.name } : template;
}

export function emptyTemplate(name: string): DashboardTemplate {
  return { id: newId(), name, preset: null, panels: [], layouts: {} };
}

/** A copy with fresh ids, so the two can change apart. */
export function duplicateTemplate(template: DashboardTemplate, name: string): DashboardTemplate {
  const ids = new Map(template.panels.map((panel) => [panel.id, newId()]));
  return {
    id: newId(),
    name,
    preset: template.preset,
    panels: template.panels.map((panel) => ({ ...panel, id: ids.get(panel.id)! })),
    layouts: mapItems(template, (item) => [{ ...item, i: ids.get(item.i)! }]),
    // Instance ids stay the same, so each widget keeps its options.
    ...(template.settings && { settings: structuredClone(template.settings) }),
  };
}

// The old dashboard only saved the widgets the user switched; these were off until switched on.
const LEGACY_OFF_BY_DEFAULT = new Set<DashboardWidgetId>(["clock", "weather", "featuredModel", "activityHeatmap"]);

// Which preset stands in for each of the old fixed layouts; the puzzle's place went to the homepage.
const LEGACY_PRESETS: Record<DashboardLayout, string> = {
  left: "classic",
  right: "classic",
  top: "overview",
  topTwo: "overview",
  bottom: "overview",
  puzzle: "homepage",
};

const DEFAULT_PRESET = "homepage";

/**
 * The first templates: every preset, showing the default one. Someone who had arranged the old dashboard sees the one
 * closest to their layout instead, with the widgets they had switched on or off, so it looks as it did.
 */
export function initialConfig(
  legacy: { layout: DashboardLayout | null; widgets: DashboardWidgetChoices } = { layout: null, widgets: {} },
  isAdmin = false,
): DashboardConfig {
  const templates = DASHBOARD_PRESETS.map((preset) => templateFromPreset(preset, isAdmin));
  const arranged = legacy.layout !== null || Object.keys(legacy.widgets).length > 0;
  if (!arranged) {
    const active = templates.find((template) => template.preset === DEFAULT_PRESET)!;
    return { active: active.id, templates, offered: DASHBOARD_PRESETS.map((preset) => preset.id) };
  }
  const index = templates.findIndex((template) => template.preset === LEGACY_PRESETS[legacy.layout ?? "left"]);
  let chosen = templates[index];
  if (legacy.layout === "right")
    chosen = { ...chosen, layouts: { lg: chosen.layouts.lg!.map((item) => ({ ...item, x: 12 - item.x - item.w })) } };
  for (const widget of DASHBOARD_WIDGETS) {
    const enabled = legacy.widgets[widget.id] ?? (LEGACY_OFF_BY_DEFAULT.has(widget.id) ? false : undefined);
    if (enabled === true) chosen = addWidget(chosen, widget.id);
    else if (enabled === false) chosen = removeWidget(chosen, widget.id);
  }
  templates[index] = chosen;
  return { active: chosen.id, templates, offered: DASHBOARD_PRESETS.map((preset) => preset.id) };
}

/**
 * Adds the built-in templates added since the user's were made, once each: a built-in the user deleted stays deleted.
 * Returns the same config when there's nothing new.
 */
// Configs saved before `offered` was tracked were all made when exactly these existed.
const UNTRACKED_OFFERED = ["classic", "overview", "compact", "showcase", "minimal"];

export function offerNewPresets(config: DashboardConfig, isAdmin: boolean): DashboardConfig {
  const offered = new Set(config.offered ?? UNTRACKED_OFFERED);
  const added = DASHBOARD_PRESETS.filter((preset) => !offered.has(preset.id))
    .slice(0, Math.max(0, MAX_TEMPLATES - config.templates.length))
    .map((preset) => templateFromPreset(preset, isAdmin));
  if (!added.length && config.offered) return config;
  return {
    ...config,
    templates: [...config.templates, ...added],
    offered: [...new Set([...offered, ...DASHBOARD_PRESETS.map((preset) => preset.id)])],
  };
}
