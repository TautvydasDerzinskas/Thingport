import { keyframes } from "@emotion/react";
import {
  forwardRef,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { useTranslation } from "react-i18next";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import Popover from "@mui/material/Popover";
import Tooltip from "@mui/material/Tooltip";
import useMediaQuery from "@mui/material/useMediaQuery";
import { alpha, type Theme } from "@mui/material/styles";
import { dividerBorderColor, neutralTint, statusTint } from "../../theme";
import { hasPicks, isInert, type MenuAction, type MenuAnchor, type MenuPick } from "./menuAction";
import { tileMenuMove, type TileZone } from "./menuNav";

// A menu that leads with a few big icon tiles for the most used actions, then the rest in short rows, in sections
// with a small heading where a group has several. An action with several picks lists them in place: under the tiles
// in a tray for a tile, under its row for a row.

export type TileMenuSection = {
  key: string;
  /** Said once for its rows, which can then use their short labels. */
  heading?: string;
  items: MenuAction[];
  /** A line above it, as before the destructive ones. */
  divider?: boolean;
};

type Props = {
  open: boolean;
  anchorEl: MenuAnchor;
  /** Opened at a point (a right-click): the menu's corner sits there instead of under the trigger. */
  atPoint?: boolean;
  onClose: () => void;
  /** The menu's id, for the trigger's aria-controls. */
  id: string;
  /** What the menu is, for screen readers. */
  label: string;
  /** What the tiles are, for screen readers. */
  tilesLabel: string;
  tiles: MenuAction[];
  sections: TileMenuSection[];
  onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void;
};

const TILE_GAP = 4;
const WIDTH = 320;

const rise = keyframes`from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; }`;
const drop = keyframes`from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; }`;

const buttonReset = {
  appearance: "none",
  border: 0,
  margin: 0,
  font: "inherit",
  background: "none",
  cursor: "pointer",
  textDecoration: "none",
  WebkitTapHighlightColor: "transparent",
} as const;

const focusRing = (theme: Theme) => ({ outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: -2 });

const visuallyHidden = {
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
} as const;

/** A button, or a link when it has somewhere to go. */
const linkProps = (item: { href?: string; external?: boolean }) =>
  item.href
    ? {
        component: "a" as const,
        href: item.href,
        ...(item.external && { target: "_blank", rel: "noopener noreferrer" }),
      }
    : { component: "button" as const, type: "button" as const };

const picksId = (menuId: string, action: MenuAction) => `${menuId}-${action.key}-picks`;

export default function TileMenu({
  open,
  anchorEl,
  atPoint = false,
  onClose,
  id,
  label,
  tilesLabel,
  tiles,
  sections,
  onContextMenu,
}: Props) {
  const menu = useRef<HTMLDivElement>(null);
  const lastTile = useRef<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)", { noSsr: true });
  const trayAction = tiles.find((tile) => tile.key === expanded && hasPicks(tile));

  const navNodes = () => Array.from(menu.current?.querySelectorAll<HTMLElement>("[data-nav]") ?? []);
  // A right-click elsewhere moves the open menu to a new point without closing it: it starts again there.
  const lastAnchor = useRef(anchorEl);
  useLayoutEffect(() => {
    if (!anchorEl || anchorEl === lastAnchor.current) return;
    lastAnchor.current = anchorEl;
    setExpanded(null);
    lastTile.current = null;
    // Still mounted only when it moved; a menu opening focuses its first item as it enters.
    menu.current?.querySelector<HTMLElement>("[data-nav]")?.focus();
  }, [anchorEl]);
  const choose = (item: MenuAction | MenuPick) => {
    if (isInert(item)) return;
    if (!item.keepOpen) onClose();
    item.onSelect?.();
  };
  const press = (action: MenuAction) => {
    if (isInert(action)) return;
    if (hasPicks(action)) setExpanded((current) => (current === action.key ? null : action.key));
    else choose(action);
  };
  const enterPicks = (key: string) => {
    // Drawn now, so focus can move into them.
    if (expanded !== key) flushSync(() => setExpanded(key));
    menu.current?.querySelector<HTMLElement>(`[data-of="${CSS.escape(key)}"]`)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      event.preventDefault();
      onClose();
      return;
    }
    const current = event.target as HTMLElement;
    // A link only answers Enter; a menu item answers Space too.
    if (event.key === " " && current.tagName === "A") {
      event.preventDefault();
      current.click();
      return;
    }
    const nodes = navNodes();
    const index = nodes.indexOf(current);
    const { key: itemKey, of: parent, expandable } = current.dataset;
    // Left and right move along the tiles; in the column under them they open and close an item's picks.
    if (index >= 0 && nodes[index].dataset.nav !== "tile") {
      if (event.key === "ArrowRight" && itemKey && expandable) {
        event.preventDefault();
        enterPicks(itemKey);
        return;
      }
      if (event.key === "ArrowLeft") {
        if (parent) {
          event.preventDefault();
          menu.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(parent)}"]`)?.focus();
          setExpanded(null);
        } else if (itemKey && expanded === itemKey) {
          event.preventDefault();
          setExpanded(null);
        }
        return;
      }
    }
    if (index >= 0 && nodes[index].dataset.nav === "tile" && (event.key === "ArrowDown" || event.key === "ArrowUp"))
      lastTile.current = itemKey ?? null;
    const zones = nodes.map((node) => (node.dataset.nav === "tile" ? "tile" : "row") as TileZone);
    const returnTile = nodes.findIndex((node) => node.dataset.nav === "tile" && node.dataset.key === lastTile.current);
    const target = tileMenuMove(zones, index, event.key, returnTile);
    if (target === null) return;
    event.preventDefault();
    nodes[target]?.focus();
  };

  const rowsBelow = sections.filter((section) => section.items.length > 0);

  return (
    <Popover
      open={open && anchorEl !== null}
      anchorEl={anchorEl}
      onClose={onClose}
      onContextMenu={onContextMenu}
      anchorOrigin={atPoint ? { vertical: "top", horizontal: "left" } : { vertical: "bottom", horizontal: "right" }}
      transformOrigin={atPoint ? { vertical: "top", horizontal: "left" } : { vertical: "top", horizontal: "right" }}
      transitionDuration={reduceMotion ? 0 : { enter: 200, exit: 150 }}
      slotProps={{
        paper: {
          onKeyDown,
          elevation: 8,
          sx: (theme) => ({
            width: `min(${WIDTH}px, calc(100vw - 32px))`,
            mt: atPoint ? 0 : "4px",
            border: 1,
            borderColor: dividerBorderColor(theme),
            borderRadius: `${Number(theme.shape.borderRadius) + 2}px`,
          }),
        },
        transition: {
          onEntering: () => navNodes()[0]?.focus(),
          onExited: () => {
            setExpanded(null);
            lastTile.current = null;
          },
        },
      }}
    >
      <Box id={id} ref={menu} role="menu" aria-label={label}>
        {tiles.length > 0 && (
          <Box
            // A menu's groups: fieldset is a form's.
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
            role="group"
            aria-label={tilesLabel}
            sx={{
              display: "grid",
              gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))`,
              gap: `${TILE_GAP}px`,
              p: "8px",
            }}
          >
            {tiles.map((action, index) => (
              <Tile
                key={action.key}
                action={action}
                index={index}
                expanded={expanded === action.key}
                controls={picksId(id, action)}
                onPress={press}
              />
            ))}
          </Box>
        )}
        {trayAction && (
          <Tray
            id={picksId(id, trayAction)}
            action={trayAction}
            index={tiles.indexOf(trayAction)}
            count={tiles.length}
            onPick={choose}
          />
        )}
        {rowsBelow.map((section, index) => (
          <Box key={section.key}>
            {(index === 0 ? tiles.length > 0 : section.divider) && <Divider />}
            <Box
              // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
              role="group"
              aria-label={section.heading}
              sx={{ px: "4px", pt: index === 0 || section.divider ? "4px" : 0, pb: "4px" }}
            >
              {section.heading && <Heading>{section.heading}</Heading>}
              {section.items.map((action) =>
                action.note ? (
                  <Note key={action.key} action={action} />
                ) : (
                  <Item
                    key={action.key}
                    action={action}
                    label={section.heading ? (action.shortLabel ?? action.label) : action.label}
                    expanded={expanded === action.key}
                    picksId={picksId(id, action)}
                    onPress={press}
                    onPick={choose}
                  />
                ),
              )}
            </Box>
          </Box>
        ))}
      </Box>
    </Popover>
  );
}

function Glyph({ action }: { action: MenuAction }) {
  return action.busy ? <CircularProgress size={18} color="inherit" /> : <>{action.icon}</>;
}

function Tile({
  action,
  index,
  expanded,
  controls,
  onPress,
}: {
  action: MenuAction;
  index: number;
  expanded: boolean;
  controls: string;
  onPress: (action: MenuAction) => void;
}) {
  const picks = hasPicks(action);
  const { t } = useTranslation("common");
  return (
    <Box
      {...linkProps(action)}
      role="menuitem"
      tabIndex={-1}
      data-nav="tile"
      data-key={action.key}
      data-expandable={(picks && !isInert(action)) || undefined}
      aria-disabled={isInert(action) || undefined}
      aria-expanded={picks ? expanded : undefined}
      aria-controls={picks && expanded ? controls : undefined}
      onClick={(event: MouseEvent) => {
        if (isInert(action)) event.preventDefault();
        onPress(action);
      }}
      sx={(theme) => {
        const dark = theme.palette.mode === "dark";
        return {
          ...buttonReset,
          position: "relative",
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "6px",
          px: "2px",
          pt: "8px",
          pb: "7px",
          borderRadius: "10px",
          color: "text.primary",
          textAlign: "center",
          transition: "background-color 150ms ease, transform 150ms ease",
          // Backwards, not both: a held fill would beat the :active press below.
          animation: `${rise} 180ms ease-out ${index * 20}ms backwards`,
          "& .chip": {
            position: "relative",
            display: "grid",
            placeItems: "center",
            width: 40,
            height: 40,
            borderRadius: "12px",
            bgcolor: alpha(theme.palette.primary.main, dark ? 0.16 : 0.1),
            color: dark ? "primary.main" : "primary.dark",
            transition: "transform 150ms ease, background-color 150ms ease, color 150ms ease",
            "& > svg": { fontSize: 22 },
          },
          "& .more": {
            position: "absolute",
            right: -6,
            bottom: -6,
            display: "grid",
            placeItems: "center",
            width: 18,
            height: 18,
            borderRadius: "50%",
            bgcolor: "background.paper",
            color: "text.secondary",
            boxShadow: `0 0 0 1px ${theme.palette.divider}`,
            transition: "transform 200ms ease",
            "& svg": { fontSize: 16 },
          },
          "& .label": { fontSize: 11.5, lineHeight: 1.25, maxWidth: "100%", overflowWrap: "break-word" },
          "&:hover": { bgcolor: "action.hover" },
          "&:hover .chip": { transform: "translateY(-1px)" },
          "&:active": { transform: "scale(0.96)" },
          "&:focus-visible": focusRing(theme),
          "&[aria-expanded='true']": { bgcolor: "action.hover" },
          "&[aria-expanded='true'] .chip": { bgcolor: "primary.main", color: "primary.contrastText" },
          "&[aria-expanded='true'] .more": { transform: "rotate(180deg)" },
          "&[aria-disabled='true']": { opacity: 0.5, cursor: "default", bgcolor: "transparent", transform: "none" },
          "@media (prefers-reduced-motion: reduce)": {
            animation: "none",
            transition: "none",
            "&:active, &:hover .chip": { transform: "none" },
            "& .chip, & .more": { transition: "none" },
          },
        };
      }}
    >
      <span className="chip">
        <Glyph action={action} />
        {picks && (
          <span className="more" aria-hidden>
            <ExpandMoreIcon />
          </span>
        )}
      </span>
      <span className="label">{action.label}</span>
      {action.external && <Box sx={visuallyHidden}>{t("common:newTab")}</Box>}
    </Box>
  );
}

/** A tile's picks, under the row of tiles, with a notch pointing up at the tile. */
function Tray({
  id,
  action,
  index,
  count,
  onPick,
}: {
  id: string;
  action: MenuAction;
  index: number;
  count: number;
  onPick: (pick: MenuPick) => void;
}) {
  const center = `(100% - ${(count - 1) * TILE_GAP}px) * ${(index + 0.5) / count} + ${index * TILE_GAP}px`;
  return (
    <Box
      id={id}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
      role="group"
      aria-label={action.label}
      sx={(theme) => ({
        position: "relative",
        mx: "8px",
        mb: "8px",
        p: "4px",
        borderRadius: "10px",
        bgcolor: theme.thingport.subnavBackground,
        animation: `${drop} 180ms ease-out`,
        "&::before": {
          content: '""',
          position: "absolute",
          top: -5,
          left: `calc(${center} - 5px)`,
          width: 10,
          height: 10,
          borderRadius: "2px",
          bgcolor: theme.thingport.subnavBackground,
          transform: "rotate(45deg)",
        },
        "@media (prefers-reduced-motion: reduce)": { animation: "none" },
      })}
    >
      <Picks action={action} onPick={onPick} />
    </Box>
  );
}

/** A row and, when it has several picks and is open, the picks under it. */
function Item({
  action,
  label,
  expanded,
  picksId: controls,
  onPress,
  onPick,
}: {
  action: MenuAction;
  label: string;
  expanded: boolean;
  picksId: string;
  onPress: (action: MenuAction) => void;
  onPick: (pick: MenuPick) => void;
}) {
  const row = <Row action={action} label={label} expanded={expanded} controls={controls} onPress={onPress} />;
  return (
    <>
      {action.tooltip ? (
        <Tooltip title={action.tooltip} placement="left" enterDelay={400} arrow describeChild>
          {row}
        </Tooltip>
      ) : (
        row
      )}
      {expanded && hasPicks(action) && (
        <Box
          id={controls}
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
          role="group"
          aria-label={action.label}
          sx={(theme) => ({
            // Under the label: the row's padding, icon and gap, less the guide line.
            ml: "34px",
            mr: "4px",
            mb: "2px",
            pl: "4px",
            borderLeft: `2px solid ${theme.palette.divider}`,
            animation: `${drop} 180ms ease-out`,
            "@media (prefers-reduced-motion: reduce)": { animation: "none" },
          })}
        >
          <Picks action={action} onPick={onPick} />
        </Box>
      )}
    </>
  );
}

type RowProps = {
  action: MenuAction;
  label: string;
  expanded: boolean;
  controls: string;
  onPress: (action: MenuAction) => void;
} & Omit<HTMLAttributes<HTMLElement>, "color" | "onClick">;

// Forwards the props and ref a Tooltip hands its child.
const Row = forwardRef<HTMLElement, RowProps>(function Row(
  { action, label, expanded, controls, onPress, ...rest },
  ref,
) {
  const picks = hasPicks(action);
  const { t } = useTranslation("common");
  return (
    <Box
      {...rest}
      {...linkProps(action)}
      ref={ref}
      role="menuitem"
      tabIndex={-1}
      data-nav="row"
      data-key={action.key}
      data-expandable={(picks && !isInert(action)) || undefined}
      aria-disabled={isInert(action) || undefined}
      aria-expanded={picks ? expanded : undefined}
      aria-controls={picks && expanded ? controls : undefined}
      onClick={(event: MouseEvent) => {
        if (isInert(action)) event.preventDefault();
        onPress(action);
      }}
      sx={(theme) => {
        const error = action.tone === "error";
        const warning = action.tone === "warning";
        return {
          ...buttonReset,
          display: "flex",
          alignItems: "center",
          gap: "10px",
          width: "100%",
          minHeight: 32,
          px: "10px",
          py: "6px",
          borderRadius: "6px",
          color: error ? "error.main" : warning ? statusTint(theme, "warning").text : "text.primary",
          fontSize: 13,
          lineHeight: 1.4,
          textAlign: "left",
          transition: "background-color 150ms ease",
          "& > .glyph": {
            display: "grid",
            placeItems: "center",
            width: 18,
            flexShrink: 0,
            color: error ? "error.main" : warning ? "warning.main" : "action.active",
            "& svg": { fontSize: 18 },
          },
          "& .chevron": { fontSize: 18, transition: "transform 200ms ease" },
          "&:hover": { bgcolor: error ? alpha(theme.palette.error.main, 0.08) : "action.hover" },
          "&:focus-visible": focusRing(theme),
          "&[aria-expanded='true'] .chevron": { transform: "rotate(180deg)" },
          "&[aria-disabled='true']": { opacity: 0.5, cursor: "default", bgcolor: "transparent" },
          "@media (pointer: coarse)": { minHeight: 42 },
          "@media (prefers-reduced-motion: reduce)": { transition: "none", "& .chevron": { transition: "none" } },
        };
      }}
    >
      <span className="glyph">
        <Glyph action={action} />
      </span>
      <Box component="span" sx={{ flex: 1, minWidth: 0 }}>
        {label}
        {action.secondary && (
          <Box component="span" sx={{ display: "block", color: "text.secondary", fontSize: 11.5 }}>
            {action.secondary}
          </Box>
        )}
        {action.external && (
          <Box component="span" sx={visuallyHidden}>
            {t("common:newTab")}
          </Box>
        )}
      </Box>
      {picks && (
        <Box
          component="span"
          aria-hidden
          sx={{ display: "flex", alignItems: "center", gap: "2px", color: "text.secondary", fontSize: 11.5 }}
        >
          {action.picks?.length}
          <ExpandMoreIcon className="chevron" />
        </Box>
      )}
    </Box>
  );
});

function Picks({ action, onPick }: { action: MenuAction; onPick: (pick: MenuPick) => void }) {
  return (
    <>
      {action.picks?.map((pick) => (
        <PickRow key={pick.key} action={action} pick={pick} onPick={onPick} />
      ))}
    </>
  );
}

function PickRow({ action, pick, onPick }: { action: MenuAction; pick: MenuPick; onPick: (pick: MenuPick) => void }) {
  // Its action going busy while its picks are open stops them too.
  const inert = isInert(action) || Boolean(pick.disabled);
  const row = (
    <Box
      {...linkProps(pick)}
      role="menuitem"
      tabIndex={-1}
      title={pick.title}
      data-nav="pick"
      data-of={action.key}
      aria-disabled={inert || undefined}
      onClick={(event: MouseEvent) => {
        if (inert) event.preventDefault();
        else onPick(pick);
      }}
      sx={(theme) => ({
        ...buttonReset,
        display: "flex",
        alignItems: "center",
        gap: "10px",
        width: "100%",
        minHeight: 36,
        px: "6px",
        py: "4px",
        borderRadius: "6px",
        color: "text.primary",
        textAlign: "left",
        transition: "background-color 150ms ease",
        "&:hover": { bgcolor: "action.hover" },
        "&:focus-visible": focusRing(theme),
        "&[aria-disabled='true']": { opacity: 0.5, cursor: "default", bgcolor: "transparent" },
        "@media (pointer: coarse)": { minHeight: 44 },
        "@media (prefers-reduced-motion: reduce)": { transition: "none" },
      })}
    >
      {pick.media}
      <Box component="span" sx={{ flex: 1, minWidth: 0 }}>
        <Box
          component="span"
          sx={{
            display: "block",
            fontSize: 12.5,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {pick.label}
        </Box>
        {pick.secondary && (
          <Box
            component="span"
            sx={{
              display: "block",
              color: "text.secondary",
              fontSize: 11,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {pick.secondary}
          </Box>
        )}
      </Box>
    </Box>
  );
  return pick.tooltip ? (
    <Tooltip title={inert ? "" : pick.tooltip} placement="left" enterDelay={400} arrow describeChild>
      {row}
    </Tooltip>
  ) : (
    row
  );
}

function Heading({ children }: { children: ReactNode }) {
  return (
    <Box
      aria-hidden
      sx={{
        px: "10px",
        pt: "6px",
        pb: "2px",
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: "0.08em",
        lineHeight: 1.6,
        textTransform: "uppercase",
        color: "text.secondary",
        userSelect: "none",
      }}
    >
      {children}
    </Box>
  );
}

/** Focusable so a screen reader reaches it, but it does nothing. */
function Note({ action }: { action: MenuAction }) {
  return (
    <Box
      role="menuitem"
      aria-disabled="true"
      tabIndex={-1}
      data-nav="row"
      sx={(theme) => ({
        display: "flex",
        alignItems: "flex-start",
        gap: "10px",
        m: "2px",
        px: "10px",
        py: "8px",
        borderRadius: "8px",
        bgcolor: neutralTint(theme),
        color: "text.secondary",
        fontSize: 12,
        lineHeight: 1.4,
        outline: "none",
        "& > .glyph": { display: "grid", mt: "1px", flexShrink: 0, "& svg": { fontSize: 16 } },
        "&:focus-visible": focusRing(theme),
      })}
    >
      <span className="glyph">{action.icon}</span>
      <span>
        <Box component="span" sx={{ display: "block", color: "text.primary", fontWeight: 600 }}>
          {action.label}
        </Box>
        {action.secondary}
      </span>
    </Box>
  );
}
