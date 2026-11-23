import { keyframes } from "@emotion/react";
import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MutableRefObject,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import MenuItem from "@mui/material/MenuItem";
import MenuList from "@mui/material/MenuList";
import Paper from "@mui/material/Paper";
import Popover from "@mui/material/Popover";
import Tooltip from "@mui/material/Tooltip";
import useMediaQuery from "@mui/material/useMediaQuery";
import { alpha, type Theme } from "@mui/material/styles";
import { dividerBorderColor, statusTint } from "../../theme";
import { hasPicks, isInert, type MenuAction, type MenuAnchor } from "./menuAction";
import { insidePolygon, placeSubmenu, safeArea, type Point } from "./menuNav";

// A menu whose groups open as submenus beside it: after a short hover or at once on a click, kept open while the
// pointer crosses other rows on its way there. On a phone or a touch screen a submenu slides in where the menu is,
// with a row back. An action with several picks (a slicer's plates) is a submenu of them.

export type NestedMenuNode =
  /** `short`: under a submenu that says the rest, so its short label. */
  | { kind: "action"; action: MenuAction; short?: boolean }
  | { kind: "submenu"; key: string; label: string; icon: ReactNode; children: NestedMenuNode[] }
  | { kind: "divider"; key: string };

type Props = {
  open: boolean;
  anchorEl: MenuAnchor;
  /** Opened at a point (a right-click): the menu's corner sits there instead of under the trigger. */
  atPoint?: boolean;
  onClose: () => void;
  /** The top level's id, for the trigger's aria-controls. */
  id: string;
  /** What the menu is, for screen readers. */
  label: string;
  nodes: NestedMenuNode[];
  onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void;
};

const HOVER_OPEN_MS = 110;
const HOVER_CLOSE_MS = 180;
const GRACE_MS = 400;
const SUBMENU_MIN = 200;
const SUBMENU_MAX = 360;
const PANELS_QUERY = "(max-width: 599.95px), (hover: none)";

type Leaf = {
  kind: "leaf";
  key: string;
  label: string;
  secondary?: string;
  icon?: ReactNode;
  /** A pick's thumbnail. */
  media?: ReactNode;
  title?: string;
  inert: boolean;
  busy: boolean;
  tone?: MenuAction["tone"];
  href?: string;
  external?: boolean;
  keepOpen?: boolean;
  tooltip?: ReactNode;
  onSelect?: () => void;
};
type Branch = {
  kind: "branch";
  key: string;
  label: string;
  icon: ReactNode;
  children: Node[];
  inert: boolean;
  busy: boolean;
  tooltip?: ReactNode;
  /** Its rows are an action's picks: counted on the row, and scrolled when there are many. */
  picks: boolean;
};
type Node = Leaf | Branch | { kind: "divider"; key: string };

function toNodes(nodes: NestedMenuNode[], parent = ""): Node[] {
  return nodes.map((node): Node => {
    if (node.kind === "divider") return { ...node, key: `${parent}${node.key}` };
    if (node.kind === "submenu") {
      const key = `${parent}${node.key}`;
      return {
        kind: "branch",
        key,
        label: node.label,
        icon: node.icon,
        children: toNodes(node.children, `${key}/`),
        inert: false,
        busy: false,
        picks: false,
      };
    }
    const { action } = node;
    const key = `${parent}${action.key}`;
    const inert = isInert(action);
    if (hasPicks(action)) {
      return {
        kind: "branch",
        key,
        label: node.short ? (action.shortLabel ?? action.label) : action.label,
        icon: action.icon,
        inert,
        busy: Boolean(action.busy),
        tooltip: action.tooltip,
        picks: true,
        children: (action.picks ?? []).map((pick) => ({
          kind: "leaf",
          key: `${key}/${pick.key}`,
          label: pick.label,
          secondary: pick.secondary,
          media: pick.media,
          title: pick.title,
          tooltip: pick.tooltip,
          // Its action going busy while its picks are open stops them too.
          inert: inert || Boolean(pick.disabled),
          busy: false,
          href: pick.href,
          keepOpen: pick.keepOpen,
          onSelect: pick.onSelect,
        })),
      };
    }
    return {
      kind: "leaf",
      key,
      label: node.short ? (action.shortLabel ?? action.label) : action.label,
      secondary: action.secondary,
      icon: action.icon,
      inert,
      busy: Boolean(action.busy),
      tone: action.tone,
      href: action.href,
      external: action.external,
      keepOpen: action.keepOpen,
      tooltip: action.tooltip,
      onSelect: action.onSelect,
    };
  });
}

