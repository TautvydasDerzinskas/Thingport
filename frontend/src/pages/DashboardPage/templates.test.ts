import { describe, expect, it } from "vitest";
import type { DashboardGridItem, DashboardTemplate, DashboardWidgetId } from "../../api/settings";
import {
  DASHBOARD_PRESETS,
  type DashboardPreset,
  addWidget,
  detachWidget,
  duplicateTemplate,
  firstFit,
  instanceCount,
  removeWidget,
  initialConfig,
  mergePanels,
  offerNewPresets,
  nudgeLayout,
  moveTab,
  moveWidgetToPanel,
  removePanels,
  resolveLayout,
  setLayout,
  setTab,
  setWidgetSettings,
  splitPanel,
  templateFromPreset,
  templateWidgets,
} from "./templates";
import { resolveSettings, widgetById } from "./widgets";

const overlaps = (a: DashboardGridItem, b: DashboardGridItem) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function expectNoOverlap(items: DashboardGridItem[]) {
  const clashes = items.flatMap((a, index) =>
    items.slice(index + 1).flatMap((b) => (overlaps(a, b) ? [`${a.i} / ${b.i}`] : [])),
  );
  expect(clashes).toEqual([]);
}

const one = (id: DashboardWidgetId, x: number, y: number, w: number, h: number) => ({ widgets: [id], x, y, w, h });
const COUNTS: DashboardWidgetId[] = ["collectionCount", "modelCount", "authorCount", "categoryCount"];

