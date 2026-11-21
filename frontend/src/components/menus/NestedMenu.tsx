import { keyframes } from "@emotion/react";
import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MutableRefObject,
  type MouseEvent,
  type PointerEvent,
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
import { hasPicks, type MenuAction, type MenuAnchor } from "./menuAction";
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
    if (hasPicks(action)) {
      return {
        kind: "branch",
        key,
        label: node.short ? (action.shortLabel ?? action.label) : action.label,
        icon: action.icon,
        inert: Boolean(action.disabled || action.busy),
        busy: Boolean(action.busy),
        picks: true,
        children: (action.picks ?? []).map((pick) => ({
          kind: "leaf",
          key: `${key}/${pick.key}`,
          label: pick.label,
          secondary: pick.secondary,
          media: pick.media,
          title: pick.title,
          inert: Boolean(pick.disabled),
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
      inert: Boolean(action.disabled || action.busy || action.note),
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
  subPointerLeave: (depth: number, key: string, event: PointerEvent<HTMLElement>) => void;
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
  "&.Mui-focusVisible": { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: -2 },
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

function LeafRow({ node, depth }: { node: Leaf; depth: number }) {
  const menu = useMenu();
  const { t } = useTranslation("common");
  const link = node.href
    ? {
        component: "a" as const,
        href: node.href,
        ...(node.external && { target: "_blank", rel: "noopener noreferrer" }),
      }
    : {};
  const glyph = node.busy ? <CircularProgress size={18} color="inherit" /> : (node.media ?? node.icon);
  const row = (
    <MenuItem
      {...link}
      data-menu-key={menu.keyAttr(node.key)}
      disabled={node.inert}
      title={node.title}
      onClick={() => menu.run(node)}
      onPointerMove={(event) => menu.rowPointerMove(depth, node, event)}
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
  // A disabled row can't hold a tooltip: it gets no pointer events.
  if (!node.tooltip || node.inert) return row;
  return (
    <Tooltip title={node.tooltip} placement={menu.panels ? "bottom" : "right"} enterDelay={400} arrow describeChild>
      {row}
    </Tooltip>
  );
}

function SubRow({ node, depth }: { node: Branch; depth: number }) {
  const menu = useMenu();
  const expanded = menu.path[depth] === node.key;
  return (
    <MenuItem
      data-menu-key={menu.keyAttr(node.key)}
      disabled={node.inert}
      aria-haspopup="menu"
      aria-expanded={expanded}
      aria-controls={expanded ? menu.menuId(node.key) : undefined}
      // A keyboard press (detail 0) moves focus into the submenu; a click leaves it here.
      onClick={(event) => menu.openSub(depth, node.key, menu.panels || event.detail === 0)}
      onKeyDown={(event) => {
        if (event.key !== "ArrowRight") return;
        event.preventDefault();
        menu.openSub(depth, node.key, true);
      }}
      onPointerMove={(event) => menu.rowPointerMove(depth, node, event)}
      onPointerLeave={(event) => menu.subPointerLeave(depth, node.key, event)}
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
  const [place, setPlace] = useState<{ side: "right" | "left"; top: number } | null>(null);

  // Placed once, as it opens: moving it under the pointer afterwards would be worse than a rare overlap.
  useLayoutEffect(() => {
    const parent = container.current;
    const element = surface.current;
    const row = parent?.querySelector(rowSelector);
    if (!parent || !element || !row) return;
    setPlace(
      placeSubmenu(
        row.getBoundingClientRect(),
        parent.getBoundingClientRect(),
        { width: element.offsetWidth, height: element.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
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
          minWidth: 200,
          maxWidth: 360,
          // Not hidden while it's measured: a submenu opened from the keyboard takes focus as it mounts.
          opacity: place ? undefined : 0,
          animation: place ? `${place.side === "left" ? fromRight : fromLeft} 160ms ease-out` : "none",
          ...NO_MOTION,
        },
        place?.side === "left" ? { right: "calc(100% + 4px)" } : { left: "calc(100% + 4px)" },
        // Many plates scroll; a level that opens further submenus can't, or they'd be cut off.
        branch.picks && { maxHeight: "calc(100vh - 16px)", overflowY: "auto" },
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
        data-menu-level={menu.levelAttr(depth)}
        onKeyDown={(event) => menu.levelKeyDown(depth, event)}
        sx={{ py: 0.75, outline: 0 }}
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
      <Level
        depth={trail.length}
        nodes={level}
        label={current?.label ?? rootLabel}
        id={current ? menu.menuId(current.key) : rootId}
        back={Boolean(current)}
      />
    </Box>
  );
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
  const pending = useRef<Pending | null>(null);
  const grace = useRef<{ depth: number; area: Point[]; until: number } | null>(null);
  const surfaces = useRef<(HTMLElement | null)[]>([]);

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
  }, [open]);
  useEffect(() => () => clearPending(pending), []);

  const keyAttr = (key: string) => `${id}:${key}`;
  const levelAttr = (depth: number) => `${id}:${depth}`;
  const focusRow = useCallback(
    (key: string) =>
      document.querySelector<HTMLElement>(`[data-menu-key="${id}:${key}"]`)?.focus({ preventScroll: true }),
    [id],
  );
  const focusFirst = useCallback(
    (depth: number) =>
      document
        .querySelector(`[data-menu-level="${id}:${depth}"]`)
        ?.querySelector<HTMLElement>("[data-menu-key]:not(.Mui-disabled)")
        ?.focus({ preventScroll: true }),
    [id],
  );

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
    focusWanted.current = focusInside ? { depth: depth + 1 } : null;
    setDirection("forward");
    setPath((current) => [...current.slice(0, depth), key]);
  };

  /** Closes the submenu the row at `depth` opened, and any below it. */
  const closeBelow = (depth: number, focusTrigger: boolean) => {
    cancelPending();
    const trigger = live.current.path[depth];
    if (!trigger) return;
    setDirection("back");
    setPath((current) => current.slice(0, depth));
    if (!focusTrigger) return;
    // A panel comes back when it mounts again; beside, the row is still there.
    if (live.current.panels) focusWanted.current = { depth, key: trigger };
    else focusRow(trigger);
  };

  // Stable, as each level calls it once as it mounts.
  const claimFocus = useCallback(
    (depth: number) => {
      const wanted = focusWanted.current;
      if (wanted && wanted.depth === depth) {
        focusWanted.current = null;
        if (wanted.key) focusRow(wanted.key);
        else focusFirst(depth);
      } else if (depth === 0 && !wanted) {
        focusFirst(0);
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
    }
  };

  const rowPointerMove = (depth: number, node: Leaf | Branch, event: PointerEvent<HTMLElement>) => {
    if (live.current.panels || event.pointerType === "touch") return;
    // Crossing other rows on the way to an open submenu doesn't switch it.
    const area = grace.current;
    if (area && area.depth === depth) {
      if (Date.now() < area.until && insidePolygon({ x: event.clientX, y: event.clientY }, area.area)) return;
      grace.current = null;
    }
    const row = event.currentTarget;
    if (document.activeElement !== row) row.focus({ preventScroll: true });
    const openHere = live.current.path[depth];
    if (node.kind === "branch") {
      if (openHere === node.key) cancelPending();
      else if (!node.inert) schedule(node.key, HOVER_OPEN_MS, () => openSub(depth, node.key, false));
    } else if (openHere) {
      schedule(`close@${depth}`, HOVER_CLOSE_MS, () => closeBelow(depth, false));
    } else {
      cancelPending();
    }
  };

  const subPointerLeave = (depth: number, key: string, event: PointerEvent<HTMLElement>) => {
    if (pending.current?.key === key) cancelPending();
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
    subPointerLeave,
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
        {panels ? (
          <PanelStack nodes={tree} rootId={id} rootLabel={label} />
        ) : (
          <Level depth={0} nodes={tree} label={label} id={id} />
        )}
      </Popover>
    </MenuContext.Provider>
  );
}