type MenuApi = {
  /** Touch or a narrow screen: a submenu replaces the menu instead of opening beside it. */
  panels: boolean;
  /** The open submenus' keys, from the top level down. */
  path: string[];
  direction: "none" | "forward" | "back";
  menuId: (key: string) => string;
  keyAttr: (key: string) => string;
  levelAttr: (depth: number) => string;
  run: (leaf: Leaf) => void;
  openSub: (depth: number, key: string, focusInside: boolean) => void;
  closeBelow: (depth: number, focusTrigger: boolean) => void;
  claimFocus: (depth: number) => void;
  levelKeyDown: (depth: number, event: KeyboardEvent<HTMLElement>) => void;
  rowPointerMove: (depth: number, node: Leaf | Branch, event: PointerEvent<HTMLElement>) => void;
  rowPointerLeave: (depth: number, key: string, event: PointerEvent<HTMLElement>) => void;
  enterSubmenu: () => void;
  registerSurface: (depth: number, element: HTMLElement | null) => void;
};

const MenuContext = createContext<MenuApi | null>(null);

function useMenu(): MenuApi {
  const api = useContext(MenuContext);
  if (!api) throw new Error("A menu row outside its menu");
  return api;
}

const fromRight = keyframes`from { opacity: 0; transform: translateX(6px); } to { opacity: 1; transform: none; }`;
const fromLeft = keyframes`from { opacity: 0; transform: translateX(-6px); } to { opacity: 1; transform: none; }`;
const panelForward = keyframes`from { opacity: 0; transform: translateX(28px); } to { opacity: 1; transform: none; }`;
const panelBack = keyframes`from { opacity: 0; transform: translateX(-28px); } to { opacity: 1; transform: none; }`;
const NO_MOTION = { "@media (prefers-reduced-motion: reduce)": { animation: "none" } };

const visuallyHidden = {
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
} as const;

const surfaceSx = (theme: Theme) => ({ border: 1, borderColor: dividerBorderColor(theme) });

const rowSx = (theme: Theme) => ({
  mx: 0.75,
  px: 1.25,
  borderRadius: "6px",
  minHeight: 34,
  gap: 0,
  "& .MuiListItemIcon-root": { minWidth: 32, color: "action.active" },
  // A disabled row can take focus too, so a note is read, but MUI gives it no focus-visible class.
  "&.Mui-focusVisible, &.Mui-disabled:focus-visible": {
    outline: `2px solid ${theme.palette.primary.main}`,
    outlineOffset: -2,
  },
  "@media (pointer: coarse)": { minHeight: 44 },
});

/** A row whose submenu is open, so the way back to it stays lit. */
const expandedSx = (theme: Theme) => ({
  bgcolor: alpha(theme.palette.primary.main, 0.12),
  "&:hover": { bgcolor: alpha(theme.palette.primary.main, 0.16) },
  "& .chevron": { color: "primary.main" },
});

const toneSx = (tone: MenuAction["tone"]) => (theme: Theme) => {
  if (tone === "error") return { color: "error.main", "& .MuiListItemIcon-root": { color: "error.main" } };
  if (tone === "warning")
    return { color: statusTint(theme, "warning").text, "& .MuiListItemIcon-root": { color: "warning.main" } };
  return {};
};

