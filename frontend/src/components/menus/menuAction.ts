import type { ReactNode } from "react";

/** What a menu opens at: an element, or a bare point for one opened by right-click. */
export type MenuAnchor = HTMLElement | { nodeType: 1; getBoundingClientRect: () => DOMRect } | null;

/** One of an action's several targets, such as the plate a slicer opens. */
export type MenuPick = {
  key: string;
  label: string;
  secondary?: string;
  /** A thumbnail before the label. */
  media?: ReactNode;
  /** The full name, on hover, for a label cut short. */
  title?: string;
  /** Explains the pick on hover, where its action's explanation doesn't hold for every pick. */
  tooltip?: ReactNode;
  disabled?: boolean;
  href?: string;
  /** Leaves the menu open: the action closes it itself once it's done. */
  keepOpen?: boolean;
  onSelect: () => void;
};

/** An item of TileMenu or NestedMenu. Choosing one closes the menu, then runs `onSelect`. */
export type MenuAction = {
  key: string;
  label: string;
  /** For where a heading already says the rest: "OrcaSlicer" under "Open in". */
  shortLabel?: string;
  /** An icon element; the menu sizes it. */
  icon: ReactNode;
  secondary?: string;
  disabled?: boolean;
  /** Working: a spinner instead of the icon, and it can't be chosen again yet. */
  busy?: boolean;
  tone?: "error" | "warning";
  href?: string;
  /** Opens another site, in a new tab. */
  external?: boolean;
  /** Leaves the menu open: the action closes it itself once it's done. */
  keepOpen?: boolean;
  /** Explains the action on hover. */
  tooltip?: ReactNode;
  /** A disabled item that only says why something is missing, drawn as a note. */
  note?: boolean;
  /** Two or more: choosing the action lists them, and choosing one runs it. */
  picks?: MenuPick[];
  onSelect?: () => void;
};

export const hasPicks = (action: MenuAction) => (action.picks?.length ?? 0) > 1;

/** Whether choosing it does anything. */
export const isInert = (item: { disabled?: boolean; busy?: boolean; note?: boolean }) =>
  Boolean(item.disabled || item.busy || item.note);
