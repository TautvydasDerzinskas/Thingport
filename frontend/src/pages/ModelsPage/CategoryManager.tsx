import { Fragment, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Tooltip from "@mui/material/Tooltip";
import CloseIcon from "@mui/icons-material/Close";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import CheckIcon from "@mui/icons-material/Check";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Category, CategoryKind, CategoryMetaInput } from "../../api/categories";
import { useConfirm } from "../../components/ConfirmProvider";
import { buildCategoryTree, flattenCategoryTree } from "../../utils/categoryTree";
import CategoryMetaDialog from "./CategoryMetaDialog";
import CategoryResetDialog from "./CategoryResetDialog";

// One nesting level. Also how far a row must be dragged sideways to change its level.
const INDENT_PX = 24;
const ACTION_BUTTON_PX = 30;

type Props = {
  /** Only the trees of this kind; it also picks the labels. */
  kind: CategoryKind;
  categories: Category[];
  onCreate: (name: string, parentId: string | null) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onReorder: (categoryIds: string[]) => Promise<void>;
  onMove: (id: string, parentId: string | null, position: number) => Promise<void>;
  onUpdateMeta: (id: string, meta: CategoryMetaInput) => Promise<void>;
  /** Shown only when given: puts the tree back to the starter one. */
  onResetDefaults?: () => Promise<void>;
  /** Turns the reset off: there's nothing for it to change. */
  atDefaults?: boolean;
  onUnauthorized?: () => void;
};

function hasMeta(category: Category): boolean {
  return Boolean(
    category.meta_title ||
    category.meta_description ||
    category.makerworld_cat_ids ||
    category.thingiverse_cat_ids ||
    category.printables_cat_ids ||
    category.myminifactory_cat_ids ||
    category.snapmaker_cat_ids ||
    category.makeronline_cat_ids ||
    category.crealitycloud_cat_ids ||
    category.nexprint_cat_ids ||
    category.thangs_cat_ids ||
    category.cults3d_cat_ids,
  );
}

type FlatItem = { id: string; parentId: string | null; depth: number };
type Projection = { depth: number; parentId: string | null };

/**
 * Where the dragged row would land: its vertical position comes from the row it's over, its level
 * from how far it was dragged sideways, kept within what the neighbours allow. Null when there's
 * no valid level, e.g. above the first top-level category, since dragging never makes a top-level one.
 */
function getProjection(items: FlatItem[], activeId: string, overId: string, offsetX: number): Projection | null {
  const activeIndex = items.findIndex((i) => i.id === activeId);
  const overIndex = items.findIndex((i) => i.id === overId);
  if (activeIndex === -1 || overIndex === -1) return null;
  const newItems = arrayMove(items, activeIndex, overIndex);
  const previous = newItems[overIndex - 1];
  const next = newItems[overIndex + 1];
  const maxDepth = previous ? previous.depth + 1 : 0;
  // Can't slip in above `next` at a shallower level than it: that would steal it as a child.
  const minDepth = Math.max(next ? next.depth : 0, 1);
  if (!previous || maxDepth < minDepth) return null;
  const wanted = items[activeIndex].depth + Math.round(offsetX / INDENT_PX);
  const depth = Math.min(Math.max(wanted, minDepth), maxDepth);

  let parentId: string | null;
  if (depth === previous.depth) parentId = previous.parentId;
  else if (depth > previous.depth) parentId = previous.id;
  else parentId = newItems.slice(0, overIndex).findLast((i) => i.depth === depth)?.parentId ?? null;
  return { depth, parentId };
}

type MoveButtons = { canMoveUp: boolean; canMoveDown: boolean; onMoveUp: () => void; onMoveDown: () => void };