function RowTooltip({ node, children }: { node: Leaf | Branch; children: ReactElement }) {
  const { panels } = useMenu();
  if (!node.tooltip) return children;
  // Keep the same row mounted while it is preparing, so keyboard focus stays on it.
  return (
    <Tooltip
      title={node.inert ? "" : node.tooltip}
      placement={panels ? "bottom" : "right"}
      enterDelay={400}
      arrow
      describeChild
      disableHoverListener={node.inert}
      disableFocusListener={node.inert}
      disableTouchListener={node.inert}
    >
      {children}
    </Tooltip>
  );
}

function LeafRow({ node, depth }: { node: Leaf; depth: number }) {
  const menu = useMenu();
  const { t } = useTranslation("common");
  // Still an anchor while inert, so a focused row stays mounted, but with nowhere to go: a middle click follows an href.
  const link = node.href
    ? {
        component: "a" as const,
        ...(!node.inert && {
          href: node.href,
          ...(node.external && { target: "_blank", rel: "noopener noreferrer" }),
        }),
      }
    : {};
  const glyph = node.busy ? <CircularProgress size={18} color="inherit" /> : (node.media ?? node.icon);
  const row = (
    <MenuItem
      {...link}
      data-menu-key={menu.keyAttr(node.key)}
      disabled={node.inert}
      title={node.title}
      onClick={(event) => {
        // Focusable while disabled, so a link's Enter still lands here: it mustn't go anywhere.
        if (node.inert) event.preventDefault();
        menu.run(node);
      }}
      onPointerMove={(event) => menu.rowPointerMove(depth, node, event)}
      onPointerLeave={(event) => menu.rowPointerLeave(depth, node.key, event)}
      sx={[rowSx, toneSx(node.tone), Boolean(node.media) && { py: 0.5 }]}
    >
      {glyph && <ListItemIcon sx={node.media ? { minWidth: "40px !important" } : undefined}>{glyph}</ListItemIcon>}
      <ListItemText
        primary={node.label}
        secondary={node.secondary}
        slotProps={
          node.media
            ? {
                primary: { variant: "body2", noWrap: true },
                secondary: { variant: "caption", noWrap: true, sx: { display: "block" } },
              }
            : { secondary: { variant: "caption", sx: { display: "block" } } }
        }
      />
      {node.external && (
        <Box component="span" sx={visuallyHidden}>
          {t("common:newTab")}
        </Box>
      )}
    </MenuItem>
  );
  return <RowTooltip node={node}>{row}</RowTooltip>;
}

function SubRow({ node, depth }: { node: Branch; depth: number }) {
  const menu = useMenu();
  const expanded = menu.path[depth] === node.key;
  const row = (
    <MenuItem
      data-menu-key={menu.keyAttr(node.key)}
      disabled={node.inert}
      aria-haspopup="menu"
      aria-expanded={expanded}
      aria-controls={expanded ? menu.menuId(node.key) : undefined}
      // A keyboard press (detail 0) moves focus into the submenu; a click leaves it here. MUI still clicks a focused
      // disabled row on Space.
      onClick={(event) => !node.inert && menu.openSub(depth, node.key, menu.panels || event.detail === 0)}
      onKeyDown={(event) => {
        if (node.inert || event.key !== "ArrowRight") return;
        event.preventDefault();
        menu.openSub(depth, node.key, true);
      }}
      onPointerMove={(event) => menu.rowPointerMove(depth, node, event)}
      onPointerLeave={(event) => menu.rowPointerLeave(depth, node.key, event)}
      sx={[rowSx, expanded && !menu.panels && expandedSx]}
    >
      <ListItemIcon>{node.busy ? <CircularProgress size={18} color="inherit" /> : node.icon}</ListItemIcon>
      <ListItemText primary={node.label} />
      {node.picks && (
        <Box component="span" aria-hidden sx={{ ml: 2, color: "text.secondary", fontSize: 12 }}>
          {node.children.length}
        </Box>
      )}
      <ChevronRightIcon
        className="chevron"
        fontSize="small"
        sx={{ ml: node.picks ? 0.25 : 2, mr: -0.5, color: "text.secondary" }}
      />
    </MenuItem>
  );
  return <RowTooltip node={node}>{row}</RowTooltip>;
}

