import { describe, expect, it } from "vitest";
import type { NestedMenuNode } from "../../components/menus/NestedMenu";
import {
  submenuTree,
  tileLayout,
  type ModelAction,
  type ModelActionGroup,
  type ModelActionId,
} from "./modelMenuLayout";

const LABELS = { open: "Open in", ai: "AI" };
const ICONS = { open: "open-icon", ai: "ai-icon" };

const GROUPS: Record<ModelActionId, ModelActionGroup> = {
  addToCollection: "library",
  removeFromCollection: "library",
  openCopy: "library",
  copy: "library",
  download: "files",
  customize: "files",
  toolOwned: "manage",
  edit: "manage",
  delete: "danger",
  categorize: "ai",
  improve: "ai",
  slicer: "open",
  adapted: "open",
  studio: "open",
  provider: "open",
  link: "source",
  moreFrom: "source",
  fillGaps: "source",
};

const plates = [
  { key: "a", label: "Hull", onSelect: () => undefined },
  { key: "b", label: "Cabin", onSelect: () => undefined },
];

function action(key: ModelActionId, extra: Partial<ModelAction> = {}): ModelAction {
  return { key, group: GROUPS[key], label: `${key} label`, shortLabel: `${key} short`, icon: key, ...extra };
}

/** In useModelActions' order. */
const imported = [
  action("addToCollection"),
  action("download"),
  action("customize"),
  action("edit"),
  action("categorize"),
  action("improve"),
  action("slicer", { picks: plates }),
  action("adapted"),
  action("studio"),
  action("provider"),
  action("fillGaps"),
  action("delete"),
];

const keys = (items: { key: string }[]) => items.map((item) => item.key);

describe("tileLayout", () => {
  it("makes tiles of the four most used, in that order", () => {
    expect(keys(tileLayout(imported, LABELS).tiles)).toEqual(["download", "slicer", "addToCollection", "edit"]);
  });

  it("puts lone rows first, a section per group with several, and Delete last behind a line", () => {
    const { sections } = tileLayout(imported, LABELS);
    expect(sections.map((section) => [section.key, section.heading, keys(section.items), section.divider])).toEqual([
      ["rows", undefined, ["customize", "fillGaps"], undefined],
      ["open", "Open in", ["adapted", "studio", "provider"], undefined],
      ["ai", "AI", ["categorize", "improve"], undefined],
      ["danger", undefined, ["delete"], true],
    ]);
  });

  it("gives a group of one no heading", () => {
    const upload = [action("download"), action("slicer"), action("studio"), action("categorize"), action("delete")];
    const { sections } = tileLayout(upload, LABELS);
    expect(sections.find((section) => section.key === "rows")?.items.map((item) => item.key)).toEqual([
      "studio",
      "categorize",
    ]);
    expect(sections.some((section) => section.heading)).toBe(false);
  });

  it("leaves a disabled action out of the tiles, but not one that's busy", () => {
    const actions = [
      action("download", { busy: true, disabled: true }),
      action("slicer", { disabled: true }),
      action("addToCollection"),
    ];
    const layout = tileLayout(actions, LABELS);
    expect(keys(layout.tiles)).toEqual(["download", "addToCollection"]);
    expect(keys(layout.sections[0].items)).toEqual(["slicer"]);
  });

  it("puts a note after the rows, before Delete", () => {
    const tool = [action("addToCollection"), action("download"), action("toolOwned", { note: true }), action("studio")];
    expect(tileLayout(tool, LABELS).sections.map((section) => [section.key, keys(section.items)])).toEqual([
      ["rows", ["studio"]],
      ["notes", ["toolOwned"]],
    ]);
  });

  it("offers copying a shared model as a tile", () => {
    const shared = [
      action("addToCollection"),
      action("copy"),
      action("download"),
      action("slicer"),
      action("moreFrom"),
    ];
    expect(keys(tileLayout(shared, LABELS).tiles)).toEqual(["download", "slicer", "addToCollection", "copy"]);
  });
});

/** The tree as text: "label", "label ›" with its children, or "—". */
function outline(nodes: NestedMenuNode[]): unknown[] {
  return nodes.map((node) => {
    if (node.kind === "divider") return "—";
    if (node.kind === "submenu") return { [`${node.label} ›`]: outline(node.children) };
    const label = node.short ? (node.action.shortLabel ?? node.action.label) : node.action.label;
    return (node.action.picks?.length ?? 0) > 1 ? `${label} ›` : label;
  });
}

describe("submenuTree", () => {
  it("folds Open in and AI into submenus with short labels, between the everyday actions and Delete", () => {
    expect(outline(submenuTree(imported, LABELS, ICONS))).toEqual([
      "addToCollection label",
      "download label",
      "customize label",
      "edit label",
      "—",
      { "Open in ›": ["slicer short ›", "adapted short", "studio short", "provider short"] },
      { "AI ›": ["categorize short", "improve short"] },
      "fillGaps label",
      "—",
      "delete label",
    ]);
  });

  it("keeps a group of one as a plain row with its full label", () => {
    const upload = [action("download"), action("studio"), action("improve"), action("delete")];
    expect(outline(submenuTree(upload, LABELS, ICONS))).toEqual([
      "download label",
      "—",
      "studio label",
      "improve label",
      "—",
      "delete label",
    ]);
  });

  it("draws no line where a section is empty", () => {
    const tool = [action("addToCollection"), action("download"), action("toolOwned", { note: true })];
    expect(outline(submenuTree(tool, LABELS, ICONS))).toEqual([
      "addToCollection label",
      "download label",
      "toolOwned label",
    ]);
  });
});