function CategoryRow({
  name,
  depth,
  busy,
  move,
  dragHandle,
  nodeRef,
  style,
  metaTitle,
  metaDescription,
  hasDetails,
  onOpenMeta,
  onAddChild,
  addChildLabel,
  onRename,
  onDelete,
}: {
  name: string;
  depth: number;
  busy: boolean;
  /** Up/down arrows; top-level categories only. */
  move?: MoveButtons;
  /** Subcategories are dragged instead. */
  dragHandle?: ReactNode;
  nodeRef: (node: HTMLElement | null) => void;
  style: CSSProperties;
  metaTitle: string | null;
  metaDescription: string | null;
  hasDetails: boolean;
  onOpenMeta: () => void;
  onAddChild: () => void;
  addChildLabel: string;
  onRename: (name: string) => Promise<void>;
  onDelete: () => void;
}) {
  const { t } = useTranslation(["models", "common"]);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [saving, setSaving] = useState(false);
  const indent = `${depth * INDENT_PX}px`;

  const startEdit = () => {
    setValue(name);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setValue(name);
  };

  const commit = async () => {
    const trimmed = value.trim();
    if (!trimmed || trimmed === name) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onRename(trimmed);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <ListItem ref={nodeRef} style={style} disableGutters sx={{ pl: indent, py: 0.5 }}>
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ width: "100%" }}>
          <TextField
            size="small"
            fullWidth
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") cancelEdit();
            }}
            // oxlint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
          />
          <IconButton size="small" onClick={commit} disabled={saving || !value.trim()}>
            {saving ? <CircularProgress size={16} /> : <CheckIcon fontSize="small" />}
          </IconButton>
          <IconButton size="small" onClick={cancelEdit} disabled={saving}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
      </ListItem>
    );
  }

  const actionCount = move ? 6 : 4;
  return (
    <ListItem
      ref={nodeRef}
      style={style}
      disableGutters
      sx={{ pl: indent, py: 0.5 }}
      secondaryAction={
        <Stack direction="row" spacing={0.25}>
          {move && (
            <>
              <IconButton
                size="small"
                onClick={move.onMoveUp}
                disabled={busy || !move.canMoveUp}
                aria-label={t("common:moveUp") ?? undefined}
              >
                <ArrowUpwardIcon fontSize="small" />
              </IconButton>
              <IconButton
                size="small"
                onClick={move.onMoveDown}
                disabled={busy || !move.canMoveDown}
                aria-label={t("common:moveDown") ?? undefined}
              >
                <ArrowDownwardIcon fontSize="small" />
              </IconButton>
            </>
          )}
          <Tooltip title={addChildLabel}>
            <span>
              <IconButton size="small" onClick={onAddChild} disabled={busy} aria-label={addChildLabel}>
                <AddIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip
            title={
              hasDetails ? (
                <Stack spacing={0.25} sx={{ py: 0.25 }}>
                  {metaTitle && (
                    <Typography variant="caption" fontWeight={700} sx={{ display: "block" }}>
                      {metaTitle}
                    </Typography>
                  )}
                  {metaDescription && (
                    <Typography variant="caption" sx={{ display: "block" }}>
                      {metaDescription}
                    </Typography>
                  )}
                </Stack>
              ) : (
                (t("models:categories.manager.addDetailsTooltip") ?? "")
              )
            }
          >
            <span>
              <IconButton
                size="small"
                onClick={onOpenMeta}
                disabled={busy}
                aria-label={
                  (hasDetails
                    ? t("models:categories.manager.editDetailsTooltip")
                    : t("models:categories.manager.addDetailsTooltip")) ?? undefined
                }
              >
                <InfoOutlinedIcon
                  fontSize="small"
                  sx={{
                    opacity: hasDetails ? 1 : 0.35,
                    color: hasDetails ? "primary.main" : "action.active",
                  }}
                />
              </IconButton>
            </span>
          </Tooltip>
          <IconButton size="small" onClick={startEdit} disabled={busy} aria-label={t("common:rename") ?? undefined}>
            <EditIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" onClick={onDelete} disabled={busy} aria-label={t("common:delete") ?? undefined}>
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Stack>
      }
    >
      {dragHandle}
      <Typography
        variant="body2"
        fontWeight={depth === 0 ? 600 : 400}
        noWrap
        sx={{ pr: `${actionCount * ACTION_BUTTON_PX + 8}px` }}
      >
        {name}
      </Typography>
    </ListItem>
  );
}