/** A submenu beside its row, on the side with room. */
function Submenu({
  branch,
  depth,
  container,
  rowSelector,
}: {
  branch: Branch;
  depth: number;
  /** The level it opens from. */
  container: RefObject<HTMLElement>;
  /** Its row in that level. */
  rowSelector: string;
}) {
  const menu = useMenu();
  const surface = useRef<HTMLDivElement | null>(null);
  const [place, setPlace] = useState<ReturnType<typeof placeSubmenu> | null>(null);

  // Reposition for viewport changes, after the parent paper moves and when it changes size (narrowed to the room
  // there, its rows wrap). Hovering alone keeps the position stable.
  useLayoutEffect(() => {
    const parent = container.current;
    const element = surface.current;
    const row = parent?.querySelector(rowSelector);
    if (!parent || !element || !row) return;
    const measure = () => {
      const rowBox = row.getBoundingClientRect();
      const parentBox = parent.getBoundingClientRect();
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const fit = (room: number) => {
        element.style.minWidth = `${Math.min(SUBMENU_MIN, room)}px`;
        element.style.maxWidth = `${Math.min(SUBMENU_MAX, room)}px`;
      };
      // The side goes by its own width, not one it was narrowed to before; the height by the width it gets there.
      fit(Infinity);
      const width = element.offsetWidth;
      const { room } = placeSubmenu(rowBox, parentBox, { width, height: element.offsetHeight }, viewport);
      fit(room);
      const next = placeSubmenu(rowBox, parentBox, { width, height: element.offsetHeight }, viewport);
      element.style.minWidth = "";
      element.style.maxWidth = "";
      setPlace((current) =>
        current?.side === next.side && current.top === next.top && current.room === next.room ? current : next,
      );
    };
    let frame = 0;
    const scheduleMeasure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const paper = parent.closest(".MuiPaper-root");
    const observer = new MutationObserver(scheduleMeasure);
    if (paper) observer.observe(paper, { attributes: true, attributeFilter: ["style", "class"] });
    const resized = new ResizeObserver(scheduleMeasure);
    resized.observe(element);
    window.addEventListener("resize", scheduleMeasure);
    measure();
    return () => {
      observer.disconnect();
      resized.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
      cancelAnimationFrame(frame);
    };
  }, [container, rowSelector]);

  return (
    <Paper
      ref={(element: HTMLDivElement | null) => {
        surface.current = element;
        menu.registerSurface(depth + 1, element);
      }}
      elevation={8}
      onPointerEnter={menu.enterSubmenu}
      sx={[
        surfaceSx,
        {
          position: "absolute",
          zIndex: 1,
          top: place?.top ?? 0,
          width: "max-content",
          // Measured at its own width first; where neither side has that much room, narrowed to fit the roomier.
          minWidth: Math.min(SUBMENU_MIN, place?.room ?? SUBMENU_MIN),
          maxWidth: Math.min(SUBMENU_MAX, place?.room ?? SUBMENU_MAX),
          // Rows wrap to that width rather than spill out of it; a pick's file name is cut short instead.
          "& .MuiMenuItem-root": { whiteSpace: "normal" },
          // Not hidden while it's measured: a submenu opened from the keyboard takes focus as it mounts.
          opacity: place ? undefined : 0,
          animation: place ? `${place.side === "left" ? fromRight : fromLeft} 160ms ease-out` : "none",
          ...NO_MOTION,
        },
        place?.side === "left" ? { right: "calc(100% + 4px)" } : { left: "calc(100% + 4px)" },
      ]}
    >
      <Level depth={depth + 1} nodes={branch.children} label={branch.label} id={menu.menuId(branch.key)} />
    </Paper>
  );
}

