import type { ReactNode } from "react";
import type { MenuAction } from "../../components/menus/menuAction";
import type { NestedMenuNode } from "../../components/menus/NestedMenu";
import type { TileMenuSection } from "../../components/menus/TileMenu";

// How a model's actions are laid out: as tiles with sections under them (the model page's header) or as a short menu
// with submenus (a card's "⋯" and right-click). Both take the same actions, in the order useModelActions gives them.

export type ModelActionId =
  | "addToCollection"
  | "removeFromCollection"
  | "openCopy"
  | "copy"
  | "download"
  | "customize"
  | "toolOwned"
  | "edit"
  | "delete"
  | "categorize"
  | "improve"
  | "slicer"
  | "adapted"
  | "studio"
  | "provider"
  | "link"
  | "moreFrom"
  | "fillGaps";

/** What an action is about. "open" and "ai" are the groups that get a heading or a submenu of their own. */
export type ModelActionGroup = "library" | "files" | "manage" | "open" | "ai" | "source" | "danger";

export type ModelAction = MenuAction & { key: ModelActionId; group: ModelActionGroup };

/** The most used first: the first few a model has become tiles. */
const TILE_ORDER: ModelActionId[] = ["download", "slicer", "addToCollection", "edit", "copy", "openCopy", "customize"];
export const MAX_TILES = 4;
/** Rows without a heading come first, so none reads as part of the section above it. */
const LOOSE_ORDER: ModelActionGroup[] = ["library", "files", "manage", "source", "open", "ai"];
const HEADED = ["open", "ai"] as const;

export type GroupLabels = { open: string; ai: string };

/** Tiles for the most used actions, then the rest: lone rows, a section per headed group with 2+, and Delete. */
export function tileLayout(
  actions: ModelAction[],
  labels: GroupLabels,
): { tiles: MenuAction[]; sections: TileMenuSection[] } {
  // A disabled tile would be a big button that does nothing; one that's busy keeps its place.
  const tiles = TILE_ORDER.flatMap((key) =>
    actions.filter((action) => action.key === key && (!action.disabled || action.busy)),
  ).slice(0, MAX_TILES);
  const rest = actions.filter((action) => !tiles.includes(action));
  const inGroup = (group: ModelActionGroup) => rest.filter((action) => action.group === group);
  const headed = HEADED.filter((group) => inGroup(group).length > 1);
  const loose = LOOSE_ORDER.filter((group) => !(headed as ModelActionGroup[]).includes(group)).flatMap(inGroup);
  // Notes say why something's missing, so they sit after what is there.
  const sections: TileMenuSection[] = [
    { key: "rows", items: loose.filter((action) => !action.note) },
    ...headed.map((group) => ({ key: group, heading: labels[group], items: inGroup(group) })),
    { key: "notes", items: loose.filter((action) => action.note) },
    { key: "danger", items: inGroup("danger"), divider: true },
  ];
  return { tiles, sections: sections.filter((section) => section.items.length > 0) };
}

/** A submenu of a group's actions, or the one action, with its full label, when it's alone. */
function folded(key: "open" | "ai", label: string, icon: ReactNode, actions: ModelAction[]): NestedMenuNode[] {
  if (actions.length === 0) return [];
  if (actions.length === 1) return [{ kind: "action", action: actions[0] }];
  return [
    { kind: "submenu", key, label, icon, children: actions.map((action) => ({ kind: "action", action, short: true })) },
  ];
}

/** The everyday actions, then Open in and AI folded into submenus and the source's own, then Delete. */
export function submenuTree(
  actions: ModelAction[],
  labels: GroupLabels,
  icons: { open: ReactNode; ai: ReactNode },
): NestedMenuNode[] {
  const inGroups = (...groups: ModelActionGroup[]) => actions.filter((action) => groups.includes(action.group));
  const sections: NestedMenuNode[][] = [
    inGroups("library", "files", "manage").map((action) => ({ kind: "action", action })),
    [
      ...folded("open", labels.open, icons.open, inGroups("open")),
      ...folded("ai", labels.ai, icons.ai, inGroups("ai")),
      ...inGroups("source").map((action): NestedMenuNode => ({ kind: "action", action })),
    ],
    inGroups("danger").map((action) => ({ kind: "action", action })),
  ];
  const out: NestedMenuNode[] = [];
  for (const section of sections.filter((items) => items.length > 0)) {
    if (out.length > 0) out.push({ kind: "divider", key: `divider-${out.length}` });
    out.push(...section);
  }
  return out;
}
