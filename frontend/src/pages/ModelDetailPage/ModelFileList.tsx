import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import PrintIcon from "@mui/icons-material/Print";
import HelpTip from "../../components/HelpTip";
import PlateThumbnail from "../../components/media/PlateThumbnail";
import { fileRowText } from "./fileRowText";
import type { ModelFile } from "./useOpenInSlicer";

/** Rows visible before the list scrolls, and the height reserved for one (a row with wrapped badges is taller). */
export const VISIBLE_ROWS = 4;
const ROW_HEIGHT_PX = 60;
const THUMB_PX = 40;

type Props = {
  files: ModelFile[];
  selected: ModelFile;
  onSelect: (file: ModelFile) => void;
};

/** Where keyboard focus moves for a key, or null when the key is not a navigation key. */
export function nextFocusIndex(key: string, current: number, count: number): number | null {
  switch (key) {
    case "ArrowDown":
      return Math.min(count - 1, current + 1);
    case "ArrowUp":
      return Math.max(0, current - 1);
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

function FileThumb({ file }: { file: ModelFile }) {
  return file.plate ? (
    <PlateThumbnail plate={file.plate} size={THUMB_PX} />
  ) : (
    <Box
      sx={{
        width: THUMB_PX,
        height: THUMB_PX,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 0.75,
        bgcolor: "action.hover",
      }}
    >
      <PrintIcon fontSize="small" />
    </Box>
  );
}

/**
 * The files of a model: the one the open and download actions apply to is selected here. A single file shows
 * the same row, only as information.
 */
export default function ModelFileList({ files, selected, onSelect }: Props) {
  const { t, i18n } = useTranslation(["models"]);
  const selectable = files.length > 1;
  const selectedIndex = Math.max(
    0,
    files.findIndex((file) => file.key === selected.key),
  );
  const [focusIndex, setFocusIndex] = useState(selectedIndex);
  const rows = useRef<(HTMLElement | null)[]>([]);

  // A selection made elsewhere (or a new file set) moves the roving focus point with it.
  useEffect(() => setFocusIndex(selectedIndex), [selectedIndex]);
  useEffect(() => {
    rows.current[selectedIndex]?.scrollIntoView?.({ block: "nearest" });
  }, [selectedIndex]);

  const textOf = (file: ModelFile) =>
    file.plate
      ? fileRowText(t, file.filename, file.index, file.plate.profile, i18n.resolvedLanguage ?? i18n.language)
      : { primary: t("models:detail.preparedPrintFile"), secondary: file.filename };

  const onKeyDown = (e: KeyboardEvent) => {
    const next = nextFocusIndex(e.key, focusIndex, files.length);
    if (next == null) return;
    e.preventDefault();
    setFocusIndex(next);
    rows.current[next]?.focus();
    rows.current[next]?.scrollIntoView?.({ block: "nearest" });
  };

  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
        {t("models:detail.fileSelectLabel", { count: files.length })}
      </Typography>
      <List
        disablePadding
        role={selectable ? "listbox" : "list"}
        aria-label={t("models:detail.fileListAria")}
        onKeyDown={selectable ? onKeyDown : undefined}
        sx={(theme) => {
          const fade = alpha(theme.palette.text.primary, 0.18);
          const paper = theme.palette.background.paper;
          return {
            maxHeight: VISIBLE_ROWS * ROW_HEIGHT_PX,
            overflowY: "auto",
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 2,
            // Soft edge shadows that only show where more rows are hidden (cover trick, no scroll listener).
            background: [
              `linear-gradient(${paper} 30%, transparent) top / 100% 24px no-repeat local`,
              `linear-gradient(transparent, ${paper} 70%) bottom / 100% 24px no-repeat local`,
              `radial-gradient(farthest-side at 50% 0, ${fade}, transparent) top / 100% 8px no-repeat scroll`,
              `radial-gradient(farthest-side at 50% 100%, ${fade}, transparent) bottom / 100% 8px no-repeat scroll`,
              paper,
            ].join(", "),
          };
        }}
      >
        {files.map((file, i) => {
          const text = textOf(file);
          const isSelected = selectable && file.key === selected.key;
          return (
            <ListItemButton
              key={file.key}
              ref={(el: HTMLElement | null) => {
                rows.current[i] = el;
              }}
              component={selectable ? "li" : "div"}
              role={selectable ? "option" : "listitem"}
              aria-selected={selectable ? isSelected : undefined}
              tabIndex={selectable ? (i === focusIndex ? 0 : -1) : -1}
              disableRipple={!selectable}
              selected={isSelected}
              onClick={selectable ? () => onSelect(file) : undefined}
              onFocus={selectable ? () => setFocusIndex(i) : undefined}
              onKeyDown={
                selectable
                  ? (e: KeyboardEvent) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelect(file);
                      }
                    }
                  : undefined
              }
              sx={(theme) => ({
                gap: 1.25,
                px: 1,
                py: 0.75,
                alignItems: "flex-start",
                cursor: selectable ? "pointer" : "default",
                borderLeft: "3px solid",
                borderLeftColor: isSelected ? "primary.main" : "transparent",
                transition: theme.transitions.create(["background-color", "border-color"], { duration: 150 }),
                "@media (prefers-reduced-motion: reduce)": { transition: "none" },
                "&.Mui-focusVisible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: -2 },
                ...(!selectable && { "&:hover": { bgcolor: "transparent" } }),
              })}
            >
              <FileThumb file={file} />
              <Tooltip title={file.filename} enterDelay={500} placement="top-start">
                <ListItemText
                  primary={text.primary}
                  secondary={text.secondary}
                  sx={{ m: 0, minWidth: 0, flex: "1 1 auto" }}
                  primaryTypographyProps={{ variant: "body2", fontWeight: 600, noWrap: true }}
                  secondaryTypographyProps={{ variant: "caption", component: "div" }}
                />
              </Tooltip>
              {file.plate?.is_default && (
                <Box sx={{ display: "inline-flex", alignItems: "center", flexShrink: 0, mt: 0.25 }}>
                  <Chip size="small" variant="outlined" color="primary" label={t("models:detail.defaultFile")} />
                  <HelpTip text={t("models:detail.defaultFileHelp")} />
                </Box>
              )}
            </ListItemButton>
          );
        })}
      </List>
    </Box>
  );
}