function Level({
  depth,
  nodes,
  label,
  id,
  back = false,
}: {
  depth: number;
  nodes: Node[];
  label: string;
  id: string;
  /** Starts with a "‹ label" row that goes back up, as panels do. */
  back?: boolean;
}) {
  const menu = useMenu();
  const { claimFocus } = menu;
  const { t } = useTranslation("common");
  const box = useRef<HTMLDivElement>(null);
  const openKey = menu.panels ? undefined : menu.path[depth];
  const openBranch = nodes.find((node): node is Branch => node.kind === "branch" && node.key === openKey);
  // As it mounts: a level opened from the keyboard takes focus, one opened by the pointer leaves it.
  useEffect(() => claimFocus(depth), [claimFocus, depth]);

  return (
    <Box ref={box} sx={{ position: "relative" }}>
      <MenuList
        id={id}
        aria-label={label}
        variant="menu"
        // Arrows stop on disabled rows too, as on the tile menu: a note says why something is missing.
        disabledItemsFocusable
        data-menu-level={menu.levelAttr(depth)}
        onKeyDown={(event) => menu.levelKeyDown(depth, event)}
        onScroll={openBranch ? () => menu.closeBelow(depth, false) : undefined}
        sx={{
          py: 0.75,
          outline: 0,
          // The submenu is a sibling of the list so scrolling the list does not clip it.
          ...(!menu.panels && { maxHeight: "calc(100dvh - 34px)", overflowY: "auto" }),
        }}
      >
        {back && [
          <MenuItem
            key="back"
            data-menu-key={menu.keyAttr(`back@${depth}`)}
            aria-label={t("common:backTo", { name: label })}
            onClick={() => menu.closeBelow(depth - 1, true)}
            sx={[rowSx, { "& .MuiListItemText-primary": { fontWeight: 600 } }]}
          >
            <ListItemIcon>
              <ChevronLeftIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary={label} />
          </MenuItem>,
          <Divider key="back-divider" />,
        ]}
        {nodes.map((node) =>
          node.kind === "divider" ? (
            <Divider key={node.key} />
          ) : node.kind === "branch" ? (
            <SubRow key={node.key} node={node} depth={depth} />
          ) : (
            <LeafRow key={node.key} node={node} depth={depth} />
          ),
        )}
      </MenuList>
      {openBranch && (
        <Submenu
          key={openBranch.key}
          branch={openBranch}
          depth={depth}
          container={box}
          rowSelector={`[data-menu-key="${menu.keyAttr(openBranch.key)}"]`}
        />
      )}
    </Box>
  );
}

/** Touch and narrow screens: one level at a time, sliding in where the menu is. */
function PanelStack({ nodes, rootId, rootLabel }: { nodes: Node[]; rootId: string; rootLabel: string }) {
  const menu = useMenu();
  const trail: Branch[] = [];
  let level = nodes;
  for (const key of menu.path) {
    const sub = level.find((node): node is Branch => node.kind === "branch" && node.key === key);
    if (!sub) break;
    trail.push(sub);
    level = sub.children;
  }
  const current = trail[trail.length - 1];
  const slide = menu.direction === "forward" ? panelForward : menu.direction === "back" ? panelBack : null;
  return (
    <Box
      key={current?.key ?? "root"}
      sx={{ animation: slide ? `${slide} 200ms cubic-bezier(0.2, 0, 0, 1)` : "none", ...NO_MOTION }}
    >
      {/* Whichever level is shown has the top level's id: it's the one menu the trigger controls. */}
      <Level
        depth={trail.length}
        nodes={level}
        label={current?.label ?? rootLabel}
        id={rootId}
        back={Boolean(current)}
      />
    </Box>
  );
}

/** Scrolls the row's own list, and nothing else, just enough to show it. */
function reveal(row: HTMLElement) {
  const list = row.closest<HTMLElement>("[data-menu-level]");
  if (!list) return;
  const box = list.getBoundingClientRect();
  const at = row.getBoundingClientRect();
  if (at.top < box.top) list.scrollTop -= box.top - at.top;
  else if (at.bottom > box.bottom) list.scrollTop += at.bottom - box.bottom;
}

type Pending = { key: string; timer: number };

function clearPending(pending: MutableRefObject<Pending | null>) {
  if (pending.current) window.clearTimeout(pending.current.timer);
  pending.current = null;
}

