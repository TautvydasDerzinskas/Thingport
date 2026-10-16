import React from "react";
import { useTranslation } from "react-i18next";
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import type { StorageToken } from "../../api/settings";

// Tokens that make a folder of their own; {filename} and {plate} belong to the file name.
const FOLDER_TOKENS: StorageToken[] = ["category-or-folder", "collection", "creator", "tags", "model", "id"];
const FILE_NAMES = ["{filename}", "{plate} - {filename}"];
const SINGLE_TOKEN_RE = /^\{([a-z-]+)\}$/;

type Props = {
  template: string;
  onChange: (template: string) => void;
  disabled?: boolean;
};

function split(template: string): { folders: string[]; file: string } {
  const segments = template.split("/").filter(Boolean);
  return { folders: segments.slice(0, -1), file: segments[segments.length - 1] ?? "{filename}" };
}

/** The storage template as folders to add, drop and drag into order, and a file name; the rules it must follow
 *  are checked by the server, so this one only makes the usual layouts easy to build. */
export default function StorageTemplateBuilder({ template, onChange, disabled }: Props) {
  const { t } = useTranslation("app");
  const { folders, file } = split(template);
  const [addAnchor, setAddAnchor] = React.useState<HTMLElement | null>(null);
  // Index of the folder whose text is being edited; folders.length for a new one.
  const [editing, setEditing] = React.useState<number | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  // Index-based: the same text can appear twice while being fixed.
  const ids = folders.map((folder, index) => `${index}:${folder}`);
  const emit = (nextFolders: string[], nextFile = file) => onChange([...nextFolders, nextFile].join("/"));
  const label = (segment: string) => {
    const token = SINGLE_TOKEN_RE.exec(segment)?.[1];
    return token ? t(`adminSettings.storage.tokenNames.${token}`, { defaultValue: segment }) : segment;
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    emit(arrayMove(folders, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))));
  };

  const unused = FOLDER_TOKENS.filter((token) => !template.includes(`{${token}}`));

  return (
    <Stack spacing={1.5}>
      <Box>
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.75 }}>
          {t("adminSettings.storage.pathLabel")}
        </Typography>
        <Stack direction="row" alignItems="center" flexWrap="wrap" useFlexGap sx={{ gap: 0.5 }}>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
              {folders.map((folder, index) => (
                <FolderChip
                  key={ids[index]}
                  id={ids[index]}
                  label={label(folder)}
                  custom={!SINGLE_TOKEN_RE.test(folder)}
                  disabled={disabled}
                  onEdit={() => setEditing(index)}
                  onDelete={() => emit(folders.filter((_, i) => i !== index))}
                />
              ))}
            </SortableContext>
          </DndContext>
          <Button
            size="small"
            startIcon={<AddIcon fontSize="small" />}
            onClick={(event) => setAddAnchor(event.currentTarget)}
            disabled={disabled}
          >
            {t("adminSettings.storage.addFolder")}
          </Button>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ ml: 0.5, maxWidth: "100%", minWidth: 0 }}>
            <InsertDriveFileOutlinedIcon fontSize="small" color="action" />
            <TextField
              select
              size="small"
              label={t("adminSettings.storage.fileNameLabel")}
              value={file}
              onChange={(event) => emit(folders, event.target.value)}
              disabled={disabled}
              sx={{ width: 240, maxWidth: "calc(100% - 28px)" }}
            >
              {FILE_NAMES.map((value) => (
                <MenuItem key={value} value={value}>
                  {t(
                    value === "{filename}"
                      ? "adminSettings.storage.fileNamePlain"
                      : "adminSettings.storage.fileNamePlate",
                  )}
                </MenuItem>
              ))}
              {/* Typed as text: shown as it is, to keep or replace. */}
              {!FILE_NAMES.includes(file) && (
                <MenuItem value={file} sx={{ fontFamily: "monospace" }}>
                  {file}
                </MenuItem>
              )}
            </TextField>
          </Stack>
        </Stack>
      </Box>

      <Menu anchorEl={addAnchor} open={Boolean(addAnchor)} onClose={() => setAddAnchor(null)}>
        {unused.map((token) => (
          <MenuItem
            key={token}
            onClick={() => {
              setAddAnchor(null);
              emit([...folders, `{${token}}`]);
            }}
            sx={{ maxWidth: 420, whiteSpace: "normal" }}
          >
            <ListItemText
              primary={t(`adminSettings.storage.tokenNames.${token}`)}
              secondary={t(`adminSettings.storage.tokens.${token}`)}
            />
          </MenuItem>
        ))}
        {unused.length > 0 && <Divider />}
        <MenuItem
          onClick={() => {
            setAddAnchor(null);
            setEditing(folders.length);
          }}
        >
          <ListItemText primary={t("adminSettings.storage.customFolder")} />
        </MenuItem>
      </Menu>

      {editing !== null && (
        <FolderTextDialog
          initial={folders[editing] ?? ""}
          onClose={() => setEditing(null)}
          onSave={(text) => {
            const next = [...folders];
            next[editing] = text;
            emit(next);
            setEditing(null);
          }}
        />
      )}
    </Stack>
  );
}

type FolderChipProps = {
  id: string;
  label: string;
  custom: boolean;
  disabled?: boolean;
  onEdit: () => void;
  onDelete: () => void;
};

function FolderChip({ id, label, custom, disabled, onEdit, onDelete }: FolderChipProps) {
  const { t } = useTranslation("app");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  return (
    <Stack
      direction="row"
      alignItems="center"
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      sx={{ zIndex: isDragging ? 1 : undefined }}
    >
      <Chip
        icon={<FolderOutlinedIcon fontSize="small" />}
        label={label}
        variant={custom ? "outlined" : "filled"}
        onClick={custom ? onEdit : undefined}
        onDelete={disabled ? undefined : onDelete}
        sx={{
          cursor: disabled ? "default" : "grab",
          fontFamily: custom ? "monospace" : undefined,
          boxShadow: isDragging ? 3 : undefined,
        }}
        title={t("adminSettings.storage.dragToReorder")}
        {...attributes}
        {...listeners}
      />
      <ChevronRightIcon fontSize="small" color="disabled" />
    </Stack>
  );
}

function FolderTextDialog({
  initial,
  onClose,
  onSave,
}: {
  initial: string;
  onClose: () => void;
  onSave: (text: string) => void;
}) {
  const { t } = useTranslation(["app", "common"]);
  const [text, setText] = React.useState(initial);
  const trimmed = text.trim();
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t("adminSettings.storage.customFolder")}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {t("adminSettings.storage.customFolderHint")}
        </Typography>
        <TextField
          fullWidth
          size="small"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && trimmed && !trimmed.includes("/")) onSave(trimmed);
          }}
          placeholder="Library"
          error={trimmed.includes("/")}
          helperText={trimmed.includes("/") ? t("adminSettings.storage.customFolderSlash") : undefined}
          slotProps={{ input: { sx: { fontFamily: "monospace" } } }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:cancel")}</Button>
        <Button variant="contained" disabled={!trimmed || trimmed.includes("/")} onClick={() => onSave(trimmed)}>
          {t("common:save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
