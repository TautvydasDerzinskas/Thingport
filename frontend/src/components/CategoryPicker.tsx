import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { keyframes } from "@emotion/react";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import Popover from "@mui/material/Popover";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import CheckIcon from "@mui/icons-material/Check";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import SearchIcon from "@mui/icons-material/Search";
import type { Category } from "../api/categories";
import {
  ancestorPath,
  buildCategoryTree,
  categorySearchIds,
  flattenCategoryTree,
  foldForSearch,
} from "../utils/categoryTree";
import { translateCategoryDisplay } from "../utils/translateCategoryDisplay";

const rowIn = keyframes`
  from { opacity: 0; transform: translateY(-3px); }
  to { opacity: 1; transform: none; }
`;
const motion = { "@media (prefers-reduced-motion: reduce)": { animation: "none", transition: "none" } } as const;

type Props = {
  /** Of one kind: the tree it picks from. */
  categories: Category[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  disabled?: boolean;
};

/** The name with the part that matched the search picked out. */
function Highlighted({ text, query }: { text: string; query: string }) {
  const folded = foldForSearch(text);
  const needle = foldForSearch(query.trim());
  const at = needle ? folded.indexOf(needle) : -1;
  // Folding a rare letter can change the name's length, and then there's no telling which letters matched.
  if (at < 0 || folded.length !== text.length) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <Box component="span" sx={{ color: "primary.main", fontWeight: 700 }}>
        {text.slice(at, at + needle.length)}
      </Box>
      {text.slice(at + needle.length)}
    </>
  );
}

/** Picks a category from a long tree: a field that opens a filter over the tree, with only the top level showing until
 *  one is opened. A top-level category with others under it is a heading: it opens rather than being picked. */