export default function NestedMenu({
  open,
  anchorEl,
  atPoint = false,
  onClose,
  id,
  label,
  nodes,
  onContextMenu,
}: Props) {
  const tree = toNodes(nodes);
  const panels = useMediaQuery(PANELS_QUERY, { noSsr: true });
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)", { noSsr: true });
  const [path, setPath] = useState<string[]>([]);
  const [direction, setDirection] = useState<MenuApi["direction"]>("none");
  // For timers and handlers that outlive the render they were made in.
  const live = useRef({ path, panels });
  useLayoutEffect(() => {
    live.current = { path, panels };
  });
  const focusWanted = useRef<{ depth: number; key?: string } | null>(null);
  const paper = useRef<HTMLDivElement>(null);
  const pending = useRef<Pending | null>(null);
  const grace = useRef<{ depth: number; area: Point[]; until: number } | null>(null);
  const surfaces = useRef<(HTMLElement | null)[]>([]);
  /** The last row focused, as its data-menu-key. */
  const lastFocused = useRef<string | null>(null);

  const cancelPending = () => clearPending(pending);
  /** Runs `action` after `delay`, unless something else is scheduled first; the same key doesn't restart it. */
  const schedule = (key: string, delay: number, action: () => void) => {
    if (pending.current?.key === key) return;
    cancelPending();
    const timer = window.setTimeout(() => {
      pending.current = null;
      action();
    }, delay);
    pending.current = { key, timer };
  };
  useEffect(() => {
    if (open) return;
    clearPending(pending);
    grace.current = null;
    focusWanted.current = null;
    lastFocused.current = null;
  }, [open]);
  useEffect(() => () => clearPending(pending), []);

  const keyAttr = (key: string) => `${id}:${key}`;
  const levelAttr = (depth: number) => `${id}:${depth}`;
  const focusRow = useCallback(
    (key: string) =>
      document
        .querySelector<HTMLElement>(`[data-menu-key="${id}:${key}"]`)
        ?.focus({ preventScroll: !live.current.panels }),
    [id],
  );
  /** Its first row that can be chosen, else its first: a level of disabled rows still takes focus. */
  const focusFirst = useCallback(
    (depth: number) => {
      const level = document.querySelector(`[data-menu-level="${id}:${depth}"]`);
      const row =
        level?.querySelector<HTMLElement>("[data-menu-key]:not(.Mui-disabled)") ??
        level?.querySelector<HTMLElement>("[data-menu-key]");
      if (!row) return;
      row.focus({ preventScroll: true });
      // A submenu entered again may be scrolled down its list.
      reveal(row);
    },
    [id],
  );
  /** The trigger row if it can be seen, else the first row of that level that can, without scrolling. */
  const focusSeen = (depth: number, trigger: string) => {
    const list = document.querySelector<HTMLElement>(`[data-menu-level="${id}:${depth}"]`);
    if (!list) return;
    const box = list.getBoundingClientRect();
    const seen = (row: HTMLElement) => {
      const at = row.getBoundingClientRect();
      return at.top >= box.top - 1 && at.bottom <= box.bottom + 1;
    };
    const rows = Array.from(list.querySelectorAll<HTMLElement>("[data-menu-key]"));
    const own = rows.find((row) => row.getAttribute("data-menu-key") === `${id}:${trigger}`);
    (own && seen(own) ? own : (rows.find(seen) ?? own))?.focus({ preventScroll: true });
  };

  // A right-click elsewhere moves the open menu to a new point without closing it: it starts again there.
  const lastAnchor = useRef(anchorEl);
  useLayoutEffect(() => {
    if (!anchorEl || anchorEl === lastAnchor.current) return;
    lastAnchor.current = anchorEl;
    clearPending(pending);
    grace.current = null;
    focusWanted.current = null;
    setPath([]);
    setDirection("none");
    // Still mounted only when it moved; a menu opening focuses its first row as it mounts.
    focusFirst(0);
  }, [anchorEl, focusFirst]);

  // Crossing the narrow-screen width swaps the layout and drops the focused row: the new layout's levels take focus
  // back as they mount, on the same row if the open level has it, else on its first.
  const shownPanels = useRef(panels);
  useLayoutEffect(() => {
    if (shownPanels.current === panels) return;
    shownPanels.current = panels;
    // A hover's timer would open its branch in the new layout, its row gone, without a click or a key.
    clearPending(pending);
    grace.current = null;
    const root = paper.current;
    if (!open || !root) return;
    let depth = live.current.path.length;
    while (depth > 0 && !root.querySelector(`[data-menu-level="${id}:${depth}"]`)) depth--;
    const row = lastFocused.current;
    const same =
      row !== null && root.querySelector(`[data-menu-level="${id}:${depth}"] [data-menu-key="${CSS.escape(row)}"]`);
    focusWanted.current = { depth, key: same ? row.slice(id.length + 1) : undefined };
  }, [panels, open, id]);

  const closeAll = () => {
    cancelPending();
    grace.current = null;
    onClose();
  };

  const openSub = (depth: number, key: string, focusInside: boolean) => {
    cancelPending();
    if (live.current.path[depth] === key) {
      if (focusInside) focusFirst(depth + 1);
      return;
    }
    // The way to the submenu it replaces no longer leads anywhere.
    grace.current = null;
    focusWanted.current = focusInside ? { depth: depth + 1 } : null;
    setDirection("forward");
    setPath((current) => [...current.slice(0, depth), key]);
  };

  /** Closes the submenu the row at `depth` opened, and any below it. */
  const closeBelow = (depth: number, focusTrigger: boolean) => {
    cancelPending();
    const trigger = live.current.path[depth];
    if (!trigger) return;
    // Focus in what closes, as when scrolling the list closes it, comes back to this level instead of the paper.
    const focusInside = surfaces.current.slice(depth + 1).some((surface) => surface?.contains(document.activeElement));
    grace.current = null;
    setDirection("back");
    setPath((current) => current.slice(0, depth));
    if (!focusTrigger && !focusInside) return;
    // A panel comes back when it mounts again; beside, the row is still there.
    if (live.current.panels) focusWanted.current = { depth, key: trigger };
    else if (focusTrigger) focusRow(trigger);
    else focusSeen(depth, trigger);
  };

  // Stable, as each level calls it once as it mounts.
  const claimFocus = useCallback(
    (depth: number) => {
      const wanted = focusWanted.current;
      if (wanted && wanted.depth === depth) {
        focusWanted.current = null;
        if (wanted.key) focusRow(wanted.key);
        else {
          if (live.current.panels && paper.current) paper.current.scrollTop = 0;
          focusFirst(depth);
        }
      } else if (depth === 0 && !wanted) {
        // A new layout's submenu mounts, and takes focus back, before the top level does.
        const focused = document.activeElement;
        if (!(focused?.hasAttribute("data-menu-key") && paper.current?.contains(focused))) focusFirst(0);
      }
    },
    [focusRow, focusFirst],
  );

  const levelKeyDown = (depth: number, event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Tab") {
      event.preventDefault();
      closeAll();
    } else if (depth > 0 && (event.key === "Escape" || event.key === "ArrowLeft")) {
      // Back one level; the top level's Escape is the popover's, and closes it all.
      event.preventDefault();
      event.stopPropagation();
      closeBelow(depth - 1, true);
    } else if (event.key === " " && !event.defaultPrevented && event.target instanceof HTMLAnchorElement) {
      // A link only answers Enter, and MUI leaves it so; a menu item answers Space too.
      event.preventDefault();
      event.target.click();
    }
  };

  const hoverRow = (depth: number, node: Leaf | Branch, row: HTMLElement, delay?: number) => {
    if (document.activeElement !== row) row.focus({ preventScroll: true });
    const openHere = live.current.path[depth];
    if (node.kind === "branch") {
      if (openHere === node.key) cancelPending();
      else if (!node.inert) schedule(node.key, delay ?? HOVER_OPEN_MS, () => openSub(depth, node.key, false));
    } else if (openHere) {
      schedule(`close@${node.key}`, delay ?? HOVER_CLOSE_MS, () => closeBelow(depth, false));
    } else {
      cancelPending();
    }
  };

  const rowPointerMove = (depth: number, node: Leaf | Branch, event: PointerEvent<HTMLElement>) => {
    if (live.current.panels || event.pointerType === "touch") return;
    const row = event.currentTarget;
    // Give the pointer time to reach the submenu. A stationary pointer is rechecked when that time runs out.
    const area = grace.current;
    if (area && area.depth === depth) {
      const remaining = area.until - Date.now();
      if (remaining > 0 && insidePolygon({ x: event.clientX, y: event.clientY }, area.area)) {
        schedule(`grace@${node.key}`, remaining, () => {
          if (grace.current !== area || !row.isConnected || live.current.panels) return;
          grace.current = null;
          hoverRow(depth, node, row, 0);
        });
        return;
      }
      grace.current = null;
    }
    hoverRow(depth, node, row);
  };

  const rowPointerLeave = (depth: number, key: string, event: PointerEvent<HTMLElement>) => {
    if ([key, `grace@${key}`, `close@${key}`].includes(pending.current?.key ?? "")) cancelPending();
    const submenu = surfaces.current[depth + 1];
    if (live.current.panels || event.pointerType === "touch" || !submenu || live.current.path[depth] !== key) return;
    grace.current = {
      depth,
      until: Date.now() + GRACE_MS,
      area: safeArea({ x: event.clientX, y: event.clientY }, submenu.getBoundingClientRect()),
    };
  };

  const enterSubmenu = () => {
    cancelPending();
    grace.current = null;
  };

  const run = (leaf: Leaf) => {
    if (leaf.inert) return;
    if (!leaf.keepOpen) closeAll();
    leaf.onSelect?.();
  };

  const api: MenuApi = {
    panels,
    path,
    direction,
    menuId: (key) => `${id}-${key.replace(/[^\w-]/g, "-")}`,
    keyAttr,
    levelAttr,
    run,
    openSub,
    closeBelow,
    claimFocus,
    levelKeyDown,
    rowPointerMove,
    rowPointerLeave,
    enterSubmenu,
    registerSurface: (depth, element) => {
      surfaces.current[depth] = element;
    },
  };

  return (
    // Rebuilt each render on purpose: rows act on the latest path.
    // oxlint-disable-next-line react/jsx-no-constructed-context-values
    <MenuContext.Provider value={api}>
      <Popover
        open={open && anchorEl !== null}
        anchorEl={anchorEl}
        onClose={onClose}
        onContextMenu={onContextMenu}
        anchorOrigin={atPoint ? { vertical: "top", horizontal: "left" } : { vertical: "bottom", horizontal: "right" }}
        transformOrigin={atPoint ? { vertical: "top", horizontal: "left" } : { vertical: "top", horizontal: "right" }}
        transitionDuration={reducedMotion ? 0 : { enter: 200, exit: 140 }}
        slotProps={{
          paper: {
            ref: paper,
            elevation: 8,
            sx: [
              surfaceSx,
              { mt: atPoint ? 0 : "4px" },
              panels
                ? { width: "min(288px, calc(100vw - 32px))", overflowX: "hidden", overflowY: "auto" }
                : // Submenus hang outside it.
                  { minWidth: 220, overflow: "visible", maxHeight: "none" },
            ],
          },
          transition: {
            onExited: () => {
              setPath([]);
              setDirection("none");
            },
          },
        }}
      >
        {/* Here, not on the paper: the popover's focus trap puts its own onFocus there. */}
        <Box
          onFocus={(event: FocusEvent<HTMLDivElement>) => {
            const row = event.target.getAttribute("data-menu-key");
            if (row) lastFocused.current = row;
          }}
        >
          {panels ? (
            <PanelStack nodes={tree} rootId={id} rootLabel={label} />
          ) : (
            <Level depth={0} nodes={tree} label={label} id={id} />
          )}
        </Box>
      </Popover>
    </MenuContext.Provider>
  );
}
