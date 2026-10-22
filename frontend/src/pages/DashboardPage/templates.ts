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
} from "../../api/settings";
import { DASHBOARD_WIDGETS, widgetById, type ResolvedSettings } from "./widgets";

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

/** Every widget the template shows, in any panel. */
export function templateWidgets(template: DashboardTemplate): Set<DashboardWidgetId> {
  return new Set(template.panels.flatMap((panel) => panel.widgets));
}

/** Keeps only the panels that still exist in every saved layout. */
function pruneLayouts(template: DashboardTemplate): DashboardTemplate {
  const ids = new Set(template.panels.map((panel) => panel.id));
  const layouts: DashboardTemplate["layouts"] = {};
  for (const [breakpoint, items] of Object.entries(template.layouts) as [DashboardBreakpoint, DashboardGridItem[]][])
    layouts[breakpoint] = items.filter((item) => ids.has(item.i));
  return { ...template, layouts };
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

/** A widget in a panel of its own, in the first free spot it fits in each layout: a gap if there's one, else below. */
export function addWidget(
  template: DashboardTemplate,
  id: DashboardWidgetId,
  panelId: string = newId(),
): DashboardTemplate {
  if (templateWidgets(template).has(id)) return template;
  const panel: DashboardPanel = { id: panelId, widgets: [id] };
  const layouts: DashboardTemplate["layouts"] = {};
  for (const [breakpoint, items] of Object.entries(template.layouts) as [DashboardBreakpoint, DashboardGridItem[]][]) {
    const cols = colsOf(breakpoint);
    const wide = defaultItem(panel, 0);
    const item = cols === 12 ? wide : fitLayout([wide], cols)[0];
    layouts[breakpoint] = [...items, { ...item, ...firstFit(items, item.w, item.h, cols) }];
  }
  return { ...template, panels: [...template.panels, panel], layouts };
}

export function removePanels(template: DashboardTemplate, ids: ReadonlySet<string>): DashboardTemplate {
  return pruneLayouts({ ...template, panels: template.panels.filter((panel) => !ids.has(panel.id)) });
}

/** Takes a widget off the dashboard, and its panel with it once it holds nothing else. */
export function removeWidget(template: DashboardTemplate, id: DashboardWidgetId): DashboardTemplate {
  const panels = template.panels.flatMap((panel) => {
    if (!panel.widgets.includes(id)) return [panel];
    const widgets = panel.widgets.filter((widget) => widget !== id);
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
  id: DashboardWidgetId,
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

/** Takes a widget out of a tabbed panel into a panel of its own, at the bottom. */
export function detachWidget(template: DashboardTemplate, id: DashboardWidgetId): DashboardTemplate {
  const source = template.panels.find((panel) => panel.widgets.includes(id));
  if (!source || source.widgets.length < 2) return template;
  return addWidget(removeWidget(template, id), id);
}

/** Every tab of a tabbed panel becomes a panel of its own; the first stays where the panel was. */
export function splitPanel(template: DashboardTemplate, panelId: string): DashboardTemplate {
  const panel = template.panels.find((p) => p.id === panelId);
  if (!panel || panel.widgets.length < 2) return template;
  return panel.widgets.slice(1).reduce(detachWidget, template);
}

/**
 * Saves a widget's options. Only what differs from its defaults is kept, so a default changed in a later release
 * reaches everyone who never picked otherwise.
 */
export function setWidgetSettings(
  template: DashboardTemplate,
  id: DashboardWidgetId,
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

type PresetPanel = { widgets: DashboardWidgetId[]; x: number; y: number; w: number; h: number };
export type DashboardPreset = { id: string; panels: PresetPanel[] };

const one = (id: DashboardWidgetId, x: number, y: number, w: number, h: number): PresetPanel => ({
  widgets: [id],
  x,
  y,
  w,
  h,
});
const COUNTS: DashboardWidgetId[] = ["collectionCount", "modelCount", "authorCount", "categoryCount"];
const countsRow = (y: number) => COUNTS.map((id, index) => one(id, index * 3, y, 3, 2));

/** In the order the template picker shows them. Laid out on the wide 12-column grid. */
export const DASHBOARD_PRESETS: DashboardPreset[] = [
  {
    // The dashboard as it first was: the counts down the left, two columns of lists beside them.
    id: "classic",
    panels: [
      ...COUNTS.map((id, index) => one(id, 0, index * 2, 3, 2)),
      one("topViewed", 3, 0, 5, 5),
      one("topPrinted", 3, 5, 5, 5),
      one("recentlyAdded", 3, 10, 5, 5),
      one("topAuthors", 8, 0, 4, 5),
      one("topProviders", 8, 5, 4, 4),
    ],
  },
  {
    id: "overview",
    panels: [
      ...countsRow(0),
      one("topViewed", 0, 2, 4, 5),
      one("topPrinted", 4, 2, 4, 5),
      one("recentlyAdded", 8, 2, 4, 5),
      one("topAuthors", 0, 7, 6, 5),
      one("topProviders", 6, 7, 6, 4),
    ],
  },
  {
    // The lists gathered into two tabbed panels, so everything fits on one screen.
    id: "compact",
    panels: [
      ...countsRow(0),
      { widgets: ["recentlyAdded", "topViewed", "topPrinted"], x: 0, y: 2, w: 6, h: 5 },
      { widgets: ["topAuthors", "topProviders"], x: 6, y: 2, w: 6, h: 5 },
    ],
  },
  {
    // The old fixed "Puzzle" layout: boxes of every size fitted together with no gaps. The clock, weather and heatmap
    // lead in full-width bands, so the rest packs the same without them.
    id: "puzzle",
    panels: [
      one("clock", 0, 0, 6, 3),
      one("weather", 6, 0, 6, 3),
      one("activityHeatmap", 0, 3, 12, 3),
      one("topViewed", 0, 6, 6, 5),
      one("collectionCount", 6, 6, 4, 2),
      one("modelCount", 10, 6, 2, 2),
      one("recentlyAdded", 6, 8, 6, 5),
      one("authorCount", 0, 11, 2, 2),
      one("categoryCount", 2, 11, 4, 2),
      one("topPrinted", 0, 13, 4, 5),
      one("topAuthors", 4, 13, 4, 5),
      one("topProviders", 8, 13, 4, 5),
    ],
  },
  {
    id: "minimal",
    panels: [
      one("clock", 0, 0, 4, 2),
      one("modelCount", 4, 0, 4, 2),
      one("collectionCount", 8, 0, 4, 2),
      one("recentlyAdded", 0, 2, 6, 5),
      one("topViewed", 6, 2, 6, 5),
    ],
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

export function templateFromPreset(preset: DashboardPreset): DashboardTemplate {
  const panels = preset.panels.map((p) => ({ panel: { id: newId(), widgets: p.widgets } as DashboardPanel, p }));
  return {
    id: newId(),
    name: null,
    preset: preset.id,
    panels: panels.map(({ panel }) => panel),
    layouts: { lg: panels.map(({ panel, p }) => ({ i: panel.id, x: p.x, y: p.y, w: p.w, h: p.h })) },
  };
}

/** Back to the preset it started from, keeping its id and name. */
export function resetTemplate(template: DashboardTemplate): DashboardTemplate {
  const preset = presetById(template.preset);
  return preset ? { ...templateFromPreset(preset), id: template.id, name: template.name } : template;
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
  };
}

// The old dashboard only saved the widgets the user switched; these were off until switched on.
const LEGACY_OFF_BY_DEFAULT = new Set<DashboardWidgetId>(["clock", "weather", "featuredModel", "activityHeatmap"]);

// Which preset stands in for each of the old fixed layouts.
const LEGACY_PRESETS: Record<DashboardLayout, string> = {
  left: "classic",
  right: "classic",
  top: "overview",
  topTwo: "overview",
  bottom: "overview",
  puzzle: "puzzle",
};

/**
 * The first templates: every preset, with the one closest to the user's old layout showing. That one also takes the
 * widgets the user had switched on or off, so their dashboard looks as it did.
 */
export function initialConfig(
  legacy: { layout: DashboardLayout; widgets: DashboardWidgetChoices } = { layout: "left", widgets: {} },
): DashboardConfig {
  const templates = DASHBOARD_PRESETS.map(templateFromPreset);
  const index = templates.findIndex((template) => template.preset === LEGACY_PRESETS[legacy.layout]);
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

export function offerNewPresets(config: DashboardConfig): DashboardConfig {
  const offered = new Set(config.offered ?? UNTRACKED_OFFERED);
  const added = DASHBOARD_PRESETS.filter((preset) => !offered.has(preset.id))
    .slice(0, Math.max(0, MAX_TEMPLATES - config.templates.length))
    .map(templateFromPreset);
  if (!added.length && config.offered) return config;
  return {
    ...config,
    templates: [...config.templates, ...added],
    offered: [...new Set([...offered, ...DASHBOARD_PRESETS.map((preset) => preset.id)])],
  };
}