function DragHandle({
  setActivatorNodeRef,
  attributes,
  listeners,
}: Pick<ReturnType<typeof useSortable>, "setActivatorNodeRef" | "attributes" | "listeners">) {
  const { t } = useTranslation("models");
  return (
    <Box
      component="span"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-label={t("categories.manager.dragToMove") ?? undefined}
      sx={{
        display: "inline-flex",
        mr: 0.75,
        color: "action.active",
        cursor: "grab",
        touchAction: "none",
        borderRadius: 0.5,
        "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main" },
      }}
    >
      <DragIndicatorIcon fontSize="small" />
    </Box>
  );
}

/** Every row is in the sortable list so the others can be placed around it; only subcategories drag. */
function TreeRow({
  id,
  depth,
  ...rowProps
}: { id: string; depth: number } & Omit<Parameters<typeof CategoryRow>[0], "nodeRef" | "style" | "dragHandle">) {
  const isRoot = depth === 0;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: isRoot,
  });
  return (
    <CategoryRow
      {...rowProps}
      depth={depth}
      nodeRef={setNodeRef}
      // The DragOverlay shows the dragged row; this one stays as a faint placeholder at the projected level.
      style={{ transform: CSS.Translate.toString(transform), transition, opacity: isDragging ? 0.35 : 1 }}
      dragHandle={
        isRoot ? undefined : (
          <DragHandle setActivatorNodeRef={setActivatorNodeRef} attributes={attributes} listeners={listeners} />
        )
      }
    />
  );
}

/** Opened from a row's + button; sits after that category's existing subcategories. */
function InlineAddRow({
  depth,
  busy,
  placeholder,
  onAdd,
  onCancel,
}: {
  depth: number;
  busy: boolean;
  placeholder: string;
  onAdd: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  const submit = async () => {
    const trimmed = value.trim();
    if (trimmed) await onAdd(trimmed);
  };
  return (
    <Stack direction="row" spacing={0.5} alignItems="center" sx={{ pl: `${depth * INDENT_PX}px`, py: 0.5 }}>
      <TextField
        size="small"
        fullWidth
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") onCancel();
        }}
        // oxlint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
      />
      <IconButton size="small" onClick={submit} disabled={busy || !value.trim()}>
        {busy ? <CircularProgress size={16} /> : <CheckIcon fontSize="small" />}
      </IconButton>
      <IconButton size="small" onClick={onCancel} disabled={busy}>
        <CloseIcon fontSize="small" />
      </IconButton>
    </Stack>
  );
}

function AddRow({
  placeholder,
  busy,
  onAdd,
}: {
  placeholder: string;
  busy: boolean;
  onAdd: (name: string) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const submit = async () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    await onAdd(trimmed);
    setValue("");
    setAdding(false);
  };

  if (!adding) {
    return (
      <Button
        size="small"
        startIcon={<AddIcon fontSize="small" />}
        onClick={() => {
          setAdding(true);
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
      >
        {placeholder}
      </Button>
    );
  }

  return (
    <Stack direction="row" spacing={0.5} alignItems="center" sx={{ py: 0.5 }}>
      <TextField
        inputRef={inputRef}
        size="small"
        fullWidth
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") {
            setAdding(false);
            setValue("");
          }
        }}
      />
      <IconButton size="small" onClick={submit} disabled={busy || !value.trim()}>
        {busy ? <CircularProgress size={16} /> : <CheckIcon fontSize="small" />}
      </IconButton>
      <IconButton
        size="small"
        onClick={() => {
          setAdding(false);
          setValue("");
        }}
        disabled={busy}
      >
        <CloseIcon fontSize="small" />
      </IconButton>
    </Stack>
  );
}