export default function CategoryPicker({ categories, value, onChange, label, disabled = false }: Props) {
  const { t, i18n } = useTranslation(["models", "common"]);
  const baseId = useId();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  // The arrow keys bring the active row into view; a mouse on it is already looking at it.
  const scrollToActive = useRef(false);
  const filterRef = useRef<HTMLInputElement>(null);

  const tree = useMemo(() => buildCategoryTree(categories), [categories]);
  const nameOf = (category: Category) =>
    translateCategoryDisplay(category, i18n).name || t("models:categories.untitled");
  const hasChildren = (id: string) => Boolean(tree.childrenByParent[id]?.length);
  const canPick = (category: Category, depth: number) => depth > 0 || !hasChildren(category.id);
  const searching = query.trim().length > 0;

  const rows = useMemo(() => {
    if (searching) {
      const kept = categorySearchIds(tree, query, nameOf);
      return flattenCategoryTree(tree).filter(({ category }) => kept.has(category.id));
    }
    const closed = new Set([...tree.byId.keys()].filter((id) => !opened.has(id)));
    return flattenCategoryTree(tree, closed);
    // `nameOf` only changes with the language, which rebuilds everything anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, query, searching, opened]);

  const open = (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) => {
    if (disabled) return;
    setAnchorEl(event.currentTarget);
    setQuery("");
    setActiveId(value || null);
    // The current pick stays in sight: everything above it starts open.
    setOpened(new Set(value && tree.byId.has(value) ? ancestorPath(tree, value).slice(0, -1) : []));
  };
  const close = () => setAnchorEl(null);

  const toggle = (id: string) =>
    setOpened((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const activate = (category: Category, depth: number) => {
    if (canPick(category, depth)) {
      onChange(category.id);
      close();
    } else if (!searching) toggle(category.id);
  };

  // The best match is one Enter away: a name that has what was typed, over one only kept for what's above it.
  useEffect(() => {
    if (!searching) return;
    const needle = foldForSearch(query.trim());
    const pickable = rows.filter(({ category, depth }) => canPick(category, depth));
    const best = pickable.find(({ category }) => foldForSearch(nameOf(category)).includes(needle)) ?? pickable[0];
    scrollToActive.current = true;
    setActiveId(best?.category.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const rowId = (id: string) => `${baseId}-${id}`;
  useEffect(() => {
    if (!scrollToActive.current || !activeId) return;
    scrollToActive.current = false;
    document.getElementById(rowId(activeId))?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, rows]);

  const onFilterKeyDown = (event: KeyboardEvent) => {
    const at = rows.findIndex((row) => row.category.id === activeId);
    const active = rows[at];
    const moveTo = (index: number) => {
      scrollToActive.current = true;
      setActiveId(rows[(index + rows.length) % rows.length]?.category.id ?? null);
    };
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveTo(at + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveTo(at < 0 ? -1 : at - 1);
    } else if (event.key === "Enter" && active) {
      event.preventDefault();
      activate(active.category, active.depth);
    } else if (!searching && active && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
      // Only with nothing typed: otherwise these move the caret in what was.
      event.preventDefault();
      const isOpen = opened.has(active.category.id);
      if (event.key === "ArrowRight") {
        if (!hasChildren(active.category.id)) return;
        if (isOpen) moveTo(at + 1);
        else toggle(active.category.id);
      } else if (isOpen) {
        toggle(active.category.id);
      } else if (active.category.parent_id) {
        scrollToActive.current = true;
        setActiveId(active.category.parent_id);
      }
    }
  };

  const shownValue =
    value && tree.byId.has(value)
      ? ancestorPath(tree, value)
          .map((id) => nameOf(tree.byId.get(id)!))
          .join(" › ")
      : "";
  const listId = `${baseId}-list`;

  return (
    <>
      <TextField
        fullWidth
        label={label}
        value={shownValue}
        disabled={disabled}
        onClick={open}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
            event.preventDefault();
            open(event);
          }
        }}
        slotProps={{
          input: {
            readOnly: true,
            endAdornment: (
              <ArrowDropDownIcon
                sx={{
                  color: disabled ? "action.disabled" : "action.active",
                  transform: anchorEl ? "rotate(180deg)" : "none",
                  transition: "transform 150ms",
                  ...motion,
                }}
              />
            ),
            sx: {
              cursor: disabled ? "default" : "pointer",
              "& input": { cursor: "inherit", textOverflow: "ellipsis" },
            },
          },
          htmlInput: { role: "combobox", "aria-haspopup": "tree", "aria-expanded": Boolean(anchorEl) },
        }}
      />
      <Popover
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={close}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        // Typing filters straight away: focus goes to the filter as it opens, rather than to the popover itself.
        disableAutoFocus
        slotProps={{
          transition: { onEntering: () => filterRef.current?.focus() },
          paper: {
            sx: {
              mt: 0.5,
              width: anchorEl?.offsetWidth,
              maxWidth: "calc(100vw - 32px)",
              maxHeight: "min(380px, 70vh)",
              display: "flex",
              flexDirection: "column",
              borderRadius: "10px",
            },
          },
        }}
      >
        <Box sx={{ p: 1, flexShrink: 0 }}>
          <TextField
            inputRef={filterRef}
            fullWidth
            size="small"
            placeholder={t("models:categoryPicker.filter")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onFilterKeyDown}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              },
              htmlInput: {
                role: "combobox",
                "aria-label": t("models:categoryPicker.filter"),
                "aria-expanded": true,
                "aria-controls": listId,
                "aria-activedescendant": activeId ? rowId(activeId) : undefined,
              },
            }}
          />
        </Box>
        <Box
          id={listId}
          role="tree"
          aria-label={label}
          sx={{ flex: 1, minHeight: 0, overflowY: "auto", px: 0.5, pb: 0.5 }}
        >
          {rows.map(({ category, depth }) => {
            const branch = hasChildren(category.id);
            const isOpen = searching || opened.has(category.id);
            const picked = category.id === value;
            return (
              <Box
                key={category.id}
                id={rowId(category.id)}
                role="treeitem"
                aria-level={depth + 1}
                aria-selected={picked}
                aria-expanded={branch ? isOpen : undefined}
                onClick={() => activate(category, depth)}
                onMouseMove={() => setActiveId(category.id)}
                sx={(theme) => ({
                  display: "flex",
                  alignItems: "center",
                  gap: 0.25,
                  minHeight: 36,
                  pl: 0.25 + depth * 1.75,
                  pr: 1,
                  borderRadius: "8px",
                  cursor: "pointer",
                  bgcolor: picked
                    ? alpha(theme.palette.primary.main, category.id === activeId ? 0.16 : 0.1)
                    : category.id === activeId
                      ? "action.hover"
                      : "transparent",
                  animation: searching ? "none" : `${rowIn} 150ms ease-out`,
                  ...motion,
                })}
              >
                {branch ? (
                  // The row says it opens through aria-expanded, and the arrow keys do it: this is the mouse's way.
                  <IconButton
                    size="small"
                    tabIndex={-1}
                    aria-hidden
                    disabled={searching}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggle(category.id);
                    }}
                    sx={{ p: 0.25, color: "text.secondary" }}
                  >
                    <ChevronRightIcon
                      fontSize="small"
                      sx={{
                        transform: isOpen ? "rotate(90deg)" : "none",
                        transition: "transform 150ms",
                        ...motion,
                      }}
                    />
                  </IconButton>
                ) : (
                  <Box sx={{ width: 24, flexShrink: 0 }} />
                )}
                <Typography
                  variant="body2"
                  noWrap
                  title={nameOf(category)}
                  sx={{ flex: 1, minWidth: 0, fontWeight: picked || depth === 0 ? 600 : 400 }}
                >
                  <Highlighted text={nameOf(category)} query={query} />
                </Typography>
                {picked && <CheckIcon fontSize="small" color="primary" sx={{ flexShrink: 0 }} />}
              </Box>
            );
          })}
          {!rows.length && (
            <Typography variant="body2" color="text.secondary" sx={{ px: 1, py: 1.5, textAlign: "center" }}>
              {t("models:categoryPicker.noMatches", { query: query.trim() })}
            </Typography>
          )}
        </Box>
      </Popover>
    </>
  );
}