// Fixed shapes for the edits below, apart from the shipped presets, which change as the product does.
const FIXTURES: DashboardPreset[] = [
  {
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
    // Boxes of every size fitted together, under full-width bands.
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

const preset = (id: string) =>
  templateFromPreset((FIXTURES.find((p) => p.id === id) ?? DASHBOARD_PRESETS.find((p) => p.id === id))!, true);
const shipped = (id: string, isAdmin = true) =>
  templateFromPreset(
    DASHBOARD_PRESETS.find((p) => p.id === id)!,
    isAdmin,
  );
const panelOf = (template: DashboardTemplate, widget: string) =>
  template.panels.find((panel) => panel.widgets.includes(widget as never))!;

describe("presets", () => {
  it.each(DASHBOARD_PRESETS.map((p) => p.id))("%s fits the wide grid with nothing overlapping", (id) => {
    const template = shipped(id);
    const lg = resolveLayout(template, "lg");
    expectNoOverlap(lg);
    for (const item of lg) expect(item.x + item.w).toBeLessThanOrEqual(12);
    // Laid out exactly as written, with no gaps for the compactor to close and so shuffle the preset.
    const byId = (a: DashboardGridItem, b: DashboardGridItem) => a.i.localeCompare(b.i);
    expect(lg.toSorted(byId)).toEqual(template.layouts.lg!.toSorted(byId));
  });

  it("show each widget at most once, with options only for widgets they show", () => {
    for (const p of DASHBOARD_PRESETS) {
      const widgets = p.panels.flatMap((panel) => panel.widgets);
      expect(new Set(widgets).size).toBe(widgets.length);
      for (const id of Object.keys(p.settings ?? {})) expect(widgets).toContain(id);
    }
  });

  it("come with their widgets' options, each template its own copy", () => {
    const homepage = shipped("homepage");
    expect(homepage.settings?.recentlyAdded).toEqual({ count: "3" });
    const minimal = shipped("minimal");
    expect(minimal.settings?.launcher).toEqual(homepage.settings?.launcher);
    expect(minimal.settings?.launcher).not.toBe(homepage.settings?.launcher);
  });

  it("show everyone else a stand-in for an admin-only widget, in its place", () => {
    const admin = shipped("homepage");
    const homepage = shipped("homepage", false);
    expect(templateWidgets(homepage).has("cpu")).toBe(false);
    const cell = (template: DashboardTemplate, widget: string) =>
      template.layouts.lg!.find((item) => item.i === panelOf(template, widget).id)!;
    expect(cell(homepage, "featuredModel")).toMatchObject({
      ...cell(admin, "cpu"),
      i: panelOf(homepage, "featuredModel").id,
    });
    expect(homepage.panels).toHaveLength(admin.panels.length);
  });
});

describe("resolveLayout", () => {
  it("keeps each panel to its half on the medium grid and stacks them on a phone", () => {
    const template = preset("puzzle");
    const md = resolveLayout(template, "md");
    expectNoOverlap(md);
    const at = (id: string) => md.find((item) => item.i === panelOf(template, id).id)!;
    // The clock and weather stay side by side, and the full-width heatmap spans both halves below them.
    expect(at("clock")).toMatchObject({ x: 0, y: 0, w: 3 });
    expect(at("weather")).toMatchObject({ x: 3, y: 0, w: 3 });
    expect(at("activityHeatmap")).toMatchObject({ x: 0, y: 3, w: 6 });
    // Each box keeps to its side: the top viewed list left, the collections count right.
    expect([at("topViewed").x, at("collectionCount").x]).toEqual([0, 3]);

    const sm = resolveLayout(template, "sm");
    expect(sm.every((item) => item.x === 0 && item.w === 1)).toBe(true);
    // Reading order: the clock, top left, first.
    expect(sm.toSorted((a, b) => a.y - b.y)[0].i).toBe(panelOf(template, "clock").id);
  });

  it("keeps a saved breakpoint and puts panels added since at its bottom", () => {
    let template = preset("minimal");
    const md = resolveLayout(template, "md");
    template = setLayout(template, "md", md);
    // In the template but in no saved layout, as a panel added on another device's breakpoint would be.
    template = { ...template, panels: [...template.panels, { id: "weather-panel", widgets: ["weather"] }] };
    const resolved = resolveLayout(template, "md");
    const weather = resolved.find((item) => item.i === panelOf(template, "weather").id)!;
    expect(weather.y).toBeGreaterThanOrEqual(Math.max(...md.map((item) => item.y + item.h)));
    expectNoOverlap(resolved);
  });
});

describe("panel edits", () => {
  it("merges panels into one tabbed panel where the first of them was, at their largest size", () => {
    const template = preset("classic");
    const viewed = panelOf(template, "topViewed");
    const authors = panelOf(template, "topAuthors");
    const merged = mergePanels(template, new Set([authors.id, viewed.id]));
    expect(merged.panels).toHaveLength(template.panels.length - 1);
    const panel = panelOf(merged, "topAuthors");
    // topViewed is at x 3, topAuthors at x 8 on the same row, so topViewed leads.
    expect(panel.id).toBe(viewed.id);
    expect(panel.widgets).toEqual(["topViewed", "topAuthors"]);
    const item = merged.layouts.lg!.find((cell) => cell.i === panel.id)!;
    expect(item).toMatchObject({ x: 3, y: 0, w: 5, h: 5 });
    expectNoOverlap(resolveLayout(merged, "lg"));
  });

  it("dragging a panel's only widget onto another merges them and shows the new tab", () => {
    const template = preset("classic");
    const target = panelOf(template, "topPrinted");
    const moved = moveWidgetToPanel(template, "clock" as never, target.id);
    expect(moved).toBe(template); // not on this template
    const merged = moveWidgetToPanel(template, "modelCount", target.id);
    expect(merged.panels).toHaveLength(template.panels.length - 1);
    expect(panelOf(merged, "modelCount")).toMatchObject({ id: target.id, tab: 1 });
    expect(merged.layouts.lg!.some((cell) => cell.i === panelOf(template, "modelCount").id)).toBe(false);
  });

  it("detaches and splits tabs back into panels of their own", () => {
    const template = preset("compact");
    const lists = panelOf(template, "topViewed");
    const detached = detachWidget(template, "topViewed");
    expect(panelOf(detached, "topViewed").id).not.toBe(lists.id);
    expect(panelOf(detached, "recentlyAdded").widgets).toEqual(["recentlyAdded", "topPrinted"]);
    const split = splitPanel(template, lists.id);
    expect(split.panels).toHaveLength(template.panels.length + 2);
    expect(panelOf(split, "recentlyAdded").id).toBe(lists.id);
    expectNoOverlap(resolveLayout(split, "lg"));
  });

  it("reorders tabs and keeps the shown tab showing", () => {
    const compact = preset("compact");
    const template = setTab(compact, panelOf(compact, "topPrinted").id, 2);
    const moved = moveTab(template, "topPrinted", 0);
    expect(panelOf(moved, "topPrinted")).toMatchObject({
      widgets: ["topPrinted", "recentlyAdded", "topViewed"],
      tab: 0,
    });
    expect(moveTab(moved, "topViewed", 9).panels).toEqual(moved.panels);
  });

  it("removing panels takes their widgets off and their cells out of every layout", () => {
    let template = preset("overview");
    template = setLayout(template, "md", resolveLayout(template, "md"));
    const gone = panelOf(template, "topAuthors").id;
    const removed = removePanels(template, new Set([gone]));
    expect(templateWidgets(removed).has("topAuthors")).toBe(false);
    expect(removed.layouts.md!.some((cell) => cell.i === gone)).toBe(false);
  });
});

describe("initialConfig", () => {
  it("starts on the preset nearest the old layout, with the user's widget choices", () => {
    const config = initialConfig({ layout: "top", widgets: { clock: true, topProviders: false } }, true);
    const active = config.templates.find((template) => template.id === config.active)!;
    expect(active.preset).toBe("overview");
    expect(templateWidgets(active).has("clock")).toBe(true);
    expect(templateWidgets(active).has("topProviders")).toBe(false);
    // The other presets are left as they come.
    expect(templateWidgets(config.templates.find((t) => t.preset === "classic")!).has("topProviders")).toBe(true);
  });

  it("starts someone who never arranged the old dashboard on the homepage", () => {
    const config = initialConfig(undefined, true);
    expect(config.templates.find((template) => template.id === config.active)!.preset).toBe("homepage");
    expect(config.templates.map((template) => template.preset)).toEqual(DASHBOARD_PRESETS.map((p) => p.id));
  });

  it("puts the old puzzle layout on the homepage, which took its place", () => {
    const config = initialConfig({ layout: "puzzle", widgets: { clock: true, weather: true } }, true);
    const active = config.templates.find((template) => template.id === config.active)!;
    expect(active.preset).toBe("homepage");
    expect(templateWidgets(active).has("clock")).toBe(true);
  });

  it("mirrors the classic preset for counts on the right", () => {
    const config = initialConfig({ layout: "right", widgets: {} }, true);
    const active = config.templates.find((template) => template.id === config.active)!;
    const counts = active.layouts.lg!.find((cell) => cell.i === panelOf(active, "modelCount").id)!;
    expect(counts.x).toBe(9);
  });
});

describe("nudgeLayout", () => {
  const min = { minW: 1, minH: 1 };
  const stack: DashboardGridItem[] = [
    { i: "a", x: 0, y: 0, w: 4, h: 2 },
    { i: "b", x: 0, y: 2, w: 4, h: 3 },
  ];
  const at = (layout: DashboardGridItem[], id: string) => layout.find((item) => item.i === id)!;

  it("swaps a panel with the one below when moved down", () => {
    const moved = nudgeLayout(stack, "a", 0, 1, false, 12, min);
    expect(at(moved, "b").y).toBe(0);
    expect(at(moved, "a").y).toBe(3);
  });

  it("swaps back when moved up", () => {
    const moved = nudgeLayout(nudgeLayout(stack, "a", 0, 1, false, 12, min), "a", 0, -1, false, 12, min);
    expect(at(moved, "a").y).toBe(0);
    expect(at(moved, "b").y).toBe(2);
  });

  it("moves sideways within the grid", () => {
    expect(at(nudgeLayout(stack, "a", 1, 0, false, 12, min), "a").x).toBe(1);
    expect(at(nudgeLayout(stack, "a", -1, 0, false, 12, min), "a").x).toBe(0);
  });

  it("resizes within the minimum and pushes what's below down", () => {
    const taller = nudgeLayout(stack, "a", 0, 1, true, 12, min);
    expect(at(taller, "a").h).toBe(3);
    expect(at(taller, "b").y).toBe(3);
    expect(at(nudgeLayout(stack, "a", -1, 0, true, 12, { minW: 4, minH: 1 }), "a").w).toBe(4);
    expectNoOverlap(taller);
  });
});

describe("offerNewPresets", () => {
  it("adds a built-in added since, once, and leaves deleted ones deleted", () => {
    const config = initialConfig({ layout: "left", widgets: {} }, true);
    // Saved before the homepage existed, with the minimal one deleted.
    const old = {
      active: config.active,
      templates: config.templates.filter((t) => t.preset !== "homepage" && t.preset !== "minimal"),
      offered: ["classic", "overview", "compact", "showcase", "minimal", "puzzle"],
    };
    const updated = offerNewPresets(old, true);
    expect(updated.templates.map((t) => t.preset)).toEqual(["classic", "overview", "compact", "homepage"]);
    // Offered, not switched to: the user stays on the template they had.
    expect(updated.active).toBe(config.active);
    const deleted = { ...updated, templates: updated.templates.filter((t) => t.preset !== "homepage") };
    expect(offerNewPresets(deleted, true)).toBe(deleted);
  });
});

describe("setWidgetSettings", () => {
  it("keeps only what differs from the defaults, and resolves the rest", () => {
    let template = preset("minimal");
    template = setWidgetSettings(template, "clock", { hourCycle: "12", showDate: true, showGreeting: false });
    expect(template.settings).toEqual({ clock: { hourCycle: "12", showGreeting: false } });
    expect(resolveSettings(widgetById("clock")!, template.settings?.clock)).toEqual({
      hourCycle: "12",
      showDate: true,
      showGreeting: false,
    });
    // Back to the defaults leaves nothing stored.
    template = setWidgetSettings(template, "clock", { hourCycle: "24", showDate: true, showGreeting: true });
    expect(template.settings).toEqual({});
  });

  it("go along with a copy of the template, apart from the original's", () => {
    const template = setWidgetSettings(preset("minimal"), "clock", { hourCycle: "12" });
    const copy = duplicateTemplate(template, "Copy");
    expect(copy.settings).toEqual(template.settings);
    expect(copy.settings).not.toBe(template.settings);
  });

  it("falls back to the default for a value no longer offered", () => {
    expect(resolveSettings(widgetById("topViewed")!, { count: "42", showMore: "yes" })).toEqual({
      count: "5",
      showMore: true,
    });
  });
});

describe("list settings", () => {
  it("keeps only web addresses, once each, up to the most a panel takes", () => {
    const rss = widgetById("rss")!;
    const resolved = resolveSettings(rss, {
      feeds: ["https://a.example/feed", "javascript:alert(1)", "https://a.example/feed", "http://192.168.1.5/rss"],
    });
    expect(resolved.feeds).toEqual(["https://a.example/feed", "http://192.168.1.5/rss"]);
    expect(resolveSettings(rss, { feeds: "not a list" }).feeds).toEqual([]);
  });

  it("stores a list only when it isn't the empty default", () => {
    let template = preset("minimal");
    template = setWidgetSettings(template, "uptime", { urls: [], showServer: true });
    expect(template.settings).toEqual({});
    template = setWidgetSettings(template, "uptime", { urls: ["http://nas.local"], showServer: true });
    expect(template.settings).toEqual({ uptime: { urls: ["http://nas.local"] } });
  });
});

describe("firstFit", () => {
  it("fills the highest gap a panel fits, and goes below when none does", () => {
    const items: DashboardGridItem[] = [
      { i: "a", x: 0, y: 0, w: 4, h: 4 },
      { i: "b", x: 8, y: 0, w: 4, h: 2 },
    ];
    expect(firstFit(items, 4, 3, 12)).toEqual({ x: 4, y: 0 });
    expect(firstFit(items, 4, 2, 12)).toEqual({ x: 4, y: 0 });
    expect(firstFit(items, 12, 2, 12)).toEqual({ x: 0, y: 4 });
  });

  it("puts a panel added to a preset in its first gap rather than at the bottom", () => {
    const template = addWidget(preset("minimal"), "rss");
    const lg = resolveLayout(template, "lg");
    const rss = lg.find((cell) => cell.i === panelOf(template, "rss").id)!;
    // Minimal ends at row 7; nothing above has room for a 4-by-5 panel, so it starts there, on the left.
    expect(rss).toMatchObject({ x: 0, y: 7 });
    expectNoOverlap(lg);
  });
});

describe("launcher links", () => {
  it("starts with Thingport and its repository, and keeps only web links with safe icons", () => {
    const launcher = widgetById("launcher")!;
    expect((resolveSettings(launcher, undefined).items as { name: string }[]).map((item) => item.name)).toEqual([
      "Thingport",
      "GitHub",
    ]);
    const items = resolveSettings(launcher, {
      items: [
        { name: "", url: "http://nas.local:5000", icon: "javascript:alert(1)" },
        { name: "Bad", url: "javascript:alert(1)", icon: "" },
        { name: "Printer", url: "http://192.168.1.30", icon: "/icon-192.png" },
      ],
    }).items;
    expect(items).toEqual([
      { name: "nas.local:5000", url: "http://nas.local:5000", icon: "" },
      { name: "Printer", url: "http://192.168.1.30", icon: "/icon-192.png" },
    ]);
  });

  it("stores the list once the user changes it, even to empty", () => {
    let template = preset("minimal");
    const launcher = resolveSettings(widgetById("launcher")!, undefined);
    template = setWidgetSettings(template, "launcher", launcher);
    expect(template.settings).toEqual({});
    template = setWidgetSettings(template, "launcher", { ...launcher, items: [] });
    expect(template.settings).toEqual({ launcher: { items: [] } });
  });
});

describe("widgets added more than once", () => {
  const instancesOf = (template: DashboardTemplate, widget: string) =>
    template.panels.flatMap((panel) => panel.widgets).filter((id) => id.split(":")[0] === widget);

  it("gives each copy of a widget that may repeat its own id and options", () => {
    let template = addWidget(addWidget(preset("minimal"), "rss"), "rss");
    const [first, second] = instancesOf(template, "rss");
    // The first keeps the bare id, so options saved before copies existed still belong to it.
    expect(first).toBe("rss");
    expect(second).toMatch(/^rss:[a-z0-9]+$/);
    expect(instanceCount(template, "rss")).toBe(2);
    template = setWidgetSettings(template, second, { feeds: ["https://b.example/feed"], count: "5", showDates: true });
    expect(template.settings).toEqual({ [second]: { feeds: ["https://b.example/feed"] } });
    expect(resolveSettings(widgetById(first)!, template.settings?.[first]).feeds).toEqual([]);
    expectNoOverlap(resolveLayout(template, "lg"));
  });

  it("still shows a widget that may not repeat only once", () => {
    const template = preset("minimal");
    expect(addWidget(template, "clock")).toBe(template);
  });

  it("drops a removed copy's options, but keeps a single widget's for when it's back", () => {
    let template = addWidget(addWidget(preset("minimal"), "launcher"), "launcher");
    const [, second] = instancesOf(template, "launcher");
    template = setWidgetSettings(template, second, {
      items: [],
      iconStyle: "mono",
      limit: "12",
      search: false,
    });
    template = setWidgetSettings(template, "clock", { hourCycle: "12", showDate: true, showGreeting: true });
    const panel = template.panels.find((p) => p.widgets.includes(second))!;
    template = removePanels(template, new Set([panel.id]));
    expect(template.settings?.[second]).toBeUndefined();
    template = removeWidget(template, "clock");
    expect(template.settings?.clock).toEqual({ hourCycle: "12" });
  });

  it("keeps a copy's id and options when its tab is taken out into a panel of its own", () => {
    let template = addWidget(addWidget(preset("minimal"), "rss"), "rss");
    const [first, second] = instancesOf(template, "rss");
    template = setWidgetSettings(template, second, { feeds: ["https://b.example/feed"], count: "5", showDates: true });
    template = moveWidgetToPanel(template, second, panelOf(template, first).id);
    expect(panelOf(template, first).widgets).toEqual([first, second]);
    template = detachWidget(template, second);
    expect(template.panels.find((p) => p.widgets.includes(second))!.widgets).toEqual([second]);
    expect(template.settings?.[second]).toEqual({ feeds: ["https://b.example/feed"] });
  });
});

describe("splitPanel", () => {
  it("puts the tabs one under another where the panel was, moving what was below down", () => {
    const template: DashboardTemplate = {
      id: "t",
      name: null,
      preset: null,
      panels: [
        { id: "tabs", widgets: ["topViewed", "topPrinted", "recentlyAdded"] },
        { id: "below", widgets: ["clock"] },
        { id: "beside", widgets: ["modelCount"] },
      ],
      layouts: {
        lg: [
          { i: "tabs", x: 0, y: 0, w: 6, h: 5 },
          { i: "below", x: 0, y: 5, w: 6, h: 2 },
          { i: "beside", x: 6, y: 0, w: 3, h: 2 },
        ],
      },
    };
    const split = splitPanel(template, "tabs");
    const lg = resolveLayout(split, "lg");
    const at = (widget: string) => lg.find((item) => item.i === panelOf(split, widget).id)!;
    expect(at("topViewed")).toMatchObject({ x: 0, y: 0, w: 6, h: 5 });
    expect(at("topPrinted")).toMatchObject({ x: 0, y: 5, w: 6, h: 5 });
    expect(at("recentlyAdded")).toMatchObject({ x: 0, y: 10, w: 6, h: 5 });
    expect(at("clock")).toMatchObject({ x: 0, y: 15 });
    expect(at("modelCount")).toMatchObject({ x: 6, y: 0 });
    expectNoOverlap(lg);
  });

  it("gives a tab dragged out on its own the size of the panel it came from", () => {
    const template: DashboardTemplate = {
      id: "t",
      name: null,
      preset: null,
      panels: [{ id: "tabs", widgets: ["topViewed", "clock"] }],
      layouts: { lg: [{ i: "tabs", x: 0, y: 0, w: 3, h: 3 }] },
    };
    const detached = detachWidget(template, "clock");
    const cell = detached.layouts.lg!.find((item) => item.i === panelOf(detached, "clock").id)!;
    expect(cell).toMatchObject({ w: 3, h: 3 });
  });
});

describe("trending providers", () => {
  it("keeps the providers picked, in their order, and never none", () => {
    const trending = widgetById("trending")!;
    expect(resolveSettings(trending, undefined).providers).toEqual(["printables", "makerworld", "thangs"]);
    expect(resolveSettings(trending, { providers: ["thangs", "nope", "printables", "thangs"] }).providers).toEqual([
      "thangs",
      "printables",
    ]);
    expect(resolveSettings(trending, { providers: [] }).providers).toEqual(["printables", "makerworld", "thangs"]);
  });

  it("can be added more than once", () => {
    const template = addWidget(addWidget(preset("minimal"), "trending"), "trending");
    expect(instanceCount(template, "trending")).toBe(2);
  });
});