/** Add, rename, reorder and nest one kind's trees. Rendered inside the models manager dialog. */
export default function CategoryManager({
  kind,
  categories,
  onCreate,
  onRename,
  onDelete,
  onReorder,
  onMove,
  onUpdateMeta,
  onResetDefaults,
  atDefaults = false,
  onUnauthorized,
}: Props) {
  const { t } = useTranslation(["models", "common"]);
  const confirmDialog = useConfirm();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [metaCategory, setMetaCategory] = useState<Category | null>(null);
  const [addingUnderId, setAddingUnderId] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);

  // A drop shows right away and stays until `categories` is refetched (which happens on failure too).
  const [optimistic, setOptimistic] = useState<{ base: Category[]; list: Category[] } | null>(null);
  const shown = optimistic?.base === categories ? optimistic.list : categories;
  const tree = useMemo(() => buildCategoryTree(shown), [shown]);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [offsetX, setOffsetX] = useState(0);

  // While dragging, the dragged category's subtree is folded into it.
  const flat = useMemo(() => flattenCategoryTree(tree, activeId ? new Set([activeId]) : undefined), [tree, activeId]);
  const items = useMemo<FlatItem[]>(
    () =>
      flat.map(({ category, depth }) => ({
        id: category.id,
        parentId: category.parent_id && tree.byId.has(category.parent_id) ? category.parent_id : null,
        depth,
      })),
    [flat, tree],
  );
  const projection = activeId && overId ? getProjection(items, activeId, overId, offsetX) : null;

  const sensors = useSensors(
    // A few pixels of travel before dragging, so clicks on the handle don't start one.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const untitledLabel = t("models:categories.untitled");
  const labels = kind === "folder" ? "models:folders.manager" : "models:categories.manager";

  const handleDelete = async (category: Category) => {
    const name = category.name || untitledLabel;
    const message = tree.childrenByParent[category.id]?.length
      ? t("models:categories.manager.confirmDeleteCategoryWithSub", { name })
      : t("models:categories.manager.confirmDeleteCategory", { name });
    if (!(await confirmDialog({ message, destructive: true }))) return;
    setBusyId(category.id);
    try {
      await onDelete(category.id);
    } finally {
      setBusyId(null);
    }
  };

  const moveRoot = async (index: number, direction: -1 | 1) => {
    const ids = tree.roots.map((r) => r.id);
    const swapIndex = index + direction;
    if (swapIndex < 0 || swapIndex >= ids.length) return;
    [ids[index], ids[swapIndex]] = [ids[swapIndex], ids[index]];
    setBusyId(ids[swapIndex]);
    try {
      await onReorder(ids);
    } finally {
      setBusyId(null);
    }
  };

  const resetDrag = () => {
    setActiveId(null);
    setOverId(null);
    setOffsetX(0);
  };

  const handleDragStart = ({ active }: DragStartEvent) => {
    setActiveId(String(active.id));
    setOverId(String(active.id));
    setOffsetX(0);
    setAddingUnderId(null);
  };

  const handleDragMove = ({ delta }: DragMoveEvent) => setOffsetX(delta.x);

  const handleDragOver = ({ over }: DragOverEvent) => setOverId(over ? String(over.id) : null);

  const handleDragEnd = async ({ active, over }: DragEndEvent) => {
    const target = projection;
    resetDrag();
    if (!target || !over) return;
    const id = String(active.id);
    const moved = arrayMove(
      items,
      items.findIndex((i) => i.id === id),
      items.findIndex((i) => i.id === over.id),
    );
    const siblingIds = moved
      .filter((i) => (i.id === id ? target.parentId : i.parentId) === target.parentId)
      .map((i) => i.id);
    const position = siblingIds.indexOf(id);

    const original = tree.byId.get(id);
    const originalParentId = original?.parent_id ?? null;
    const sameParent = originalParentId === target.parentId;
    const originalSiblingIds = (originalParentId ? tree.childrenByParent[originalParentId] : tree.roots)?.map(
      (c) => c.id,
    );
    if (sameParent && siblingIds.every((c, i) => c === originalSiblingIds?.[i])) return;

    const list: Category[] = [];
    for (const c of shown) {
      const idx = siblingIds.indexOf(c.id);
      if (c.id === id) list.push({ ...c, parent_id: target.parentId, position });
      else list.push(idx === -1 ? c : { ...c, position: idx });
    }
    setOptimistic({ base: categories, list });
    setBusyId(id);
    try {
      if (sameParent) await onReorder(siblingIds);
      else await onMove(id, target.parentId, position);
    } finally {
      setBusyId(null);
    }
  };

  // The add-subcategory input goes after the category's last descendant.
  const addAfterId = useMemo(() => {
    if (!addingUnderId) return null;
    const start = flat.findIndex((f) => f.category.id === addingUnderId);
    if (start === -1) return null;
    let end = start;
    while (flat[end + 1] && flat[end + 1].depth > flat[start].depth) end += 1;
    return flat[end].category.id;
  }, [flat, addingUnderId]);
  const addingDepth = addingUnderId ? (flat.find((f) => f.category.id === addingUnderId)?.depth ?? 0) + 1 : 0;

  const activeCategory = activeId ? tree.byId.get(activeId) : undefined;

  return (
    <>
      <Box>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          // Folding the dragged subtree shifts the rows below, so keep re-measuring.
          measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={resetDrag}
        >
          <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
            <List disablePadding>
              {flat.map(({ category, depth }) => {
                const rootIndex = depth === 0 ? tree.roots.findIndex((r) => r.id === category.id) : -1;
                return (
                  <Fragment key={category.id}>
                    {rootIndex > 0 && <Box sx={{ height: 12 }} />}
                    <TreeRow
                      id={category.id}
                      depth={category.id === activeId && projection ? projection.depth : depth}
                      name={category.name || untitledLabel}
                      busy={busyId === category.id}
                      move={
                        depth === 0
                          ? {
                              canMoveUp: rootIndex > 0,
                              canMoveDown: rootIndex < tree.roots.length - 1,
                              onMoveUp: () => moveRoot(rootIndex, -1),
                              onMoveDown: () => moveRoot(rootIndex, 1),
                            }
                          : undefined
                      }
                      metaTitle={category.meta_title}
                      metaDescription={category.meta_description}
                      hasDetails={hasMeta(category)}
                      onOpenMeta={() => setMetaCategory(category)}
                      onAddChild={() => setAddingUnderId(category.id)}
                      addChildLabel={t(`${labels}.addSubcategory`)}
                      onRename={(name) => onRename(category.id, name)}
                      onDelete={() => handleDelete(category)}
                    />
                    {addAfterId === category.id && addingUnderId && (
                      <InlineAddRow
                        depth={addingDepth}
                        busy={busyId === `new-sub-${addingUnderId}`}
                        placeholder={t(`${labels}.addSubcategory`)}
                        onCancel={() => setAddingUnderId(null)}
                        onAdd={async (name) => {
                          setBusyId(`new-sub-${addingUnderId}`);
                          try {
                            await onCreate(name, addingUnderId);
                            setAddingUnderId(null);
                          } finally {
                            setBusyId(null);
                          }
                        }}
                      />
                    )}
                  </Fragment>
                );
              })}

              {!tree.roots.length && (
                <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                  {t(`${labels}.noCategories`)}
                </Typography>
              )}
            </List>
          </SortableContext>
          <DragOverlay>
            {activeCategory && (
              <Paper elevation={6} sx={{ display: "flex", alignItems: "center", px: 1, py: 0.75, cursor: "grabbing" }}>
                <DragIndicatorIcon fontSize="small" sx={{ mr: 0.75, color: "action.active" }} />
                <Typography variant="body2" noWrap>
                  {activeCategory.name || untitledLabel}
                </Typography>
              </Paper>
            )}
          </DragOverlay>
        </DndContext>

        <Divider sx={{ my: 1.5 }} />

        <Stack direction="row" spacing={1} alignItems="center">
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <AddRow
              placeholder={t(`${labels}.addCategory`)}
              busy={busyId === "new-root"}
              onAdd={async (name) => {
                setBusyId("new-root");
                try {
                  await onCreate(name, null);
                } finally {
                  setBusyId(null);
                }
              }}
            />
          </Box>
          {onResetDefaults && (
            <Button
              size="small"
              disabled={atDefaults}
              startIcon={<RestartAltIcon fontSize="small" />}
              onClick={() => setResetOpen(true)}
              sx={{ flexShrink: 0 }}
            >
              {t("models:categories.manager.reset")}
            </Button>
          )}
        </Stack>
      </Box>
      {onResetDefaults && (
        <CategoryResetDialog
          open={resetOpen}
          onClose={() => setResetOpen(false)}
          onConfirm={onResetDefaults}
          onUnauthorized={onUnauthorized}
        />
      )}
      {metaCategory && (
        <CategoryMetaDialog
          category={metaCategory}
          showSiteCatIds={kind === "category"}
          onClose={() => setMetaCategory(null)}
          onSave={(meta) => onUpdateMeta(metaCategory.id, meta)}
        />
      )}
    </>
  );
}
