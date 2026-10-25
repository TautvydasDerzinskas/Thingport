import { afterEach, describe, expect, it } from "vitest";
import type { DashboardWidgetId } from "../../api/settings";
import type { CustomWidget } from "../../api/widgets";
import { addWidget, emptyTemplate, panelMinSize, resolveLayout } from "./templates";
import { allWidgets, isCustomInstance, registerCustomWidgets, resolveSettings, widgetById } from "./widgets";

const widget = (overrides: Partial<CustomWidget> = {}): CustomWidget => ({
  id: "abc123",
  source: "own",
  slug: "printer",
  manifest: {
    name: "Printer",
    description: "",
    version: "1.0.0",
    size: { w: 3, h: 2, minW: 2, minH: 2 },
    settings: [
      { key: "url", type: "text", label: "Address", default: "http://octopi.local" },
      { key: "token", type: "text", label: "Token", secret: true },
      { key: "jobs", type: "number", label: "Jobs", default: 5 },
      { key: "temps", type: "toggle", label: "Temperatures", default: true },
      {
        key: "refresh",
        type: "choice",
        label: "Refresh",
        options: [
          { value: "10", label: "10 s" },
          { value: "30", label: "30 s" },
        ],
      },
    ],
    hosts: ["octopi.local"],
  },
  script: "export default () => {}",
  html: null,
  sha: "sha",
  updatedAt: "2026-10-22T00:00:00Z",
  ...overrides,
});

const ID = "custom-abc123" as DashboardWidgetId;

afterEach(() => registerCustomWidgets([]));

describe("custom widgets", () => {
  it("become widget types of their own once registered", () => {
    expect(widgetById(ID)).toBeUndefined();
    registerCustomWidgets([widget()]);
    const registered = widgetById(ID)!;
    expect(registered.label).toBe("Printer");
    expect(registered.multiple).toBe(true);
    expect(registered.size).toEqual({ w: 3, h: 2, minW: 2, minH: 2 });
    expect(allWidgets()).toContain(registered);
    expect(isCustomInstance(`${ID}:x1`)).toBe(true);
    expect(isCustomInstance("clock")).toBe(false);
  });

  it("are replaced, not added to, when registered again", () => {
    registerCustomWidgets([widget()]);
    registerCustomWidgets([widget({ id: "other" })]);
    expect(widgetById(ID)).toBeUndefined();
    expect(widgetById("custom-other" as DashboardWidgetId)).toBeDefined();
  });

  it("fill in their settings' defaults, with numbers as text", () => {
    registerCustomWidgets([widget()]);
    const registered = widgetById(ID)!;
    expect(resolveSettings(registered, undefined)).toEqual({
      url: "http://octopi.local",
      token: "",
      jobs: "5",
      temps: true,
      refresh: "10",
    });
    expect(resolveSettings(registered, { url: "http://printer.lan", jobs: 7, refresh: "60" })).toMatchObject({
      url: "http://printer.lan",
      jobs: "7",
      // An option the widget no longer offers falls back to its default.
      refresh: "10",
    });
  });

  it("are placed at their own size, and can be added more than once", () => {
    registerCustomWidgets([widget()]);
    const once = addWidget(emptyTemplate("Mine"), ID);
    const twice = addWidget(once, ID);
    expect(twice.panels.flatMap((panel) => panel.widgets)).toEqual([ID, expect.stringMatching(/^custom-abc123:/)]);
    expect(resolveLayout(once, "lg")[0]).toMatchObject({ w: 3, h: 2 });
    expect(panelMinSize(once.panels[0])).toEqual({ minW: 2, minH: 2 });
  });
});
